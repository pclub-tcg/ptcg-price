// P’CLUB 競標市場（Cloudflare Worker＋D1）
// 身分：玩家在 LINE 傳「競標」→ 機器人回一個帶 token 的網址 → 網站存 token，之後出價都綁這個 LINE 帳號。
// 不經手金流：結標後通知得標者與賣家，雙方自行聯絡交易。
// 資料表只建在 D1，不會被每天匯入商品資料（products）影響。

const EXTEND_MS = 3 * 60 * 1000;      // 最後 3 分鐘有人出價就延長 3 分鐘（防秒殺）
const MAX_LIVE = 20;                  // 每人同時上架上限
const MAX_PHOTO = 450 * 1024;         // 照片（壓縮後 data URL）上限
let READY = false;

async function ensure(env) {
  if (READY) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS a_users (token TEXT PRIMARY KEY, uid TEXT NOT NULL, name TEXT, created INTEGER)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS auctions (id INTEGER PRIMARY KEY AUTOINCREMENT, seller TEXT NOT NULL, sname TEXT, title TEXT NOT NULL, cond TEXT, note TEXT, photo TEXT, start INTEGER NOT NULL, inc INTEGER NOT NULL, buynow INTEGER, price INTEGER, bidder TEXT, bname TEXT, nbids INTEGER DEFAULT 0, ends INTEGER NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'live', contact TEXT, ref INTEGER, notified INTEGER DEFAULT 0)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS a_bids (aid INTEGER NOT NULL, uid TEXT NOT NULL, name TEXT, amount INTEGER NOT NULL, at INTEGER NOT NULL)"),
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
  return await env.DB.prepare("SELECT uid, name FROM a_users WHERE token = ?").bind(t).first();
}

// 公開欄位（不含照片本體、不含 LINE userId）
function pub(a, me) {
  return { id: a.id, title: a.title, cond: a.cond, note: a.note, photo: a.photo ? 1 : 0, start: a.start, inc: a.inc, buynow: a.buynow, price: a.price, nbids: a.nbids,
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
      await push(env, a.bidder, [btnMsg(env, "🎉 恭喜得標", `${a.title}｜${ntd(a.price)}。請在 24 小時內聯絡賣家完成交易。`, a.id, "看賣家聯絡方式")]);
      await push(env, a.seller, [btnMsg(env, "✅ 你的競標已結標", `${a.title}｜${ntd(a.price)}，得標者 ${a.bname || "玩家"}。`, a.id, "看得標者")]);
    } else await push(env, a.seller, [btnMsg(env, "競標已結束（流標）", `${a.title} 沒有人出價，可以重新上架。`, a.id)]);
  }
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
      const a = await env.DB.prepare("SELECT photo FROM auctions WHERE id = ?").bind(+p.slice(6) || 0).first();
      const m = a && a.photo && a.photo.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
      if (!m) return new Response("Not found", { status: 404, headers: cors(env, req) });
      const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
      return new Response(bin, { headers: { "content-type": m[1], "cache-control": "public, max-age=86400", ...cors(env, req) } });
    }
    if (p === "list") {
      if (Math.random() < 0.3) await settle(env); else await env.DB.prepare("UPDATE auctions SET status = 'ended' WHERE status = 'live' AND ends <= ?").bind(now).run();
      const me = await who(env, req), st = url.searchParams.get("st") || "live";
      const cols = "id, seller, sname, title, cond, note, CASE WHEN photo IS NULL OR photo = '' THEN 0 ELSE 1 END AS photo, start, inc, buynow, price, bidder, bname, nbids, ends, created, status, contact, ref";
      let q;
      if (st === "mine" && me) q = env.DB.prepare(`SELECT ${cols} FROM auctions WHERE status != 'cancel' AND (seller = ?1 OR bidder = ?1 OR id IN (SELECT aid FROM a_bids WHERE uid = ?1)) ORDER BY ends DESC LIMIT 100`).bind(me.uid);
      else if (st === "ended") q = env.DB.prepare(`SELECT ${cols} FROM auctions WHERE status = 'ended' ORDER BY ends DESC LIMIT 60`);
      else q = env.DB.prepare(`SELECT ${cols} FROM auctions WHERE status = 'live' ORDER BY ends ASC LIMIT 200`);
      const { results = [] } = await q.all();
      return J(env, req, { now, me: me ? { name: me.name } : null, items: results.map(a => pub(a, me)) });
    }
    if (p.startsWith("item/")) {
      const id = +p.slice(5) || 0, me = await who(env, req);
      const a = await env.DB.prepare("SELECT * FROM auctions WHERE id = ? AND status != 'cancel'").bind(id).first();
      if (!a) return J(env, req, { err: "找不到這個競標" }, 404);
      if (a.status === "live" && a.ends <= now) { await settle(env); a.status = "ended"; }
      const { results = [] } = await env.DB.prepare("SELECT uid, name, amount, at FROM a_bids WHERE aid = ? ORDER BY amount DESC LIMIT 30").bind(id).all();
      return J(env, req, { now, me: me ? { name: me.name } : null, item: pub(a, me), bids: results.map(b => ({ name: mask(b.name), amount: b.amount, at: b.at, me: !!(me && b.uid === me.uid) })) });
    }
    if (req.method !== "POST") return J(env, req, { err: "not found" }, 404);
    const me = await who(env, req);
    if (!me) return J(env, req, { err: "請先從 LINE 登入（傳「競標」給 P’CLUB 官方帳號）", login: 1 }, 401);
    const b = await req.json().catch(() => ({}));

    if (p === "create") {
      const title = clip(b.title, 60), start = Math.round(+b.start), inc = Math.round(+b.inc), hours = Math.round(+b.hours), buynow = b.buynow ? Math.round(+b.buynow) : null;
      if (title.length < 2) return J(env, req, { err: "請填商品名稱" }, 400);
      if (!(start >= 1 && start <= 10000000)) return J(env, req, { err: "起標價要在 NT$1～10,000,000" }, 400);
      if (!(inc >= 1 && inc <= start + 100000)) return J(env, req, { err: "每次加價至少 NT$1" }, 400);
      if (![1, 3, 6, 12, 24, 48, 72, 120, 168].includes(hours)) return J(env, req, { err: "競標時間不正確" }, 400);
      if (buynow != null && !(buynow > start)) return J(env, req, { err: "直購價要高於起標價" }, 400);
      const photo = typeof b.photo === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(b.photo) ? b.photo : null;
      if (photo && photo.length > MAX_PHOTO) return J(env, req, { err: "照片太大，請換一張" }, 400);
      const contact = clip(b.contact, 60);
      if (!contact) return J(env, req, { err: "請填聯絡方式（結標後只給得標者看）" }, 400);
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM auctions WHERE seller = ? AND status = 'live'").bind(me.uid).first();
      if (n && n.n >= MAX_LIVE) return J(env, req, { err: `同時最多上架 ${MAX_LIVE} 件` }, 400);
      const r = await env.DB.prepare("INSERT INTO auctions (seller, sname, title, cond, note, photo, start, inc, buynow, price, nbids, ends, created, status, contact, ref) VALUES (?,?,?,?,?,?,?,?,?,NULL,0,?,?,'live',?,?)")
        .bind(me.uid, me.name, title, clip(b.cond, 20), clip(b.note, 300), photo, start, inc, buynow, now + hours * 3600e3, now, contact, b.ref ? Math.round(+b.ref) || null : null).run();
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
      if (!dup) await env.DB.prepare("INSERT INTO a_reports VALUES (?, ?, ?, ?)").bind(id, me.uid, clip(b.reason, 200), now).run();
      return J(env, req, { ok: 1 });
    }
    return J(env, req, { err: "not found" }, 404);
  } catch (e) {
    console.error("auction api", e && e.stack || e);
    return J(env, req, { err: "系統忙碌，請稍後再試" }, 500);
  }
}
