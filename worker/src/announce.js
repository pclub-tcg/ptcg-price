// 群發公告：只有管理員（競標管理員，meta.auction_admin）能用。
// 管理員在 LINE 傳「群發公告」→ 回預覽（圖片＋文字、好友數、本月剩餘訊息額度）→ 按「確認發送」才用 broadcast 發給所有好友。
// 每則公告（ANN.id）只能發一次，避免重複發送吃掉額度。
// 新公告：圖片放 tools/announce/（publish 時會複製到網站 announce/），然後改下面的 ANN。

export const ANN = {
  id: "20261030",
  img: "announce/announce-20261030.jpg",
  prev: "announce/announce-20261030_s.jpg",
  text: "🎉 P’CLUB 新功能上線！\n\n🛒 玩家市集：刊登要賣的卡，直接購買或出價議價，每件都標日本行情\n📮 求卡：貼出想收的卡，有人刊登就通知你\n🔔 到價提醒：查價後按卡片下方「到價提醒」，跌到你要的價格就通知你\n☠️ 海賊王行情：日版・英文版・美版每天更新\n\n傳「市集」開始，傳「市集教學」看圖解 👇",
};
const H = env => ({ authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN, "content-type": "application/json" });

async function isAdmin(env, uid) {
  if (!env.DB || !uid) return false;
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'auction_admin'").first().catch(() => null);
  return !!(r && r.v === uid);
}
function msgs(env, quick) {
  const u = p => new URL(p, env.SITE_URL).href;
  return [{ type: "image", originalContentUrl: u(ANN.img), previewImageUrl: u(ANN.prev) }, { type: "text", text: ANN.text, ...(quick ? { quickReply: { items: quick } } : {}) }];
}
const QK = [["🛒 市集", "市集"], ["📖 市集教學", "市集教學"], ["🔔 我的提醒", "我的提醒"]].map(([label, text]) => ({ type: "action", action: { type: "message", label, text } }));

async function stats(env) {
  const out = {};
  try { const q = await (await fetch("https://api.line.me/v2/bot/message/quota", { headers: H(env) })).json(); out.limit = q.type === "limited" ? q.value : null; } catch (e) {}
  try { const c = await (await fetch("https://api.line.me/v2/bot/message/quota/consumption", { headers: H(env) })).json(); out.used = c.totalUsage; } catch (e) {}
  try { // 好友數（前一天的統計，日本時間）
    const d = new Date(Date.now() + 9 * 3600e3 - 864e5).toISOString().slice(0, 10).replace(/-/g, "");
    const f = await (await fetch("https://api.line.me/v2/bot/insight/followers?date=" + d, { headers: H(env) })).json();
    if (f.status === "ready") { out.followers = f.followers; out.reach = f.targetedReaches; out.blocks = f.blocks; }
  } catch (e) {}
  return out;
}

// LINE 文字：群發公告（不是管理員就回 null，當一般查價處理）
export async function announceText(env, uid, q) {
  if (!/^(群發公告|發送公告|公告預覽)$/.test(q)) return null;
  if (!(await isAdmin(env, uid))) return [{ type: "text", text: "只有管理員可以群發公告。" }];
  const sent = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind("bc_" + ANN.id).first();
  if (sent) return [{ type: "text", text: `這則公告（${ANN.id}）已經在 ${sent.v} 發送過了，不會重複發送。` }];
  const img = await fetch(new URL(ANN.img, env.SITE_URL).href, { method: "HEAD" }).catch(() => null);
  if (!img || !img.ok) return [{ type: "text", text: "公告圖片還沒上網站（網站發布約需 10 分鐘），請稍後再傳一次「群發公告」。" }];
  const s = await stats(env);
  const n = s.reach || s.followers;
  const left = s.limit != null && s.used != null ? s.limit - s.used : null;
  const warn = left != null && n != null && n > left ? `\n⚠️ 本月剩餘額度不夠發給所有好友，LINE 會拒絕發送。` : "";
  const info = `📣 群發公告預覽（上面兩則就是好友會收到的內容）\n\n發送對象：所有好友${n != null ? `，約 ${n} 人` : ""}${s.blocks ? `（另有 ${s.blocks} 人封鎖）` : ""}\n本月訊息額度：${s.limit != null ? `${s.used ?? "?"} / ${s.limit}` : "無上限或查不到"}${left != null ? `，剩 ${left} 則` : ""}\n每位好友算 1 則。${warn}\n\n確定要發送嗎？發出後無法收回。`;
  return [...msgs(env), { type: "text", text: info, quickReply: { items: [
    { type: "action", action: { type: "postback", label: "✅ 確認發送", data: "bcgo|" + ANN.id, displayText: "確認發送公告" } },
    { type: "action", action: { type: "postback", label: "取消", data: "bcno|" + ANN.id, displayText: "取消" } }] } }];
}

export async function announcePostback(env, uid, data) {
  const [t, id] = String(data || "").split("|");
  if (t !== "bcgo" && t !== "bcno") return null;
  if (t === "bcno") return [{ type: "text", text: "已取消，沒有發送。" }];
  if (!(await isAdmin(env, uid))) return [{ type: "text", text: "只有管理員可以群發公告。" }];
  if (id !== ANN.id) return [{ type: "text", text: "這則公告已經更新過，請重新傳「群發公告」。" }];
  const now = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
  if (await env.DB.prepare("SELECT 1 FROM meta WHERE k = ?").bind("bc_" + ANN.id).first()) return [{ type: "text", text: "這則公告已經發送過了。" }];
  await env.DB.prepare("INSERT INTO meta (k, v) VALUES (?, ?)").bind("bc_" + ANN.id, now).run();
  const r = await fetch("https://api.line.me/v2/bot/message/broadcast", { method: "POST", headers: { ...H(env), "X-Line-Retry-Key": crypto.randomUUID() }, body: JSON.stringify({ messages: msgs(env, QK) }) });
  if (!r.ok) {
    const err = await r.text();
    await env.DB.prepare("DELETE FROM meta WHERE k = ?").bind("bc_" + ANN.id).run(); // 沒發成功：允許重試
    return [{ type: "text", text: "發送失敗：" + err.slice(0, 300) }];
  }
  return [{ type: "text", text: `✅ 已發送給所有好友（${now}）。` }];
}
