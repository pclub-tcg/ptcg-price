/* P’CLUB App：註冊離線快取、「加到主畫面」提示、從其他頁的底部選單跳回首頁功能（#cam #inv #tcg） */
(()=>{
const app=matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
document.documentElement.classList.toggle("is-app",app);
if("serviceWorker" in navigator)addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));

/* 首頁：#cam 拍照查價、#inv 我的庫存、#tcg 卡片目錄 */
const h=location.hash.slice(1);
if(["cam","inv","tcg"].includes(h)&&document.querySelector('.th-tabbar [data-th="'+h+'"], .th-nav [data-th="'+h+'"]')){
  let n=0;const t=setInterval(()=>{const ok=h==="cam"?document.getElementById("imgbtn"):h==="inv"?document.getElementById("inv-fab"):document.getElementById("tab-tcg");
    if(ok||++n>40){clearInterval(t);history.replaceState(null,"",location.pathname+location.search);
      const b=document.querySelector('[data-th="'+h+'"]');if(b)b.click()}},250)}

/* 加到主畫面提示（手機、還沒安裝、14 天內沒按過關閉才出現） */
if(app||innerWidth>900)return;
const K="pclub-install-x";let x=0;try{x=+localStorage.getItem(K)||0}catch(e){}
if(Date.now()-x<14*864e5)return;
const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)&&!/crios|fxios|line\//i.test(navigator.userAgent);
let ev=null;
function show(txt,btn){if(document.getElementById("pwa-tip"))return;
  const d=document.createElement("div");d.id="pwa-tip";d.setAttribute("role","dialog");d.setAttribute("aria-label","安裝 P’CLUB App");
  d.innerHTML='<img src="app/icon-192.png" alt=""><div><b>把 P’CLUB 加到主畫面</b><span>'+txt+'</span></div>'+(btn?'<button type="button" class="go">安裝</button>':'')+'<button type="button" class="x" aria-label="關閉">✕</button>';
  document.body.appendChild(d);
  d.querySelector(".x").onclick=()=>{d.remove();try{localStorage.setItem(K,Date.now())}catch(e){}};
  const g=d.querySelector(".go");if(g)g.onclick=async()=>{d.remove();if(ev){ev.prompt();try{await ev.userChoice}catch(e){}ev=null}}}
addEventListener("beforeinstallprompt",e=>{e.preventDefault();ev=e;setTimeout(()=>show("像 App 一樣全螢幕開啟，查價更快",true),4000)});
if(ios)setTimeout(()=>show("點下方的 <i>分享</i> 按鈕，再選「加入主畫面」",false),5000);
const s=document.createElement("style");
s.textContent='#pwa-tip{position:fixed;left:12px;right:12px;bottom:calc(78px + env(safe-area-inset-bottom,0px));z-index:35;display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:16px;background:var(--surface,#1D1612);color:var(--ink,#F6EDE3);border:1px solid var(--line,#2F241D);box-shadow:0 18px 40px -12px rgba(0,0,0,.55);font-size:13px;animation:pwa-in .3s ease-out}'+
'#pwa-tip img{width:42px;height:42px;border-radius:10px;flex:none}#pwa-tip div{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}#pwa-tip span{color:var(--muted,#A8988A);font-size:12px}#pwa-tip i{font-style:normal;font-weight:700;color:var(--brand,#FF8A2B)}'+
'#pwa-tip .go{border:0;border-radius:10px;background:var(--brand,#FF8A2B);color:var(--brand-ink,#1D130E);font-weight:800;padding:8px 14px;cursor:pointer}#pwa-tip .x{border:0;background:none;color:var(--muted,#A8988A);font-size:15px;padding:4px 6px;cursor:pointer}'+
'@keyframes pwa-in{from{transform:translateY(20px);opacity:0}}@media (prefers-reduced-motion:reduce){#pwa-tip{animation:none}}';
document.head.appendChild(s);
})();
