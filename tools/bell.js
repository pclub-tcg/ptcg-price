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
  /* 新頁面（有載入 pages.css）在手機加底部選單 */
  if(document.querySelector('link[href="pages.css"]')&&!document.querySelector(".pc-tab")){
    var here=location.pathname.split("/").pop()||"index.html",T=[["./","行情",'<path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/>'],["community.html","社群",'<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'],["dex.html","圖鑑",'<rect x="4" y="3" width="12" height="17" rx="2"/><path d="M8 3v17M20 6v13"/>'],["draw.html","抽卡",'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 8l1.5 3 3 .4-2.2 2 .6 3-2.9-1.5L9.1 16.4l.6-3-2.2-2 3-.4z"/>'],["market.html","市集",'<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v11H4z"/><path d="M10 20v-5h4v5"/>']];
    var nv=document.createElement("nav");nv.className="pc-tab";nv.setAttribute("aria-label","快速選單");
    nv.innerHTML=T.map(function(t){var on=t[0]===here;return '<a href="'+t[0]+'"'+(on?' class="on" aria-current="page"':'')+'><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+t[2]+'</svg>'+t[1]+'</a>'}).join("");
    document.body.appendChild(nv);document.body.classList.add("has-tab");
  }
  if(!tok||/notes\.html$/.test(location.pathname))return;
  fetch(API+"n/count",{headers:{"x-tok":tok}}).then(function(r){return r.json()}).then(function(j){var n=j&&j.unread||0;if(n>0){var b=a.querySelector("b");b.hidden=false;b.textContent=n>99?"99+":n;a.setAttribute("aria-label","通知中心，"+n+" 則未讀")}}).catch(function(){});
})();
