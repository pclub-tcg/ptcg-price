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
  if(!tok||/notes\.html$/.test(location.pathname))return;
  fetch(API+"n/count",{headers:{"x-tok":tok}}).then(function(r){return r.json()}).then(function(j){var n=j&&j.unread||0;if(n>0){var b=a.querySelector("b");b.hidden=false;b.textContent=n>99?"99+":n;a.setAttribute("aria-label","通知中心，"+n+" 則未讀")}}).catch(function(){});
})();
