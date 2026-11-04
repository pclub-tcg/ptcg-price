"""網站載入畫面（2026-11-04）：patch_page.py 最後呼叫 apply(h)。
- 一打開就顯示深色開場：火焰 logo、P’CLUB、洗牌中的卡片、進度條與載入步驟
- 追蹤 trend.json／extra.json／klast.json 載入進度，資料到齊（或最多 8 秒）就淡出；同一次瀏覽再開頁面只閃一下
- 商品圖片載入前顯示流光骨架，不再是一片空白"""

CSS = r"""<style id="pc-boot-css">
#pc-boot{position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;
  background:radial-gradient(60% 45% at 50% 38%,rgba(255,122,26,.22),transparent 70%),radial-gradient(50% 40% at 85% 100%,rgba(255,70,30,.14),transparent 70%),#0F0C0B;
  color:#F5F4F0;font-family:Inter,"Noto Sans TC",system-ui,-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif;
  transition:opacity .45s ease,transform .45s ease,visibility 0s .45s}
#pc-boot.out{opacity:0;transform:scale(1.04);visibility:hidden;pointer-events:none}
#pc-boot .deck{position:relative;left:-35px;width:120px;height:168px;margin-bottom:6px}
#pc-boot .deck i{position:absolute;inset:0;border-radius:11px;background:linear-gradient(150deg,#2a2330,#1a161d);border:2px solid #3a3240;box-shadow:0 14px 30px rgba(0,0,0,.45);
  animation:pcdeal 2.4s cubic-bezier(.6,0,.3,1) infinite}
#pc-boot .deck i::after{content:"";position:absolute;inset:9px;border-radius:7px;border:2px solid rgba(255,122,26,.35);
  background:linear-gradient(100deg,transparent 30%,rgba(255,176,64,.22) 50%,transparent 70%) 0 0/250% 100%;animation:pcsh 1.4s linear infinite}
#pc-boot .deck i:nth-child(1){animation-delay:0s}#pc-boot .deck i:nth-child(2){animation-delay:.8s}#pc-boot .deck i:nth-child(3){animation-delay:1.6s}
#pc-boot .deck b{position:absolute;left:50%;top:50%;width:62px;height:62px;margin:-31px 0 0 -31px;z-index:5;filter:drop-shadow(0 0 18px rgba(255,122,26,.8));animation:pcflick 1.1s ease-in-out infinite alternate}
#pc-boot .wm{font-size:44px;font-weight:800;letter-spacing:.02em;line-height:1}
#pc-boot .wm span{color:#FF7A1A}
#pc-boot .tag{font-size:15px;color:#A8A29A;letter-spacing:.08em;margin-top:-10px}
#pc-boot .bar{width:min(260px,70vw);height:6px;border-radius:6px;background:#2a2428;overflow:hidden;margin-top:8px}
#pc-boot .bar u{display:block;height:100%;width:0;border-radius:6px;background:linear-gradient(90deg,#FF5A1F,#FFB040);box-shadow:0 0 12px rgba(255,140,40,.8);transition:width .35s ease}
#pc-boot .st{font-size:13px;color:#8F8981;min-height:18px;font-variant-numeric:tabular-nums}
@keyframes pcdeal{0%{transform:translate(0,0) rotate(0);opacity:1;z-index:3}
  30%{transform:translate(70px,-8px) rotate(14deg);z-index:3}
  45%{transform:translate(70px,-8px) rotate(14deg);z-index:0}
  70%{transform:translate(0,0) rotate(0);z-index:0}100%{transform:translate(0,0) rotate(0);z-index:1}}
@keyframes pcsh{from{background-position:120% 0}to{background-position:-120% 0}}
@keyframes pcflick{from{transform:scale(.94) rotate(-3deg)}to{transform:scale(1.06) rotate(3deg)}}
html.pc-booting{overflow:hidden}
/* 商品圖片載入前：流光骨架 */
.crow>img.cimg:not(.ld),.tcard .ti img:not(.ld),.thumb img:not(.ld),.th-board img:not(.ld){opacity:1!important;color:transparent;
  background:linear-gradient(100deg,#1c1920 35%,#2e2833 50%,#1c1920 65%) 0 0/250% 100%!important;animation:pcsh 1.2s linear infinite!important}
@media (prefers-reduced-motion:reduce){#pc-boot .deck i,#pc-boot .deck i::after,#pc-boot .deck b{animation:none}
  .crow>img.cimg:not(.ld),.tcard .ti img:not(.ld),.thumb img:not(.ld){animation:none!important}}
</style>"""

FLAME = ('<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="pcfl" x1="0" y1="1" x2="0" y2="0">'
         '<stop offset="0" stop-color="#FF4D1A"/><stop offset="1" stop-color="#FFB040"/></linearGradient></defs>'
         '<path fill="url(#pcfl)" d="M16.4 3.2c1.2 5.2 7.6 7.9 7.6 15.3a8 8 0 0 1-16 0c0-3.5 1.7-5.8 3.7-7.2-.1 2.8.9 4.7 2.8 5.2-.7-4.9.3-9.2 1.9-13.3z"/>'
         '<path fill="#FFE2A8" d="M16 18.5c1.6 1.4 3 2.6 3 4.6a3 3 0 0 1-6 0c0-1.5.9-2.7 3-4.6z"/></svg>')

HTML = ('<div id="pc-boot" role="status" aria-live="polite" aria-label="P’CLUB 載入中">'
        '<div class="deck"><i></i><i></i><i></i><b>' + FLAME + '</b></div>'
        '<div class="wm">P’<span>CLUB</span></div><div class="tag">寶可夢・海賊王 卡價行情</div>'
        '<div class="bar"><u></u></div><div class="st">連線到行情資料…</div></div>')

JS = r"""<script id="pc-boot-js">(function(){
var B=document.getElementById("pc-boot");if(!B)return;var de=document.documentElement;de.classList.add("pc-booting");
var U=B.querySelector(".bar u"),S=B.querySelector(".st"),again=false;
try{again=sessionStorage.getItem("pcboot")==="1";sessionStorage.setItem("pcboot","1")}catch(e){}
var gh=/github\.io$/.test(location.hostname),need=gh?{"trend.json":0,"extra.json":0}:{},msg={"trend.json":"載入漲跌排行…","extra.json":"整理卡片目錄…","klast.json":"更新最新成交價…","us.json":"加入美版行情…"};
var p=8,dom=false,done=false;
function set(v,t){p=Math.max(p,v);U.style.width=p+"%";if(t)S.textContent=t}
function ready(){for(var k in need)if(!need[k])return false;return dom}
function hide(){if(done)return;done=true;set(100,"完成");setTimeout(function(){B.classList.add("out");de.classList.remove("pc-booting");setTimeout(function(){B.remove()},600)},again?60:260)}
function check(){if(ready())hide()}
var of=window.fetch;if(of)window.fetch=function(u){var s=String(u&&u.url||u).split("?")[0],k=null;for(var n in msg)if(s===n||s.slice(-n.length-1)==="/"+n)k=n;
  var r=of.apply(this,arguments);if(k&&!done){S.textContent=msg[k];r.then(function(res){if(k in need){need[k]=1;var c=0,t=0;for(var x in need){t++;c+=need[x]}set(35+55*c/t)}check();return res},function(){if(k in need)need[k]=1;check()})}return r};
var cr=setInterval(function(){if(done)return clearInterval(cr);if(p<85)set(p+(again?6:2.2))},120);
document.addEventListener("DOMContentLoaded",function(){dom=true;set(again?80:35,gh?null:"完成");check()});
setTimeout(hide,again?2500:8000);
window.addEventListener("pageshow",function(e){if(e.persisted)hide()});
})();</script>"""


def apply(h):
    if 'id="pc-boot"' in h:
        return h
    i = h.find("<body")
    j = h.find(">", i) + 1
    assert i >= 0, "找不到 <body>"
    return h[:j] + CSS + HTML + JS + h[j:]
