// 卡片暱稱：「睡覺伊布」「梵谷皮卡丘」這種玩家叫法 → 目錄裡的卡（同一張圖的各語言、各版本）
// 內建的在 aliases.json；用戶補的存在 D1 al_alias（登入才能加，每人每天最多 20 個）
import SEED from "./aliases.json";
let READY = false;
async function ensure(env) {
  if (READY) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS al_alias (a TEXT NOT NULL, k TEXT NOT NULL, uid TEXT, at INTEGER, PRIMARY KEY (a, k))").run();
  READY = true;
}
export const normA = s => String(s || "").normalize("NFKC").toLowerCase().replace(/psa\s*10|psa|鑑定|裸卡?|日版|美版|中文版|價格|行情|多少錢?/g, "").replace(/[\s　・·、,，.。!！?？「」『』()（）\-_]/g, "");
const SEEDN = Object.entries(SEED).map(([a, ks]) => [normA(a), a, ks]);
// 查詢字裡含有暱稱（或就是暱稱）：回傳 { names, keys }
export async function aliasKeys(q, env) {
  const nq = normA(q);
  if (nq.length < 2) return null;
  const names = new Set(), keys = [];
  const add = (a, k) => { names.add(a); if (!keys.includes(k)) keys.push(k); };
  for (const [na, a, ks] of SEEDN) if (na === nq || (na.length >= 3 && nq.includes(na))) ks.forEach(k => add(a, k));
  if (env.DB) {
    try {
      await ensure(env);
      const { results = [] } = await env.DB.prepare("SELECT a, k FROM al_alias WHERE a = ? OR (length(a) >= 3 AND instr(?, a) > 0) ORDER BY at LIMIT 40").bind(nq, nq).all();
      for (const r of results) add(r.a, r.k);
    } catch (e) { console.error("alias", e && e.message); }
  }
  return keys.length ? { names: [...names], keys } : null;
}
export async function aliasProducts(q, env, rowsTo) {
  const r = await aliasKeys(q, env);
  if (!r || !env.DB) return [];
  const { results = [] } = await env.DB.prepare(`SELECT k, j FROM products WHERE k IN (${r.keys.map(() => "?").join(",")})`).bind(...r.keys).all();
  const list = rowsTo({ results }), want = /psa\s*10|鑑定/i.test(q), raw = /裸/.test(q);
  const ord = k => r.keys.indexOf(k);
  return list.sort((a, b) => (want ? (b.p ? 1 : 0) - (a.p ? 1 : 0) : raw ? (a.p ? 1 : 0) - (b.p ? 1 : 0) : 0) || ord(a.k) - ord(b.k)).map(p => ({ ...p, alias: r.names[0] }));
}
// /api/al/q?q=（網站搜尋用）、/api/al/list?k=、POST /api/al/add {k, a}、POST /api/al/del {k, a}
export async function aliasApi(req, env, url, { who, J, cors, rowsTo, catItem, base, admin }) {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(env, req) });
  if (!env.DB) return J(env, req, { err: "暫時無法使用" }, 503);
  await ensure(env);
  const p = url.pathname.replace(/^\/api\/al\/?/, "");
  if (p === "q") {
    const q = (url.searchParams.get("q") || "").slice(0, 40);
    const list = await aliasProducts(q, env, rowsTo);
    if (!list.length) return J(env, req, { items: [] });
    const D = await base(env);
    return J(env, req, { alias: list[0].alias, items: list.slice(0, 12).map(x => catItem(x, D, env)) });
  }
  if (p === "all") { // 網站一次載入：{k: [暱稱...]}，卡片格子顯示暱稱、目錄搜尋也搜得到
    const out = {};
    for (const [, a, ks] of SEEDN) for (const k of ks) (out[k] = out[k] || []).includes(a) || out[k].push(a);
    const { results = [] } = await env.DB.prepare("SELECT a, k FROM al_alias ORDER BY at LIMIT 20000").all();
    for (const r of results) (out[r.k] = out[r.k] || []).includes(r.a) || out[r.k].push(r.a);
    const res = J(env, req, { map: out });
    const h = new Headers(res.headers); h.set("cache-control", "public, max-age=120");
    return new Response(res.body, { status: res.status, headers: h });
  }
  if (p === "list") {
    const k = url.searchParams.get("k") || "";
    const { results = [] } = await env.DB.prepare("SELECT a FROM al_alias WHERE k = ? ORDER BY at LIMIT 20").bind(k).all();
    const seed = SEEDN.filter(x => x[2].includes(k)).map(x => x[1]);
    return J(env, req, { items: [...new Set([...seed, ...results.map(r => r.a)])] });
  }
  if ((p === "add" || p === "del") && req.method === "POST") {
    const me = await who(env, req);
    if (!me) return J(env, req, { err: "請先登入", login: 1 }, 401);
    const b = await req.json().catch(() => ({}));
    const k = String(b.k || "").slice(0, 200), raw = String(b.a || "").trim(), a = normA(raw);
    if (p === "del") {
      const isAdmin = admin && await admin(env, me.uid);
      await env.DB.prepare(`DELETE FROM al_alias WHERE a = ? AND k = ?${isAdmin ? "" : " AND uid = ?"}`).bind(...(isAdmin ? [a, k] : [a, k, me.uid])).run();
      return J(env, req, { ok: 1 });
    }
    if (a.length < 2 || a.length > 12) return J(env, req, { err: "暱稱要 2～12 個字" }, 400);
    if (/https?:|www\.|line\.me|@/.test(raw)) return J(env, req, { err: "暱稱不能放連結" }, 400);
    const ex = await env.DB.prepare("SELECT 1 FROM products WHERE k = ?").bind(k).first();
    if (!ex) return J(env, req, { err: "這張卡暫時不能加暱稱" }, 400);
    const day = Date.now() - 864e5;
    const c = await env.DB.prepare("SELECT COUNT(*) n FROM al_alias WHERE uid = ? AND at > ?").bind(me.uid, day).first();
    if (c && c.n >= 20) return J(env, req, { err: "今天加太多了，明天再來" }, 429);
    await env.DB.prepare("INSERT OR IGNORE INTO al_alias (a, k, uid, at) VALUES (?, ?, ?, ?)").bind(a, k, me.uid, Date.now()).run();
    return J(env, req, { ok: 1, a });
  }
  return J(env, req, { err: "not found" }, 404);
}
