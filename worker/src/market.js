// P’CLUB 市集：玩家刊登卡片，買家直購或出價議價（Cloudflare Worker＋D1）
// 身分和競標共用：LINE 傳「市集」或「競標」拿到 token（a_users），停權名單（a_banned）、管理員（meta.auction_admin）也共用。
// 不經手金流：成交（保留）後通知雙方，互相看到聯絡方式，自行面交／寄送；完成後互相評價。
// 狀態：live 刊登中 → held 已保留（有買家）→ sold 已售出；cancel 下架；expired 過期（30 天沒更新）

const FREE_QUOTA = 10;                 // 每人同時刊登（刊登中＋保留中）免費上限，管理員可替個別玩家調高
const MAX_PHOTOS = 4;
const MAX_PHOTO = 600 * 1024;
const CHUNK = 60 * 1024;
const LIFE_MS = 30 * 864e5;
const MAX_WANTS = 20;                  // 每人同時求卡上限            // 刊登 30 天沒更新就過期
const OFFER_MS = 48 * 3600e3;          // 出價 48 小時沒回覆就失效
const BUMP_MS = 24 * 3600e3;           // 每 24 小時可以「更新」一次（排到最新）
let READY = false;

async function ensure(env) {
  if (READY) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS a_users (token TEXT PRIMARY KEY, uid TEXT NOT NULL, name TEXT, created INTEGER)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS a_banned (uid TEXT NOT NULL, reason TEXT, at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS a_ratings (aid INTEGER NOT NULL, from_uid TEXT NOT NULL, to_uid TEXT NOT NULL, score INTEGER NOT NULL, abandon INTEGER DEFAULT 0, note TEXT, at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS m_items (id INTEGER PRIMARY KEY AUTOINCREMENT, seller TEXT NOT NULL, sname TEXT, shop TEXT, title TEXT NOT NULL, ip TEXT, kind TEXT, cond TEXT, note TEXT, price INTEGER NOT NULL, nego INTEGER DEFAULT 1, ref INTEGER, ckey TEXT, cimg TEXT, nphoto INTEGER DEFAULT 0, contact TEXT, status TEXT NOT NULL DEFAULT 'live', buyer TEXT, bname TEXT, bcontact TEXT, deal INTEGER, dealt INTEGER, created INTEGER NOT NULL, bumped INTEGER NOT NULL, views INTEGER DEFAULT 0)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS m_items_st ON m_items (status, bumped)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS m_photos (mid INTEGER NOT NULL, n INTEGER NOT NULL, i INTEGER NOT NULL, mime TEXT, data BLOB)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS m_offers (id INTEGER PRIMARY KEY AUTOINCREMENT, mid INTEGER NOT NULL, uid TEXT NOT NULL, name TEXT, amount INTEGER NOT NULL, msg TEXT, contact TEXT, status TEXT NOT NULL DEFAULT 'open', at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS m_watch (mid INTEGER NOT NULL, uid TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS m_follow (ckey TEXT NOT NULL, uid TEXT NOT NULL, title TEXT, at INTEGER)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS m_ratings (mid INTEGER NOT NULL, from_uid TEXT NOT NULL, to_uid TEXT NOT NULL, score INTEGER NOT NULL, abandon INTEGER DEFAULT 0, note TEXT, at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS m_reports (mid INTEGER NOT NULL, uid TEXT NOT NULL, reason TEXT, at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS m_quota (uid TEXT PRIMARY KEY, max INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS m_wants (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, name TEXT, shop TEXT, title TEXT NOT NULL, ip TEXT, kind TEXT, ckey TEXT, cimg TEXT, ref INTEGER, maxp INTEGER NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open', created INTEGER NOT NULL, bumped INTEGER NOT NULL, nresp INTEGER DEFAULT 0)"),
  ]);
  READY = true;
}

const mask = n => { const a = [...String(n || "玩家")]; return a.length <= 2 ? a[0] + "*" : a[0] + "*".repeat(Math.min(3, a.length - 2)) + a[a.length - 1]; };
const ntd = v => "NT$" + Math.round(v).toLocaleString("en-US");
const clip = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const KINDS = { card: "單卡", psa: "鑑定卡", box: "原盒", other: "其他" };

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
  u.shop = await shopId(u.uid);
  return u;
}
// 賣場代號：LINE userId 的雜湊（不公開 userId）
async function shopId(uid) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pclub-shop:" + uid)));
  return btoa(String.fromCharCode(...h.slice(0, 8))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function quota(env, me) {
  const [u, q] = await Promise.all([env.DB.prepare("SELECT COUNT(*) AS n FROM m_items WHERE seller = ? AND status IN ('live','held')").bind(me.uid).first(), env.DB.prepare("SELECT max FROM m_quota WHERE uid = ?").bind(me.uid).first()]);
  return { used: u ? u.n : 0, max: me.admin ? 999 : (q ? q.max : FREE_QUOTA) };
}
const meOut = (me, q) => me ? { name: me.name, admin: me.admin ? 1 : 0, banned: me.banned ? 1 : 0, shop: me.shop, quota: q || null } : null;
// 評價：競標＋市集一起算
async function stats(env, uid) {
  if (!uid) return null;
  const r = await env.DB.prepare("SELECT SUM(score > 0) AS pos, SUM(score < 0) AS neg, SUM(abandon) AS ab FROM (SELECT score, abandon FROM a_ratings WHERE to_uid = ?1 UNION ALL SELECT score, abandon FROM m_ratings WHERE to_uid = ?1)").bind(uid).first();
  const s = await env.DB.prepare("SELECT COUNT(*) AS n FROM m_items WHERE seller = ? AND status = 'sold'").bind(uid).first();
  return { pos: r && r.pos || 0, neg: r && r.neg || 0, ab: r && r.ab || 0, sold: s ? s.n : 0 };
}

function pub(m, me, W) {
  const party = me && (m.seller === me.uid || m.buyer === me.uid);
  return { id: m.id, title: m.title, ip: m.ip || "pk", kind: m.kind || "card", cond: m.cond, note: m.note, price: m.price, nego: m.nego ? 1 : 0, ref: m.ref, ckey: m.ckey, cimg: m.cimg,
    nphoto: m.nphoto || 0, status: m.status, created: m.created, bumped: m.bumped, views: m.views || 0, seller: mask(m.sname), shop: m.shop, deal: m.deal, dealt: m.dealt,
    mine: !!(me && m.seller === me.uid), buying: !!(me && m.buyer === me.uid), watched: !!(W && W.has(m.id)),
    // 保留／售出後，只有買賣雙方看得到對方名稱與聯絡方式
    contact: party && m.buyer && (m.status === "held" || m.status === "sold") ? { seller: m.sname, contact: m.contact, buyer: m.bname, bcontact: m.bcontact } : null };
}

function pubWant(w, me) {
  return { id: w.id, title: w.title, ip: w.ip || "pk", kind: w.kind || "card", ckey: w.ckey, cimg: w.cimg, ref: w.ref, maxp: w.maxp, note: w.note, status: w.status,
    created: w.created, bumped: w.bumped, nresp: w.nresp || 0, buyer: mask(w.name), shop: w.shop, mine: !!(me && w.uid === me.uid) };
}
async function push(env, to, messages) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !to) return;
  const r = await fetch("https://api.line.me/v2/bot/message/push", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN }, body: JSON.stringify({ to, messages }) });
  if (!r.ok) console.error("market push failed", r.status, await r.text());
}
const link = (env, id) => { const u = new URL("market.html", env.SITE_URL); u.searchParams.set("openExternalBrowser", "1"); if (id) u.hash = String(id).startsWith("w") ? id : "m" + id; return u.href; };
const btnMsg = (env, title, txt, id, label) => ({ type: "template", altText: title + "：" + txt, template: { type: "buttons", title: title.slice(0, 40), text: txt.slice(0, 60), actions: [{ type: "uri", label: (label || "查看商品").slice(0, 20), uri: link(env, id) }] } });

// LINE 傳「市集」：發登入連結（token 和競標共用）
export async function marketToken(env, uid) {
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
  const u = new URL("market.html", env.SITE_URL); u.searchParams.set("openExternalBrowser", "1"); u.hash = "t=" + token;
  return { type: "template", altText: "P’CLUB 市集：" + u.href, template: { type: "buttons", title: "P’CLUB 市集", text: `${name ? name + "，" : ""}用這個按鈕打開就會自動登入，可以刊登、購買、議價。不要把連結給別人。`.slice(0, 60), actions: [{ type: "uri", label: "打開市集", uri: u.href }] } };
}

// 每 10 分鐘：出價逾時失效、刊登過期
export async function marketCron(env) {
  if (!env.DB) return;
  await ensure(env);
  const now = Date.now();
  const { results: os = [] } = await env.DB.prepare("SELECT o.id, o.uid, o.amount, m.id AS mid, m.title FROM m_offers o JOIN m_items m ON m.id = o.mid WHERE o.status = 'open' AND o.at < ? LIMIT 30").bind(now - OFFER_MS).all();
  for (const o of os) {
    const r = await env.DB.prepare("UPDATE m_offers SET status = 'expired' WHERE id = ? AND status = 'open'").bind(o.id).run();
    if (r.meta && r.meta.changes) await push(env, o.uid, [btnMsg(env, "出價已失效", `${o.title} 的出價 ${ntd(o.amount)} 賣家 48 小時沒回覆，已自動失效。`, o.mid, "再看看")]);
  }
  await env.DB.prepare("UPDATE m_wants SET status = 'expired' WHERE status = 'open' AND bumped < ?").bind(now - 2 * LIFE_MS).run();
  const { results: ex = [] } = await env.DB.prepare("SELECT id, seller, title FROM m_items WHERE status = 'live' AND bumped < ? LIMIT 30").bind(now - LIFE_MS).all();
  for (const m of ex) {
    const r = await env.DB.prepare("UPDATE m_items SET status = 'expired' WHERE id = ? AND status = 'live'").bind(m.id).run();
    if (r.meta && r.meta.changes) await push(env, m.seller, [btnMsg(env, "刊登已過期", `${m.title} 刊登 30 天沒更新，已自動下架，可以在「我的」重新刊登。`, m.id, "重新刊登")]);
  }
}

async function getItem(env, id) { return env.DB.prepare("SELECT * FROM m_items WHERE id = ?").bind(id).first(); }

export async function marketApi(req, env, url, catalog) {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(env, req) });
  if (!env.DB) return J(env, req, { err: "市集暫時無法使用" }, 503);
  await ensure(env);
  const p = url.pathname.replace(/^\/api\/m\/?/, ""), now = Date.now();
  try {
    // 照片：GET photo/<id>/<n>；POST photo/<id>?n=0..3（二進位 JPEG）
    if (p.startsWith("photo/")) {
      const [id, n0] = p.slice(6).split("/").map(x => +x || 0), n = Math.max(0, Math.min(MAX_PHOTOS - 1, req.method === "POST" ? +url.searchParams.get("n") || 0 : n0));
      if (req.method === "POST") {
        const me = await who(env, req);
        if (!me) return J(env, req, { err: "請先登入", login: 1 }, 401);
        const m = await getItem(env, id);
        if (!m || m.seller !== me.uid) return J(env, req, { err: "只能替自己的商品上傳照片" }, 403);
        const mime = (req.headers.get("content-type") || "").split(";")[0];
        if (!/^image\/(jpeg|png|webp)$/.test(mime)) return J(env, req, { err: "照片格式不支援" }, 400);
        const buf = new Uint8Array(await req.arrayBuffer());
        if (!buf.length || buf.length > MAX_PHOTO) return J(env, req, { err: "照片太大，請換一張" }, 400);
        const st = [env.DB.prepare("DELETE FROM m_photos WHERE mid = ? AND n = ?").bind(id, n)];
        for (let i = 0, k = 0; i < buf.length; i += CHUNK, k++) st.push(env.DB.prepare("INSERT INTO m_photos VALUES (?, ?, ?, ?, ?)").bind(id, n, k, mime, buf.slice(i, i + CHUNK).buffer));
        st.push(env.DB.prepare("UPDATE m_items SET nphoto = MAX(IFNULL(nphoto, 0), ?) WHERE id = ?").bind(n + 1, id));
        await env.DB.batch(st);
        return J(env, req, { ok: 1 });
      }
      const { results = [] } = await env.DB.prepare("SELECT mime, data FROM m_photos WHERE mid = ? AND n = ? ORDER BY i").bind(id, n).all();
      if (!results.length) return new Response("Not found", { status: 404, headers: cors(env, req) });
      const parts = results.map(r => new Uint8Array(r.data)), bin = new Uint8Array(parts.reduce((t, x) => t + x.length, 0));
      let o = 0; for (const x of parts) { bin.set(x, o); o += x.length; }
      return new Response(bin, { headers: { "content-type": results[0].mime || "image/jpeg", "cache-control": "public, max-age=86400", ...cors(env, req) } });
    }

    if (p === "list") {
      const me = await who(env, req), st = url.searchParams.get("st") || "live";
      let q;
      if (st === "mine" && me) q = env.DB.prepare("SELECT * FROM m_items WHERE status != 'cancel' AND (seller = ?1 OR buyer = ?1 OR id IN (SELECT mid FROM m_offers WHERE uid = ?1)) ORDER BY bumped DESC LIMIT 200").bind(me.uid);
      else if (st === "watch" && me) q = env.DB.prepare("SELECT * FROM m_items WHERE status != 'cancel' AND id IN (SELECT mid FROM m_watch WHERE uid = ?) ORDER BY bumped DESC LIMIT 100").bind(me.uid);
      else if (st === "sold") q = env.DB.prepare("SELECT * FROM m_items WHERE status = 'sold' ORDER BY dealt DESC LIMIT 60");
      else q = env.DB.prepare("SELECT * FROM m_items WHERE status IN ('live','held') ORDER BY status = 'held', bumped DESC LIMIT 400");
      const { results = [] } = await q.all();
      const W = me ? new Set(((await env.DB.prepare("SELECT mid FROM m_watch WHERE uid = ?").bind(me.uid).all()).results || []).map(r => r.mid)) : null;
      let pending = 0;
      if (me) { const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM m_offers o JOIN m_items m ON m.id = o.mid WHERE m.seller = ? AND o.status = 'open'").bind(me.uid).first(); pending = r ? r.n : 0; }
      return J(env, req, { now, me: meOut(me, me ? await quota(env, me) : null), pending, items: results.map(m => pub(m, me, W)) });
    }

    if (p === "wants") {
      const me = await who(env, req), st = url.searchParams.get("st") || "open";
      const q = st === "mine" && me ? env.DB.prepare("SELECT * FROM m_wants WHERE uid = ? AND status != 'cancel' ORDER BY bumped DESC LIMIT 100").bind(me.uid)
        : env.DB.prepare("SELECT * FROM m_wants WHERE status = 'open' ORDER BY bumped DESC LIMIT 400");
      const { results = [] } = await q.all();
      return J(env, req, { now, me: meOut(me, me ? await quota(env, me) : null), items: results.map(w => pubWant(w, me)) });
    }
    if (p.startsWith("want/") && req.method === "GET") {
      const id = +p.slice(5) || 0, me = await who(env, req);
      const w = await env.DB.prepare("SELECT * FROM m_wants WHERE id = ? AND status != 'cancel'").bind(id).first();
      if (!w) return J(env, req, { err: "找不到這筆求卡，可能已關閉" }, 404);
      // 市集上同一張卡（卡片目錄同一個 key）正在賣的
      const { results: ms = [] } = w.ckey ? await env.DB.prepare("SELECT * FROM m_items WHERE ckey = ? AND status = 'live' ORDER BY price ASC LIMIT 10").bind(w.ckey).all() : { results: [] };
      return J(env, req, { now, me: meOut(me, me ? await quota(env, me) : null), want: pubWant(w, me), buyerStats: await stats(env, w.uid), selling: ms.map(m => pub(m, me, null)) });
    }
    if (p.startsWith("shop/")) {
      const sid = clip(p.slice(5), 20), me = await who(env, req);
      const s = await env.DB.prepare("SELECT seller, sname FROM m_items WHERE shop = ? ORDER BY id DESC LIMIT 1").bind(sid).first();
      if (!s) return J(env, req, { err: "找不到這個賣場" }, 404);
      const { results = [] } = await env.DB.prepare("SELECT * FROM m_items WHERE seller = ? AND status IN ('live','held','sold') ORDER BY status = 'sold', bumped DESC LIMIT 200").bind(s.seller).all();
      const { results: rs = [] } = await env.DB.prepare("SELECT score, abandon, note, at FROM (SELECT score, abandon, note, at FROM a_ratings WHERE to_uid = ?1 UNION ALL SELECT score, abandon, note, at FROM m_ratings WHERE to_uid = ?1) ORDER BY at DESC LIMIT 30").bind(s.seller).all();
      return J(env, req, { now, me: meOut(me), shop: { id: sid, name: mask(s.sname), stats: await stats(env, s.seller), ratings: rs }, items: results.map(m => pub(m, me, null)) });
    }

    if (p.startsWith("item/")) {
      const id = +p.slice(5) || 0, me = await who(env, req);
      const m = await getItem(env, id);
      if (!m || m.status === "cancel") return J(env, req, { err: "找不到這個商品，可能已下架" }, 404);
      if (!me || me.uid !== m.seller) env.DB.prepare("UPDATE m_items SET views = IFNULL(views, 0) + 1 WHERE id = ?").bind(id).run().catch(() => {});
      const W = me ? new Set(((await env.DB.prepare("SELECT mid FROM m_watch WHERE uid = ? AND mid = ?").bind(me.uid, id).all()).results || []).map(r => r.mid)) : null;
      // 出價：賣家看全部（含買家名稱）；買家只看自己的
      let offers = [];
      if (me && me.uid === m.seller) offers = ((await env.DB.prepare("SELECT id, name, amount, msg, status, at FROM m_offers WHERE mid = ? ORDER BY at DESC LIMIT 50").bind(id).all()).results || []).map(o => ({ ...o, name: o.name || "玩家" }));
      else if (me) offers = ((await env.DB.prepare("SELECT id, amount, msg, status, at FROM m_offers WHERE mid = ? AND uid = ? ORDER BY at DESC LIMIT 10").bind(id, me.uid).all()).results || []).map(o => ({ ...o, mine: 1 }));
      const party = me && m.buyer && (m.seller === me.uid || m.buyer === me.uid) && m.status === "sold";
      const myRate = party ? await env.DB.prepare("SELECT score, abandon, note FROM m_ratings WHERE mid = ? AND from_uid = ?").bind(id, me.uid).first() : null;
      const follow = me && m.ckey ? !!(await env.DB.prepare("SELECT 1 FROM m_follow WHERE ckey = ? AND uid = ?").bind(m.ckey, me.uid).first()) : false;
      const nOpen = (await env.DB.prepare("SELECT COUNT(*) AS n FROM m_offers WHERE mid = ? AND status = 'open'").bind(id).first() || {}).n || 0;
      return J(env, req, { now, me: meOut(me), sellerStats: await stats(env, m.seller), buyerStats: m.buyer && me && m.seller === me.uid ? await stats(env, m.buyer) : null,
        item: pub(m, me, W), offers, nOpen, follow, rate: party ? { can: !myRate, mine: myRate, role: m.seller === me.uid ? "seller" : "buyer" } : null });
    }

    if (p === "admin/reports") {
      const me = await who(env, req);
      if (!me || !me.admin) return J(env, req, { err: "只有管理員可以看" }, 403);
      const { results: rs = [] } = await env.DB.prepare("SELECT m.id, m.title, m.status, m.sname, COUNT(*) AS n, GROUP_CONCAT(r.reason, '｜') AS reasons, MAX(r.at) AS last FROM m_reports r JOIN m_items m ON m.id = r.mid GROUP BY m.id ORDER BY last DESC LIMIT 100").all();
      const { results: qs = [] } = await env.DB.prepare("SELECT q.uid, q.max, (SELECT name FROM a_users u WHERE u.uid = q.uid LIMIT 1) AS name FROM m_quota q ORDER BY q.max DESC LIMIT 100").all();
      const { results: top = [] } = await env.DB.prepare("SELECT seller AS uid, MAX(sname) AS name, COUNT(*) AS n FROM m_items WHERE status IN ('live','held') GROUP BY seller ORDER BY n DESC LIMIT 30").all();
      return J(env, req, { reports: rs, quotas: qs, top, free: FREE_QUOTA });
    }

    if (req.method !== "POST") return J(env, req, { err: "not found" }, 404);
    const me = await who(env, req);
    if (!me) return J(env, req, { err: "請先從 LINE 登入（傳「市集」給 P’CLUB 官方帳號）", login: 1 }, 401);
    const b = await req.json().catch(() => ({}));
    if (me.banned && ["create", "edit", "buy", "offer", "rate", "bump", "want/create", "want/bump"].includes(p)) return J(env, req, { err: "你的帳號已被停權，無法刊登或購買。如有疑問請聯絡 P’CLUB 官方帳號。" }, 403);
    const id = +b.id || 0;

    if (p === "create") {
      const title = clip(b.title, 60), price = Math.round(+b.price);
      if (title.length < 2) return J(env, req, { err: "請填商品名稱" }, 400);
      if (!(price >= 1 && price <= 10000000)) return J(env, req, { err: "售價要在 NT$1～10,000,000" }, 400);
      const contact = clip(b.contact, 60);
      if (!contact) return J(env, req, { err: "請填聯絡方式（有人購買後才給買家看）" }, 400);
      const q = await quota(env, me);
      if (q.used >= q.max) return J(env, req, { err: `免費刊登上限是同時 ${q.max} 件（刊登中＋保留中）。請先下架或完成交易，或聯絡 P’CLUB 官方帳號申請提高上限。`, quota: q }, 400);
      const ip = b.ip === "op" ? "op" : "pk", kind = KINDS[b.kind] ? b.kind : "card", ckey = clip(b.ckey, 80) || null;
      const r = await env.DB.prepare("INSERT INTO m_items (seller, sname, shop, title, ip, kind, cond, note, price, nego, ref, ckey, cimg, nphoto, contact, status, created, bumped) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,'live',?,?)")
        .bind(me.uid, me.name || "玩家", me.shop, title, ip, kind, clip(b.cond, 20), clip(b.note, 500), price, b.nego ? 1 : 0, b.ref ? Math.round(+b.ref) || null : null, ckey, /^https:\/\/[\w./%-]+$/.test(b.cimg || "") ? b.cimg.slice(0, 300) : null, contact, now, now).run();
      const mid = r.meta.last_row_id, told = new Set([me.uid]);
      // 從求卡按「我有這張」刊登的：通知那位求卡的人
      if (b.want) {
        const w = await env.DB.prepare("SELECT * FROM m_wants WHERE id = ? AND status = 'open'").bind(+b.want || 0).first();
        if (w && w.uid !== me.uid) { told.add(w.uid); await env.DB.prepare("UPDATE m_wants SET nresp = IFNULL(nresp, 0) + 1 WHERE id = ?").bind(w.id).run();
          await push(env, w.uid, [btnMsg(env, "📮 有人回應你的求卡", `${w.title}｜賣家開價 ${ntd(price)}（你收 ${ntd(w.maxp)}）`, mid, "去看看")]); }
      }
      // 卡片目錄同一張、價格在收購價內的求卡：一起通知
      if (ckey) {
        const { results: ws = [] } = await env.DB.prepare("SELECT id, uid, title, maxp FROM m_wants WHERE ckey = ? AND status = 'open' AND maxp >= ? LIMIT 50").bind(ckey, price).all();
        for (const w of ws) if (!told.has(w.uid)) { told.add(w.uid); await env.DB.prepare("UPDATE m_wants SET nresp = IFNULL(nresp, 0) + 1 WHERE id = ?").bind(w.id).run();
          await push(env, w.uid, [btnMsg(env, "📮 你在收的卡有人賣了", `${title}｜${ntd(price)}（你收 ${ntd(w.maxp)}）`, mid, "去看看")]); }
      }
      // 行情提醒：關注這張卡的人收到通知（自己除外）
      if (ckey) {
        const { results: fs = [] } = await env.DB.prepare("SELECT DISTINCT uid FROM m_follow WHERE ckey = ? AND uid != ? LIMIT 100").bind(ckey, me.uid).all();
        const cheap = b.ref && price < +b.ref ? `，比日本行情 ${ntd(+b.ref)} 便宜` : "";
        for (const f of fs) if (!told.has(f.uid)) await push(env, f.uid, [btnMsg(env, "🔔 你關注的卡有人刊登", `${title}｜${ntd(price)}${cheap}`, mid, "去看看")]);
      }
      return J(env, req, { ok: 1, id: mid, quota: { ...q, used: q.used + 1 } });
    }

    if (p === "want/create") {
      const title = clip(b.title, 60), maxp = Math.round(+b.maxp);
      if (title.length < 2) return J(env, req, { err: "請填想收的卡" }, 400);
      if (!(maxp >= 1 && maxp <= 10000000)) return J(env, req, { err: "收購價要在 NT$1～10,000,000" }, 400);
      const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM m_wants WHERE uid = ? AND status = 'open'").bind(me.uid).first();
      if (n && n.n >= MAX_WANTS) return J(env, req, { err: `同時最多 ${MAX_WANTS} 筆求卡，請先關閉收到的或不需要的` }, 400);
      const r = await env.DB.prepare("INSERT INTO m_wants (uid, name, shop, title, ip, kind, ckey, cimg, ref, maxp, note, status, created, bumped) VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',?,?)")
        .bind(me.uid, me.name || "玩家", me.shop, title, b.ip === "op" ? "op" : "pk", KINDS[b.kind] ? b.kind : "card", clip(b.ckey, 80) || null, /^https:\/\/[\w./%-]+$/.test(b.cimg || "") ? b.cimg.slice(0, 300) : null,
          b.ref ? Math.round(+b.ref) || null : null, maxp, clip(b.note, 300), now, now).run();
      // 市集上已經有人在賣這張、而且價格在收購價內：通知求卡的人
      let hits = 0;
      if (b.ckey) { const h = await env.DB.prepare("SELECT COUNT(*) AS n FROM m_items WHERE ckey = ? AND status = 'live' AND price <= ?").bind(clip(b.ckey, 80), maxp).first(); hits = h ? h.n : 0; }
      return J(env, req, { ok: 1, id: r.meta.last_row_id, hits });
    }
    if (p === "want/close" || p === "want/bump") {
      const w = await env.DB.prepare("SELECT * FROM m_wants WHERE id = ?").bind(id).first();
      if (!w || w.uid !== me.uid) return J(env, req, { err: "只能管理自己的求卡" }, 403);
      if (p === "want/close") await env.DB.prepare("UPDATE m_wants SET status = ? WHERE id = ?").bind(b.got ? "done" : "cancel", id).run();
      else {
        if (w.status === "open" && now - w.bumped < BUMP_MS) return J(env, req, { err: "每 24 小時可以更新一次" }, 400);
        await env.DB.prepare("UPDATE m_wants SET status = 'open', bumped = ? WHERE id = ?").bind(now, id).run();
      }
      return J(env, req, { ok: 1 });
    }

    if (p === "edit") {
      const m = await getItem(env, id);
      if (!m || m.seller !== me.uid) return J(env, req, { err: "只能修改自己的商品" }, 403);
      if (m.status !== "live") return J(env, req, { err: "只有刊登中的商品可以修改" }, 400);
      const price = b.price != null ? Math.round(+b.price) : m.price;
      if (!(price >= 1 && price <= 10000000)) return J(env, req, { err: "售價要在 NT$1～10,000,000" }, 400);
      await env.DB.prepare("UPDATE m_items SET price = ?, nego = ?, note = ?, cond = ?, contact = ? WHERE id = ?")
        .bind(price, b.nego != null ? (b.nego ? 1 : 0) : m.nego, b.note != null ? clip(b.note, 500) : m.note, b.cond != null ? clip(b.cond, 20) : m.cond, b.contact ? clip(b.contact, 60) : m.contact, id).run();
      if (price < m.price) { // 降價通知關注的人
        const { results: ws = [] } = await env.DB.prepare("SELECT DISTINCT uid FROM m_watch WHERE mid = ? AND uid != ? LIMIT 100").bind(id, me.uid).all();
        for (const w of ws) await push(env, w.uid, [btnMsg(env, "📉 關注的商品降價了", `${m.title}｜${ntd(m.price)} → ${ntd(price)}`, id, "去看看")]);
      }
      return J(env, req, { ok: 1 });
    }

    if (p === "bump") { // 更新：排到最新，同時延長 30 天；過期的商品也能用這個重新刊登
      const m = await getItem(env, id);
      if (!m || m.seller !== me.uid) return J(env, req, { err: "只能更新自己的商品" }, 403);
      if (m.status === "expired") { const q = await quota(env, me); if (q.used >= q.max) return J(env, req, { err: `已達同時刊登上限 ${q.max} 件` }, 400); }
      else if (m.status !== "live") return J(env, req, { err: "只有刊登中或已過期的商品可以更新" }, 400);
      if (m.status === "live" && now - m.bumped < BUMP_MS) { const h = Math.ceil((BUMP_MS - (now - m.bumped)) / 3600e3); return J(env, req, { err: `每 24 小時可以更新一次，約 ${h} 小時後再試` }, 400); }
      await env.DB.prepare("UPDATE m_items SET bumped = ?, status = 'live' WHERE id = ?").bind(now, id).run();
      return J(env, req, { ok: 1 });
    }

    if (p === "cancel") {
      const m = await getItem(env, id);
      if (!m || m.seller !== me.uid) return J(env, req, { err: "只能下架自己的商品" }, 403);
      if (!["live", "expired"].includes(m.status)) return J(env, req, { err: m.status === "held" ? "已經有買家保留，請先在下方「取消這筆交易」" : "這個商品不能下架" }, 400);
      const { results: os = [] } = await env.DB.prepare("SELECT uid FROM m_offers WHERE mid = ? AND status = 'open'").bind(id).all();
      await env.DB.batch([env.DB.prepare("UPDATE m_items SET status = 'cancel' WHERE id = ?").bind(id), env.DB.prepare("UPDATE m_offers SET status = 'declined' WHERE mid = ? AND status = 'open'").bind(id)]);
      for (const o of os) await push(env, o.uid, [btnMsg(env, "商品已下架", `${m.title} 賣家已下架，你的出價自動取消。`, null, "看其他商品")]);
      return J(env, req, { ok: 1 });
    }

    // 成交（保留給買家）：直購或賣家接受出價共用
    async function hold(m, buyer, bname, bcontact, amount) {
      const r = await env.DB.prepare("UPDATE m_items SET status = 'held', buyer = ?, bname = ?, bcontact = ?, deal = ?, dealt = ? WHERE id = ? AND status = 'live'").bind(buyer, bname, bcontact, amount, now, m.id).run();
      if (!r.meta || !r.meta.changes) return false;
      const { results: os = [] } = await env.DB.prepare("SELECT uid FROM m_offers WHERE mid = ? AND status = 'open' AND uid != ?").bind(m.id, buyer).all();
      await env.DB.prepare("UPDATE m_offers SET status = 'declined' WHERE mid = ? AND status = 'open' AND uid != ?").bind(m.id, buyer).run();
      await push(env, buyer, [btnMsg(env, "🎉 已幫你保留商品", `${m.title}｜${ntd(amount)}。請在 24 小時內聯絡賣家完成交易。`, m.id, "看賣家聯絡方式")]);
      await push(env, m.seller, [btnMsg(env, "✅ 你的商品有人買了", `${m.title}｜${ntd(amount)}，買家 ${bname || "玩家"}。請聯絡買家，交易完成後按「已完成」。`, m.id, "看買家聯絡方式")]);
      for (const o of os) await push(env, o.uid, [btnMsg(env, "商品已售出", `${m.title} 已經賣給其他買家，你的出價自動取消。`, null, "看其他商品")]);
      return true;
    }

    if (p === "buy") {
      const m = await getItem(env, id), bcontact = clip(b.contact, 60);
      if (!m || m.status !== "live") return J(env, req, { err: "這個商品已經被保留或下架了" }, 400);
      if (m.seller === me.uid) return J(env, req, { err: "不能買自己的商品" }, 400);
      if (!bcontact) return J(env, req, { err: "請填你的聯絡方式（只給賣家看）" }, 400);
      const busy = await env.DB.prepare("SELECT COUNT(*) AS n FROM m_items WHERE buyer = ? AND status = 'held'").bind(me.uid).first();
      if (busy && busy.n >= 10) return J(env, req, { err: "你有 10 筆保留中的交易還沒完成，請先完成再購買" }, 400);
      if (!(await hold(m, me.uid, me.name, bcontact, m.price))) return J(env, req, { err: "剛剛有人搶先買走了" }, 409);
      return J(env, req, { ok: 1 });
    }

    if (p === "offer") {
      const m = await getItem(env, id), amount = Math.round(+b.amount), bcontact = clip(b.contact, 60);
      if (!m || m.status !== "live") return J(env, req, { err: "這個商品已經被保留或下架了" }, 400);
      if (!m.nego) return J(env, req, { err: "這個商品不接受議價，可以直接購買" }, 400);
      if (m.seller === me.uid) return J(env, req, { err: "不能對自己的商品出價" }, 400);
      if (!bcontact) return J(env, req, { err: "請填你的聯絡方式（賣家接受後才給他看）" }, 400);
      if (!(amount >= Math.ceil(m.price * 0.5) && amount < m.price)) return J(env, req, { err: `出價要低於售價、且不低於售價的一半（${ntd(Math.ceil(m.price * 0.5))}）。想用原價買請按「直接購買」` }, 400);
      const open = await env.DB.prepare("SELECT id FROM m_offers WHERE mid = ? AND uid = ? AND status = 'open'").bind(id, me.uid).first();
      if (open) await env.DB.prepare("UPDATE m_offers SET amount = ?, msg = ?, contact = ?, at = ? WHERE id = ?").bind(amount, clip(b.msg, 100), bcontact, now, open.id).run();
      else {
        const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM m_offers WHERE uid = ? AND status = 'open'").bind(me.uid).first();
        if (n && n.n >= 20) return J(env, req, { err: "你同時最多只能有 20 筆等待回覆的出價" }, 400);
        await env.DB.prepare("INSERT INTO m_offers (mid, uid, name, amount, msg, contact, status, at) VALUES (?,?,?,?,?,?,'open',?)").bind(id, me.uid, me.name, amount, clip(b.msg, 100), bcontact, now).run();
      }
      await push(env, m.seller, [btnMsg(env, "💬 有人出價", `${m.title}｜售價 ${ntd(m.price)}，${me.name || "玩家"} 出價 ${ntd(amount)}${b.msg ? "：" + clip(b.msg, 30) : ""}`, id, "回覆出價")]);
      return J(env, req, { ok: 1 });
    }

    if (p === "offer/act") {
      const o = await env.DB.prepare("SELECT * FROM m_offers WHERE id = ?").bind(+b.oid || 0).first();
      if (!o || o.status !== "open") return J(env, req, { err: "這筆出價已經處理過或失效了" }, 400);
      const m = await getItem(env, o.mid);
      if (b.act === "withdraw") {
        if (o.uid !== me.uid) return J(env, req, { err: "只能取消自己的出價" }, 403);
        await env.DB.prepare("UPDATE m_offers SET status = 'withdrawn' WHERE id = ?").bind(o.id).run();
        return J(env, req, { ok: 1 });
      }
      if (!m || m.seller !== me.uid) return J(env, req, { err: "只有賣家可以回覆出價" }, 403);
      if (b.act === "decline") {
        await env.DB.prepare("UPDATE m_offers SET status = 'declined' WHERE id = ?").bind(o.id).run();
        await push(env, o.uid, [btnMsg(env, "出價未被接受", `${m.title}｜你出價 ${ntd(o.amount)}，賣家沒有接受。售價 ${ntd(m.price)}。`, m.id, "再看看")]);
        return J(env, req, { ok: 1 });
      }
      if (b.act === "accept") {
        if (m.status !== "live") return J(env, req, { err: "商品已經保留給別人或下架了" }, 400);
        await env.DB.prepare("UPDATE m_offers SET status = 'accepted' WHERE id = ?").bind(o.id).run();
        if (!(await hold(m, o.uid, o.name, o.contact, o.amount))) return J(env, req, { err: "商品狀態已改變，請重新整理" }, 409);
        return J(env, req, { ok: 1 });
      }
      return J(env, req, { err: "不明的操作" }, 400);
    }

    if (p === "deal") { // 保留中：賣家按「已完成」→ sold；任一方「取消交易」→ 回到刊登中
      const m = await getItem(env, id);
      if (!m || m.status !== "held" || (m.seller !== me.uid && m.buyer !== me.uid)) return J(env, req, { err: "只有買賣雙方可以操作這筆交易" }, 403);
      if (b.act === "done") {
        if (m.seller !== me.uid) return J(env, req, { err: "交易完成請由賣家按「已完成」" }, 403);
        await env.DB.prepare("UPDATE m_items SET status = 'sold', dealt = ? WHERE id = ?").bind(now, id).run();
        await push(env, m.buyer, [btnMsg(env, "交易完成", `${m.title} 賣家已標記完成，記得給賣家評價。`, id, "給評價")]);
        return J(env, req, { ok: 1 });
      }
      if (b.act === "release") {
        const reason = clip(b.reason, 60);
        await env.DB.prepare("UPDATE m_items SET status = 'live', buyer = NULL, bname = NULL, bcontact = NULL, deal = NULL, dealt = NULL WHERE id = ?").bind(id).run();
        const other = m.seller === me.uid ? m.buyer : m.seller;
        await push(env, other, [btnMsg(env, "交易已取消", `${m.title} 的交易已被${m.seller === me.uid ? "賣家" : "買家"}取消${reason ? "：" + reason : ""}。`, id)]);
        // 對方超過 24 小時沒完成：可以記一筆「未完成交易」
        if (b.abandon && now - (m.dealt || now) > 24 * 3600e3)
          await env.DB.prepare("INSERT INTO m_ratings VALUES (?, ?, ?, -1, 1, ?, ?)").bind(id, me.uid, other, reason || "未完成交易", now).run();
        return J(env, req, { ok: 1 });
      }
      return J(env, req, { err: "不明的操作" }, 400);
    }

    if (p === "rate") {
      const m = await getItem(env, id), score = +b.score > 0 ? 1 : -1;
      if (!m || m.status !== "sold" || (m.seller !== me.uid && m.buyer !== me.uid)) return J(env, req, { err: "交易完成後，買賣雙方才能互相評價" }, 403);
      if (await env.DB.prepare("SELECT 1 FROM m_ratings WHERE mid = ? AND from_uid = ?").bind(id, me.uid).first()) return J(env, req, { err: "你已經評價過了" }, 400);
      await env.DB.prepare("INSERT INTO m_ratings VALUES (?, ?, ?, ?, 0, ?, ?)").bind(id, me.uid, m.seller === me.uid ? m.buyer : m.seller, score, clip(b.note, 100), now).run();
      return J(env, req, { ok: 1 });
    }

    if (p === "watch") {
      await env.DB.prepare("DELETE FROM m_watch WHERE mid = ? AND uid = ?").bind(id, me.uid).run();
      if (b.on) await env.DB.prepare("INSERT INTO m_watch VALUES (?, ?)").bind(id, me.uid).run();
      return J(env, req, { ok: 1, on: b.on ? 1 : 0 });
    }

    if (p === "follow") {
      const ckey = clip(b.ckey, 80);
      if (!ckey) return J(env, req, { err: "這個商品沒有對應卡片目錄，不能設定到貨提醒" }, 400);
      await env.DB.prepare("DELETE FROM m_follow WHERE ckey = ? AND uid = ?").bind(ckey, me.uid).run();
      if (b.on) {
        const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM m_follow WHERE uid = ?").bind(me.uid).first();
        if (n && n.n >= 50) return J(env, req, { err: "到貨提醒最多 50 張卡" }, 400);
        await env.DB.prepare("INSERT INTO m_follow VALUES (?, ?, ?, ?)").bind(ckey, me.uid, clip(b.title, 60), now).run();
      }
      return J(env, req, { ok: 1, on: b.on ? 1 : 0 });
    }

    if (p === "report") {
      const m = await getItem(env, id);
      if (!m) return J(env, req, { err: "找不到商品" }, 404);
      if (m.seller === me.uid) return J(env, req, { err: "不能檢舉自己的商品" }, 400);
      if (!(await env.DB.prepare("SELECT 1 FROM m_reports WHERE mid = ? AND uid = ?").bind(id, me.uid).first()))
        await env.DB.prepare("INSERT INTO m_reports VALUES (?, ?, ?, ?)").bind(id, me.uid, clip(b.reason, 200), now).run();
      return J(env, req, { ok: 1 });
    }

    if (p === "admin/act") {
      if (!me.admin) return J(env, req, { err: "只有管理員可以操作" }, 403);
      const uid = b.uid || (id ? (await getItem(env, id) || {}).seller : "");
      if (b.action === "remove") await env.DB.prepare("UPDATE m_items SET status = 'cancel' WHERE id = ?").bind(id).run();
      else if (b.action === "dismiss") await env.DB.prepare("DELETE FROM m_reports WHERE mid = ?").bind(id).run();
      else if (b.action === "ban" || b.action === "unban") {
        if (!uid) return J(env, req, { err: "找不到這個使用者" }, 400);
        await env.DB.prepare("DELETE FROM a_banned WHERE uid = ?").bind(uid).run();
        if (b.action === "ban") await env.DB.batch([env.DB.prepare("INSERT INTO a_banned VALUES (?, ?, ?)").bind(uid, clip(b.reason, 100) || "管理員停權", now),
          env.DB.prepare("UPDATE m_items SET status = 'cancel' WHERE seller = ? AND status = 'live'").bind(uid), env.DB.prepare("UPDATE auctions SET status = 'cancel' WHERE seller = ? AND status = 'live'").bind(uid)]);
      } else if (b.action === "quota") {
        const max = Math.round(+b.max);
        if (!uid || !(max >= 0 && max <= 999)) return J(env, req, { err: "上限要在 0～999" }, 400);
        if (max === FREE_QUOTA) await env.DB.prepare("DELETE FROM m_quota WHERE uid = ?").bind(uid).run();
        else await env.DB.prepare("INSERT OR REPLACE INTO m_quota VALUES (?, ?)").bind(uid, max).run();
      } else return J(env, req, { err: "不明的操作" }, 400);
      return J(env, req, { ok: 1 });
    }
    return J(env, req, { err: "not found" }, 404);
  } catch (e) {
    console.error("market api", e && e.stack || e);
    const m = String(e && e.message || e);
    if (/daily row write limit|exceeded D1/i.test(m)) return J(env, req, { err: "今天資料庫寫入額度已用完，請明天再試" }, 503);
    return J(env, req, { err: "系統忙碌，請稍後再試（" + m.slice(0, 120) + "）" }, 500);
  }
}
