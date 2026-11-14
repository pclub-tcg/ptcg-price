/* 頁首 🔔 通知：有登入（atok，市集／競標／社群共用）就顯示未讀數，點了到通知中心 notes.html */
(function(){
  var API="https://ptcg-line-bot.spickertop.workers.dev/api/";
  var m=location.hash.match(/(?:^#|&)t=([A-Za-z0-9_-]{20,64})/);
  if(m){try{localStorage.setItem("atok",m[1])}catch(e){}try{history.replaceState(null,"",location.pathname+location.search.replace(/[?&]openExternalBrowser=1/,""))}catch(e){}}
  var tok="";try{tok=localStorage.getItem("atok")||""}catch(e){}
  var host=document.querySelector(".th-right")||document.querySelector("header .nav")||document.querySelector("header nav");
  if(!host||document.getElementById("pc-bell"))return;
  var st=document.createElement("style");
  st.textContent=".pc-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;color:inherit;text-decoration:none;flex:none}.pc-bell:hover{background:rgba(127,127,127,.12)}.pc-bell svg{width:22px;height:22px}.pc-bell b{position:absolute;top:3px;right:1px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#e5484d;color:#fff;font:700 11px/18px system-ui,sans-serif;text-align:center}.pc-bell b[hidden]{display:none}";
  document.head.appendChild(st);
  var a=document.createElement("a");a.id="pc-bell";a.href="notes.html";a.className="pc-bell";a.setAttribute("aria-label","通知中心");
  a.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><b hidden></b>';
  if(host.classList.contains("th-right"))host.insertBefore(a,host.firstChild);else host.appendChild(a);
  /* ＋ 新增：拍照查價、刊登、上架競標、發文、抽卡試算、記錄收藏（首頁底部中間和各頁共用） */
  window.PCPlus=function(){
    var bg=document.getElementById("pc-plus");if(bg){bg.hidden=false;return}
    var A=[["📷","拍照查價","傳卡片照片給 LINE，自動辨識行情","https://line.me/R/ti/p/@916ctmro","#06C755,#04a344"],["💬","發到社群","曬卡、開箱、分享抽卡戰績","community.html?compose=1","#f97316,#ef4444"],["🛒","刊登市集","賣卡，一口價或接受議價","market.html?new=1","#10b981,#059669"],["🔨","上架競標","讓大家出價","auction.html?new=1","#f59e0b,#ea580c"],["🎴","抽卡試算","換點數還是出貨賣？","draw.html","#8b5cf6,#d946ef"],["📚","記錄收藏","在圖鑑標記你有的卡","dex.html","#3b82f6,#6366f1"]];
    var cs=document.createElement("style");cs.textContent="#pc-plus{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center}#pc-plus[hidden]{display:none}#pc-plus .pp{width:100%;max-width:560px;background:#17110E;color:#F6EDE3;border-radius:22px 22px 0 0;border-top:1px solid #3A2C23;padding:18px 16px calc(18px + env(safe-area-inset-bottom,0px));animation:ppu .22s ease-out}@keyframes ppu{from{transform:translateY(40px);opacity:.4}}#pc-plus h3{margin:0 0 12px;font-size:17px;font-weight:900;display:flex;justify-content:space-between;align-items:center}#pc-plus h3 button{width:36px;height:36px;border-radius:50%;border:0;background:#251C17;color:#F6EDE3;font-size:16px;cursor:pointer}#pc-plus .pg{display:grid;grid-template-columns:1fr 1fr;gap:8px}#pc-plus a{display:flex;gap:10px;align-items:center;padding:12px;border-radius:14px;background:#1D1612;border:1px solid #2F241D;text-decoration:none;color:inherit;min-height:64px}#pc-plus a:hover{border-color:#FF8A2B}#pc-plus a i{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-style:normal;font-size:20px;flex:none}#pc-plus a b{display:block;font-size:14px}#pc-plus a small{display:block;font-size:11.5px;color:#A8988A;line-height:1.4;margin-top:2px}";
    document.head.appendChild(cs);
    bg=document.createElement("div");bg.id="pc-plus";bg.innerHTML='<div class="pp" role="dialog" aria-modal="true" aria-label="新增"><h3>要做什麼？<button type="button" aria-label="關閉">✕</button></h3><div class="pg">'+A.map(function(a){return '<a href="'+a[3]+'"'+(/^https/.test(a[3])?' target="_blank" rel="noopener"':'')+'><i style="background:linear-gradient(135deg,'+a[4]+')">'+a[0]+'</i><span><b>'+a[1]+'</b><small>'+a[2]+'</small></span></a>'}).join("")+'</div></div>';
    document.body.appendChild(bg);
    var close=function(){bg.hidden=true};bg.onclick=function(e){if(e.target===bg||e.target.closest("h3 button"))close()};
    document.addEventListener("keydown",function(e){if(e.key==="Escape")close()});
    var f=bg.querySelector("a");if(f)f.focus();
  };
  /* 新頁面（有載入 pages.css）在手機加底部選單，跟首頁一樣：行情／社群／＋／市集／我的庫存 */
  if(document.querySelector('link[href="pages.css"]')&&!document.querySelector(".pc-tab")){
    var here=location.pathname.split("/").pop()||"index.html",T=[["./","行情",'<path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/>'],["community.html","社群",'<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'],["+","新增",""],["market.html","市集",'<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v11H4z"/><path d="M10 20v-5h4v5"/>'],["./#inv","我的庫存",'<path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3"/>']];
    var nv=document.createElement("nav");nv.className="pc-tab";nv.setAttribute("aria-label","快速選單");
    nv.innerHTML=T.map(function(t){if(t[0]==="+")return '<button type="button" class="pl" onclick="PCPlus()"><i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></i>新增</button>';var on=t[0]===here;return '<a href="'+t[0]+'"'+(on?' class="on" aria-current="page"':'')+'><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+t[2]+'</svg>'+t[1]+'</a>'}).join("");
    document.body.appendChild(nv);document.body.classList.add("has-tab");
  }
  if(!tok||/notes\.html$/.test(location.pathname))return;
  fetch(API+"n/count",{headers:{"x-tok":tok}}).then(function(r){return r.json()}).then(function(j){var n=j&&j.unread||0;if(n>0){var b=a.querySelector("b");b.hidden=false;b.textContent=n>99?"99+":n;a.setAttribute("aria-label","通知中心，"+n+" 則未讀")}}).catch(function(){});
})();
