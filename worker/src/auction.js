// P’CLUB 競標市場（Cloudflare Worker＋D1）
// 身分：玩家在 LINE 傳「競標」→ 機器人回一個帶 token 的網址 → 網站存 token，之後出價都綁這個 LINE 帳號。
// 不經手金流：結標後通知得標者與賣家，雙方自行聯絡交易。
// 資料表只建在 D1，不會被每天匯入商品資料（products）影響。

const EXTEND_MS = 3 * 60 * 1000;      // 最後 3 分鐘有人出價就延長 3 分鐘（防秒殺）
const MAX_LIVE = 20;                  // 每人同時上架上限
const MAX_PHOTO = 600 * 1024;         // 照片（壓縮後 JPEG）上限
const CHUNK = 60 * 1024;              // 照片分段存（D1 單一參數／語句有大小限制）
let READY = false, CATALOG = null;
export const setCatalog = fn => { CATALOG = fn; }; // index.js 提供商品目錄搜尋（上架時帶入日本行情）

async function ensure(env) {
  if (READY) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS a_users (token TEXT PRIMARY KEY, uid TEXT NOT NULL, name TEXT, created INTEGER)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS auctions (id INTEGER PRIMARY KEY AUTOINCREMENT, seller TEXT NOT NULL, sname TEXT, title TEXT NOT NULL, cond TEXT, note TEXT, photo TEXT, start INTEGER NOT NULL, inc INTEGER NOT NULL, buynow INTEGER, price INTEGER, bidder TEXT, bname TEXT, nbids INTEGER DEFAULT 0, ends INTEGER NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'live', contact TEXT, ref INTEGER, notified INTEGER DEFAULT 0)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS a_bids (aid INTEGER NOT NULL, uid TEXT NOT NULL, name TEXT, amount INTEGER NOT NULL, at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS a_photos (aid INTEGER NOT NULL, i INTEGER NOT NULL, mime TEXT, data BLOB)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS a_watch (aid INTEGER NOT NULL, uid TEXT NOT NULL, warned INTEGER DEFAULT 0)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS a_ratings (aid INTEGER NOT NULL, from_uid TEXT NOT NULL, to_uid TEXT NOT NULL, score INTEGER NOT NULL, abandon INTEGER DEFAULT 0, note TEXT, at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS a_banned (uid TEXT NOT NULL, reason TEXT, at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS a_reports (aid INTEGER NOT NULL, uid TEXT NOT NULL, reason TEXT, at INTEGER NOT NULL)"),
  ]);
  READY = true;
}

const mask = n => { const a = [...String(n || "玩家")]; return a.length <= 2 ? a[0] + "*" : a[0] + "*".repeat(Math.min(3, a.length - 2)) + a[a.length - 1]; };
const ntd = v => "NT$" + Math.round(v).toLocaleString("en-US");
const clip = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

function cors(env, req) {
  const o = req.headers.get("origin") || "", site = env.SITE_URL ? new URL(env.SITE_URL).origin : "";
  return { "access-control-allow-origin": o && (o === site || /^http:\/\/localhost(:\d+)?$/.test(o)) ? o : site, "access-control-allow-headers": "content-type,x-tok", "access-control-allow-methods": "GET,POST,OPTIONS", vary: "origin" };
}
const J = (env, req, obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors(env, req) } });

async function who(env, req) {
  const t = req.headers.get("x-tok") || "";
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return null;
  const u = await env.DB.prepare("SELECT uid, name FROM a_users WHERE token = ?").bind(t).first();
  if (!u) return null;
  const [ad, bn] = await Promise.all([env.DB.prepare("SELECT v FROM meta WHERE k = 'auction_admin'").first(), env.DB.prepare("SELECT 1 AS b FROM a_banned WHERE uid = ? LIMIT 1").bind(u.uid).first()]);
  u.admin = !!(ad && ad.v === u.uid); u.banned = !!bn;
  return u;
}
const meOut = me => me ? { name: me.name, admin: me.admin ? 1 : 0, banned: me.banned ? 1 : 0 } : null;
// 評價統計：好評、負評、未完成交易（棄標／未出貨）
async function stats(env, uid) {
  if (!uid) return null;
  const r = await env.DB.prepare("SELECT SUM(score > 0) AS pos, SUM(score < 0) AS neg, SUM(abandon) AS ab FROM a_ratings WHERE to_uid = ?").bind(uid).first();
  return { pos: r && r.pos || 0, neg: r && r.neg || 0, ab: r && r.ab || 0 };
}

// 公開欄位（不含照片本體、不含 LINE userId）
function pub(a, me, W) {
  return { watched: !!(W && W.has(a.id)), id: a.id, title: a.title, cond: a.cond, note: a.note, photo: a.photo ? 1 : 0, start: a.start, inc: a.inc, buynow: a.buynow, price: a.price, nbids: a.nbids,
    ends: a.ends, created: a.created, status: a.status, ref: a.ref, seller: mask(a.sname), leader: a.bidder ? mask(a.bname) : null,
    mine: !!(me && a.seller === me.uid), leading: !!(me && a.bidder === me.uid),
    // 結標後只有得標者、賣家看得到對方聯絡方式
    contact: me && a.status === "ended" && a.bidder && (a.bidder === me.uid || a.seller === me.uid) ? { seller: a.sname, contact: a.contact, winner: a.bname } : null };
}

async function push(env, to, messages) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !to) return;
  const r = await fetch("https://api.line.me/v2/bot/message/push", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN }, body: JSON.stringify({ to, messages }) });
  if (!r.ok) console.error("push failed", r.status, await r.text());
}
const link = (env, id) => { const u = new URL("auction.html", env.SITE_URL); u.searchParams.set("openExternalBrowser", "1"); if (id) u.hash = "a" + id; return u.href; };
const btnMsg = (env, title, txt, id, label) => ({ type: "template", altText: title + "：" + txt, template: { type: "buttons", title: title.slice(0, 40), text: txt.slice(0, 60), actions: [{ type: "uri", label: label || "查看競標", uri: link(env, id) }] } });

// 結標：到期的拍賣改成 ended，並通知雙方（每筆只通知一次）
export async function settle(env) {
  if (!env.DB) return;
  await ensure(env);
  const now = Date.now();
  await env.DB.prepare("UPDATE auctions SET status = 'ended' WHERE status = 'live' AND ends <= ?").bind(now).run();
  const { results = [] } = await env.DB.prepare("SELECT * FROM auctions WHERE status = 'ended' AND notified = 0 LIMIT 20").all();
  for (const a of results) {
    const ok = await env.DB.prepare("UPDATE auctions SET notified = 1 WHERE id = ? AND notified = 0").bind(a.id).run();
    if (!ok.meta || !ok.meta.changes) continue;
    if (a.bidder) {
      await push(env, a.bidder, [btnMsg(env, "🎉 恭喜得標", `${a.title}｜${ntd(a.price)}。請在 24 小時內聯絡賣家，交易後記得評價。`, a.id, "看賣家聯絡方式")]);
      await push(env, a.seller, [btnMsg(env, "✅ 你的競標已結標", `${a.title}｜${ntd(a.price)}，得標者 ${a.bname || "玩家"}。`, a.id, "看得標者")]);
    } else await push(env, a.seller, [btnMsg(env, "競標已結束（流標）", `${a.title} 沒有人出價，可以重新上架。`, a.id)]);
  }
  // 關注的商品 30 分鐘內結標：提醒一次（目前最高出價者不用提醒）
  const { results: ws = [] } = await env.DB.prepare("SELECT w.rowid AS rid, w.uid, a.id, a.title, a.price, a.start, a.nbids, a.bidder FROM a_watch w JOIN auctions a ON a.id = w.aid WHERE w.warned = 0 AND a.status = 'live' AND a.ends > ? AND a.ends <= ? LIMIT 50").bind(now, now + 30 * 60e3).all();
  for (const w of ws) {
    await env.DB.prepare("UPDATE a_watch SET warned = 1 WHERE rowid = ?").bind(w.rid).run();
    if (w.uid !== w.bidder) await push(env, w.uid, [btnMsg(env, "⏰ 關注的商品快結標了", `${w.title} 30 分鐘內結標，目前 ${ntd(w.nbids ? w.price : w.start)}。`, w.id, "去出價")]);
  }
}

// LINE 傳「管理競標」：第一個傳的人成為管理員（之後只有他能用）
export async function lineAdmin(env, uid) {
  await ensure(env);
  const ad = await env.DB.prepare("SELECT v FROM meta WHERE k = 'auction_admin'").first();
  if (ad && ad.v && ad.v !== uid) return { type: "text", text: "你不是競標管理員。" };
  if (!ad) await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('auction_admin', ?)").bind(uid).run();
  const m = await lineToken(env, uid);
  m.template.title = "競標管理後台"; m.template.text = (ad ? "" : "已把你設為管理員。") + "打開後點「管理」分頁，可以看檢舉、下架、停權。";
  m.template.actions[0].uri = m.template.actions[0].uri.replace("#t=", "#admin&t="); m.template.actions[0].label = "打開管理後台";
  return m;
}

// LINE 傳「競標」：發一個綁定這個 LINE 帳號的 token
export async function lineToken(env, uid) {
  await ensure(env);
  let name = "";
  try { const r = await fetch("https://api.line.me/v2/bot/profile/" + uid, { headers: { authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN } }); if (r.ok) name = (await r.json()).displayName || ""; } catch (e) {}
  const old = await env.DB.prepare("SELECT token FROM a_users WHERE uid = ? ORDER BY created DESC LIMIT 1").bind(uid).first();
  let token = old && old.token;
  if (token) await env.DB.prepare("UPDATE a_users SET name = ? WHERE uid = ?").bind(clip(name, 30) || "玩家", uid).run();
  else {
    const b = crypto.getRandomValues(new Uint8Array(24));
    token = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await env.DB.prepare("INSERT INTO a_users VALUES (?, ?, ?, ?)").bind(token, uid, clip(name, 30) || "玩家", Date.now()).run();
  }
  const u = new URL("auction.html", env.SITE_URL); u.searchParams.set("openExternalBrowser", "1"); u.hash = "t=" + token;
  return { type: "template", altText: "P’CLUB 競標市場：" + u.href, template: { type: "buttons", title: "P’CLUB 競標市場", text: `${name ? name + "，" : ""}用這個按鈕打開就會自動登入，可以出價和上架。不要把連結給別人。`.slice(0, 60), actions: [{ type: "uri", label: "打開競標市場", uri: u.href }] } };
}

export async function auctionApi(req, env, url) {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(env, req) });
  if (!env.DB) return J(env, req, { err: "競標暫時無法使用" }, 503);
  await ensure(env);
  const p = url.pathname.replace(/^\/api\/a\/?/, ""), now = Date.now();
  try {
    if (p.startsWith("photo/")) {
      const id = +p.slice(6) || 0;
      if (req.method === "POST") { // 上架後另外上傳照片（二進位，不轉 base64，省 CPU）
        const me = await who(env, req);
        if (!me) return J(env, req, { err: "請先登入", login: 1 }, 401);
        const a = await env.DB.prepare("SELECT seller FROM auctions WHERE id = ?").bind(id).first();
        if (!a || a.seller !== me.uid) return J(env, req, { err: "只能替自己的商品上傳照片" }, 403);
        const mime = (req.headers.get("content-type") || "").split(";")[0];
        if (!/^image\/(jpeg|png|webp)$/.test(mime)) return J(env, req, { err: "照片格式不支援" }, 400);
        const buf = new Uint8Array(await req.arrayBuffer());
        if (!buf.length || buf.length > MAX_PHOTO) return J(env, req, { err: "照片太大，請換一張" }, 400);
        const st = [env.DB.prepare("DELETE FROM a_photos WHERE aid = ?").bind(id)];
        for (let i = 0, k = 0; i < buf.length; i += CHUNK, k++) st.push(env.DB.prepare("INSERT INTO a_photos VALUES (?, ?, ?, ?)").bind(id, k, mime, buf.slice(i, i + CHUNK).buffer));
        st.push(env.DB.prepare("UPDATE auctions SET photo = 'p' WHERE id = ?").bind(id));
        await env.DB.batch(st);
        return J(env, req, { ok: 1 });
      }
      const { results = [] } = await env.DB.prepare("SELECT mime, data FROM a_photos WHERE aid = ? ORDER BY i").bind(id).all();
      if (!results.length) return new Response("Not found", { status: 404, headers: cors(env, req) });
      const parts = results.map(r => new Uint8Array(r.data instanceof ArrayBuffer ? r.data : r.data)), n = parts.reduce((t, x) => t + x.length, 0), bin = new Uint8Array(n);
      let o = 0; for (const x of parts) { bin.set(x, o); o += x.length; }
      return new Response(bin, { headers: { "content-type": results[0].mime || "image/jpeg", "cache-control": "public, max-age=86400", ...cors(env, req) } });
    }
    if (p === "list") {
      if (Math.random() < 0.3) await settle(env); else await env.DB.prepare("UPDATE auctions SET status = 'ended' WHERE status = 'live' AND ends <= ?").bind(now).run();
      const me = await who(env, req), st = url.searchParams.get("st") || "live";
      const cols = "id, seller, sname, title, cond, note, CASE WHEN photo IS NULL OR photo = '' THEN 0 ELSE 1 END AS photo, start, inc, buynow, price, bidder, bname, nbids, ends, created, status, contact, ref";
      let q;
      if (st === "mine" && me) q = env.DB.prepare(`SELECT ${cols} FROM auctions WHERE status != 'cancel' AND (seller = ?1 OR bidder = ?1 OR id IN (SELECT aid FROM a_bids WHERE uid = ?1)) ORDER BY ends DESC LIMIT 100`).bind(me.uid);
      else if (st === "ended") q = env.DB.prepare(`SELECT ${cols} FROM auctions WHERE status = 'ended' ORDER BY ends DESC LIMIT 60`);
      else q = env.DB.prepare(`SELECT ${cols} FROM auctions WHERE status = 'live' ORDER BY ends ASC LIMIT 200`);
      if (st === "watch" && me) q = env.DB.prepare(`SELECT ${cols} FROM auctions WHERE status != 'cancel' AND id IN (SELECT aid FROM a_watch WHERE uid = ?) ORDER BY ends DESC LIMIT 100`).bind(me.uid);
      const { results = [] } = await q.all();
      const W = me ? new Set(((await env.DB.prepare("SELECT aid FROM a_watch WHERE uid = ?").bind(me.uid).all()).results || []).map(r => r.aid)) : null;
      return J(env, req, { now, me: meOut(me), items: results.map(a => pub(a, me, W)) });
    }
    if (p.startsWith("item/")) {
      const id = +p.slice(5) || 0, me = await who(env, req);
      const a = await env.DB.prepare("SELECT * FROM auctions WHERE id = ? AND status != 'cancel'").bind(id).first();
      if (!a) return J(env, req, { err: "找不到這個競標" }, 404);
      if (a.status === "live" && a.ends <= now) { await settle(env); a.status = "ended"; }
      const { results = [] } = await env.DB.prepare("SELECT uid, name, amount, at FROM a_bids WHERE aid = ? ORDER BY amount DESC LIMIT 30").bind(id).all();
      const W = me ? new Set(((await env.DB.prepare("SELECT aid FROM a_watch WHERE uid = ? AND aid = ?").bind(me.uid, id).all()).results || []).map(r => r.aid)) : null;
      const party = me && a.status === "ended" && a.bidder && (a.seller === me.uid || a.bidder === me.uid);
      const myRate = party ? await env.DB.prepare("SELECT score, abandon, note FROM a_ratings WHERE aid = ? AND from_uid = ?").bind(id, me.uid).first() : null;
      return J(env, req, { now, me: meOut(me), sellerStats: await stats(env, a.seller), leaderStats: a.bidder ? await stats(env, a.bidder) : null,
        rate: party ? { can: !myRate, mine: myRate, role: a.seller === me.uid ? "seller" : "buyer", abandonOk: now - a.ends > 24 * 3600e3 } : null,
        item: pub(a, me, W), bids: results.map(b => ({ name: mask(b.name), amount: b.amount, at: b.at, me: !!(me && b.uid === me.uid) })) });
    }
    if (p === "search") {
      const q = clip(url.searchParams.get("q"), 40);
      if (q.length < 1 || !CATALOG) return J(env, req, { items: [] });
      return J(env, req, { items: await CATALOG(q, env) });
    }
    if (p === "admin/reports") {
      const me = await who(env, req);
      if (!me || !me.admin) return J(env, req, { err: "只有管理員可以看" }, 403);
      const { results: rs = [] } = await env.DB.prepare("SELECT a.id, a.title, a.status, a.seller, a.sname, COUNT(*) AS n, GROUP_CONCAT(r.reason, '｜') AS reasons, MAX(r.at) AS last FROM a_reports r JOIN auctions a ON a.id = r.aid GROUP BY a.id ORDER BY last DESC LIMIT 100").all();
      const { results: bs = [] } = await env.DB.prepare("SELECT b.uid, b.reason, b.at, (SELECT name FROM a_users u WHERE u.uid = b.uid LIMIT 1) AS name FROM a_banned b ORDER BY b.at DESC LIMIT 100").all();
      const { results: ab = [] } = await env.DB.prepare("SELECT to_uid AS uid, (SELECT name FROM a_users u WHERE u.uid = to_uid LIMIT 1) AS name, SUM(abandon) AS ab, SUM(score < 0) AS neg FROM a_ratings GROUP BY to_uid HAVING ab > 0 OR neg > 0 ORDER BY ab DESC, neg DESC LIMIT 100").all();
      return J(env, req, { reports: rs, banned: bs, bad: ab });
    }
    if (req.method !== "POST") return J(env, req, { err: "not found" }, 404);
    const me = await who(env, req);
    if (!me) return J(env, req, { err: "請先從 LINE 登入（傳「競標」給 P’CLUB 官方帳號）", login: 1 }, 401);
    const b = await req.json().catch(() => ({}));
    if (me.banned && ["create", "bid", "rate"].includes(p)) return J(env, req, { err: "你的帳號已被停權，無法上架或出價。如有疑問請聯絡 P’CLUB 官方帳號。" }, 403);

    if (p === "watch") {
      const id = +b.id || 0;
      await env.DB.prepare("DELETE FROM a_watch WHERE aid = ? AND uid = ?").bind(id, me.uid).run();
      if (b.on) await env.DB.prepare("INSERT INTO a_watch (aid, uid, warned) VALUES (?, ?, 0)").bind(id, me.uid).run();
      return J(env, req, { ok: 1, on: b.on ? 1 : 0 });
    }

    if (p === "rate") {
      const id = +b.id || 0, score = +b.score > 0 ? 1 : -1;
      const a = await env.DB.prepare("SELECT seller, bidder, status, ends FROM auctions WHERE id = ?").bind(id).first();
      if (!a || a.status !== "ended" || !a.bidder || (a.seller !== me.uid && a.bidder !== me.uid)) return J(env, req, { err: "只有得標者和賣家可以互相評價" }, 403);
      if (await env.DB.prepare("SELECT 1 FROM a_ratings WHERE aid = ? AND from_uid = ?").bind(id, me.uid).first()) return J(env, req, { err: "你已經評價過了" }, 400);
      const abandon = b.abandon && now - a.ends > 24 * 3600e3 ? 1 : 0;
      if (b.abandon && !abandon) return J(env, req, { err: "結標 24 小時後才能回報對方未完成交易" }, 400);
      await env.DB.prepare("INSERT INTO a_ratings VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, me.uid, a.seller === me.uid ? a.bidder : a.seller, abandon ? -1 : score, abandon, clip(b.note, 100), now).run();
      return J(env, req, { ok: 1 });
    }

    if (p === "admin/act") {
      if (!me.admin) return J(env, req, { err: "只有管理員可以操作" }, 403);
      const id = +b.id || 0;
      if (b.action === "remove") await env.DB.prepare("UPDATE auctions SET status = 'cancel' WHERE id = ?").bind(id).run();
      else if (b.action === "ban" || b.action === "unban") {
        const uid = b.uid || (await env.DB.prepare("SELECT seller FROM auctions WHERE id = ?").bind(id).first() || {}).seller;
        if (!uid) return J(env, req, { err: "找不到這個使用者" }, 400);
        await env.DB.prepare("DELETE FROM a_banned WHERE uid = ?").bind(uid).run();
        if (b.action === "ban") await env.DB.batch([env.DB.prepare("INSERT INTO a_banned VALUES (?, ?, ?)").bind(uid, clip(b.reason, 100) || "管理員停權", now), env.DB.prepare("UPDATE auctions SET status = 'cancel' WHERE seller = ? AND status = 'live'").bind(uid)]);
      } else if (b.action === "dismiss") await env.DB.prepare("DELETE FROM a_reports WHERE aid = ?").bind(id).run();
      else return J(env, req, { err: "不明的操作" }, 400);
      return J(env, req, { ok: 1 });
    }

    if (p === "create") {
      const title = clip(b.title, 60), start = Math.round(+b.start), inc = Math.round(+b.inc), hours = Math.round(+b.hours), buynow = b.buynow ? Math.round(+b.buynow) : null;
      if (title.length < 2) return J(env, req, { err: "請填商品名稱" }, 400);
      if (!(start >= 1 && start <= 10000000)) return J(env, req, { err: "起標價要在 NT$1～10,000,000" }, 400);
      if (!(inc >= 1 && inc <= start + 100000)) return J(env, req, { err: "每次加價至少 NT$1" }, 400);
      if (![1, 3, 6, 12, 24, 48, 72, 120, 168].includes(hours)) return J(env, req, { err: "競標時間不正確" }, 400);
      if (buynow != null && !(buynow > start && buynow <= 10000000)) return J(env, req, { err: "直購價要高於起標價，且不超過 NT$10,000,000" }, 400);
      const contact = clip(b.contact, 60);
      if (!contact) return J(env, req, { err: "請填聯絡方式（結標後只給得標者看）" }, 400);
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM auctions WHERE seller = ? AND status = 'live'").bind(me.uid).first();
      if (n && n.n >= MAX_LIVE) return J(env, req, { err: `同時最多上架 ${MAX_LIVE} 件` }, 400);
      const r = await env.DB.prepare("INSERT INTO auctions (seller, sname, title, cond, note, photo, start, inc, buynow, price, nbids, ends, created, status, contact, ref) VALUES (?,?,?,?,?,NULL,?,?,?,NULL,0,?,?,'live',?,?)")
        .bind(me.uid, me.name || "玩家", title, clip(b.cond, 20), clip(b.note, 300), start, inc, buynow, now + hours * 3600e3, now, contact, b.ref ? Math.round(+b.ref) || null : null).run();
      return J(env, req, { ok: 1, id: r.meta.last_row_id });
    }

    if (p === "bid") {
      const id = +b.id || 0, amount = Math.round(+b.amount);
      const a = await env.DB.prepare("SELECT * FROM auctions WHERE id = ?").bind(id).first();
      if (!a || a.status !== "live" || a.ends <= now) return J(env, req, { err: "這個競標已經結束" }, 400);
      if (a.seller === me.uid) return J(env, req, { err: "不能對自己的商品出價" }, 400);
      if (a.bidder === me.uid) return J(env, req, { err: "你已經是最高出價者" }, 400);
      const min = a.nbids ? a.price + a.inc : a.start;
      if (!(amount >= min)) return J(env, req, { err: `最低要出 ${ntd(min)}`, min }, 400);
      if (amount > min * 10 + 100000) return J(env, req, { err: "出價金額太高，請確認是否打錯" }, 400);
      const buy = a.buynow && amount >= a.buynow, amt = buy ? a.buynow : amount;
      const ends = buy ? now : (a.ends - now < EXTEND_MS ? now + EXTEND_MS : a.ends);
      // 樂觀鎖：價格與出價次數沒被別人改過才會成功
      const r = await env.DB.prepare(`UPDATE auctions SET price = ?, bidder = ?, bname = ?, nbids = nbids + 1, ends = ?${buy ? ", status = 'ended'" : ""} WHERE id = ? AND status = 'live' AND nbids = ? AND IFNULL(price, -1) = IFNULL(?, -1)`)
        .bind(amt, me.uid, me.name, ends, id, a.nbids, a.price).run();
      if (!r.meta || !r.meta.changes) return J(env, req, { err: "剛剛有人搶先出價了，請重新整理再出價" }, 409);
      await env.DB.prepare("INSERT INTO a_bids VALUES (?, ?, ?, ?, ?)").bind(id, me.uid, me.name, amt, now).run();
      if (a.bidder && a.bidder !== me.uid && !buy) await push(env, a.bidder, [btnMsg(env, "⚠️ 你被超標了", `${a.title} 目前出價 ${ntd(amt)}，要再加價嗎？`, id, "再出價")]);
      if (buy) await settle(env);
      return J(env, req, { ok: 1, price: amt, ends, won: buy ? 1 : 0, extended: ends !== a.ends && !buy ? 1 : 0 });
    }

    if (p === "cancel") {
      const r = await env.DB.prepare("UPDATE auctions SET status = 'cancel' WHERE id = ? AND seller = ? AND status = 'live' AND nbids = 0").bind(+b.id || 0, me.uid).run();
      return r.meta && r.meta.changes ? J(env, req, { ok: 1 }) : J(env, req, { err: "已經有人出價或已結束，不能下架" }, 400);
    }

    if (p === "report") {
      const id = +b.id || 0, dup = await env.DB.prepare("SELECT 1 FROM a_reports WHERE aid = ? AND uid = ?").bind(id, me.uid).first();
      const own = await env.DB.prepare("SELECT 1 FROM auctions WHERE id = ? AND seller = ?").bind(id, me.uid).first();
      if (own) return J(env, req, { err: "不能檢舉自己的商品" }, 400);
      if (!dup) await env.DB.prepare("INSERT INTO a_reports VALUES (?, ?, ?, ?)").bind(id, me.uid, clip(b.reason, 200), now).run();
      return J(env, req, { ok: 1 });
    }
    return J(env, req, { err: "not found" }, 404);
  } catch (e) {
    console.error("auction api", e && e.stack || e);
    const m = String(e && e.message || e);
    if (/daily row write limit|exceeded D1/i.test(m)) return J(env, req, { err: "今天資料庫寫入額度已用完，台灣時間早上 8 點後恢復，請明天再上架／出價" }, 503);
    return J(env, req, { err: "系統忙碌，請稍後再試（" + m.slice(0, 120) + "）" }, 500);
  }
}
