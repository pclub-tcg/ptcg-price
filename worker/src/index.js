// 卡價套利王 LINE 機器人（Cloudflare Worker）
// 環境變數（在 Cloudflare 設定頁填，不要寫進程式）：
//   LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN  必填
//   ANTHROPIC_API_KEY                               選填：以圖搜尋用
//   SITE_URL   你的 GitHub Pages 網址，例如 https://帳號.github.io/ptcg-price/
//   CLAUDE_MODEL 選填，預設 claude-sonnet-5-5
//   IMAGE_LIMIT_PER_IP 選填，網站以圖搜尋每個 IP 每天幾次，預設 30

const CACHE_MS = 10 * 60 * 1000;
let DATA = null, DATA_AT = 0;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/identify") return identifyRoute(req, env);
    if (req.method === "GET") return new Response("卡價套利王 LINE bot OK");
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
    body: JSON.stringify({ replyToken: token, messages: messages.slice(0, 5) }),
  });
  if (!r.ok) console.error("reply failed", r.status, await r.text());
}
const text = t => ({ type: "text", text: t.slice(0, 4900) });

async function handle(ev, env) {
  if (ev.type === "follow") return reply(env, ev.replyToken, [text(HELP)]);
  if (ev.type !== "message" || !ev.replyToken) return;
  const D = await data(env);
  if (ev.message.type === "text") {
    const q = ev.message.text.trim();
    if (/^(說明|help|使用說明|\?|？)$/i.test(q)) return reply(env, ev.replyToken, [text(HELP)]);
    if (/^(有賺頭|賺|推薦|熱門)$/.test(q)) {
      const list = D.products.map(p => ({ p, c: calc(p, D) })).filter(x => x.c && x.c.gap != null && x.c.gap > 0)
        .sort((a, b) => b.c.gap / b.c.cost - a.c.gap / a.c.cost).slice(0, 10).map(x => x.p);
      if (!list.length) return reply(env, ev.replyToken, [text("目前沒有價差為正的商品。")]);
      return reply(env, ev.replyToken, [text("目前價差最大的商品（日本成本 → 台灣社團價）："), carousel(list, D, env, "有賺頭的商品")]);
    }
    const hits = search(q, D);
    if (!hits.length) return reply(env, ev.replyToken, [text(`找不到「${q}」。\n可以試試卡號（例如 201/165）、系列加卡號（SV8 132/106）、卡名（噴火龍）或加上 PSA10。\n也可以直接傳卡片照片給我。`)]);
    return reply(env, ev.replyToken, [carousel(hits, D, env, "「" + q + "」的查價結果")]);
  }
  if (ev.message.type === "image") {
    if (!env.ANTHROPIC_API_KEY) return reply(env, ev.replyToken, [text("以圖搜尋還沒開啟。請先用文字查詢，例如「SV8 132/106」或「噴火龍 PSA10」。")]);
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

const HELP = `卡價套利王｜日本成交價 × 台灣社團價

📝 文字查價：傳卡號、卡名或系列
　例：201/165、SV8 132/106、噴火龍 PSA10、純白閃焰 BOX
📷 以圖搜尋：直接傳卡片照片
💰 傳「有賺頭」：看目前價差最大的商品

價格說明：日本價為 Mercari / SNKRDUNK 近期成交中位數；到手成本 = Mercari 扣優惠券 NT$600 加運費，或 SNKRDUNK 加運費，取較便宜的；台灣價多為社團開價。`;

// ---------- 資料 ----------
async function data(env) {
  if (DATA && Date.now() - DATA_AT < CACHE_MS) return DATA;
  const r = await fetch(new URL("data/bot.json", env.SITE_URL).href, { cf: { cacheTtl: 300 } });
  if (!r.ok) { if (DATA) return DATA; throw new Error("bot.json " + r.status); }
  DATA = await r.json(); DATA_AT = Date.now();
  for (const p of DATA.products) p.h = norm([p.n, p.j, p.kw, p.cn, p.num, p.set, p.rar, p.b ? "box 原盒" : "", p.p ? "psa10 鑑定" : ""].join(" "));
  return DATA;
}
const norm = s => String(s || "").normalize("NFKC").toLowerCase();

function calc(p, D) {
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

async function identify(buf, mediaType, env) {
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
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
  if (!env.ANTHROPIC_API_KEY) return out({ code: "not_configured" }, 503);
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

// ---------- Flex 訊息 ----------
const yen = v => "¥" + Math.round(v).toLocaleString("en-US");
const nt = v => "NT$" + Math.round(v).toLocaleString("en-US");
const row = (k, v, color) => ({ type: "box", layout: "horizontal", contents: [
  { type: "text", text: k, size: "xs", color: "#8a8778", flex: 5 },
  { type: "text", text: v, size: "sm", color: color || "#1c2333", align: "end", flex: 6, weight: "bold" }] });

function bubble(p, D, env) {
  const c = calc(p, D), site = env.SITE_URL;
  const rows = [];
  if (p.s) rows.push(row("SNKRDUNK 成交中位", `${yen(p.s[0])}（${p.s[1]}筆）`));
  if (p.m) rows.push(row("Mercari 成交中位", `${yen(p.m[0])}（${p.m[1]}筆）`));
  if (c) rows.push(row(`到手成本（${c.src}）`, nt(c.cost)));
  if (p.tw) rows.push(row("台灣社團" + (p.tt || ""), nt(p.tw)));
  if (c && c.gap != null) rows.push(row("價差", (c.gap >= 0 ? "+" : "") + Math.round(c.gap).toLocaleString("en-US"), c.gap > 0 ? "#d6363d" : "#0f8f80"));
  if (!rows.length) rows.push({ type: "text", text: "還沒有日本成交價", size: "sm", color: "#8a8778" });
  const actions = [];
  actions.push({ type: "button", style: "primary", color: "#1c2333", height: "sm", action: { type: "uri", label: p.kk ? "看 K 線與詳情" : "看詳情", uri: new URL("?p=" + encodeURIComponent(p.k), site).href } });
  if (p.sid) actions.push({ type: "button", style: "link", height: "sm", action: { type: "uri", label: "SNKRDUNK 成交紀錄", uri: "https://snkrdunk.com/apparels/" + p.sid } });
  if (p.mq) actions.push({ type: "button", style: "link", height: "sm", action: { type: "uri", label: "Mercari 成交紀錄", uri: "https://jp.mercari.com/search?keyword=" + encodeURIComponent(p.mq) + "&status=sold_out&sort=created_time&order=desc" } });
  const b = {
    type: "bubble", size: "kilo",
    body: { type: "box", layout: "vertical", spacing: "sm", contents: [
      { type: "text", text: p.n, weight: "bold", size: "md", wrap: true, maxLines: 3 },
      ...(p.j && p.j !== p.n ? [{ type: "text", text: p.j, size: "xxs", color: "#8a8778", wrap: true, maxLines: 2 }] : []),
      ...(p.note ? [{ type: "text", text: p.note, size: "xxs", color: "#b26a00", wrap: true, maxLines: 3 }] : []),
      { type: "separator", margin: "md" },
      { type: "box", layout: "vertical", spacing: "xs", margin: "md", contents: rows },
    ] },
    footer: { type: "box", layout: "vertical", spacing: "xs", contents: actions },
  };
  if (p.img) b.hero = { type: "image", url: new URL(p.img, site).href, size: "full", aspectRatio: "5:7", aspectMode: "fit", backgroundColor: "#232a3b" };
  return b;
}
function carousel(list, D, env, alt) {
  return { type: "flex", altText: (alt || "查價結果").slice(0, 380), contents: { type: "carousel", contents: list.slice(0, 10).map(p => bubble(p, D, env)) } };
}

export { search, matchImage, calc, bubble, carousel, verify };
