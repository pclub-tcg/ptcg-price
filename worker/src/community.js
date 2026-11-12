// P’CLUB 社群：曬卡、開箱、抽卡戰績、討論。登入和市集共用（a_users token），停權名單、管理員也共用。
// 照片跟市集一樣切塊存 D1；留言、按讚會進通知中心，留言另外推 LINE。
// 被 3 個人檢舉自動隱藏，管理員可以刪文。
import { note } from "./notes.js";

const MAX_PHOTOS = 4, MAX_PHOTO = 600 * 1024, CHUNK = 60 * 1024;
const POSTS_PER_DAY = 10, COMMENTS_PER_DAY = 80, HIDE_AT = 3;
export const C_KINDS = { show: "曬卡", open: "開箱", draw: "抽卡戰績", talk: "討論" };
let READY = false;
async function ensure(env, marketEnsure) {
  if (READY) return;
  await marketEnsure(env); // a_users、a_banned、meta
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS c_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, name TEXT, shop TEXT, kind TEXT, text TEXT, ckey TEXT, ctitle TEXT, cimg TEXT, cref INTEGER, nphoto INTEGER DEFAULT 0, likes INTEGER DEFAULT 0, ncom INTEGER DEFAULT 0, reports INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'live', at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS c_posts_st ON c_posts (status, id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS c_photos (pid INTEGER NOT NULL, n INTEGER NOT NULL, i INTEGER NOT NULL, mime TEXT, data BLOB)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS c_likes (pid INTEGER NOT NULL, uid TEXT NOT NULL, PRIMARY KEY (pid, uid))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS c_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, pid INTEGER NOT NULL, uid TEXT NOT NULL, name TEXT, text TEXT, at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'live')"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS c_comments_pid ON c_comments (pid, id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS c_reports (pid INTEGER NOT NULL, uid TEXT NOT NULL, reason TEXT, at INTEGER NOT NULL, PRIMARY KEY (pid, uid))"),
  ]);
  READY = true;
}

const pubPost = (r, me, L) => ({ id: r.id, kind: r.kind, text: r.text, ckey: r.ckey, ctitle: r.ctitle, cimg: r.cimg, cref: r.cref, nphoto: r.nphoto || 0, likes: r.likes || 0, ncom: r.ncom || 0,
  at: r.at, name: r.name || "玩家", shop: r.shop, liked: !!(L && L.has(r.id)), mine: !!(me && r.uid === me.uid), hidden: r.status !== "live" ? 1 : 0 });

export async function communityApi(req, env, url, h) {
  const { who, J, cors, clip, linePush, marketEnsure } = h;
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(env, req) });
  if (!env.DB) return J(env, req, { err: "社群暫時無法使用" }, 503);
  await ensure(env, marketEnsure);
  const p = url.pathname.replace(/^\/api\/c\/?/, ""), now = Date.now(), post = req.method === "POST";
  const body = post && !p.startsWith("photo/") ? await req.json().catch(() => ({})) : {};
  const siteLink = (id, c) => { const u = new URL("community.html", env.SITE_URL); u.searchParams.set("openExternalBrowser", "1"); u.hash = "p" + id + (c ? "c" : ""); return u.href; };
  try {
    // 照片：GET photo/<id>/<n>；POST photo/<id>?n=0..3
    if (p.startsWith("photo/")) {
      const [id, n0] = p.slice(6).split("/").map(x => +x || 0), n = Math.max(0, Math.min(MAX_PHOTOS - 1, post ? +url.searchParams.get("n") || 0 : n0));
      if (post) {
        const me = await who(env, req);
        if (!me) return J(env, req, { err: "請先登入", login: 1 }, 401);
        const r = await env.DB.prepare("SELECT uid FROM c_posts WHERE id = ?").bind(id).first();
        if (!r || r.uid !== me.uid) return J(env, req, { err: "只能替自己的貼文上傳照片" }, 403);
        const mime = (req.headers.get("content-type") || "").split(";")[0];
        if (!/^image\/(jpeg|png|webp)$/.test(mime)) return J(env, req, { err: "照片格式不支援" }, 400);
        const buf = new Uint8Array(await req.arrayBuffer());
        if (!buf.length || buf.length > MAX_PHOTO) return J(env, req, { err: "照片太大，請換一張" }, 400);
        const st = [env.DB.prepare("DELETE FROM c_photos WHERE pid = ? AND n = ?").bind(id, n)];
        for (let i = 0, k = 0; i < buf.length; i += CHUNK, k++) st.push(env.DB.prepare("INSERT INTO c_photos VALUES (?, ?, ?, ?, ?)").bind(id, n, k, mime, buf.slice(i, i + CHUNK).buffer));
        st.push(env.DB.prepare("UPDATE c_posts SET nphoto = MAX(IFNULL(nphoto, 0), ?) WHERE id = ?").bind(n + 1, id));
        await env.DB.batch(st);
        return J(env, req, { ok: 1 });
      }
      const { results = [] } = await env.DB.prepare("SELECT mime, data FROM c_photos WHERE pid = ? AND n = ? ORDER BY i").bind(id, n).all();
      if (!results.length) return new Response("Not found", { status: 404, headers: cors(env, req) });
      const parts = results.map(r => new Uint8Array(r.data)), bin = new Uint8Array(parts.reduce((t, x) => t + x.length, 0));
      let o = 0; for (const x of parts) { bin.set(x, o); o += x.length; }
      return new Response(bin, { headers: { "content-type": results[0].mime || "image/jpeg", "cache-control": "public, max-age=604800", ...cors(env, req) } });
    }

    const me = await who(env, req);
    const likedSet = async ids => { if (!me || !ids.length) return new Set(); const r = await env.DB.prepare(`SELECT pid FROM c_likes WHERE uid = ? AND pid IN (${ids.map(() => "?").join(",")})`).bind(me.uid, ...ids).all(); return new Set((r.results || []).map(x => x.pid)); };

    if (p === "list") {
      const before = +url.searchParams.get("before") || 1e15, kind = url.searchParams.get("kind") || "", shop = url.searchParams.get("shop") || "", ckey = url.searchParams.get("ckey") || "";
      const hot = url.searchParams.get("sort") === "hot", off = Math.max(0, Math.min(400, +url.searchParams.get("off") || 0)), q = clip(url.searchParams.get("q"), 40);
      const w = [hot ? "at > ?" : "id < ?", me && me.admin ? "status != 'del'" : "status = 'live'"], a = [hot ? now - 14 * 864e5 : before];
      if (q) { const like = "%" + q.replace(/[\\%_]/g, c => "\\" + c) + "%"; w.push("(ctitle LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\')"); a.push(like, like); }
      if (C_KINDS[kind]) { w.push("kind = ?"); a.push(kind); }
      if (shop) { w.push("shop = ?"); a.push(shop.slice(0, 40)); }
      if (ckey) { w.push("ckey = ?"); a.push(ckey.slice(0, 200)); }
      // 熱門：近 14 天，留言比按讚重，越新越前面
      const order = hot ? `ORDER BY (likes * 2 + ncom * 3 + 1) * 1.0 / ((? - at) / 3600000.0 + 6) DESC, id DESC LIMIT 20 OFFSET ${off}` : "ORDER BY id DESC LIMIT 20";
      const { results = [] } = await env.DB.prepare(`SELECT * FROM c_posts WHERE ${w.join(" AND ")} ${order}`).bind(...a, ...(hot ? [now] : [])).all();
      const L = await likedSet(results.map(r => r.id));
      return J(env, req, { items: results.map(r => pubPost(r, me, L)), me: me ? { name: me.name, shop: me.shop, admin: me.admin ? 1 : 0, banned: me.banned ? 1 : 0 } : null });
    }
    if (p.startsWith("post/")) {
      const id = +p.slice(5) || 0, r = await env.DB.prepare("SELECT * FROM c_posts WHERE id = ?").bind(id).first();
      if (!r || (r.status !== "live" && !(me && (me.admin || r.uid === me.uid)))) return J(env, req, { err: "這篇貼文不存在或已刪除" }, 404);
      const { results: cs = [] } = await env.DB.prepare("SELECT id, uid, name, text, at FROM c_comments WHERE pid = ? AND status = 'live' ORDER BY id LIMIT 300").bind(id).all();
      return J(env, req, { post: pubPost(r, me, await likedSet([id])), comments: cs.map(c => ({ id: c.id, name: c.name || "玩家", text: c.text, at: c.at, mine: !!(me && c.uid === me.uid), op: c.uid === r.uid ? 1 : 0 })), me: me ? { admin: me.admin ? 1 : 0 } : null });
    }

    if (!post) return J(env, req, { err: "not found" }, 404);
    if (!me) return J(env, req, { err: "請先登入：在 LINE 傳「社群」給 P’CLUB", login: 1 }, 401);
    if (me.banned) return J(env, req, { err: "你的帳號已被停權" }, 403);

    if (p === "create") {
      const kind = C_KINDS[body.kind] ? body.kind : "show", text = clip(body.text, 500);
      if (!text && !(+body.nphoto > 0)) return J(env, req, { err: "寫點什麼或放一張照片吧" }, 400);
      const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM c_posts WHERE uid = ? AND at > ?").bind(me.uid, now - 864e5).first();
      if (c && c.n >= POSTS_PER_DAY && !me.admin) return J(env, req, { err: `每人一天最多發 ${POSTS_PER_DAY} 篇，明天再來` }, 429);
      const cimg = /^https:\/\//.test(body.cimg || "") ? clip(body.cimg, 300) : null;
      const r = await env.DB.prepare("INSERT INTO c_posts (uid, name, shop, kind, text, ckey, ctitle, cimg, cref, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
        .bind(me.uid, clip(me.name, 30) || "玩家", me.shop, kind, text, clip(body.ckey, 200) || null, clip(body.ctitle, 80) || null, cimg, Math.round(+body.cref || 0) || null, now).first();
      return J(env, req, { ok: 1, id: r.id });
    }
    const m = p.match(/^(like|comment|del|report|delc)\/(\d+)$/);
    if (!m) return J(env, req, { err: "not found" }, 404);
    const id = +m[2];
    if (m[1] === "delc") {
      const c = await env.DB.prepare("SELECT c.uid, c.pid, p.uid AS puid FROM c_comments c JOIN c_posts p ON p.id = c.pid WHERE c.id = ?").bind(id).first();
      if (!c || !(c.uid === me.uid || c.puid === me.uid || me.admin)) return J(env, req, { err: "不能刪這則留言" }, 403);
      await env.DB.batch([env.DB.prepare("UPDATE c_comments SET status = 'del' WHERE id = ?").bind(id), env.DB.prepare("UPDATE c_posts SET ncom = MAX(0, ncom - 1) WHERE id = ?").bind(c.pid)]);
      return J(env, req, { ok: 1 });
    }
    const r = await env.DB.prepare("SELECT * FROM c_posts WHERE id = ?").bind(id).first();
    if (!r || r.status === "del") return J(env, req, { err: "這篇貼文不存在或已刪除" }, 404);
    const head = (r.text || C_KINDS[r.kind] || "貼文").replace(/\s+/g, " ").slice(0, 20);
    if (m[1] === "like") {
      const had = await env.DB.prepare("SELECT 1 AS x FROM c_likes WHERE pid = ? AND uid = ?").bind(id, me.uid).first();
      if (had) await env.DB.batch([env.DB.prepare("DELETE FROM c_likes WHERE pid = ? AND uid = ?").bind(id, me.uid), env.DB.prepare("UPDATE c_posts SET likes = MAX(0, likes - 1) WHERE id = ?").bind(id)]);
      else {
        await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO c_likes VALUES (?, ?)").bind(id, me.uid), env.DB.prepare("UPDATE c_posts SET likes = likes + 1 WHERE id = ?").bind(id)]);
        if (r.uid !== me.uid) await note(env, r.uid, "c_like", { t: `❤️ ${clip(me.name, 20) || "有人"} 說你的貼文讚`, b: head, u: siteLink(id) });
      }
      return J(env, req, { ok: 1, liked: had ? 0 : 1, likes: Math.max(0, (r.likes || 0) + (had ? -1 : 1)) });
    }
    if (m[1] === "comment") {
      const text = clip(body.text, 200);
      if (!text) return J(env, req, { err: "留言不能空白" }, 400);
      const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM c_comments WHERE uid = ? AND at > ?").bind(me.uid, now - 864e5).first();
      if (c && c.n >= COMMENTS_PER_DAY && !me.admin) return J(env, req, { err: "今天留言太多了，明天再來" }, 429);
      await env.DB.batch([env.DB.prepare("INSERT INTO c_comments (pid, uid, name, text, at) VALUES (?, ?, ?, ?, ?)").bind(id, me.uid, clip(me.name, 30) || "玩家", text, now), env.DB.prepare("UPDATE c_posts SET ncom = ncom + 1 WHERE id = ?").bind(id)]);
      if (r.uid !== me.uid) {
        const t = `💬 ${clip(me.name, 20) || "有人"} 在你的貼文留言`, u = siteLink(id, 1);
        await linePush(env, r.uid, [{ type: "template", altText: t + "：" + text.slice(0, 40), template: { type: "buttons", title: t.slice(0, 40), text: text.slice(0, 60), actions: [{ type: "uri", label: "看貼文", uri: u }] } }]).catch(() => {});
      }
      return J(env, req, { ok: 1 });
    }
    if (m[1] === "del") {
      if (r.uid !== me.uid && !me.admin) return J(env, req, { err: "只能刪自己的貼文" }, 403);
      await env.DB.batch([env.DB.prepare("UPDATE c_posts SET status = 'del' WHERE id = ?").bind(id), env.DB.prepare("DELETE FROM c_photos WHERE pid = ?").bind(id)]);
      return J(env, req, { ok: 1 });
    }
    if (m[1] === "report") {
      if (r.uid === me.uid) return J(env, req, { err: "不能檢舉自己的貼文" }, 400);
      const ins = await env.DB.prepare("INSERT OR IGNORE INTO c_reports VALUES (?, ?, ?, ?)").bind(id, me.uid, clip(body.reason, 100), now).run();
      if (ins.meta && ins.meta.changes) {
        const n = (r.reports || 0) + 1;
        await env.DB.prepare("UPDATE c_posts SET reports = ?, status = CASE WHEN ? >= ? AND status = 'live' THEN 'hidden' ELSE status END WHERE id = ?").bind(n, n, HIDE_AT, id).run();
        const ad = await env.DB.prepare("SELECT v FROM meta WHERE k = 'auction_admin'").first();
        if (ad && ad.v) await note(env, ad.v, "c_report", { t: `🚩 社群檢舉（${n} 次${n >= HIDE_AT ? "，已自動隱藏" : ""}）`, b: `${head}｜原因：${clip(body.reason, 60) || "未填"}`, u: siteLink(id) });
      }
      return J(env, req, { ok: 1, msg: "已收到檢舉，謝謝你" });
    }
    return J(env, req, { err: "not found" }, 404);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/daily row write limit|exceeded D1/i.test(msg)) return J(env, req, { err: "今天資料庫寫入額度已用完，請明天再試" }, 503);
    return J(env, req, { err: "系統忙碌，請稍後再試（" + msg.slice(0, 120) + "）" }, 500);
  }
}
