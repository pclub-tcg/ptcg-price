/* 2026-11 改版：資料更新狀態列、漲幅排行板、趨勢卡走勢線、手機底部導覽 */
(()=>{
const $=id=>document.getElementById(id);
const E=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const P=y=>{try{return Y(y)}catch(e){return "¥"+Math.round(y).toLocaleString()}};
const go=k=>{try{openKey(k)}catch(e){}};

/* 狀態列：從原本的 #stamp 文字取出更新時間；超過 2 天沒更新顯示黃點 */
function status(){const box=$("th-status");if(!box)return;const t=($("stamp")||{}).textContent||"";
  const pick=re=>{const m=t.match(re);return m?m[1].trim():""};
  const s=pick(/SNKRDUNK 更新：([\d-]+(?: [\d:]+)?)/),m=pick(/Mercari 更新：([\d-]+(?: [\d:]+)?)/);
  const old=v=>{const d=new Date(v.slice(0,10)+"T12:00:00+08:00");return isNaN(d)||Date.now()-d>2.5*864e5};
  const f=(lab,v)=>v?`<span><i class="${old(v)?"old":""}"></i>${lab} ${E(v.slice(5,16).replace("-","/"))}</span>`:"";
  let r="";try{r=parseFloat($("rate").value)}catch(e){}
  box.innerHTML=f("日本成交（SNKRDUNK）",s)+f("Mercari・台灣社團",m)+(r?`<span style="margin-left:auto">匯率 ¥1 ≈ NT$${r.toFixed(3)}</span>`:"");}
const st=$("stamp");if(st)new MutationObserver(status).observe(st,{childList:true,characterData:true,subtree:true});status();
$("rate")&&$("rate").addEventListener("change",status);

/* 走勢小圖（JPY 數列，舊→新） */
function spark(a,w,h){if(!a||a.length<2)return "";const mn=Math.min(...a),mx=Math.max(...a),d=mx-mn||1;
  const pts=a.map((v,i)=>[(i*(w-4)/(a.length-1)+2).toFixed(1),(h-3-(v-mn)/d*(h-6)).toFixed(1)]);
  const c=a[a.length-1]>=a[0]?"var(--up)":"var(--down)",l=pts[pts.length-1];
  return `<svg class="th-spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.map(p=>p.join(",")).join(" ")}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${l[0]}" cy="${l[1]}" r="2.6" fill="${c}"/></svg>`}
const find=k=>{const j=window.TJ||{};return [...(j.up||[]),...(j.down||[])].find(x=>x.k===k)};
const nm=x=>String(x.n||"").replace(/\s*PSA\s?10\b/i,"").replace(x.num||"\u0000","").replace(/\s{2,}/g," ").trim();
const tags=x=>(x.rar==="PSA10"?'<span class="th-tag psa">PSA10</span>':x.b?'<span class="th-tag">原盒</span>':x.rar?`<span class="th-tag">${E(x.rar)}</span>`:"");

/* 主視覺右邊：近 30 天漲幅 TOP 4 */
function board(){const j=window.TJ,b=$("th-board");if(!b||!j||!(j.up||[]).length)return false;
  $("th-rows").innerHTML=j.up.slice(0,4).map((x,i)=>`<div class="th-row" data-k="${E(x.k)}" role="button" tabindex="0" aria-label="${E(x.n)} 詳情與 K 線"><span class="rk">${i+1}</span><span class="im"><img src="${E(x.img)}" alt="" loading="lazy"></span><div style="min-width:0"><div class="nm">${E(nm(x))}</div><div class="mt">${tags(x)}<span>${E(x.num||x.set||"")}</span></div></div>${spark(x.sp,78,28)||"<span></span>"}<div class="pr"><b>${P(x.y)}</b><span class="th-dl u">▲ ${E(x.c)}%</span></div></div>`).join("");
  b.hidden=false;return true}
const rows=$("th-rows");
if(rows){rows.onclick=e=>{const r=e.target.closest("[data-k]");if(r)go(r.dataset.k)};rows.onkeydown=e=>{if(e.key==="Enter"){const r=e.target.closest("[data-k]");if(r)go(r.dataset.k)}}}

/* 趨勢卡：補走勢小圖 */
function deco(){document.querySelectorAll(".tcard[data-k]").forEach(c=>{const t=c.querySelector(".tnt");if(!t||t.querySelector("svg"))return;const x=find(c.dataset.k);if(x&&x.sp)t.insertAdjacentHTML("beforeend",spark(x.sp,70,22))})}
["tup","tdown"].forEach(id=>{const el=$(id);if(el)new MutationObserver(deco).observe(el,{childList:true})});

let n=0;const wait=setInterval(()=>{if(board()||++n>60){clearInterval(wait);deco()}},250);
document.querySelectorAll(".cur button").forEach(b=>b.addEventListener("click",()=>setTimeout(()=>{board();deco()},0)));

/* 卡片目錄、回到行情、我的庫存 */
function tcg(){const t=$("tab-tcg");if(!t)return;t.click();const s=t.closest("section")||t;window.scrollTo({top:s.getBoundingClientRect().top+scrollY-70,behavior:"smooth"});mark("tcg")}
function mark(w){document.querySelectorAll(".th-tabbar [data-th]").forEach(b=>b.classList.toggle("on",b.dataset.th===w));document.querySelectorAll(".th-nav a").forEach(a=>a.classList.toggle("on",(a.dataset.th||"top")===w))}
document.querySelectorAll("[data-th]").forEach(b=>b.addEventListener("click",e=>{const w=b.dataset.th;
  if(w==="tcg"){e.preventDefault();tcg()}
  else if(w==="top"){e.preventDefault();const f=$("tab-fb");if(f&&f.getAttribute("aria-selected")!=="true")f.click();window.scrollTo({top:0,behavior:"smooth"});mark("top")}
  else if(w==="cam"){const c=$("imgbtn");if(c&&!c.hidden){e.preventDefault();window.scrollTo({top:0,behavior:"smooth"});c.click()}}
  else if(w==="inv"){e.preventDefault();const f=$("inv-fab");if(f)f.click()}}));
const ft=$("tab-fb"),tt=$("tab-tcg");ft&&ft.addEventListener("click",()=>mark("top"));tt&&tt.addEventListener("click",()=>mark("tcg"));
setInterval(()=>{const b=$("inv-fab"),o=$("th-invn");if(b&&o){const v=(b.querySelector("b")||{}).textContent||"";o.textContent=v&&v!=="0"?v:""}},1500);
})();
