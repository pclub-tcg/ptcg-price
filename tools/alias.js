/* 卡片暱稱：搜尋「睡覺伊布」這類玩家叫法時，在結果上方列出對到的卡；商品詳情可以看／補這張卡的暱稱 */
(function(){
  var A="https://ptcg-line-bot.spickertop.workers.dev/api/al/",$=function(i){return document.getElementById(i)};
  var es=function(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})};
  var tok=function(){try{return localStorage.getItem("atok")||""}catch(e){return""}};
  var st=document.createElement("style");
  st.textContent="#al-strip{margin:10px 0 4px}#al-strip[hidden]{display:none}#al-strip h4{margin:0 0 8px;font-size:14px;font-weight:800}#al-strip h4 small{font-weight:600;opacity:.7;margin-left:6px}#al-strip .alr{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;scroll-snap-type:x mandatory}#al-strip button{flex:none;width:118px;scroll-snap-align:start;text-align:left;border:1px solid rgba(127,127,127,.25);background:rgba(127,127,127,.08);color:inherit;border-radius:12px;padding:6px;cursor:pointer;font:inherit}#al-strip button:hover{border-color:#FF8A2B}#al-strip img{width:100%;aspect-ratio:63/88;object-fit:contain;border-radius:6px;background:rgba(0,0,0,.15);display:block}#al-strip b{display:block;font-size:12px;line-height:1.3;margin-top:5px;max-height:2.6em;overflow:hidden}#al-strip small{display:block;font-size:11px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#al-strip i{font-style:normal;font-weight:800;color:#FF8A2B;font-size:12px}"
  +".al-box{margin-top:10px;padding:10px 12px;border-radius:14px;background:rgba(127,127,127,.1);font-size:13px}.al-box .tg{display:inline-block;margin:3px 6px 0 0;padding:2px 9px;border-radius:999px;background:rgba(255,138,43,.18);color:#FF8A2B;font-weight:700;font-size:12px}.al-box form{display:flex;gap:6px;margin-top:8px}.al-box input{flex:1;min-width:0;padding:7px 10px;border-radius:10px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font:inherit}.al-box button{padding:7px 12px;border-radius:10px;border:0;background:#FF8A2B;color:#2A1C17;font-weight:800;cursor:pointer}.al-box .msg{display:block;margin-top:6px;font-size:12px;opacity:.8}";
  document.head.appendChild(st);
  /* 搜尋結果上方的暱稱列 */
  var strip=null,T=0,last="";
  function host(){if(strip)return strip;var q=$("q");if(!q)return null;var anchor=$("panel-fb")||$("grid");if(!anchor)return null;strip=document.createElement("div");strip.id="al-strip";strip.hidden=true;anchor.parentNode.insertBefore(strip,anchor);return strip}
  function run(){var q=($("q")||{}).value||"";q=q.trim();if(q===last)return;last=q;var h=host();if(!h)return;if(q.length<2){h.hidden=true;return}
    fetch(A+"q?q="+encodeURIComponent(q)).then(function(r){return r.json()}).then(function(j){if(q!==last)return;var L=(j&&j.items)||[];if(!L.length){h.hidden=true;return}
      h.innerHTML='<h4>「'+es(j.alias)+'」<small>玩家暱稱，對到 '+L.length+' 張</small></h4><div class="alr">'+L.map(function(x){return '<button type="button" data-k="'+es(x.k)+'" data-n="'+es(x.n)+'">'+(x.img?'<img src="'+es(x.img)+'" alt="" loading="lazy">':'')+'<b>'+es(x.n)+'</b><small>'+es(x.meta||"")+'</small>'+(x.ref?'<i>NT$'+Math.round(x.ref).toLocaleString("en-US")+'</i>':'')+'</button>'}).join("")+'</div>';
      h.hidden=false;
      h.querySelectorAll("[data-k]").forEach(function(b){b.onclick=function(){var k=b.dataset.k;if(/^[rijx]:/.test(k)&&typeof window.openKey=="function")window.openKey(k);else{var i=$("q");i.value=b.dataset.n.replace(/\s*PSA10/i,"");i.dispatchEvent(new Event("input",{bubbles:true}))}}})
    }).catch(function(){})}
  document.addEventListener("input",function(e){if(e.target&&e.target.id==="q"){clearTimeout(T);T=setTimeout(run,450)}});
  addEventListener("load",function(){setTimeout(run,800)});
  /* 商品詳情：這張卡的暱稱＋補一個 */
  window.PCA=function(src){var el=$("calias");if(!el)return;var k="";try{k=window.INV&&INV.keyOf?INV.keyOf(src):""}catch(e){}if(!k)return;
    var draw=function(L,msg){el.innerHTML='<div class="al-box"><b>🏷️ 玩家暱稱</b>'+(L.length?'<div>'+L.map(function(a){return '<span class="tg">'+es(a)+'</span>'}).join("")+'</div>':'<span class="msg" style="margin-top:2px">還沒有暱稱。大家都叫它什麼？例如「睡覺伊布」</span>')
      +(tok()?'<form><input maxlength="12" placeholder="幫這張卡取暱稱" aria-label="暱稱"><button>新增</button></form>':'<span class="msg"><a href="https://line.me/R/oaMessage/@916ctmro/?'+encodeURIComponent("登入")+'" target="_blank" rel="noopener" style="color:#FF8A2B;font-weight:800">用 LINE 登入</a>後可以幫卡片加暱稱，大家就能用暱稱搜到。</span>')
      +(msg?'<span class="msg">'+es(msg)+'</span>':'')+'</div>';
      var f=el.querySelector("form");if(f)f.onsubmit=function(e){e.preventDefault();var a=f.querySelector("input").value.trim();if(!a)return;
        fetch(A+"add",{method:"POST",headers:{"x-tok":tok(),"content-type":"application/json"},body:JSON.stringify({k:k,a:a})}).then(function(r){return r.json()}).then(function(j){if(j.ok){L.indexOf(j.a)<0&&L.push(j.a);draw(L,"已新增，搜尋「"+a+"」就找得到這張卡")}else draw(L,j.err||"新增失敗")}).catch(function(){draw(L,"連不上，稍後再試")})}};
    fetch(A+"list?k="+encodeURIComponent(k)).then(function(r){return r.json()}).then(function(j){draw((j&&j.items)||[])}).catch(function(){})};
})();
