// P’CLUB LINE 機器人（Cloudflare Worker）
// 環境變數（在 Cloudflare 設定頁填，不要寫進程式）：
//   LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN  必填
//   ANTHROPIC_API_KEY                               選填：以圖搜尋用（有填就用 Claude，比較準）
//   AI 繫結（Workers AI）                           沒有 Claude 金鑰時，用 Cloudflare 免費 AI 看圖
//   SITE_URL   你的 GitHub Pages 網址，例如 https://帳號.github.io/ptcg-price/
//   CLAUDE_MODEL 選填，預設 claude-sonnet-5-5
//   IMAGE_LIMIT_PER_IP 選填，網站以圖搜尋每個 IP 每天幾次，預設 30
//   ADMIN_KEY 選填：重建圖文選單 /setup/richmenu?key=… 用的密碼；沒設就關閉這個網址

import { auctionApi, settle, lineToken, lineAdmin, setCatalog } from "./auction.js";

const CACHE_MS = 10 * 60 * 1000;
let DATA = null, DATA_AT = 0;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/identify") return identifyRoute(req, env);
    if (url.pathname.startsWith("/api/a/")) return auctionApi(req, env, url);
    if (url.pathname === "/debug/flex") { // 暫時：檢查查價卡片格式是否被 LINE 接受（只驗證，不會傳訊息）
      const q = (url.searchParams.get("q") || "").slice(0, 40), D = await base(env);
      const hits = D.db ? await dbSearch(q, wantUS(q) ? 2 : 0, env, D) : search(q, D);
      const msg = hits.length ? await oneCard(hits, q, false, D, env) : { type: "text", text: "no hits" };
      const r = await fetch("https://api.line.me/v2/bot/message/validate/reply", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN }, body: JSON.stringify({ messages: [msg] }) });
      return new Response(JSON.stringify({ status: r.status, line: await r.text(), main: msg.altText, bytes: JSON.stringify(msg).length, rel: JSON.stringify(msg).match(/"text":"(這張・)?(PSA10|裸卡|原盒)"/g) }), { headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } });
    }
    if (url.pathname === "/setup/richmenu") { // 管理用：要帶 ?key=ADMIN_KEY（Cloudflare 密鑰）才會執行；沒設 ADMIN_KEY 就整個關閉
      const k = url.searchParams.get("key") || "";
      if (!env.ADMIN_KEY || k.length !== env.ADMIN_KEY.length || !(await safeEq(k, env.ADMIN_KEY))) return new Response("Forbidden", { status: 403 });
      return setupRichMenu(env);
    }
    if (req.method === "GET") return new Response("P’CLUB LINE bot OK");
    if (req.method !== "POST" || url.pathname !== "/webhook") return new Response("Not found", { status: 404 });
    const body = await req.text();
    if (!(await verify(body, req.headers.get("x-line-signature") || "", env.LINE_CHANNEL_SECRET)))
      return new Response("bad signature", { status: 401 });
    const { events = [] } = JSON.parse(body);
    ctx.waitUntil(Promise.all(events.map(ev => handle(ev, env).catch(e => console.error("event error", e && e.stack || e)))));
    return new Response("ok");
  },
  async scheduled(ev, env, ctx) { // 每 10 分鐘：結標並通知；圖文選單版本更新時自動重建
    ctx.waitUntil(settle(env).catch(e => console.error("settle", e && e.stack || e)));
    ctx.waitUntil(autoRichMenu(env).catch(e => console.error("richmenu", e && e.stack || e)));
  },
};

async function safeEq(a, b) { // 固定時間比較，避免從回應時間猜密碼
  const e = new TextEncoder(), x = new Uint8Array(await crypto.subtle.digest("SHA-256", e.encode(a))), y = new Uint8Array(await crypto.subtle.digest("SHA-256", e.encode(b)));
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0;
}

// ---------- LINE ----------
async function verify(body, sig, secret) {
  if (!secret || !sig) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (b64.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < b64.length; i++) d |= b64.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}
async function reply(env, token, messages) {
  const r = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN },
    body: JSON.stringify({ replyToken: token, messages: withQuick(messages.slice(0, 5)) }),
  });
  if (!r.ok) {
    const err = await r.text(); console.error("reply failed", r.status, err);
    // 卡片格式被 LINE 拒絕時，至少回一段文字（方便看出哪裡壞了），不讓使用者沒有回應
    if (r.status === 400 && !messages.__fb) { const fb = [{ type: "text", text: "卡片顯示失敗，請稍後再試。（" + err.slice(0, 300) + "）" }]; fb.__fb = 1; return reply(env, token, fb); }
  }
}
const text = t => ({ type: "text", text: t.slice(0, 4900) });

const QUICK = [
  { type: "action", action: { type: "message", label: "🔨 競標", text: "競標" } },
  { type: "action", action: { type: "message", label: "📈 漲最多", text: "漲最多" } },
  { type: "action", action: { type: "camera", label: "拍照查價" } },
  { type: "action", action: { type: "cameraRoll", label: "選照片查價" } },
  { type: "action", action: { type: "message", label: "📦 原盒", text: "原盒行情" } },
  { type: "action", action: { type: "message", label: "🏅 鑑定卡", text: "鑑定卡行情" } },
  { type: "action", action: { type: "message", label: "🗃️ 我的庫存", text: "我的庫存" } },
  { type: "action", action: { type: "message", label: "使用說明", text: "說明" } },
];
function withQuick(msgs) { if (msgs.length && !msgs[msgs.length - 1].quickReply) msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], quickReply: { items: QUICK } }; return msgs; }

const RANK = {
  gap: (D) => D.products.map(p => ({ p, c: calc(p, D) })).filter(x => x.c && x.c.gap != null && x.c.gap > 0).sort((a, b) => b.c.gap / b.c.cost - a.c.gap / a.c.cost).map(x => x.p),
  up: (D) => D.products.filter(p => p.c30 != null && (p.kn || 0) >= 8 && (p.k1 || 0) >= 3000).sort((a, b) => b.c30 - a.c30),
  box: (D) => D.products.filter(p => p.b && p.s).sort((a, b) => b.s[0] - a.s[0]),
  psa: (D) => D.products.filter(p => p.p && p.k1).sort((a, b) => (b.c30 ?? -99) - (a.c30 ?? -99)),
};

async function handle(ev, env) {
  if (ev.type === "follow") return reply(env, ev.replyToken, guide(env));
  if (ev.type !== "message" || !ev.replyToken) return;
  const D = await base(env);
  if (ev.message.type === "text") {
    let q = ev.message.text.trim();
    if (/^(說明|help|使用說明|功能|\?|？)$/i.test(q)) return reply(env, ev.replyToken, guide(env));
    if (/^(文字說明|說明文字)$/.test(q)) return reply(env, ev.replyToken, [text(HELP)]);
    if (/^(管理競標|競標管理)$/.test(q) && ev.source && ev.source.userId && env.DB) return reply(env, ev.replyToken, [await lineAdmin(env, ev.source.userId)]);
    if (/^(競標|拍賣|競標市場|我的競標|上架競標|登入競標)$/.test(q) && ev.source && ev.source.userId && env.DB) return reply(env, ev.replyToken, [{ ...(await lineToken(env, ev.source.userId)), quickReply: { items: QUICK } }]);
    if (/^(庫存|我的庫存|出售清單|出圖|庫存出圖)$/.test(q)) { const u = new URL(env.SITE_URL); u.searchParams.set("openExternalBrowser", "1"); u.hash = "inv";
      return reply(env, ev.replyToken, [{ type: "template", altText: "我的庫存：" + u.href, template: { type: "buttons", title: "我的庫存", text: "記錄成本、看估值與損益，一鍵產生庫存圖或出售清單圖。資料存在你手機的瀏覽器。", actions: [{ type: "uri", label: "打開我的庫存", uri: u.href }] }, quickReply: { items: QUICK } }]); }
    if (/^(查價|卡片搜尋|搜尋|查卡價)$/.test(q)) return reply(env, ev.replyToken, [{ ...text("直接輸入卡號、卡名或系列就能查價 👇\n例：201/165、SV8 132/106、噴火龍 PSA10、純白閃焰 BOX\n也可以按下面的「拍照查價」直接拍卡片。"),
      quickReply: { items: ["噴火龍 PSA10", "皮卡丘 SAR", "30th", "純白閃焰 BOX", "超級耿鬼ex", "噴火龍 美版"].map(t => ({ type: "action", action: { type: "message", label: t, text: t } })) } }]);
    if (/^(匯率|匯率試算|試算)$/.test(q)) return reply(env, ev.replyToken, [text(`目前匯率：1 日圓 = ${D.rate} 台幣\n\n傳「試算 日圓價格」幫你算到手成本，例如：\n試算 25000\n\n到手成本 = Mercari 價格 × 匯率 − 優惠券 NT$${D.coupon} + 運費 NT$${D.ship}\nSNKRDUNK 則是 價格 × 匯率 + 運費 NT$${D.sship}`)]);
    const t = q.match(/^試算\s*[¥￥]?\s*([\d,，]+)/);
    if (t) { const y = +t[1].replace(/[,，]/g, ""); const m = Math.max(0, y * D.rate - D.coupon) + D.ship, sn = y * D.rate + D.sship;
      return reply(env, ev.replyToken, [text(`¥${y.toLocaleString("en-US")} 的到手成本\n\nMercari（扣優惠券、加運費）：${nt(m)}\nSNKRDUNK（加運費）：${nt(sn)}\n\n匯率 ${D.rate}，未含跨境手續費與關稅。`)]); }
    const lists = [[/^(比台灣便宜|有賺頭|賺|推薦|便宜)$/, "gap", "日本買回比台灣便宜最多的商品（台灣價 − 日本到手成本）", "目前沒有價差為正的商品。"],
      [/^(漲最多|漲幅|熱門|市場趨勢)$/, "up", "SNKRDUNK 近 30 天漲最多", "目前沒有足夠的成交資料。"],
      [/^(原盒行情|原盒|box)$/i, "box", "原盒行情（SNKRDUNK 成交價高到低）", "目前沒有原盒資料。"],
      [/^(鑑定卡行情|鑑定卡|psa10?)$/i, "psa", "PSA10 鑑定卡近 30 天漲跌", "目前沒有鑑定卡資料。"]];
    for (const [re, k, title, none] of lists) if (re.test(q)) {
      const list = RANK[k](D.db ? { ...D, products: await dbRank(k, env) } : D).slice(0, 10);
      if (!list.length) return reply(env, ev.replyToken, [text(none)]);
      const first = { ...list[0] }; first._rel = { ch: "", list: list.slice(1, 4).filter(x => x.img) }; if (!first._rel.list.length) first._rel = null;
      const msg = { type: "flex", altText: title.slice(0, 380), contents: bubble(first, D, env), quickReply: { items: [...list.slice(1, 10).map(x => ({ type: "action", action: { type: "message", label: (x.n.length > 20 ? x.n.slice(0, 19) + "…" : x.n), text: x.n.slice(0, 280) } })), ...QUICK].slice(0, 13) } };
      return reply(env, ev.replyToken, [text(title + (list.length > 1 ? "\n第 1 名如下，第 2～4 名在卡片下方，其他名次點下方按鈕 👇" : "")), msg]);
    }
    const wantRaw = /裸卡?/.test(q) && !/psa/i.test(q); q = q.replace(/裸卡?/g, " ").replace(/\s+/g, " ").trim() || q;
    const onlyUS = /美版|美國|英文|tcgplayer/i.test(q), q2 = q.replace(/美版|美國|英文|tcgplayer/gi, " ").trim();
    const hits = D.db ? await dbSearch(onlyUS ? (q2 || "box") : q, onlyUS ? 1 : wantUS(q) ? 2 : 0, env, D)
      : onlyUS ? search(q2 || "box", { ...D, products: await dataUS(env) })
      : search(q, wantUS(q) ? { ...D, products: D.products.concat(await dataUS(env)) } : D);
    if (!hits.length) return reply(env, ev.replyToken, [text(`找不到「${q}」。\n可以試試卡號（例如 201/165）、系列加卡號（SV8 132/106）、卡名（噴火龍）或加上 PSA10。\n也可以直接傳卡片照片給我。`)]);
    return reply(env, ev.replyToken, [await oneCard(hits, q, wantRaw, D, env)]);
  }
  if (ev.message.type === "image") {
    if (!env.ANTHROPIC_API_KEY && !env.AI) return reply(env, ev.replyToken, [text("以圖搜尋還沒開啟。請先用文字查詢，例如「SV8 132/106」或「噴火龍 PSA10」。")]);
    const img = await fetch(`https://api-data.line.me/v2/bot/message/${ev.message.id}/content`, { headers: { authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN } });
    if (!img.ok) return reply(env, ev.replyToken, [text("讀不到這張照片，請再傳一次。")]);
    const buf = new Uint8Array(await img.arrayBuffer());
    if (buf.length > 4.5 * 1024 * 1024) return reply(env, ev.replyToken, [text("照片太大了，請傳 4MB 以下的照片。")]);
    let r;
    try { r = await identify(buf, img.headers.get("content-type") || "image/jpeg", env); }
    catch (e) { console.error(e); return reply(env, ev.replyToken, [text("辨識失敗，請再試一次，或改用文字查詢。")]); }
    const label = [r.name_zh || r.name_ja, r.number, r.set, r.rarity, r.grade, r.box ? "原盒" : ""].filter(Boolean).join("・") || "看不出是哪張卡";
    const hits = matchImage(r, D.db ? { ...D, products: await dbImage(r, env) } : D);
    const head = text(`辨識結果：${label}${r.confidence && r.confidence !== "high" ? "（把握度" + (r.confidence === "medium" ? "中" : "低") + "）" : ""}${r.note ? "\n" + r.note : ""}${r.lang && r.lang !== "ja" ? "\n這張看起來不是日版，下面是同卡號的日版行情。" : ""}`);
    if (!hits.length) return reply(env, ev.replyToken, [head, text(r.number ? `目錄裡沒有這張卡。可以試著傳「${r.number}」搜尋看看。` : "目錄裡找不到相符的商品，請拍清楚卡號再試一次。")]);
    return reply(env, ev.replyToken, [head, await oneCard(hits, label, false, D, env)]);
  }
}

// 使用說明圖（tools/guide.py 產生，跟網站一起發布）；網址失效時退回文字說明
function guide(env) {
  if (!env.SITE_URL) return [text(HELP)];
  const u = p => new URL(p, env.SITE_URL).href;
  return [{ type: "image", originalContentUrl: u("guide.jpg?v=" + RICHMENU_V), previewImageUrl: u("guide_s.jpg?v=" + RICHMENU_V), quickReply: { items: QUICK } }];
}

const HELP = `P’CLUB｜日本成交價 × 台灣社團價

🔍 查價：直接傳卡號、卡名或系列
　例：201/165、SV8 132/106、噴火龍 PSA10、純白閃焰 BOX
📷 拍照查價：傳卡片照片，自動辨識
📈 漲最多：SNKRDUNK 近 30 天漲幅排行
📦 原盒行情／🏅 鑑定卡行情
💱 試算 25000：算日圓價格的到手成本
🗃️ 我的庫存：記錄持有的卡、算損益，產生庫存圖／出售清單圖
🔨 競標：傳「競標」打開競標市場，可以出價、上架自己的卡

價格說明：日本價為 SNKRDUNK 每日成交均價與 Mercari 近期成交中位數；到手成本 = Mercari 扣優惠券 NT$600 加運費，或 SNKRDUNK 加運費，取較便宜的；台灣價多為社團開價。
點卡片上的「看 K 線」可以看日 K、週 K 走勢。

ℹ️ 本服務為個人製作的比價工具，與寶可夢公司、任天堂、SNKRDUNK、Mercari 無關；價格與圖片取自各平台公開資訊，僅供參考。如有權利疑慮請來訊，會立即處理。`;

// ---------- 資料 ----------
// 有綁 D1（env.DB）而且資料庫有資料時，全部商品都從 D1 用 SQL 撈候選，再用原本的規則排序；
// 沒有 D1 或出錯時，退回讀網站上的 bot.json（門檻以上的商品）。
let META = null, META_AT = 0;
async function base(env) {
  if (env.DB) {
    try {
      if (!META || Date.now() - META_AT > CACHE_MS) {
        const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'bot'").first();
        if (r) { META = JSON.parse(r.v); META_AT = Date.now(); }
      }
      if (META) return { ...META, products: [], db: true };
    } catch (e) { console.error("D1 meta", e && e.message || e); }
  }
  return data(env);
}
const rowsTo = res => { const list = (res.results || []).map(r => JSON.parse(r.j)); prep(list); return list; };
const esc = t => t.replace(/[\\%_]/g, m => "\\" + m);
const USW = us => us === 1 ? " AND us = 1" : us === 0 ? " AND us = 0" : "";
async function dbSearch(q, us, env, D) {
  const toks = norm(q).split(/[\s　,，]+/).filter(Boolean);
  if (!toks.length) return [];
  const opt = t => /^[a-z]{1,3}-?\d{0,2}[a-z]?$/.test(t); // 系列代號、psa10、box 等：不一定寫在名稱裡，只拿來排序
  let need = toks.filter(t => !opt(t)).slice(0, 6); if (!need.length) need = toks.slice(0, 6);
  const conds = [], args = [], ord = [], oargs = [];
  for (const t of need) {
    if (/^\d{1,3}$/.test(t)) { conds.push("(n0 = ? OR h LIKE ? ESCAPE '\\')"); args.push(String(+t), "%" + esc(t) + "%"); }
    else if (strictTok(t)) { conds.push("(numn = ? OR h LIKE ? ESCAPE '\\')"); args.push(t, "%" + esc(t) + "%"); }
    else { const bs = [t, ...bigrams(t).slice(0, 8)]; conds.push("(numn = ? OR " + bs.map(() => "h LIKE ? ESCAPE '\\'").join(" OR ") + ")"); args.push(t, ...bs.map(b => "%" + esc(b) + "%")); }
  }
  for (const t of toks) { ord.push("(numn = ?) * 10 + (h LIKE ? ESCAPE '\\') * 3"); oargs.push(t, "%" + esc(t) + "%"); }
  const sql = `SELECT j FROM products WHERE ${conds.join(" AND ")}${USW(us)} ORDER BY ${ord.join(" + ")} DESC, (tw IS NOT NULL) DESC, top DESC LIMIT 400`;
  const res = await env.DB.prepare(sql).bind(...args, ...oargs).all();
  return search(q, { ...D, products: rowsTo(res) });
}
const RANK_SQL = {
  gap: "us = 0 AND tw > 0",
  up: "us = 0 AND c30 IS NOT NULL AND kn >= 8 AND k1 >= 3000 ORDER BY c30 DESC LIMIT 30",
  box: "us = 0 AND b = 1 AND s > 0 ORDER BY s DESC LIMIT 30",
  psa: "us = 0 AND p = 1 AND k1 > 0 ORDER BY COALESCE(c30, -99) DESC LIMIT 30",
};
async function dbRank(k, env) { return rowsTo(await env.DB.prepare("SELECT j FROM products WHERE " + RANK_SQL[k]).all()); }
async function dbImage(r, env) {
  if (r.box) return rowsTo(await env.DB.prepare("SELECT j FROM products WHERE us = 0 AND b = 1").all());
  const num = norm(r.number).replace(/\s/g, ""), zh = String(r.name_zh || "").trim();
  const conds = [], args = [];
  if (num) { conds.push("numn = ?"); args.push(num); }
  if (zh) { conds.push("h LIKE ? ESCAPE '\\'"); args.push("%" + esc(norm(zh)) + "%"); }
  if (!conds.length) return [];
  return rowsTo(await env.DB.prepare(`SELECT j FROM products WHERE us = 0 AND b = 0 AND (${conds.join(" OR ")}) LIMIT 500`).bind(...args).all());
}
async function data(env) {
  if (DATA && Date.now() - DATA_AT < CACHE_MS) return DATA;
  const r = await fetch(new URL("data/bot.json", env.SITE_URL).href, { cf: { cacheTtl: 300 } });
  if (!r.ok) { if (DATA) return DATA; throw new Error("bot.json " + r.status); }
  DATA = await r.json(); DATA_AT = Date.now();
  prep(DATA.products);
  return DATA;
}
// 美版另一個檔，只有查英文或「美版」時才載入（bot.json 小一點，Worker 冷啟動不會超過 CPU 時間）
let US = null, US_AT = 0;
async function dataUS(env) {
  if (US && Date.now() - US_AT < CACHE_MS) return US;
  const r = await fetch(new URL("data/bot-us.json", env.SITE_URL).href, { cf: { cacheTtl: 300 } });
  if (!r.ok) return US || [];
  US = (await r.json()).products; US_AT = Date.now(); prep(US);
  return US;
}
const wantUS = q => /美版|美國|英文|tcgplayer|\bus\b|\ben\b/i.test(q) || /[a-z]{4,}/i.test(q.replace(/psa\s*\d*/ig, ""));
function prep(list) {
  for (const p of list) if (p.us) { const id = p.k.slice(2); p.img = p.img || `https://tcgplayer-cdn.tcgplayer.com/product/${id}_400w.jpg`; p.uurl = p.uurl || `https://www.tcgplayer.com/product/${id}`; p.kk = p.kk || "u" + id; }
  for (const p of list) if (!p.h) p.h = norm([p.n, p.j, p.kw, p.cn, p.num, p.set, p.rar, p.b ? "box 原盒" : "", p.p ? "psa10 鑑定" : "", p.us ? "" : "日版 jp"].join(" "));
}
const norm = s => String(s || "").normalize("NFKC").toLowerCase();
// 競標上架用：搜尋商品目錄，回傳名稱、細項、圖、日本行情（成交中位 × 匯率，台幣）
setCatalog(async (q, env) => {
  const D = await base(env);
  const hits = D.db ? await dbSearch(q, wantUS(q) ? 2 : 0, env, D) : search(q, D);
  const site = env.SITE_URL;
  return hits.slice(0, 8).map(p => {
    const ref = p.us ? (p.um ? p.um * (D.usd || 32) : null) : p.s ? p.s[0] * D.rate : p.m ? p.m[0] * D.rate : null;
    return { n: p.n, meta: [p.us ? "美版" : "日版", p.num, p.set, p.b ? "原盒" : p.rar, p.p ? "PSA10" : ""].filter(x => x && x !== "-").join("・"),
      img: p.img ? new URL(p.img, site).href : null, ref: ref ? Math.round(ref / 10) * 10 : null, src: p.us ? "TCGplayer" : p.s ? "SNKRDUNK" : p.m ? "Mercari" : "" };
  });
});

function calc(p, D) {
  if (p.us) return p.um ? { src: "TCGplayer", med: p.um, n: 0, cost: p.um * (D.usd || 32), gap: null } : null;
  const a = p.m ? { src: "Mercari", med: p.m[0], n: p.m[1], cost: Math.max(0, p.m[0] * D.rate - D.coupon) + D.ship } : null;
  const b = p.s ? { src: "SNKRDUNK", med: p.s[0], n: p.s[1], cost: p.s[0] * D.rate + D.sship } : null;
  const c = a && b ? (a.cost <= b.cost ? a : b) : (a || b);
  if (!c) return null;
  return { ...c, gap: p.tw ? p.tw - c.cost : null };
}

// 部分符合：詞拆成每兩個字一組＋單字，回傳商品名稱裡找得到的比例；含數字的詞、4 個字以內的英文不做部分比對
const bigrams = t => { const a = [...t]; return a.length < 2 ? a : a.slice(1).map((c, i) => a[i] + c); };
const strictTok = t => /\d/.test(t) || /^[a-z.\-&']{1,4}$/.test(t);
function fuzzy(h, t) { if (strictTok(t)) return 0; const a = [...t], bs = bigrams(t); let k = 0; for (const b of bs) if (h.includes(b)) k++; return (k / bs.length + a.filter(c => h.includes(c)).length / a.length) / 2; } // 兩字組比例與單字比例的平均
function search(q, D) {
  const toks = norm(q).split(/[\s　,，]+/).filter(Boolean);
  const wantPsa = toks.some(t => t.includes("psa"));
  const scored = [];
  for (const p of D.products) {
    let s = 0, miss = 0, numHit = false, part = false;
    for (const t of toks) {
      if (p.num && norm(p.num) === t) { s += 10; numHit = true; }
      else if (p.num && /^\d{1,3}$/.test(t) && norm(p.num).split("/")[0].replace(/^0+/, "") === t.replace(/^0+/, "")) s += 4;
      else if (p.h.includes(t)) s += 3;
      else if (/^[a-z]{1,3}-?\d{0,2}[a-z]?$/.test(t)) miss += 0.5; // 系列代號沒寫在商品名稱裡時不算錯
      else { const r = fuzzy(p.h, t); if (r >= 0.5) { s += 3 * r; part = true; } else miss++; }
    }
    if ((miss && !(numHit && miss < 1)) || !s) continue;
    if (!part) s += 5; // 每個詞都完整符合的排前面
    if (wantPsa ? p.p : !p.p) s += 1;
    if (p.tw) s += 1;
    if (p.m || p.s) s += 1;
    scored.push([p, s]);
  }
  return scored.sort((a, b) => b[1] - a[1]).slice(0, 10).map(x => x[0]);
}

function matchImage(r, D) {
  const nz = norm, num = nz(r.number).replace(/\s/g, ""), set = nz(r.set), rar = String(r.rarity || "").toUpperCase(), zh = String(r.name_zh || "").trim();
  const wantPsa = /PSA\s*10/i.test(r.grade || "");
  const sc = D.products.map(p => {
    let s = 0;
    if (r.box) { if (!p.b) return [p, -1]; const bn = nz(r.box_name_ja).replace(/box$/, ""); if (zh && p.n.includes(zh)) s += 6; if (bn && p.h.includes(bn)) s += 6; return [p, s]; }
    if (p.b) return [p, -1];
    const pn = nz(p.num);
    if (num && pn === num) s += 6; else if (num) s -= 3;
    if (set && nz(p.set) === set) s += 3;
    if (rar && String(p.rar || "").toUpperCase() === rar) s += 1;
    if (zh && p.h.includes(norm(zh))) s += 3;
    if (wantPsa === !!p.p) s += 2;
    return [p, s];
  });
  const exact = num ? sc.filter(x => !x[0].b && nz(x[0].num) === num && x[1] >= 6) : [];
  return (exact.length ? exact : sc.filter(x => x[1] >= 6)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]);
}

// ---------- Claude 看圖 ----------
const PROMPT = `You are identifying a Japanese Pokémon Trading Card Game product from a photo (it may be a raw card, a graded slab such as PSA, or a sealed booster box).
Read the card number printed at the bottom (e.g. "132/106", "143/S-P", "020/M-P"), the set code (e.g. "SV8", "SV2a", "M2a", "s8b", "S-P"), the rarity mark (e.g. SAR, SR, AR, UR, HR, MUR, MA, CHR, CSR, RR, C, U, R, P) and the Pokémon or trainer name. If it is in a grading slab, read the grade from the label.
Reply with only one JSON object and nothing else:
{"name_ja": "", "name_zh": "Traditional Chinese (Taiwan) name", "number": "", "set": "", "rarity": "", "grade": "PSA10 / PSA9 / other / empty if raw", "box": false, "box_name_ja": "", "lang": "ja/zh/en/other", "confidence": "high/medium/low", "note": "one short Traditional Chinese sentence on anything uncertain, or empty"}`;

// Cloudflare Workers AI（免費額度）能看圖的模型，依序嘗試
const CF_MODELS = ["@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/google/gemma-3-12b-it"];
async function identifyCF(b64, mediaType, env) {
  let last;
  for (const model of CF_MODELS) {
    try {
      const r = await env.AI.run(model, { max_tokens: 400, temperature: 0, messages: [{ role: "user", content: [
        { type: "text", text: PROMPT },
        { type: "image_url", image_url: { url: `data:${/png|webp|gif/.test(mediaType) ? mediaType : "image/jpeg"};base64,${b64}` } },
      ] }] });
      const t = typeof r === "string" ? r : (r.response ?? r.choices?.[0]?.message?.content ?? "");
      const m = String(typeof t === "object" ? JSON.stringify(t) : t).match(/\{[\s\S]*\}/);
      if (m) { const j = JSON.parse(m[0]); j._model = model; if (!j.confidence || j.confidence === "high") j.confidence = "medium"; return j; }
      last = new Error("no json from " + model);
    } catch (e) { last = e; console.error("workers ai", model, e && e.message); }
  }
  throw last || new Error("workers ai failed");
}

async function identify(buf, mediaType, env) {
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  if (!env.ANTHROPIC_API_KEY) return identifyCF(btoa(bin), mediaType, env);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || "claude-sonnet-5-5", max_tokens: 400,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: /png|webp|gif/.test(mediaType) ? mediaType : "image/jpeg", data: btoa(bin) } },
        { type: "text", text: PROMPT },
      ] }],
    }),
  });
  if (!r.ok) throw new Error("anthropic " + r.status + " " + (await r.text()).slice(0, 300));
  const j = await r.json();
  const t = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  const m = t.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : {};
}

// ---------- 網站以圖搜尋：POST /identify（照片原始位元組） ----------
async function identifyRoute(req, env) {
  const site = env.SITE_URL ? new URL(env.SITE_URL).origin : "";
  const origin = req.headers.get("origin") || "";
  const cors = { "access-control-allow-origin": site || "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400", vary: "origin" };
  const out = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return out({ code: "failed" }, 405);
  if (site && origin !== site) return out({ code: "bad_origin" }, 403);
  if (!env.ANTHROPIC_API_KEY && !env.AI) return out({ code: "not_configured" }, 503);
  const type = req.headers.get("content-type") || "";
  if (!/^image\/(jpeg|png|webp|gif)/.test(type)) return out({ code: "image_rejected" }, 415);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) return out({ code: "image_rejected" }, 400);
  if (buf.length > 4.5 * 1024 * 1024) return out({ code: "too_large" }, 413);
  // 簡單的每日次數限制（依 IP，存在 Cloudflare 快取，避免別人狂用你的 API 額度）
  const ip = req.headers.get("cf-connecting-ip") || "x", day = new Date().toISOString().slice(0, 10);
  const key = new Request(`https://rate.limit/${day}/${encodeURIComponent(ip)}`), cache = caches.default;
  const used = +((await (await cache.match(key))?.text()) || 0), max = +(env.IMAGE_LIMIT_PER_IP || 30);
  if (used >= max) return out({ code: "daily_limit" }, 429);
  await cache.put(key, new Response(String(used + 1), { headers: { "cache-control": "max-age=90000" } }));
  try { return out(await identify(buf, type, env)); }
  catch (e) { console.error(e); return out({ code: "failed" }, 502); }
}

// ---------- Flex 訊息（噴火龍配色：火焰橘標題區＋炭黑行情區） ----------
const yen = v => "¥" + Math.round(v).toLocaleString("en-US");
const nt = v => "NT$" + Math.round(v).toLocaleString("en-US");
const C = { y: "#FF8A2B", gold: "#FFB627", ink: "#2A1C17", or: "#C8341B", br: "#2A1C17", br2: "#3A2620", cream: "#FFE0C2", mute: "#BFA08A", up: "#FF6B5A", down: "#3CC8B4" };
const T = (text, o = {}) => ({ type: "text", text: String(text), ...o });
const pill = (t, bg, color = "#FFFFFF", size = "xxs") => ({ type: "box", layout: "vertical", backgroundColor: bg, cornerRadius: "20px", paddingStart: "8px", paddingEnd: "8px", paddingTop: "2px", paddingBottom: "2px", flex: 0, contents: [T(t, { size, color, weight: "bold" })] });
const stat = (k, v) => ({ type: "box", layout: "horizontal", contents: [T(k, { size: "xs", color: C.gold, weight: "bold", flex: 0 }), T(v, { size: "sm", color: "#FFFFFF", weight: "bold", align: "end" })] });
const line = (k, v, color = "#FFFFFF") => ({ type: "box", layout: "horizontal", contents: [T(k, { size: "xs", color: C.cream, flex: 6, wrap: true }), T(v, { size: "sm", color, weight: "bold", align: "end", flex: 5 })] });

// ---------- 查價卡片（深色版型：卡圖＋主價格、四格數字、走勢圖＋高均低、相關卡片、工具列） ----------
const K = { bg: "#1F1510", sf: "#2B1E17", ch: "#2A1C17", ln: "#3D2B20", or: "#FF8A2B", gold: "#FFB627", cream: "#FFF3E4", peach: "#FFD0A3", soft: "#E9D3BD", mute: "#A8917F", dim: "#7A6656", up: "#FF6B5A", down: "#3EC98A" };
const num = v => Math.round(v).toLocaleString("en-US");
const baseName = n => String(n).replace(/\s*PSA\s*10/i, "").trim();
const wrapX = (inner, margin = "md") => ({ type: "box", layout: "vertical", paddingStart: "14px", paddingEnd: "14px", margin, contents: [inner] });
const opill = (t, on) => ({ type: "box", layout: "vertical", flex: 0, cornerRadius: "20px", paddingStart: "7px", paddingEnd: "7px", paddingTop: "1px", paddingBottom: "1px",
  ...(on ? { backgroundColor: K.or } : { borderWidth: "1px", borderColor: "#5A3F2E" }), contents: [T(t, { size: "xxs", weight: "bold", color: on ? "#2A1C17" : K.soft })] });
const tile = (k, v, d, vc) => ({ type: "box", layout: "vertical", flex: 1, backgroundColor: K.sf, cornerRadius: "10px", paddingAll: "7px", spacing: "none", contents: [
  T(k, { size: "xxs", color: K.mute, weight: "bold" }), T(v, { size: "sm", weight: "bold", color: vc || K.cream, margin: "xs" }), T(d || "　", { size: "xxs", color: K.dim })] });
const charOf = n => {
  const toks = String(n || "").split(/\s+/);
  let t = toks.find(x => x && !/^(\d|psa|bgs|cgc|box|ar$|sar$|sr$|ur$|hr$)/i.test(x)) || "";
  t = t.replace(/^(復刻|超級|M(?=[^a-z]))/i, "").split(/的|&|＆|ex$|EX$|VMAX|VSTAR|V$|GX$|BREAK$/)[0];
  return t.length >= 2 ? t : "";
};
// 相關卡片：同角色、有成交、價格高的 3 張（排除自己）
async function addRelated(list, D, env) {
  await Promise.all(list.slice(0, 10).map(async p => {
    if (p.us) return;
    const ch = charOf(p.n); if (!ch) return;
    let cand = [];
    try {
      if (D.db) cand = rowsTo(await env.DB.prepare("SELECT j FROM products WHERE us = 0 AND h LIKE ? ESCAPE '\\' AND k != ? AND (s > 0 OR top > 0) ORDER BY COALESCE(s, 0) DESC, top DESC LIMIT 12").bind("%" + esc(norm(ch)) + "%", p.k).all());
      else cand = D.products.filter(x => !x.us && x.k !== p.k && x.h.includes(norm(ch)) && (x.s || x.m)).slice(0, 12);
    } catch (e) { return; }
    const self = baseName(p.n);
    const seen = new Set([self + (p.p ? "p" : ""), self + (p.p ? "" : "p")]), out = [];
    for (const x of cand) { const key = baseName(x.n); if (seen.has(key + (x.p ? "p" : ""))) continue; seen.add(key + (x.p ? "p" : "")); if (x.img) out.push(x); if (out.length === 3) break; }
    if (out.length) p._rel = { ch, list: out };
  }));
}
function bubble(p, D, env) {
  const c = calc(p, D), site = env.SITE_URL, R = D.rate, FX = p.fx || R;
  const grade = p.b ? (p.us ? "未拆" : "原盒") : p.p ? "PSA10" : "裸卡";
  let title = String(p.n).replace(/\s*PSA\s*10/i, "").replace(p.num ? new RegExp("\\s*" + p.num.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")) : /$^/, "").trim() || p.n;
  const chips = [opill(grade, true), opill(p.us || p.en ? "美版" : "日版"), ...(p.rar && p.rar !== "-" && p.rar !== "BOX" ? [opill(p.rar)] : []), ...(p.set || p.num ? [opill([p.set, p.num].filter(Boolean).join(" "))] : [])];
  // 主價格
  let lab, main, subp;
  if (p.us) { lab = "TCGplayer 市場價"; main = p.um ? p.um * (D.usd || 32) : null; subp = p.um ? "US$" + p.um.toFixed(2) : ""; }
  else if (p.s) { lab = `SNKRDUNK 成交中位・近 ${p.s[1]} 筆`; main = p.s[0] * R; subp = yen(p.s[0]); }
  else if (p.k1) { lab = "SNKRDUNK 每日均價"; main = p.k1 * FX; subp = yen(p.k1); }
  else if (p.m) { lab = `Mercari 成交中位・${p.m[1]} 筆`; main = p.m[0] * R; subp = yen(p.m[0]); }
  else { lab = "日本行情"; main = null; subp = "還沒有成交紀錄"; }
  const img = p.img ? [{ type: "box", layout: "vertical", width: "84px", flex: 0, cornerRadius: "6px", borderWidth: "1.5px", borderColor: "#9A6A44", contents: [{ type: "image", url: new URL(p.img, site).href, aspectRatio: "5:7", aspectMode: "cover", size: "full" }] }] : [];
  const head = { type: "box", layout: "horizontal", spacing: "lg", paddingAll: "14px", paddingBottom: "10px", background: { type: "linearGradient", angle: "160deg", startColor: "#3A2418", endColor: K.bg }, contents: [...img,
    { type: "box", layout: "vertical", flex: 1, spacing: "xs", contents: [
      T(p.us ? "P’CLUB・美國行情" : "P’CLUB・日本行情", { size: "xxs", weight: "bold", color: K.or }),
      T(title, { size: "lg", weight: "bold", color: K.cream, wrap: true, maxLines: 2 }),
      { type: "box", layout: "horizontal", spacing: "xs", contents: chips.slice(0, 4) },
      { type: "box", layout: "vertical", flex: 1, contents: [] },
      T(lab, { size: "xxs", color: K.mute, weight: "bold", margin: "sm" }),
      { type: "box", layout: "baseline", spacing: "sm", contents: [T(main != null ? nt(main) : "—", { size: "xxl", weight: "bold", color: K.or, flex: 0 }), T(subp, { size: "xxs", color: K.dim, flex: 0 })] },
    ] }] };
  // 四格
  const chg = p.c30;
  const tw = p.tw ? [nt(p.tw).replace("NT$", ""), c && c.gap != null ? "價差 " + (c.gap >= 0 ? "+" : "−") + num(Math.abs(c.gap)) : (p.tt || "社團開價"), c && c.gap > 0 ? K.up : null] : ["—", "尚無開價"];
  const tiles = { type: "box", layout: "horizontal", spacing: "sm", paddingStart: "14px", paddingEnd: "14px", paddingTop: "4px", contents: [
    tile("30 天漲跌", chg == null ? "—" : (chg >= 0 ? "▲" : "▼") + Math.abs(chg) + "%", chg == null ? "資料不足" : "比上月", chg == null ? K.dim : chg >= 0 ? K.up : K.down),
    tile("最新成交", p.k1 && p.kd ? num(p.k1 * FX) : "—", p.k1 && p.kd ? p.kd.slice(5).replace("-", "/") : "尚無", p.k1 ? null : K.dim),
    p.us ? tile("最低價", p.ul ? num(p.ul * (D.usd || 32)) : "—", "TCGplayer") : tile("到手成本", c ? num(c.cost) : "—", c ? "含運費" : "尚無", c ? K.peach : K.dim),
    tile("台灣社團", tw[0], tw[1], p.tw ? null : K.dim),
  ] };
  if (tw[2]) tiles.contents[3].contents[2].color = tw[2];
  const body = [head, tiles];
  // 走勢圖
  if (p.ch && (p.kn || 0) > 2) {
    const side = p.kh ? [{ type: "box", layout: "vertical", width: "70px", flex: 0, justifyContent: "center", spacing: "sm", contents: [["高", p.kh], ["均", p.ka], ["低", p.kl]].flatMap(([k, v], i) => [
      ...(i ? [{ type: "separator", color: K.ln }] : []),
      { type: "box", layout: "baseline", contents: [T(k, { size: "xxs", color: K.gold, weight: "bold", flex: 0 }), T(num(v * FX), { size: "xs", color: K.cream, weight: "bold", align: "end" })] }]) }] : [];
    body.push(wrapX({ type: "box", layout: "vertical", backgroundColor: K.ch, cornerRadius: "12px", paddingAll: "8px", spacing: "xs", contents: [
      { type: "box", layout: "horizontal", alignItems: "center", contents: [opill(p.us ? "TCGplayer・近 90 天" : "每日均價・近 90 天", true), T(`${p.kn} 天有成交`, { size: "xxs", color: K.dim, align: "end" })] },
      { type: "box", layout: "horizontal", spacing: "sm", alignItems: "center", contents: [{ type: "image", url: new URL(p.ch, site).href, size: "full", aspectRatio: "2:1", aspectMode: "cover", flex: 1 }, ...side] }] }));
  }
  if (p.m && !p.us && (p.s || p.k1)) body.push({ type: "box", layout: "horizontal", paddingStart: "16px", paddingEnd: "16px", margin: "md", contents: [T(`Mercari 成交中位・${p.m[1]} 筆`, { size: "xxs", color: K.mute }), T(nt(p.m[0] * R), { size: "xs", color: K.soft, weight: "bold", align: "end" })] });
  if (p.note) body.push(wrapX(T(p.note, { size: "xxs", color: K.peach, wrap: true, maxLines: 2 }), "sm"));
  // 相關卡片
  if (p._rel) {
    body.push({ type: "box", layout: "horizontal", margin: "md", paddingStart: "16px", paddingEnd: "16px", alignItems: "center", contents: [
      T("● ", { size: "xxs", color: K.or, flex: 0 }), T(p._rel.ch ? "相關卡片・" + p._rel.ch : "相關卡片", { size: "xs", weight: "bold", color: K.cream, flex: 1 }),
      ...(p._rel.ch ? [T("看更多 ›", { size: "xs", weight: "bold", color: K.or, flex: 0, action: { type: "message", label: "看更多", text: p._rel.ch } })] : [])] });
    body.push({ type: "box", layout: "horizontal", spacing: "sm", margin: "sm", paddingStart: "14px", paddingEnd: "14px", contents: [
      ...p._rel.list.map(x => { const v = x.s ? x.s[0] * R : x.m ? x.m[0] * R : null;
        const g = x.p ? "PSA10" : x.b ? "原盒" : "裸卡", gp = { type: "box", layout: "horizontal", contents: [{ type: "box", layout: "vertical", flex: 0, cornerRadius: "20px", paddingStart: "6px", paddingEnd: "6px",
          backgroundColor: x.p ? K.or : "#E9D3BD", contents: [T(x._same ? "這張・" + g : g, { size: "xxs", weight: "bold", color: "#2A1C17" })] }] };
        return { type: "box", layout: "horizontal", flex: 1, spacing: "sm", backgroundColor: K.sf, cornerRadius: "10px", paddingAll: "5px", alignItems: "center",
          ...(x._same ? { borderWidth: "1.5px", borderColor: K.or } : {}),
          action: { type: "message", label: "查價", text: (x.p || x.b ? x.n : baseName(x.n) + " 裸卡").slice(0, 280) }, contents: [
          { type: "image", url: new URL(x.img, site).href, size: "full", aspectRatio: "5:7", aspectMode: "cover", flex: 2 },
          { type: "box", layout: "vertical", flex: 3, contents: [T(x.n.replace(/\s*PSA10.*$/i, "").replace(/\s+\d+\/\S+$/, ""), { size: "xxs", weight: "bold", color: K.cream }), gp, T(v ? num(v) : "—", { size: "xs", weight: "bold", color: K.or })] }] }; }),
    ] });
  }
  // 工具列
  const detail = new URL("?p=" + encodeURIComponent(p.k), site).href;
  const hist = p.us ? (p.uurl || "https://www.tcgplayer.com") : p.sid ? `https://snkrdunk.com/apparels/${p.sid}/sales-histories` : p.mq ? "https://jp.mercari.com/search?keyword=" + encodeURIComponent(p.mq) + "&status=sold_out" : detail;
  const inv = new URL("?p=" + encodeURIComponent(p.k) + "&a=inv", site); inv.searchParams.set("openExternalBrowser", "1");
  const sell = new URL("auction.html", site); sell.searchParams.set("openExternalBrowser", "1"); sell.hash = "sell=" + encodeURIComponent(p.n) + (main ? "&ref=" + Math.round(main / 10) * 10 : "");
  const tool = (icon, label, action) => ({ type: "box", layout: "vertical", flex: 2, alignItems: "center", justifyContent: "center", spacing: "xs", paddingTop: "8px", paddingBottom: "8px", action, contents: [
    { type: "image", url: new URL("icons/" + icon + ".png", site).href, size: "18px", aspectRatio: "1:1" }, T(label, { size: "xxs", color: K.soft, weight: "bold" })] });
  const tools = [
    { type: "box", layout: "vertical", flex: 3, backgroundColor: K.or, justifyContent: "center", action: { type: "uri", label: "K 線", uri: detail }, contents: [T(p.kk ? "看 K 線 ›" : "看詳情 ›", { size: "sm", weight: "bold", color: "#2A1C17", align: "center" })] },
    tool("list", "成交紀錄", { type: "uri", label: "成交紀錄", uri: hist }), { type: "separator", color: K.ln },
    tool("box", "加入庫存", { type: "uri", label: "加入庫存", uri: inv.href }), { type: "separator", color: K.ln },
    tool("tag", "我要賣", { type: "uri", label: "我要賣", uri: sell.href }),
    ...(p.set ? [{ type: "separator", color: K.ln }, tool("cards", "同系列", { type: "message", label: "同系列", text: p.set })] : []),
  ];
  body.push(wrapX({ type: "box", layout: "horizontal", backgroundColor: K.sf, cornerRadius: "12px", contents: tools }));
  // 頁尾
  const links = [];
  if (p.us) links.push(T("TCGplayer ↗", { size: "xxs", color: K.peach, weight: "bold", decoration: "underline", flex: 0, action: { type: "uri", label: "TCGplayer", uri: p.uurl || "https://www.tcgplayer.com" } }));
  if (p.sid) links.push(T("SNKRDUNK ↗", { size: "xxs", color: K.peach, weight: "bold", decoration: "underline", flex: 0, action: { type: "uri", label: "SNKRDUNK", uri: "https://snkrdunk.com/apparels/" + p.sid } }));
  if (p.mq) links.push(T("Mercari ↗", { size: "xxs", color: K.peach, weight: "bold", decoration: "underline", flex: 0, action: { type: "uri", label: "Mercari", uri: "https://jp.mercari.com/search?keyword=" + encodeURIComponent(p.mq) + "&status=sold_out&sort=created_time&order=desc" } }));
  body.push({ type: "box", layout: "vertical", flex: 1, contents: [] }); // 撐滿高度，輪播時下面不會留白
  body.push({ type: "box", layout: "horizontal", spacing: "md", paddingStart: "16px", paddingEnd: "16px", paddingTop: "10px", paddingBottom: "12px", contents: [
    T(p.us ? `美元匯率 ${D.usd || 32}・NT$` : `匯率 ${R}・NT$`, { size: "xxs", color: K.dim, flex: 1 }), ...(links.length ? [T("前往", { size: "xxs", color: K.dim, flex: 0 })] : []), ...links] });
  return { type: "bubble", size: "giga", body: { type: "box", layout: "vertical", paddingAll: "0px", spacing: "none", backgroundColor: K.bg, contents: body } };
}
// 查價只回一張大卡片（PSA10 為主），同一張卡的裸卡（或 PSA10）排在相關卡片第一格，其他搜尋結果接在後面
async function oneCard(hits, q, wantRaw, D, env) {
  const top = hits[0];
  let main = top, other = null;
  if (!top.us && !top.b && top.num) {
    const nm = norm(top.num).replace(/\s/g, ""), bn = baseName(top.n);
    let vs = [];
    try { vs = D.db ? rowsTo(await env.DB.prepare("SELECT j FROM products WHERE us = 0 AND b = 0 AND numn = ? LIMIT 30").bind(nm).all())
      : D.products.filter(x => !x.us && !x.b && norm(x.num).replace(/\s/g, "") === nm); } catch (e) {}
    vs = vs.filter(x => baseName(x.n) === bn || (top.set && x.set === top.set));
    const psa = hits.find(x => x.p && baseName(x.n) === bn) || vs.find(x => x.p), raw = hits.find(x => !x.p && !x.b && baseName(x.n) === bn) || vs.find(x => !x.p);
    main = wantRaw ? (raw || top) : (psa || top);
    other = main.p ? raw : psa;
  }
  await addRelated([main], D, env);
  const pool = [], keys = new Set([main.k]);
  const add = (x, same) => { if (!x || keys.has(x.k) || x.us !== main.us) return; keys.add(x.k); pool.push({ ...x, img: x.img || (same ? main.img : null), _same: same }); };
  add(other, true);
  for (const x of hits) if (baseName(x.n) !== baseName(main.n)) add(x, false);
  for (const x of (main._rel && main._rel.list) || []) add(x, false);
  const list = pool.filter(x => x.img).slice(0, 3);
  main._rel = list.length ? { ch: (main._rel && main._rel.ch) || "", list } : null;
  return { type: "flex", altText: ("「" + q + "」的查價結果：" + main.n).slice(0, 380), contents: bubble(main, D, env) };
}
function carousel(list, D, env, alt, q) {
  const L = list.slice(0, 10), size = x => new TextEncoder().encode(JSON.stringify(x)).length;
  let bs = L.map(p => bubble(p, D, env));
  // LINE 輪播上限 50KB：先拿掉後面幾張的相關卡片，還太大就少放幾張，最後補一張「更多結果」
  if (size(bs) > 46000) bs = L.map((p, i) => i < 2 ? bs[i] : bubble({ ...p, _rel: null }, D, env));
  let cut = false;
  while (bs.length > 1 && size(bs) > 44500) { bs.pop(); cut = true; }
  if (cut) {
    const u = new URL(env.SITE_URL); if (q) u.searchParams.set("q", q); u.searchParams.set("openExternalBrowser", "1");
    bs.push({ type: "bubble", size: "giga", body: { type: "box", layout: "vertical", backgroundColor: K.bg, paddingAll: "18px", justifyContent: "center", spacing: "md", action: { type: "uri", label: "更多", uri: u.href }, contents: [
      T("還有 " + (L.length - bs.length) + " 筆結果", { size: "md", weight: "bold", color: K.cream, align: "center" }), T("打更完整的卡名或卡號，或到網站看全部 ›", { size: "xs", color: K.mute, wrap: true, align: "center" })] } });
  }
  return { type: "flex", altText: (alt || "查價結果").slice(0, 380), contents: { type: "carousel", contents: bs } };
}

// ---------- 圖文選單（開一次網址 /setup/richmenu 就會建立） ----------
const RICHMENU_V = "2026-10-29-pclub-tcg"; // 改圖文選單（tools/richmenu.py 或 areas）時把這個字串改掉，排程就會自動重建
async function autoRichMenu(env) {
  if (!env.DB || !env.LINE_CHANNEL_ACCESS_TOKEN) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)").run();
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'richmenu'").first();
  if (r && r.v === RICHMENU_V) return;
  const res = await setupRichMenu(env);
  if (res.ok) await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('richmenu', ?)").bind(RICHMENU_V).run();
  else console.error("richmenu failed", await res.text());
}
async function setupRichMenu(env) {
  const H = { authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN, "content-type": "application/json" };
  const site = env.SITE_URL;
  const msg = t => ({ type: "message", text: t });
  const A = (x, y, width, height, action) => ({ bounds: { x, y, width, height }, action });
  // 位置要跟 tools/richmenu.py 印出的 AREAS 一致
  const areas = [
    A(28, 28, 1124, 932, msg("查價")),
    A(96, 1010, 524, 570, { type: "uri", uri: site }),
    A(652, 1010, 460, 570, msg("說明")),
    A(1208, 28, 618, 524, { type: "uri", uri: "https://line.me/R/nv/camera/" }),
    A(1854, 28, 618, 524, msg("競標")),
    A(1208, 580, 618, 524, msg("漲最多")),
    A(1854, 580, 618, 524, msg("原盒行情")),
    A(1208, 1132, 618, 524, msg("鑑定卡行情")),
    A(1854, 1132, 618, 524, msg("匯率試算")),
  ];
  const old = await (await fetch("https://api.line.me/v2/bot/richmenu/list", { headers: H })).json();
  const r = await fetch("https://api.line.me/v2/bot/richmenu", { method: "POST", headers: H, body: JSON.stringify({ size: { width: 2500, height: 1686 }, selected: true, name: "P’CLUB 主選單", chatBarText: "選單｜查卡價", areas }) });
  if (!r.ok) return new Response("建立失敗：" + await r.text(), { status: 500 });
  const { richMenuId } = await r.json();
  const img = await fetch(new URL("richmenu.jpg?t=" + Date.now(), site).href); // 加時間避免拿到快取的舊圖
  const up = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, { method: "POST", headers: { authorization: H.authorization, "content-type": "image/jpeg" }, body: await img.arrayBuffer() });
  if (!up.ok) return new Response("上傳圖片失敗：" + await up.text(), { status: 500 });
  const def = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: "POST", headers: H });
  if (!def.ok) return new Response("設為預設失敗：" + await def.text(), { status: 500 });
  for (const m of old.richmenus || []) await fetch(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: "DELETE", headers: H });
  return new Response("圖文選單已更新 ✅", { headers: { "content-type": "text/plain; charset=utf-8" } });
}

export { search, matchImage, calc, bubble, carousel, verify, RANK };
