// 通知中心：LINE 推播（市集、競標、到價提醒、社群留言按讚）同時存一份在 D1，網站右上角 🔔 看得到。
// 每人只留最新 200 則、90 天內。
let READY = false;
async function ensure(env) {
  if (READY) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS n_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, kind TEXT, title TEXT, body TEXT, url TEXT, at INTEGER NOT NULL, rd INTEGER DEFAULT 0)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS n_notes_uid ON n_notes (uid, id)"),
  ]);
  READY = true;
}
const clip = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").trim().slice(0, n);

// 從 LINE 訊息取出標題、內容、連結
export function noteOf(messages) {
  const m = (messages || [])[0] || {}, out = { t: "", b: "", u: "" };
  if (m.type === "text") { const [a, ...r] = String(m.text || "").split("\n"); out.t = a; out.b = r.join("\n"); }
  else if (m.type === "template") { const t = m.template || {}; out.t = t.title || m.altText || ""; out.b = t.text || ""; const a = (t.actions || []).find(x => x.uri); if (a) out.u = a.uri; }
  else out.t = m.altText || "";
  for (const x of (messages || []).slice(1)) if (x.type === "text" && !out.b) out.b = x.text;
  if (!out.u) for (const x of messages || []) { const a = x.template && (x.template.actions || []).find(y => y.uri); if (a) { out.u = a.uri; break; } }
  return out;
}

export async function note(env, uid, kind, n) {
  if (!env.DB || !uid || !n || !n.t) return;
  try {
    await ensure(env);
    const u = String(n.u || "").replace(/[?&]openExternalBrowser=1/, "");
    await env.DB.prepare("INSERT INTO n_notes (uid, kind, title, body, url, at) VALUES (?, ?, ?, ?, ?, ?)").bind(uid, kind || "", clip(n.t, 80), clip(n.b, 300), clip(u, 300), Date.now()).run();
    if (Math.random() < 0.03) await env.DB.prepare("DELETE FROM n_notes WHERE at < ? OR id IN (SELECT id FROM n_notes WHERE uid = ? ORDER BY id DESC LIMIT -1 OFFSET 200)").bind(Date.now() - 90 * 864e5, uid).run();
  } catch (e) { console.log("note", e.message); }
}

// /api/n/count、/api/n/list、/api/n/read（登入同市集：x-tok）
export async function notesApi(req, env, url, who, J, cors) {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(env, req) });
  if (!env.DB) return J(env, req, { err: "暫時無法使用" }, 503);
  await ensure(env);
  const me = await who(env, req);
  if (!me) return J(env, req, { err: "請先登入", login: 1 }, 401);
  const p = url.pathname.replace(/^\/api\/n\/?/, "");
  if (p === "count") { const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM n_notes WHERE uid = ? AND rd = 0").bind(me.uid).first(); return J(env, req, { unread: r ? r.n : 0, name: me.name }); }
  if (p === "list") {
    const before = +url.searchParams.get("before") || 1e15;
    const { results = [] } = await env.DB.prepare("SELECT id, kind, title, body, url, at, rd FROM n_notes WHERE uid = ? AND id < ? ORDER BY id DESC LIMIT 40").bind(me.uid, before).all();
    return J(env, req, { items: results, name: me.name });
  }
  if (p === "read" && req.method === "POST") { await env.DB.prepare("UPDATE n_notes SET rd = 1 WHERE uid = ? AND rd = 0").bind(me.uid).run(); return J(env, req, { ok: 1 }); }
  return J(env, req, { err: "not found" }, 404);
}
