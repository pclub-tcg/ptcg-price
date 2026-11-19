// 雲端同步：我的庫存（inv）、想要清單（dex_want）、庫存總值走勢（inv_hist）。登入同市集（x-tok）。
// 每個 key 存一份 JSON 字串，最後寫入的為準（網頁端負責第一次登入時合併）。
let READY = false;
const KEYS = { inv: 400 * 1024, dex_want: 40 * 1024, inv_hist: 60 * 1024 };
async function ensure(env) {
  if (READY) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS u_store (uid TEXT NOT NULL, k TEXT NOT NULL, v TEXT, at INTEGER NOT NULL, PRIMARY KEY (uid, k))").run();
  READY = true;
}

export async function userApi(req, env, url, who, J, cors) {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(env, req) });
  if (!env.DB) return J(env, req, { err: "暫時無法使用" }, 503);
  const me = await who(env, req);
  if (!me) return J(env, req, { err: "請先登入", login: 1 }, 401);
  await ensure(env);
  const p = url.pathname.replace(/^\/api\/u\/?/, "");
  if (p === "get") {
    const { results = [] } = await env.DB.prepare("SELECT k, v, at FROM u_store WHERE uid = ?").bind(me.uid).all();
    const out = {};
    for (const r of results) if (KEYS[r.k]) out[r.k] = { v: r.v, at: r.at };
    return J(env, req, { data: out, name: me.name });
  }
  if (p === "put" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const k = String(b.k || ""), v = typeof b.v === "string" ? b.v : JSON.stringify(b.v == null ? null : b.v), at = Math.min(Date.now() + 60e3, Math.round(+b.at || Date.now()));
    if (!KEYS[k]) return J(env, req, { err: "不支援的資料" }, 400);
    if (v.length > KEYS[k]) return J(env, req, { err: "資料太大，請刪掉一些再試" }, 413);
    try { JSON.parse(v); } catch (e) { return J(env, req, { err: "資料格式錯誤" }, 400); }
    const cur = await env.DB.prepare("SELECT at FROM u_store WHERE uid = ? AND k = ?").bind(me.uid, k).first();
    if (cur && cur.at > at) return J(env, req, { ok: 0, stale: 1, at: cur.at }); // 雲端有更新的版本：網頁端先拉下來
    await env.DB.prepare("INSERT INTO u_store (uid, k, v, at) VALUES (?, ?, ?, ?) ON CONFLICT (uid, k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(me.uid, k, v, at).run();
    return J(env, req, { ok: 1, at });
  }
  return J(env, req, { err: "not found" }, 404);
}
