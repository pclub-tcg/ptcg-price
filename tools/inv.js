/* 我的庫存＋出售清單一鍵出圖（資料只存在這台裝置的瀏覽器 localStorage；可匯出／匯入備份） */
(function(){
const LS={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
let INVL=LS.get("inv",[]);if(!Array.isArray(INVL))INVL=[];
const save=()=>{LS.set("inv",INVL);fab()};
const r10=v=>Math.round(v/10)*10;
const ntf=v=>"NT$"+fmt(Math.round(v));
const today=()=>{const d=new Date();return d.getFullYear()+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+String(d.getDate()).padStart(2,"0")};
const BOX='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/></svg>';

/* 從商品取出：名稱、細項、圖、行情（台幣） */
function info(src){
  if(src.it){const it=src.it,s=it.s||[],p=it.p||[],y=s.length?median(s):p.length?median(p):null;
    return{k:"i:"+it.n,n:it.n,meta:[it.ver,{raw:"單卡",graded:"鑑定卡",box:"原盒"}[it.cat]].filter(Boolean).join("・"),
      img:hiOf(it.sid)||IMGS[it.img]||null,spr:it.cn!=null&&SPR[it.cn]!=null?SPR[it.cn]:null,y,nt:y!=null?y*RATE():null,src:s.length?"SNKRDUNK":p.length?"Mercari":""}}
  const o=src.o;
  if(o.us){const x=o.x;return{k:o.n,n:x.zh||x.n,meta:["美版",x.set,x.num,o.box?"未拆":x.r].filter(Boolean).join("・"),img:x.img||null,spr:null,y:null,nt:o.price||null,src:"TCGplayer"}}
  const it=CN[o.n],s=it&&it.s&&it.s.length?it.s:(SNK.cards[o.n]&&SNK.cards[o.n].s)||[],p=it&&it.p&&it.p.length?it.p:(MERC.cards[o.n]&&MERC.cards[o.n].p)||[];
  const y=s.length?median(s):p.length?median(p):null,sid=(it&&it.sid)||(SNK.cards[o.n]&&SNK.cards[o.n].id);
  return{k:"r:"+o.n,n:o.base+(o.psa&&!o.box?" PSA10":""),meta:[o.en?"美版":"日版",o.num,o.set&&!o.box?o.set:"",o.box?"原盒":o.rar].filter(x=>x&&x!=="-").join("・"),
    img:hiOf(sid)||null,spr:o.spr!=null?o.spr:null,y,nt:y!=null?y*RATE():null,src:s.length?"SNKRDUNK":p.length?"Mercari":""}
}
function resolve(k){
  if(k.startsWith("i:")){const it=ITEMS.find(x=>x.n===k.slice(2));return it?{it}:null}
  if(k.startsWith("us:")){const o=ROWS.find(x=>x.n===k);return o?{o}:null}
  if(k.startsWith("r:")){const o=ROWS.find(x=>x.n===k.slice(2));return o?{o}:null}
  return null}
function live(r){const s=resolve(r.k);if(!s)return{nt:r.snap,src:r.ssrc,old:1};const i=info(s);if(i.img&&!r.img){r.img=i.img}return{nt:i.nt,src:i.src}}
const imgTag=(r,w)=>r.img?`<img src="${esc(r.img)}" alt="" loading="lazy">`:r.spr!=null?sprBox(r.spr,w):`<span>${esc((r.n||"").slice(0,6))}</span>`;

/* 商品詳情的「加入我的庫存」 */
window.INV={addFrom(src,btn){
  const i=info(src),box=btn.parentNode;let f=box.querySelector(".inv-form");if(f){f.remove();return}
  f=document.createElement("div");f.className="inv-form";
  f.innerHTML=`<label>買入單價（NT$）<input type="number" inputmode="numeric" min="0" step="10" value="${i.nt!=null?r10(i.nt):""}" class="c"></label><label>張數<input type="number" inputmode="numeric" min="1" step="1" value="1" class="q" style="width:80px"></label><button type="button" class="ok">加入</button><span class="inv-msg" aria-live="polite"></span>`;
  box.appendChild(f);f.querySelector(".c").focus();
  f.querySelector(".ok").onclick=()=>{const c=+f.querySelector(".c").value||0,q=Math.max(1,Math.round(+f.querySelector(".q").value||1));
    const ex=INVL.find(r=>r.k===i.k);
    if(ex){const tq=ex.qty+q;ex.cost=Math.round((ex.cost*ex.qty+c*q)/tq);ex.qty=tq}
    else INVL.push({k:i.k,n:i.n,meta:i.meta,img:i.img,spr:i.spr,qty:q,cost:c,at:today(),snap:i.nt,ssrc:i.src});
    save();f.querySelector(".inv-msg").textContent=ex?`已合併，現在共 ${ex.qty} 張`:"已加入我的庫存"}},open};

/* 右下角按鈕 */
const fb=document.createElement("button");fb.type="button";fb.className="inv-fab";fb.id="inv-fab";fb.setAttribute("aria-label","我的庫存");
document.body.appendChild(fb);fb.onclick=()=>open();
function fab(){const n=INVL.reduce((a,r)=>a+r.qty,0);fb.innerHTML=BOX+`<span>我的庫存</span><b>${n}</b>`}
fab();

/* 庫存視窗 */
const bg=document.createElement("div");bg.className="inv-bg";bg.id="inv-bg";bg.hidden=true;
bg.innerHTML=`<div class="inv" role="dialog" aria-modal="true" aria-labelledby="inv-h"><div class="inv-head"><h2 id="inv-h">我的庫存<small id="inv-sub">資料存在這台裝置的瀏覽器</small></h2><button type="button" class="inv-x" id="inv-x" aria-label="關閉">×</button></div><div class="inv-body" id="inv-body"></div></div>`;
document.body.appendChild(bg);
const B=()=>$("inv-body");let VIEW="list",SEL={},OUTURL=null;
bg.addEventListener("click",e=>{if(e.target===bg)close()});$("inv-x").onclick=close;
function open(){VIEW="list";bg.hidden=false;document.body.style.overflow="hidden";Promise.resolve(typeof EXP!=="undefined"?EXP:0).then(draw);draw();$("inv-x").focus()}
function close(){bg.hidden=true;document.body.style.overflow="";if(OUTURL){URL.revokeObjectURL(OUTURL);OUTURL=null}}
function draw(){if(bg.hidden)return;if(VIEW==="sell")return drawSell();if(VIEW==="out")return;drawList()}

function drawList(){
  $("inv-h").firstChild.textContent="我的庫存";
  let tc=0,tv=0,nq=0,nv=0;const rows=INVL.map((r,ix)=>{const L=live(r),c=r.cost*r.qty;tc+=c;nq+=r.qty;
    const v=L.nt!=null?L.nt*r.qty:null;if(v!=null){tv+=v;nv+=c}const pl=v!=null?v-c:null,pp=pl!=null&&c?pl/c*100:null;
    return `<div class="inv-row nochk" data-i="${ix}"><div class="inv-im">${imgTag(r,64)}</div><div class="inv-main"><div class="nm">${esc(r.n)}</div><div class="mt">${esc(r.meta||"")}${r.at?"・入庫 "+esc(r.at):""}</div>
      <div class="pr"><span>成本 <b>${N(c)}</b></span><span>行情 <b>${L.nt!=null?N(L.nt):"—"}</b>${L.src?` <small>${esc(L.src)}${L.old?"（上次）":""}</small>`:""}</span>${pl!=null?`<span class="${pl>0?"up-t":pl<0?"down-t":""}">損益 <b>${pl>=0?"+":"−"}${N(Math.abs(pl))}</b>${pp!=null?`（${pp>=0?"+":""}${pp.toFixed(1)}%）`:""}</span>`:""}</div>
      <div class="inv-edit"><label>買入單價 NT$<input type="number" inputmode="numeric" min="0" step="10" value="${r.cost}" data-f="cost"></label><label>張數<input type="number" inputmode="numeric" min="1" step="1" value="${r.qty}" data-f="qty" style="width:72px"></label><button type="button" class="inv-del" data-del="${ix}">刪除</button></div></div></div>`});
  const pl=tv-nv,pp=nv?pl/nv*100:null;
  B().innerHTML=`<dl class="inv-sum"><div><dt>品項／張數</dt><dd>${INVL.length}／${nq}</dd></div><div><dt>持有成本</dt><dd>${N(tc)}</dd></div><div><dt>目前估值</dt><dd>${N(tv)}</dd></div>
    <div><dt>未實現損益</dt><dd class="${pl>0?"up-t":pl<0?"down-t":""}">${pl>=0?"+":"−"}${N(Math.abs(pl))}</dd></div><div><dt>報酬率</dt><dd class="${pl>0?"up-t":pl<0?"down-t":""}">${pp!=null?(pp>=0?"+":"")+pp.toFixed(1)+"%":"—"}</dd></div><div><dt>有行情的品項</dt><dd>${INVL.filter(r=>live(r).nt!=null).length}／${INVL.length}</dd></div></dl>
    <p class="inv-note">估值＝SNKRDUNK（沒有就用 Mercari）近期成交中位 × 張數，換算台幣；美版用 TCGplayer 市場價。資料只存在這台裝置的瀏覽器，換手機或清除瀏覽資料前請先「匯出備份」。</p>
    <div class="inv-tools"><button type="button" class="inv-btn main" id="inv-go"${INVL.length?"":" disabled"}>出售清單出圖</button><button type="button" class="inv-btn sub" id="inv-exp"${INVL.length?"":" disabled"}>匯出備份</button><button type="button" class="inv-btn sub" id="inv-imp">匯入備份</button><input type="file" id="inv-file" accept="application/json,.json" hidden></div>
    <div class="inv-list">${rows.join("")||`<div class="inv-empty">還沒有庫存。打開任何商品，按「＋ 加入我的庫存」就會出現在這裡。</div>`}</div>`;
  B().querySelectorAll(".inv-edit input").forEach(inp=>inp.onchange=()=>{const r=INVL[+inp.closest(".inv-row").dataset.i];if(!r)return;
    if(inp.dataset.f==="qty")r.qty=Math.max(1,Math.round(+inp.value||1));else r.cost=Math.max(0,+inp.value||0);save();drawList()});
  B().querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{if(b.dataset.sure){INVL.splice(+b.dataset.del,1);save();drawList()}else{b.dataset.sure=1;b.textContent="再按一次確認刪除"}});
  $("inv-go").onclick=()=>{VIEW="sell";SEL={};drawSell()};
  $("inv-exp").onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify({v:1,inv:INVL},null,1)],{type:"application/json"}));a.download="pclub-庫存-"+today().replace(/\//g,"")+".json";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)};
  $("inv-imp").onclick=()=>$("inv-file").click();
  $("inv-file").onchange=e=>{const f=e.target.files[0];if(!f)return;f.text().then(t=>{const j=JSON.parse(t),a=Array.isArray(j)?j:j.inv;if(!Array.isArray(a))throw 0;
    for(const r of a){if(!r||!r.k||!r.n)continue;const i=INVL.findIndex(x=>x.k===r.k);const v={k:String(r.k),n:String(r.n),meta:String(r.meta||""),img:r.img?String(r.img):null,spr:r.spr!=null?+r.spr:null,qty:Math.max(1,+r.qty||1),cost:Math.max(0,+r.cost||0),at:String(r.at||""),snap:r.snap!=null?+r.snap:null,ssrc:String(r.ssrc||"")};
      if(i>=0)INVL[i]=v;else INVL.push(v)}save();drawList()}).catch(()=>{B().insertAdjacentHTML("afterbegin",`<p class="inv-note" style="color:var(--bad)">這個檔案不是 P’CLUB 的庫存備份，沒有匯入。</p>`)})};
}

function drawSell(){
  $("inv-h").firstChild.textContent="出售清單";
  const contact=LS.get("invContact",""),title=LS.get("invTitle","出售清單");
  B().innerHTML=`<p class="inv-note">勾選要賣的卡，填每張開價（台幣）和張數。行情參考 SNKRDUNK（沒有就用 Mercari）近期成交中位。</p>
    <div class="inv-tools"><span class="inv-note" style="margin:0">一鍵套用開價：</span><button type="button" class="inv-btn sub" data-r="1">行情原價</button><button type="button" class="inv-btn sub" data-r="0.95">行情 95 折</button><button type="button" class="inv-btn sub" data-r="0.9">行情 9 折</button><button type="button" class="inv-btn sub" id="inv-all">全選</button></div>
    <div class="inv-list">${INVL.map((r,ix)=>{const L=live(r),s=SEL[ix];return `<div class="inv-row${s?" on":""}" data-i="${ix}"><input type="checkbox" class="ck" aria-label="選擇 ${esc(r.n)}"${s?" checked":""}><div class="inv-im">${imgTag(r,64)}</div><div class="inv-main"><div class="nm">${esc(r.n)}</div><div class="mt">${esc(r.meta||"")}・持有 ${r.qty} 張</div>
      <div class="pr"><span>行情 <b>${L.nt!=null?ntf(L.nt):"—"}</b></span><span>成本 <b>${ntf(r.cost)}</b></span></div>
      <div class="inv-sell"><label>每張開價 NT$<input type="number" inputmode="numeric" min="0" step="10" class="p" value="${s?s.p:""}" placeholder="${L.nt!=null?r10(L.nt):"自行填寫"}"${s?"":" disabled"}></label><label>出售張數<input type="number" inputmode="numeric" min="1" max="${r.qty}" step="1" class="q" value="${s?s.q:1}" style="width:72px"${s?"":" disabled"}></label></div></div></div>`}).join("")}</div>
    <div class="inv-sell"><label>圖片標題<input type="text" id="inv-title" value="${esc(title)}" maxlength="20" style="width:180px;font-family:var(--f-body)"></label><label>聯絡方式（會印在圖上，選填）<input type="text" id="inv-contact" value="${esc(contact)}" maxlength="40" placeholder="例：私訊 LINE xxx" style="width:240px;font-family:var(--f-body)"></label></div>
    <div class="inv-tools"><button type="button" class="inv-btn sub" id="inv-back">返回庫存</button><button type="button" class="inv-btn main" id="inv-make">產生圖片</button><span class="inv-msg" id="inv-err" style="color:var(--bad)"></span></div>`;
  const sync=row=>{const ix=+row.dataset.i,ck=row.querySelector(".ck"),p=row.querySelector(".p"),q=row.querySelector(".q");p.disabled=q.disabled=!ck.checked;row.classList.toggle("on",ck.checked);
    if(ck.checked){if(!p.value&&p.placeholder&&!isNaN(+p.placeholder))p.value=p.placeholder;SEL[ix]={p:+p.value||0,q:Math.min(INVL[ix].qty,Math.max(1,Math.round(+q.value||1)))}}else delete SEL[ix]};
  B().querySelectorAll(".inv-row").forEach(row=>{row.querySelector(".ck").onchange=()=>sync(row);row.querySelectorAll(".p,.q").forEach(i=>i.oninput=()=>sync(row))});
  B().querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{B().querySelectorAll(".inv-row").forEach(row=>{const L=live(INVL[+row.dataset.i]);if(row.querySelector(".ck").checked&&L.nt!=null){row.querySelector(".p").value=r10(L.nt*+b.dataset.r);sync(row)}})});
  $("inv-all").onclick=()=>{B().querySelectorAll(".inv-row").forEach(row=>{row.querySelector(".ck").checked=true;sync(row)})};
  $("inv-back").onclick=()=>{VIEW="list";drawList()};
  $("inv-make").onclick=()=>{LS.set("invContact",$("inv-contact").value.trim());LS.set("invTitle",$("inv-title").value.trim()||"出售清單");
    const list=Object.keys(SEL).map(ix=>({r:INVL[ix],...SEL[ix]})).filter(x=>x.r);
    if(!list.length){$("inv-err").textContent="請先勾選至少一張卡";return}
    if(list.some(x=>!x.p)){$("inv-err").textContent="有勾選的卡還沒填開價";return}
    $("inv-err").textContent="產生中…";render(list).catch(e=>{$("inv-err").textContent="產生失敗，請再試一次"})};
}

/* 出圖 */
function loadImg(src){return new Promise(res=>{if(!src)return res(null);const i=new Image();if(/^https?:/.test(src)&&new URL(src,location.href).origin!==location.origin)i.crossOrigin="anonymous";i.onload=()=>res(i);i.onerror=()=>res(null);i.src=src})}
async function cardImg(r){const i=await loadImg(r.img);if(i)return{i};if(r.spr!=null){const sh=await loadImg("sprites/s"+String(Math.floor(r.spr/20)).padStart(2,"0")+".jpg");if(sh){const cw=sh.naturalWidth/5,ch=sh.naturalHeight/4,c=r.spr%20;return{i:sh,sx:(c%5)*cw,sy:Math.floor(c/5)*ch,sw:cw,sh:ch}}}return null}
function rr(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath()}
function wrap(g,t,x,y,w,lh,max){const ch=[...t];let line="",n=0;for(let k=0;k<ch.length;k++){const tt=line+ch[k];if(g.measureText(tt).width>w&&line){n++;if(n===max){while(g.measureText(line+"…").width>w&&line)line=line.slice(0,-1);g.fillText(line+"…",x,y);return y+lh}g.fillText(line,x,y);y+=lh;line=ch[k]}else line=tt}if(line){g.fillText(line,x,y);y+=lh}return y}
async function render(list){
  const F='"Noto Sans TC",system-ui,sans-serif',M='"IBM Plex Mono",ui-monospace,monospace';
  try{await Promise.all(["900 60px","700 30px","500 22px"].map(w=>document.fonts.load(w+' "Noto Sans TC"',"出售清單開價行情")).concat([document.fonts.load('600 30px "IBM Plex Mono"',"NT$0123456789")]))}catch(e){}
  const imgs=await Promise.all(list.map(x=>cardImg(x.r)));
  const W=1080,P=40,G=24,one=list.length===1,cw=one?W-P*2:(W-P*2-G)/2,chh=300,rows=Math.ceil(list.length/(one?1:2)),HH=210,FH=220,H=HH+rows*(chh+G)+FH;
  const cv=document.createElement("canvas");cv.width=W;cv.height=H;const g=cv.getContext("2d");
  g.fillStyle="#1a120e";g.fillRect(0,0,W,H);
  const gr=g.createRadialGradient(W*.85,0,0,W*.85,0,520);gr.addColorStop(0,"rgba(255,138,43,.35)");gr.addColorStop(1,"rgba(255,138,43,0)");g.fillStyle=gr;g.fillRect(0,0,W,520);
  g.textBaseline="top";g.fillStyle="#fff6ea";g.font="900 64px "+F;g.fillText(LS.get("invTitle","出售清單"),P,52);
  g.fillStyle="#b9a493";g.font="500 24px "+F;g.fillText(today()+"・參考行情：SNKRDUNK／Mercari 近期成交中位",P,140);
  g.textAlign="right";g.fillStyle="#ff8a2b";g.font="900 34px "+F;g.fillText("P’CLUB",W-P,62);g.textAlign="left";
  let tot=0,totq=0;
  list.forEach((x,ix)=>{const col=one?0:ix%2,row=one?ix:Math.floor(ix/2),cx=P+col*(cw+G),cy=HH+row*(chh+G),r=x.r,L=live(r);tot+=x.p*x.q;totq+=x.q;
    g.fillStyle="#2a1d17";rr(g,cx,cy,cw,chh,22);g.fill();g.strokeStyle="#46301f";g.lineWidth=2;g.stroke();
    const iw=180,ih=252,ix0=cx+22,iy0=cy+24;g.save();rr(g,ix0,iy0,iw,ih,10);g.clip();g.fillStyle="#fff";g.fillRect(ix0,iy0,iw,ih);
    const im=imgs[ix];if(im){const sw=im.sw||im.i.naturalWidth,sh=im.sh||im.i.naturalHeight,sc=Math.min(iw/sw,ih/sh),dw=sw*sc,dh=sh*sc;g.drawImage(im.i,im.sx||0,im.sy||0,sw,sh,ix0+(iw-dw)/2,iy0+(ih-dh)/2,dw,dh)}
    else{g.fillStyle="#7a6656";g.font="700 22px "+F;g.textAlign="center";g.fillText("無圖片",ix0+iw/2,iy0+ih/2-12);g.textAlign="left"}g.restore();
    const tx=ix0+iw+22,tw=cx+cw-tx-20;let y=cy+26;
    g.fillStyle="#fff6ea";g.font="900 30px "+F;y=wrap(g,r.n,tx,y,tw,38,2);
    g.fillStyle="#b9a493";g.font="500 21px "+F;y=wrap(g,[r.meta,x.q+" 張"].filter(Boolean).join("・"),tx,y+2,tw,28,2);
    if(L.nt!=null){g.fillStyle="#b9a493";g.font="500 19px "+F;g.fillText((L.src||"市場")+" 行情",tx,y+6);g.fillStyle="#ffc48a";let f2=28;g.font="600 28px "+M;while(f2>18&&g.measureText(ntf(L.nt)).width>tw){f2-=2;g.font="600 "+f2+"px "+M}g.fillText(ntf(L.nt),tx,y+30);y+=66}else y+=10;
    g.fillStyle="#ffffff";g.font="900 34px "+F;const lab="開價 ",lw=g.measureText(lab).width;g.fillText(lab,tx,y+2);g.fillStyle="#ff8a2b";let fs=36;g.font="600 36px "+M;while(fs>20&&lw+g.measureText(ntf(x.p)).width>tw){fs-=2;g.font="600 "+fs+"px "+M}g.fillText(ntf(x.p),tx+lw,y+(36-fs)/2);
    if(L.nt){const ra=x.p/L.nt;g.fillStyle="#e8d6c4";g.font="500 20px "+F;g.fillText(ra<1?"約行情 "+(Math.round(ra*100)/10).toFixed(1)+" 折（每張）":ra>1?"高於行情 "+Math.round((ra-1)*100)+"%（每張）":"與行情相同（每張）",tx,y+48)}
  });
  const fy=HH+rows*(chh+G)+8;g.fillStyle="#ff8a2b";rr(g,P,fy,W-P*2,118,22);g.fill();
  g.fillStyle="#2a1c17";g.font="700 26px "+F;g.fillText("合計 "+list.length+" 項・"+totq+" 張",P+30,fy+22);g.font="600 44px "+M;g.textAlign="right";g.fillText(ntf(tot),W-P-30,fy+34);g.textAlign="left";
  g.font="500 22px "+F;g.fillText("開價合計",P+30,fy+66);
  const ct=LS.get("invContact","");g.fillStyle="#fff6ea";g.font="700 28px "+F;if(ct)g.fillText(ct,P,fy+140);
  g.fillStyle="#7a6656";g.font="500 18px "+F;g.fillText("行情由 P’CLUB 卡價比價整理，僅供參考 ・ spickertop-afk.github.io/ptcg-price",P,fy+(ct?184:146));
  const blob=await new Promise((res,rej)=>{try{cv.toBlob(b=>b?res(b):rej(),"image/png")}catch(e){rej(e)}});
  if(OUTURL)URL.revokeObjectURL(OUTURL);OUTURL=URL.createObjectURL(blob);VIEW="out";
  const file=new File([blob],"pclub-出售清單-"+today().replace(/\//g,"")+".png",{type:"image/png"}),canShare=navigator.canShare&&navigator.canShare({files:[file]});
  $("inv-h").firstChild.textContent="出售清單圖片";
  B().innerHTML=`<div class="inv-out"><img src="${OUTURL}" alt="出售清單圖片"></div><p class="inv-note">手機也可以長按圖片儲存。</p>
    <div class="inv-tools"><button type="button" class="inv-btn sub" id="inv-edit2">返回修改</button><a class="inv-btn main" href="${OUTURL}" download="${esc(file.name)}" style="text-decoration:none;display:inline-flex;align-items:center">下載圖片</a>${canShare?`<button type="button" class="inv-btn" id="inv-share">分享</button>`:""}</div>`;
  $("inv-edit2").onclick=()=>{VIEW="sell";drawSell()};
  if(canShare)$("inv-share").onclick=()=>navigator.share({files:[file],title:"出售清單"}).catch(()=>{});
}
})();
