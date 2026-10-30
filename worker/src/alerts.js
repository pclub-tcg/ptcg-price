// 到價提醒：玩家在 LINE 查價卡片下方按「🔔 到價提醒」，選或打一個台幣價格；
// 每天價格資料匯入 D1 後（meta.sha 改變），檢查一次，跌到設定價以下就推播，推播後這筆提醒結束（可以再設）。
// 價格 = 查價卡片上的大數字：SNKRDUNK 成交中位（沒有就 Mercari）× 匯率；美版用 TCGplayer × 美元匯率。

const MAX_ALERTS = 30;
let READY = false;
async function ensure(env) {
  if (READY) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS p_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, k TEXT NOT NULL, name TEXT, target INTEGER NOT NULL, base INTEGER, created INTEGER NOT NULL, fired INTEGER DEFAULT 0, fprice INTEGER)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS p_alerts_open ON p_alerts (fired, k)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS p_alert_pending (uid TEXT PRIMARY KEY, k TEXT NOT NULL, at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)"),
  ]);
  READY = true;
}
const nt = v => "NT$" + Math.round(v).toLocaleString("en-US");
export const priceOf = (p, D) => p.us ? (p.um ? p.um * (D.usd || 32) : null) : p.s ? p.s[0] * D.rate : p.m ? p.m[0] * D.rate : null;
const round = v => v >= 10000 ? Math.round(v / 100) * 100 : v >= 1000 ? Math.round(v / 10) * 10 : Math.round(v);

async function product(env, k, rowsTo) {
  const r = await env.DB.prepare("SELECT j FROM products WHERE k = ?").bind(k).first();
  return r ? rowsTo({ results: [r] })[0] : null;
}
const qr = items => ({ items: items.slice(0, 13) });
const pb = (label, data, displayText) => ({ type: "action", action: { type: "postback", label: label.slice(0, 20), data, displayText } });
const msgA = (label, text) => ({ type: "action", action: { type: "message", label: label.slice(0, 20), text } });

// 查價卡片下方的快速按鈕
export const alertQuick = p => p && p.k ? [pb("🔔 到價提醒", "alm|" + p.k, "到價提醒")] : [];

// 按「🔔 到價提醒」：列出建議價格（現價 −5／10／15／20%），也可以直接打「提醒 2500」
async function menu(env, uid, k, D, rowsTo) {
  const p = await product(env, k, rowsTo);
  if (!p) return [{ type: "text", text: "找不到這張卡，請重新查價再設定。" }];
  const cur = priceOf(p, D);
  await env.DB.prepare("INSERT OR REPLACE INTO p_alert_pending VALUES (?, ?, ?)").bind(uid, k, Date.now()).run();
  if (!cur) return [{ type: "text", text: `${p.n}\n目前沒有成交價。請直接打你要的價格，例如：\n提醒 2500\n有成交價、而且低於這個價格時通知你。`, quickReply: qr([msgA("我的提醒", "我的提醒")]) }];
  const opts = [5, 10, 15, 20, 30].map(d => round(cur * (1 - d / 100)));
  return [{ type: "text", text: `🔔 ${p.n}\n目前約 ${nt(cur)}\n\n價格跌到多少以下要通知你？點下面的按鈕，或直接打「提醒 金額」，例如：提醒 ${opts[1]}`,
    quickReply: qr([...opts.map((v, i) => pb(`${nt(v)}（-${[5, 10, 15, 20, 30][i]}%）`, `als|${k}|${v}`, `低於 ${nt(v)} 通知我`)), msgA("我的提醒", "我的提醒")]) }];
}

async function save(env, uid, k, target, D, rowsTo) {
  const p = await product(env, k, rowsTo);
  if (!p) return [{ type: "text", text: "找不到這張卡，請重新查價再設定。" }];
  if (!(target >= 1 && target <= 100000000)) return [{ type: "text", text: "金額看起來不對，請打數字，例如：提醒 2500" }];
  const cur = priceOf(p, D);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM p_alerts WHERE uid = ? AND fired = 0").bind(uid).first();
  const old = await env.DB.prepare("SELECT id FROM p_alerts WHERE uid = ? AND k = ? AND fired = 0").bind(uid, k).first();
  if (!old && n && n.n >= MAX_ALERTS) return [{ type: "text", text: `到價提醒最多 ${MAX_ALERTS} 張卡。傳「我的提醒」可以刪掉不需要的。` }];
  if (old) await env.DB.prepare("UPDATE p_alerts SET target = ?, base = ?, created = ? WHERE id = ?").bind(target, cur ? Math.round(cur) : null, Date.now(), old.id).run();
  else await env.DB.prepare("INSERT INTO p_alerts (uid, k, name, target, base, created, fired) VALUES (?, ?, ?, ?, ?, ?, 0)").bind(uid, k, p.n.slice(0, 80), target, cur ? Math.round(cur) : null, Date.now()).run();
  await env.DB.prepare("DELETE FROM p_alert_pending WHERE uid = ?").bind(uid).run();
  const now = cur && cur <= target ? `\n\n⚠️ 現在的價格 ${nt(cur)} 已經低於這個金額了，下次價格更新時會通知你。` : cur ? `（目前約 ${nt(cur)}）` : "";
  return [{ type: "text", text: `✅ 已設定到價提醒\n${p.n}\n低於 ${nt(target)} 時用 LINE 通知你${now}\n\n價格每天更新一次，通知一次後這筆提醒就結束，可以再設定。`, quickReply: qr([msgA("我的提醒", "我的提醒")]) }];
}

async function list(env, uid) {
  const { results = [] } = await env.DB.prepare("SELECT id, name, target, base FROM p_alerts WHERE uid = ? AND fired = 0 ORDER BY created DESC LIMIT 30").bind(uid).all();
  if (!results.length) return [{ type: "text", text: "你還沒有設定到價提醒。\n查價後按卡片下方的「🔔 到價提醒」就能設定，價格跌到你要的金額時用 LINE 通知你。" }];
  const row = a => ({ type: "box", layout: "horizontal", spacing: "md", paddingTop: "10px", paddingBottom: "10px", contents: [
    { type: "box", layout: "vertical", flex: 1, contents: [{ type: "text", text: a.name || "卡片", size: "sm", weight: "bold", color: "#FFF3E4", wrap: true, maxLines: 2 },
      { type: "text", text: `低於 ${nt(a.target)}${a.base ? `｜設定時 ${nt(a.base)}` : ""}`, size: "xs", color: "#D9BFA6" }] },
    { type: "box", layout: "vertical", flex: 0, justifyContent: "center", contents: [{ type: "text", text: "刪除", size: "xs", color: "#FF8A2B", weight: "bold", action: { type: "postback", label: "刪除", data: "ald|" + a.id, displayText: "刪除提醒：" + (a.name || "").slice(0, 30) } }] }] });
  const body = [{ type: "text", text: `🔔 我的到價提醒（${results.length}）`, weight: "bold", size: "md", color: "#FF8A2B" }];
  results.slice(0, 20).forEach((a, i) => { if (i) body.push({ type: "separator", color: "#4A3428" }); body.push(row(a)); });
  return [{ type: "flex", altText: `我的到價提醒（${results.length}）`, contents: { type: "bubble", size: "giga", body: { type: "box", layout: "vertical", backgroundColor: "#1F1510", paddingAll: "18px", contents: body } } }];
}

// LINE 文字指令：我的提醒／提醒 2500；回傳 null 代表不是提醒指令
export async function alertText(env, uid, q, D, rowsTo) {
  if (!env.DB || !uid) return null;
  if (/^(我的提醒|到價提醒|提醒清單|價格提醒)$/.test(q)) { await ensure(env); return list(env, uid); }
  const m = q.match(/^提醒\s*(?:NT\$|\$)?\s*([\d,，]+)\s*(?:元)?$/i);
  if (!m) return null;
  await ensure(env);
  const pend = await env.DB.prepare("SELECT k FROM p_alert_pending WHERE uid = ? AND at > ?").bind(uid, Date.now() - 24 * 3600e3).first();
  if (!pend) return [{ type: "text", text: "請先查一張卡，再按卡片下方的「🔔 到價提醒」，然後打「提醒 金額」。" }];
  return save(env, uid, pend.k, +m[1].replace(/[,，]/g, ""), D, rowsTo);
}

// LINE postback：alm|k 選單、als|k|價格 設定、ald|id 刪除
export async function alertPostback(env, uid, data, D, rowsTo) {
  if (!env.DB || !uid) return null;
  const [t, a, b] = String(data || "").split("|");
  if (!["alm", "als", "ald"].includes(t)) return null;
  await ensure(env);
  if (t === "alm") return menu(env, uid, a, D, rowsTo);
  if (t === "als") return save(env, uid, a, Math.round(+b), D, rowsTo);
  await env.DB.prepare("DELETE FROM p_alerts WHERE id = ? AND uid = ?").bind(+a || 0, uid).run();
  return [{ type: "text", text: "已刪除這筆到價提醒。", quickReply: qr([msgA("我的提醒", "我的提醒")]) }];
}

// 排程：價格資料更新（meta.sha 變了）後檢查一次
export async function alertCron(env, D, rowsTo, card) {
  if (!env.DB || !env.LINE_CHANNEL_ACCESS_TOKEN) return;
  await ensure(env);
  const [s, done] = await Promise.all([env.DB.prepare("SELECT v FROM meta WHERE k = 'sha'").first(), env.DB.prepare("SELECT v FROM meta WHERE k = 'alert_sha'").first()]);
  if (!s || (done && done.v === s.v)) return;
  await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('alert_sha', ?)").bind(s.v).run();
  const { results: al = [] } = await env.DB.prepare("SELECT id, uid, k, name, target FROM p_alerts WHERE fired = 0 LIMIT 3000").all();
  const ks = [...new Set(al.map(a => a.k))], P = {};
  for (let i = 0; i < ks.length; i += 80) {
    const part = ks.slice(i, i + 80);
    const res = await env.DB.prepare(`SELECT j FROM products WHERE k IN (${part.map(() => "?").join(",")})`).bind(...part).all();
    for (const p of rowsTo(res)) P[p.k] = p;
  }
  let sent = 0;
  for (const a of al) {
    const p = P[a.k], cur = p && priceOf(p, D);
    if (!cur || cur > a.target) continue;
    await env.DB.prepare("UPDATE p_alerts SET fired = ?, fprice = ? WHERE id = ?").bind(Date.now(), Math.round(cur), a.id).run();
    const msgs = [{ type: "text", text: `🔔 到價提醒\n${p.n}\n現在約 ${nt(cur)}，已經低於你設定的 ${nt(a.target)}！` }];
    try { msgs.push(await card(p)); } catch (e) {}
    const r = await fetch("https://api.line.me/v2/bot/message/push", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN }, body: JSON.stringify({ to: a.uid, messages: msgs }) });
    if (!r.ok) console.error("alert push", r.status, await r.text());
    if (++sent >= 300) break; // 一次最多推 300 則，剩下的下次排程再推
  }
  if (sent >= 300) await env.DB.prepare("DELETE FROM meta WHERE k = 'alert_sha'").run();
}
