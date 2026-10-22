// P’CLUB LINE 機器人（Cloudflare Worker）
// 環境變數（在 Cloudflare 設定頁填，不要寫進程式）：
//   LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN  必填
//   ANTHROPIC_API_KEY                               選填：以圖搜尋用（有填就用 Claude，比較準）
//   AI 繫結（Workers AI）                           沒有 Claude 金鑰時，用 Cloudflare 免費 AI 看圖
//   SITE_URL   你的 GitHub Pages 網址，例如 https://帳號.github.io/ptcg-price/
//   CLAUDE_MODEL 選填，預設 claude-sonnet-5-5
//   IMAGE_LIMIT_PER_IP 選填，網站以圖搜尋每個 IP 每天幾次，預設 30

const CACHE_MS = 10 * 60 * 1000;
let DATA = null, DATA_AT = 0;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/identify") return identifyRoute(req, env);
    if (url.pathname === "/setup/richmenu") return setupRichMenu(env);
    if (req.method === "GET") return new Response("P’CLUB LINE bot OK");
    if (req.method !== "POST" || url.pathname !== "/webhook") return new Response("Not found", { status: 404 });
    const body = await req.text();
    if (!(await verify(body, req.headers.get("x-line-signature") || "", env.LINE_CHANNEL_SECRET)))
      return new Response("bad signature", { status: 401 });
    const { events = [] } = JSON.parse(body);
    ctx.waitUntil(Promise.all(events.map(ev => handle(ev, env).catch(e => console.error("event error", e && e.stack || e)))));
    return new Response("ok");
  },
};

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
  if (!r.ok) console.error("reply failed", r.status, await r.text());
}
const text = t => ({ type: "text", text: t.slice(0, 4900) });

const QUICK = [
  { type: "action", action: { type: "message", label: "💰 比台灣便宜", text: "比台灣便宜" } },
  { type: "action", action: { type: "message", label: "📈 漲最多", text: "漲最多" } },
  { type: "action", action: { type: "camera", label: "拍照查價" } },
  { type: "action", action: { type: "cameraRoll", label: "選照片查價" } },
  { type: "action", action: { type: "message", label: "📦 原盒", text: "原盒行情" } },
  { type: "action", action: { type: "message", label: "🏅 鑑定卡", text: "鑑定卡行情" } },
  { type: "action", action: { type: "message", label: "使用說明", text: "說明" } },
];
function withQuick(msgs) { if (msgs.length) msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], quickReply: { items: QUICK } }; return msgs; }

const RANK = {
  gap: (D) => D.products.map(p => ({ p, c: calc(p, D) })).filter(x => x.c && x.c.gap != null && x.c.gap > 0).sort((a, b) => b.c.gap / b.c.cost - a.c.gap / a.c.cost).map(x => x.p),
  up: (D) => D.products.filter(p => p.c30 != null && (p.kn || 0) >= 8 && (p.k1 || 0) >= 3000).sort((a, b) => b.c30 - a.c30),
  box: (D) => D.products.filter(p => p.b && p.s).sort((a, b) => b.s[0] - a.s[0]),
  psa: (D) => D.products.filter(p => p.p && p.k1).sort((a, b) => (b.c30 ?? -99) - (a.c30 ?? -99)),
};

async function handle(ev, env) {
  if (ev.type === "follow") return reply(env, ev.replyToken, [text(HELP)]);
  if (ev.type !== "message" || !ev.replyToken) return;
  const D = await data(env);
  if (ev.message.type === "text") {
    const q = ev.message.text.trim();
    if (/^(說明|help|使用說明|功能|\?|？)$/i.test(q)) return reply(env, ev.replyToken, [text(HELP)]);
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
      const list = RANK[k](D).slice(0, 10);
      return reply(env, ev.replyToken, list.length ? [text(title + "，左右滑動看更多 👉"), carousel(list, D, env, title)] : [text(none)]);
    }
    const onlyUS = /美版|美國|英文|tcgplayer/i.test(q), q2 = q.replace(/美版|美國|英文|tcgplayer/gi, " ").trim();
    const hits = onlyUS ? search(q2 || "box", { ...D, products: await dataUS(env) })
      : search(q, wantUS(q) ? { ...D, products: D.products.concat(await dataUS(env)) } : D);
    if (!hits.length) return reply(env, ev.replyToken, [text(`找不到「${q}」。\n可以試試卡號（例如 201/165）、系列加卡號（SV8 132/106）、卡名（噴火龍）或加上 PSA10。\n也可以直接傳卡片照片給我。`)]);
    return reply(env, ev.replyToken, [carousel(hits, D, env, "「" + q + "」的查價結果")]);
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
    const hits = matchImage(r, D);
    const head = text(`辨識結果：${label}${r.confidence && r.confidence !== "high" ? "（把握度" + (r.confidence === "medium" ? "中" : "低") + "）" : ""}${r.note ? "\n" + r.note : ""}${r.lang && r.lang !== "ja" ? "\n這張看起來不是日版，下面是同卡號的日版行情。" : ""}`);
    if (!hits.length) return reply(env, ev.replyToken, [head, text(r.number ? `目錄裡沒有這張卡。可以試著傳「${r.number}」搜尋看看。` : "目錄裡找不到相符的商品，請拍清楚卡號再試一次。")]);
    return reply(env, ev.replyToken, [head, carousel(hits, D, env, label)]);
  }
}

const HELP = `P’CLUB｜日本成交價 × 台灣社團價

🔍 查價：直接傳卡號、卡名或系列
　例：201/165、SV8 132/106、噴火龍 PSA10、純白閃焰 BOX
📷 拍照查價：傳卡片照片，自動辨識
💰 比台灣便宜：日本買回比台灣便宜最多的商品
📈 漲最多：SNKRDUNK 近 30 天漲幅排行
📦 原盒行情／🏅 鑑定卡行情
💱 試算 25000：算日圓價格的到手成本

價格說明：日本價為 SNKRDUNK 每日成交均價與 Mercari 近期成交中位數；到手成本 = Mercari 扣優惠券 NT$600 加運費，或 SNKRDUNK 加運費，取較便宜的；台灣價多為社團開價。
點卡片上的「看 K 線」可以看日 K、週 K 走勢。

ℹ️ 本服務為個人製作的比價工具，與寶可夢公司、任天堂、SNKRDUNK、Mercari 無關；價格與圖片取自各平台公開資訊，僅供參考。如有權利疑慮請來訊，會立即處理。`;

// ---------- 資料 ----------
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

function calc(p, D) {
  if (p.us) return p.um ? { src: "TCGplayer", med: p.um, n: 0, cost: p.um * (D.usd || 32), gap: null } : null;
  const a = p.m ? { src: "Mercari", med: p.m[0], n: p.m[1], cost: Math.max(0, p.m[0] * D.rate - D.coupon) + D.ship } : null;
  const b = p.s ? { src: "SNKRDUNK", med: p.s[0], n: p.s[1], cost: p.s[0] * D.rate + D.sship } : null;
  const c = a && b ? (a.cost <= b.cost ? a : b) : (a || b);
  if (!c) return null;
  return { ...c, gap: p.tw ? p.tw - c.cost : null };
}

function search(q, D) {
  const toks = norm(q).split(/[\s　,，]+/).filter(Boolean);
  const wantPsa = toks.some(t => t.includes("psa"));
  const scored = [];
  for (const p of D.products) {
    let s = 0, miss = 0, numHit = false;
    for (const t of toks) {
      if (p.num && norm(p.num) === t) { s += 10; numHit = true; }
      else if (p.num && /^\d{1,3}$/.test(t) && norm(p.num).split("/")[0].replace(/^0+/, "") === t.replace(/^0+/, "")) s += 4;
      else if (p.h.includes(t)) s += 3;
      else if (/^[a-z]{1,3}-?\d{0,2}[a-z]?$/.test(t)) miss += 0.5; // 系列代號沒寫在商品名稱裡時不算錯
      else miss++;
    }
    if ((miss && !(numHit && miss < 1)) || !s) continue;
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

function bubble(p, D, env) {
  const c = calc(p, D), site = env.SITE_URL, R = D.rate;
  const tags = [p.us || p.en ? "美版" : "日版", p.b ? (p.us ? "未拆" : "原盒") : p.p ? "PSA10" : "裸卡", p.rar && p.rar !== "-" && p.rar !== "BOX" ? p.rar : null, p.set || null].filter(Boolean);
  const top = { type: "box", layout: "horizontal", backgroundColor: C.y, paddingAll: "14px", spacing: "md", contents: [
    ...(p.img ? [{ type: "image", url: new URL(p.img, site).href, flex: 2, aspectRatio: "5:7", aspectMode: "fit", size: "full" }] : []),
    { type: "box", layout: "vertical", flex: 3, spacing: "sm", contents: [
      T(p.us ? "🔥 P’CLUB・美國行情" : "🔥 P’CLUB・日本行情", { size: "xxs", color: C.ink, weight: "bold" }),
      { type: "box", layout: "vertical", backgroundColor: C.or, cornerRadius: "8px", paddingAll: "8px", contents: [T(p.n, { size: "md", color: "#FFFFFF", weight: "bold", wrap: true, maxLines: 3 })] },
      { type: "box", layout: "horizontal", spacing: "xs", contents: tags.map(t => pill(t, C.ink, "#FFC48A")) },
      ...(p.j && p.j !== p.n ? [T(p.j, { size: "xxs", color: C.ink, wrap: true, maxLines: 2 })] : []),
      ...(p.note ? [T(p.note, { size: "xxs", color: "#5A1408", wrap: true, maxLines: 2 })] : []),
    ] },
  ] };
  const body = [top];
  const FX = p.fx || R; // 每日均價換台幣的倍率（日版：日圓匯率；美版：美分→台幣）
  if (p.us) {
    const chg = p.c30 == null ? null : p.c30;
    body.push({ type: "box", layout: "vertical", backgroundColor: C.br, paddingAll: "14px", spacing: "sm", contents: [
      { type: "box", layout: "horizontal", alignItems: "center", contents: [pill(p.b ? "美版未拆・TCGplayer" : "美版・TCGplayer 市場價", C.gold, C.ink, "xs"),
        T("市場價 ", { size: "xxs", color: C.cream, align: "end", flex: 1 }), T(nt(p.um * (D.usd || 32)), { size: "lg", color: C.gold, weight: "bold", flex: 0 })] },
      { type: "box", layout: "horizontal", contents: [T(`US$${p.um.toFixed(2)}${p.ul ? `・最低 US$${p.ul.toFixed(2)}` : ""}`, { size: "xxs", color: C.mute }),
        ...(chg != null ? [T("30 天 " + (chg >= 0 ? "▲" : "▼") + Math.abs(chg) + "%", { size: "xs", weight: "bold", align: "end", color: chg >= 0 ? C.up : C.down })] : [])] },
      ...(p.ch && p.kn > 2 ? [{ type: "image", url: new URL(p.ch, site).href, size: "full", aspectRatio: "2:1", aspectMode: "cover" }] : []),
      ...(p.kh && p.kn > 2 ? [{ type: "box", layout: "horizontal", spacing: "md", contents: [stat("高", nt(p.kh * FX)), stat("均", nt(p.ka * FX)), stat("低", nt(p.kl * FX))] }] : []),
      T(`${p.set}${p.num ? "・" + p.num : ""}${p.rar ? "・" + p.rar : ""}・美元匯率 ${D.usd || 32}`, { size: "xxs", color: C.mute, wrap: true }),
    ] });
  } else if (p.k1 || p.s) {
    const chg = p.c30 == null ? null : p.c30;
    const head = p.s ? p.s[0] : p.k1; // 以 SNKRDUNK 最近成交的中位數為準（跟到手成本用同一個價格）
    body.push({ type: "box", layout: "vertical", backgroundColor: C.br, paddingAll: "14px", spacing: "sm", contents: [
      { type: "box", layout: "horizontal", alignItems: "center", contents: [pill(p.b ? "SNKRDUNK 原盒成交" : "SNKRDUNK 近期成交", C.gold, C.ink, "xs"),
        T("成交中位 ", { size: "xxs", color: C.cream, align: "end", flex: 1 }), T(nt(head * R), { size: "lg", color: C.gold, weight: "bold", flex: 0 })] },
      { type: "box", layout: "horizontal", contents: [T(`${yen(head)}${p.s ? `・最近 ${p.s[1]} 筆` : ""}`, { size: "xxs", color: C.mute }),
        ...(chg != null ? [T("30 天 " + (chg >= 0 ? "▲" : "▼") + Math.abs(chg) + "%", { size: "xs", weight: "bold", align: "end", color: chg >= 0 ? C.up : C.down })] : [])] },
      ...(p.ch ? [{ type: "image", url: new URL(p.ch, site).href, size: "full", aspectRatio: "2:1", aspectMode: "cover" }] : []),
      ...(p.kh ? [{ type: "box", layout: "horizontal", spacing: "md", contents: [stat("高", nt(p.kh * FX)), stat("均", nt(p.ka * FX)), stat("低", nt(p.kl * FX))] },
        T(`近 90 天每日均價・${p.kn} 天有成交`, { size: "xxs", color: C.mute, align: "end" })] : []),
    ] });
  }
  const rows = [];
  if (p.m) rows.push(line(`Mercari 中位・${p.m[1]}筆（${yen(p.m[0])}）`, nt(p.m[0] * R)));
  if (c && !p.us) rows.push(line(`到手成本・${c.src}`, nt(c.cost), C.gold));
  if (p.tw) rows.push(line("台灣社團" + (p.tt || ""), nt(p.tw)));
  if (c && c.gap != null) rows.push(line("價差", (c.gap >= 0 ? "+" : "−") + nt(Math.abs(c.gap)).replace("NT$", "NT$"), c.gap > 0 ? C.up : C.down));
  if (!p.us && !p.k1 && !p.s) body.push({ type: "box", layout: "vertical", backgroundColor: C.br, paddingAll: "14px", spacing: "sm", contents: [
    pill("SNKRDUNK 成交走勢", C.gold, C.ink, "xs"), T("SNKRDUNK 還沒有這個商品的成交紀錄，下面是 Mercari 的價格。", { size: "xs", color: C.cream, wrap: true })] });
  if (!rows.length) rows.push(T("還沒有日本成交價", { size: "sm", color: C.cream }));
  if (rows.length) body.push({ type: "box", layout: "vertical", backgroundColor: C.br2, paddingAll: "14px", spacing: "xs", contents: rows });
  body.push({ type: "box", layout: "vertical", flex: 1, contents: [] }); // 撐滿高度，避免輪播時下面出現白色空白
  body.push({ type: "box", layout: "horizontal", backgroundColor: C.br, paddingStart: "14px", paddingEnd: "14px", paddingTop: "6px", paddingBottom: "8px", contents: [
    T("LINE @916ctmro", { size: "xxs", color: C.mute }), T(`匯率 ${R}`, { size: "xxs", color: C.mute, align: "end" })] });
  const actions = [p.us ? { type: "button", style: "primary", color: C.ink, height: "sm", action: { type: "uri", label: "🇺🇸 TCGplayer 商品頁", uri: p.uurl || "https://www.tcgplayer.com" } }
    : { type: "button", style: "primary", color: C.ink, height: "sm", action: { type: "uri", label: p.kk ? "📊 看 K 線與詳情" : "看詳情", uri: new URL("?p=" + encodeURIComponent(p.k), site).href } }];
  const links = [];
  if (p.sid) links.push({ type: "button", style: "link", height: "sm", color: C.ink, action: { type: "uri", label: "SNKRDUNK", uri: "https://snkrdunk.com/apparels/" + p.sid } });
  if (p.mq) links.push({ type: "button", style: "link", height: "sm", color: C.ink, action: { type: "uri", label: "Mercari", uri: "https://jp.mercari.com/search?keyword=" + encodeURIComponent(p.mq) + "&status=sold_out&sort=created_time&order=desc" } });
  if (links.length) actions.push({ type: "box", layout: "horizontal", contents: links });
  return { type: "bubble", size: "giga",
    body: { type: "box", layout: "vertical", paddingAll: "0px", spacing: "none", backgroundColor: C.br, contents: body },
    footer: { type: "box", layout: "vertical", spacing: "xs", backgroundColor: C.y, paddingAll: "10px", contents: actions } };
}
function carousel(list, D, env, alt) {
  const bs = list.slice(0, 10).map(p => bubble(p, D, env));
  while (bs.length > 1 && JSON.stringify(bs).length > 46000) bs.pop(); // LINE 輪播訊息上限 50KB
  return { type: "flex", altText: (alt || "查價結果").slice(0, 380), contents: { type: "carousel", contents: bs } };
}

// ---------- 圖文選單（開一次網址 /setup/richmenu 就會建立） ----------
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
    A(1854, 28, 618, 524, msg("比台灣便宜")),
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
