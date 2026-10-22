#!/usr/bin/env python3
"""在 Artifact 模板加上「美版（TCGplayer）」分頁：讀網站上的 us.json（export.py 產生）。
用法：python3 add_us_tab.py <模板.html> <輸出.html>；已經加過就原樣輸出。"""
import sys

src, dst = sys.argv[1:3]
h = open(src, encoding="utf-8").read()
if 'id="tab-us"' in h:
    open(dst, "w", encoding="utf-8").write(h)
    sys.exit(0)


def rep(old, new, count=1):
    global h
    assert h.count(old) >= 1, "找不到：" + old[:60]
    h = h.replace(old, new, count)


# 1. 分頁按鈕
rep('<button id="tab-tcg" role="tab" aria-selected="false" aria-controls="panel-tcg">卡片目錄（TCG Japan）</button>',
    '<button id="tab-tcg" role="tab" aria-selected="false" aria-controls="panel-tcg">卡片目錄（TCG Japan）</button>\n'
    '    <button id="tab-us" role="tab" aria-selected="false" aria-controls="panel-us">美版（TCGplayer）</button>')

# 2. 分頁內容（放在快速試算前）
PANEL = '''<section class="wrap" id="panel-us" role="tabpanel" aria-labelledby="tab-us" hidden>
  <h2 class="sec" id="utitle">美版行情（TCGplayer）</h2>
  <p class="sub" id="usub">載入中…</p>
  <div class="ctools">
    <button class="chip" data-u="c" aria-pressed="false">只看單卡</button>
    <button class="chip" data-u="s" aria-pressed="false">只看未拆</button>
    <label for="usort" class="sub" style="margin:0">排序
      <select id="usort">
        <option value="hi">市場價高到低</option>
        <option value="lo">市場價低到高</option>
      </select>
    </label>
  </div>
  <div class="clist" id="ulist"></div>
  <button class="more" id="umore" type="button" hidden>顯示更多</button>
  <p class="photo-note" style="margin-top:4px">美版價格為 TCGplayer 市場價（Market Price，近期成交加權），換成台幣用當天美元匯率，未含美國運費與關稅。只收單卡 US$5、未拆商品 US$20 以上。</p>
</section>

<section class="wrap">
  <div class="quick">'''
rep('<section class="wrap">\n  <div class="quick">', PANEL)

# 3. 程式：資料載入、清單、分頁切換
JS = r'''
/* ---------- 美版（TCGplayer） ---------- */
let US=null,USP=null,ushown=60;const uf={c:false,s:false};
function loadUS(){if(US)return Promise.resolve(US);if(!USP)USP=fetch("us.json").then(r=>{if(!r.ok)throw new Error(r.status);return r.json()}).then(j=>{j.items.forEach(x=>x.hay=(x.n+" "+x.set+" "+(x.num||"")+" "+(x.r||"")+" "+(x.kw||"")).toLowerCase());return(US=j)}).catch(e=>{USP=null;throw e});return USP}
function urow(x,fx){
  const sp=x.img?`<img class="cimg" src="${esc(x.img)}" alt="${esc(x.n)} 商品圖" loading="lazy">`:`<span class="cimg none">無圖</span>`;
  const href=x.url||("https://www.tcgplayer.com/product/"+x.id);
  return `<a class="crow" href="${esc(href)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${sp}<div class="rar ${x.t==="s"?"r-box":"r-hi"}"><b>${esc(x.t==="s"?"未拆":(x.r||"卡"))}</b><small>美版</small></div>
  <div class="cmain"><div class="nm">${esc(x.n)}</div><div class="meta"><span>${esc(x.set)}</span>${x.num?`<span>${esc(x.num)}</span>`:""}<span style="color:var(--rev);font-weight:700">TCGplayer ›</span></div></div>
  <div class="cprice"><span class="gp g-na" style="font-weight:600">US$${x.m.toFixed(2)}</span><span class="lbl">約 NT$${fmt(x.m*fx)}</span></div></a>`}
function renderUS(P,q,reset){
  if(reset)ushown=60;
  if(!US){$("usub").textContent="載入美版資料中…";$("ulist").innerHTML="";$("umore").hidden=true;loadUS().then(()=>{if(tab==="us")render(false)}).catch(()=>{$("usub").textContent="美版資料只在獨立網站提供：spickertop-afk.github.io/ptcg-price"});return}
  const fx=US.usd||32;let list=US.items.filter(x=>(!q||q.split(/\s+/).every(t=>x.hay.includes(t)))&&(!uf.c||x.t==="c")&&(!uf.s||x.t==="s"));
  const s=$("usort").value;list.sort((a,b)=>s==="lo"?a.m-b.m:b.m-a.m);
  $("utitle").textContent=q?`「${$("q").value.trim()}」的美版行情`:"美版行情（TCGplayer）";
  $("usub").textContent=`共 ${fmt(US.items.length)} 項｜美元匯率 ${fx}｜符合條件 ${fmt(list.length)} 項`;
  $("ulist").innerHTML=list.length?list.slice(0,ushown).map(x=>urow(x,fx)).join(""):`<div class="empty">美版沒有符合的商品。美版用英文名稱，例如 Charizard、Pikachu，也可以搜系列或卡號。</div>`;
  $("umore").hidden=list.length<=ushown}
document.querySelectorAll("[data-u]").forEach(b=>b.onclick=()=>{const k=b.dataset.u,o=k==="c"?"s":"c";uf[k]=!uf[k];if(uf[k])uf[o]=false;document.querySelectorAll("[data-u]").forEach(x=>x.setAttribute("aria-pressed",uf[x.dataset.u]));render()});
$("usort").onchange=()=>render();$("umore").onclick=()=>{ushown+=60;render(false)};
'''
rep('/* ---------- 商品詳情 + K 線 ---------- */', JS + '/* ---------- 商品詳情 + K 線 ---------- */')

rep('if(tab==="fb") renderFB(P,q); else renderTCG(P,q,reset);',
    'if(tab==="fb") renderFB(P,q); else if(tab==="us") renderUS(P,q,reset); else renderTCG(P,q,reset);')
rep('function setTab(t){tab=t;$("tab-fb").setAttribute("aria-selected",t==="fb");$("tab-tcg").setAttribute("aria-selected",t==="tcg");$("panel-fb").hidden=t!=="fb";$("panel-tcg").hidden=t!=="tcg";',
    'function setTab(t){if(!["fb","tcg","us"].includes(t))t="fb";tab=t;for(const x of ["fb","tcg","us"]){$("tab-"+x).setAttribute("aria-selected",t===x);$("panel-"+x).hidden=t!==x}')
rep('$("tab-tcg").onclick=()=>setTab("tcg");', '$("tab-tcg").onclick=()=>setTab("tcg");$("tab-us").onclick=()=>setTab("us");')


# 4. LINE 的「看 K 線」連結：日版高稀有度卡（j:sid、j:sidp）與額外原盒（x:sid）在 extra.json 載入後才打開
rep('if(/github\\.io$/.test(location.hostname))fetch("extra.json").then(r=>r.ok?r.json():[]).then(a=>{addExtra(a);try{render()}catch(err){}}).catch(()=>{});',
    'const EXP=/github\\.io$/.test(location.hostname)?fetch("extra.json").then(r=>r.ok?r.json():[]).then(a=>{addExtra(a);try{render()}catch(err){}}).catch(()=>{}):Promise.resolve();')
rep('else if(t==="r:"){const o=ROWS.find(x=>x.n===n);if(o)openDetail({o})}',
    'else if(t==="r:"){const o=ROWS.find(x=>x.n===n);if(o)openDetail({o})}else if(t==="j:"||t==="x:"){const sid=parseInt(n),psa=/p$/.test(n);EXP.then(()=>{const o=ROWS.find(x=>SNK.cards[x.n]&&SNK.cards[x.n].id===sid&&(t==="x:"||x.psa===psa));if(o)openDetail({o})})}')

open(dst, "w", encoding="utf-8").write(h)
print("US tab added")
