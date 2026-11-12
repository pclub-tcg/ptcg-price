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
/* ===== 首頁動態：社群、市集、競標、行情混在一起的雙欄瀑布流（滑到才載入） ===== */
;(function(){
  const hero=document.querySelector(".hero");if(!hero||document.getElementById("th-feed"))return;
  const A="https://ptcg-line-bot.spickertop.workers.dev/api/";
  const sec=document.createElement("section");sec.className="th-feed";sec.id="th-feed";
  sec.innerHTML=`<div class="wrap"><h2>動態<small>卡友分享・市集新上架・競標・行情</small></h2><div class="th-fchips" role="group" aria-label="動態分類">${[["","全部"],["cm","社群"],["mk","市集"],["au","競標"],["tr","行情"]].map(([k,t],i)=>`<button type="button" data-f="${k}" aria-pressed="${!i}">${t}</button>`).join("")}</div><div class="th-mas" id="th-mas"><p class="th-fmore">載入動態中…</p></div></div>`;
  hero.after(sec);
  const R=v=>"NT$"+Math.round(v).toLocaleString("en-US");
  const avc=s=>{let h=0;for(const c of String(s||""))h=(h*31+c.charCodeAt(0))%360;return `hsl(${h} 55% 48%)`};
  const left=t=>{const s=(t-Date.now())/1000;return s<=0?"已結標":s<3600?Math.ceil(s/60)+" 分後結標":s<86400?Math.floor(s/3600)+" 小時後結標":Math.floor(s/86400)+" 天後結標"};
  const ago=t=>{const s=(Date.now()-t)/1000;return s<3600?Math.max(1,Math.floor(s/60))+" 分鐘前":s<86400?Math.floor(s/3600)+" 小時前":Math.floor(s/86400)+" 天前"};
  let ALL=[],F="";
  const card=x=>{
    if(x.t==="cm"){const p=x.p,img=p.nphoto?A+"c/photo/"+p.id+"/0":p.cimg;return `<a class="fc${img?"":" txt"}" href="community.html#p${p.id}">${img?`<span class="pic${p.nphoto?"":" card"}"><img src="${E(img)}" alt="" loading="lazy"><span class="tg cm">💬 ${({show:"曬卡",open:"開箱",draw:"抽卡戰績",talk:"討論"})[p.kind]||"社群"}</span></span>`:""}<span class="bd">${!img?`<span class="tg cm" style="position:static;display:inline-block;margin-bottom:6px">💬 討論</span>`:""}<span class="t">${E(p.text||p.ctitle||"")}</span><span class="m"><span class="who"><i class="av" style="background:${avc(p.name)}">${E([...String(p.name||"玩")][0])}</i><span>${E(p.name)}</span></span><span>❤️ ${p.likes||0}</span></span></span></a>`}
    if(x.t==="mk"){const m=x.p,img=m.nphoto?A+"m/photo/"+m.id+"/0":m.cimg,cheap=m.ref&&m.price<m.ref?Math.round((1-m.price/m.ref)*100):0;return `<a class="fc" href="market.html#m${m.id}"><span class="pic${m.nphoto?"":" card"}">${img?`<img src="${E(img)}" alt="" loading="lazy">`:`<span style="display:block;height:90px"></span>`}<span class="tg mk">🛒 市集${m.nego?"・可議":""}</span></span><span class="bd"><span class="t">${E(m.title)}</span><span class="m"><b>${R(m.price)}</b>${cheap>=5?`<span class="dn">比行情便宜 ${cheap}%</span>`:`<span>${ago(m.bumped||m.created)}</span>`}</span></span></a>`}
    if(x.t==="au"){const a=x.p;return `<a class="fc" href="auction.html#a${a.id}"><span class="pic${a.photo?"":" card"}">${a.photo?`<img src="${A}a/photo/${a.id}" alt="" loading="lazy">`:`<span style="display:block;height:90px"></span>`}<span class="tg au">🔨 競標・${a.nbids||0} 次出價</span></span><span class="bd"><span class="t">${E(a.title)}</span><span class="m"><b>${R(a.price||a.start)}</b><span>${left(a.ends)}</span></span></span></a>`}
    if(x.t==="tr"){const p=x.p,up=x.up;return `<div class="fc" role="button" tabindex="0" data-k="${E(p.k)}"><span class="pic card"><img src="${E(p.img)}" alt="" loading="lazy"><span class="tg ${up?"tr":"dn"}">${up?"📈 30 天漲":"📉 30 天跌"} ${E(p.c)}%</span></span><span class="bd"><span class="t">${E(nm(p))}</span><span class="m"><b>${P(p.y)}</b>${spark(p.sp,60,20)||""}</span></span></div>`}
    return ""};
  function draw(){const L=ALL.filter(x=>!F||x.t===F);const el=document.getElementById("th-mas");
    el.innerHTML=L.length?L.map(card).join(""):`<p class="th-fmore">${F==="cm"?"社群還沒有貼文，<a href=\"community.html\">來發第一篇</a>":F==="mk"?"市集目前沒有商品，<a href=\"market.html?new=1\">刊登一件</a>":F==="au"?"目前沒有進行中的競標":"目前沒有動態"}</p>`}
  sec.querySelector(".th-fchips").onclick=e=>{const b=e.target.closest("[data-f]");if(!b)return;F=b.dataset.f;sec.querySelectorAll("[data-f]").forEach(x=>x.setAttribute("aria-pressed",x===b));draw()};
  const mas=sec.querySelector("#th-mas");
  mas.onclick=e=>{const r=e.target.closest("[data-k]");if(r){e.preventDefault();go(r.dataset.k)}};
  mas.onkeydown=e=>{if(e.key==="Enter"){const r=e.target.closest("[data-k]");if(r)go(r.dataset.k)}};
  const j=u=>fetch(A+u).then(r=>r.json()).catch(()=>({}));
  async function load(){
    const [c,m,a]=await Promise.all([j("c/list"),j("m/list"),j("a/list")]);
    const cm=(c.items||[]).slice(0,12).map(p=>({t:"cm",p})),
      mk=(m.items||[]).filter(x=>x.status==="live").slice(0,10).map(p=>({t:"mk",p})),
      au=(a.items||[]).filter(x=>x.status==="live").slice(0,6).map(p=>({t:"au",p})),
      TJ=window.TJ||{},tr=[...(TJ.up||[]).slice(4,10).map(p=>({t:"tr",p,up:1})),...(TJ.down||[]).slice(0,4).map(p=>({t:"tr",p,up:0}))];
    // 交錯排：社群、市集、行情、競標輪流
    const Q=[cm,mk,tr,au],out=[];let more=true;while(more){more=false;for(const q of Q){if(q.length){out.push(q.shift());more=true}}}
    ALL=out;draw()}
  if("IntersectionObserver" in window){const io=new IntersectionObserver(es=>{if(es.some(x=>x.isIntersecting)){io.disconnect();load()}},{rootMargin:"600px"});io.observe(sec)}else load();
})();
})();

