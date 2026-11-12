// 抽卡平台回收點數紀錄：玩家傳抽卡結果截圖時，把「這張卡在這個平台回收幾點」記下來（不記使用者）。
// 之後只打「回收 卡號」就能帶入最近看到的點數，也能比較各平台給的點數。
let READY = false;
async function ensure(env) {
  if (READY) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS d_buyback (k TEXT NOT NULL, pf TEXT NOT NULL, pts INTEGER NOT NULL, at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS d_buyback_k ON d_buyback (k, pf, at)"),
  ]);
  READY = true;
}
const DAY = 86400000, KEEP = 90 * DAY;

export async function bbRecord(env, k, pf, pts) {
  if (!env.DB || !k || !pf || !(pts > 0) || pts > 50000000) return;
  try {
    await ensure(env);
    const now = Date.now(), last = await env.DB.prepare("SELECT pts, at FROM d_buyback WHERE k = ? AND pf = ? ORDER BY at DESC LIMIT 1").bind(k, pf).first();
    if (last && last.pts === pts && now - last.at < DAY) return; // 同一天同點數不重複記
    await env.DB.prepare("INSERT INTO d_buyback (k, pf, pts, at) VALUES (?, ?, ?, ?)").bind(k, pf, pts, now).run();
    if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM d_buyback WHERE at < ?").bind(now - KEEP).run();
  } catch (e) { console.log("bbRecord", e.message); }
}

// 各平台最近一次的回收點數，點數高的排前面：[{pf, pts, at, n}]（n＝90 天內看到幾次）
export async function bbLookup(env, k) {
  if (!env.DB || !k) return [];
  try {
    await ensure(env);
    const r = await env.DB.prepare("SELECT pf, pts, at FROM d_buyback WHERE k = ? AND at > ? ORDER BY at DESC LIMIT 60").bind(k, Date.now() - KEEP).all();
    const out = {};
    for (const x of r.results || []) { if (!out[x.pf]) out[x.pf] = { pf: x.pf, pts: x.pts, at: x.at, n: 0 }; out[x.pf].n++; }
    return Object.values(out).sort((a, b) => b.pts - a.pts);
  } catch (e) { console.log("bbLookup", e.message); return []; }
}

export const bbDate = at => { const d = new Date(at + 8 * 3600000); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
