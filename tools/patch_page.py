#!/usr/bin/env python3
"""publish 時修改 Artifact 模板：網站名稱改成 P’CLUB、分頁名稱改成「卡片目錄」、
美版（TCGplayer，網站上的 us.json）直接併進卡片目錄，並支援 LINE「看 K 線」連結打開日版高稀有度卡。
用法：python3 patch_page.py <模板.html> <輸出.html>"""
import sys

src, dst = sys.argv[1:3]
h = open(src, encoding="utf-8").read()
NAME = "P’CLUB"


def rep(old, new):
    global h
    assert old in h, "找不到：" + old[:70]
    h = h.replace(old, new, 1)


# 1. 網站名稱
h = h.replace("卡價套利王", NAME)

# 1b. 左上角 logo：閃電換成火焰；「’」在中文字型是全形，名稱改用英文字型、字距縮小
rep('<path d="M18 8l-6 9h4.5l-2 7 7-10h-4.5z" fill="currentColor"/></svg>' + NAME + '</div>',
    '<path d="M16.4 5.2c.9 3.9 5.6 5.9 5.6 11.4a6 6 0 0 1-12 0c0-2.6 1.3-4.3 2.8-5.4-.1 2.1.7 3.5 2.1 3.9-.5-3.7.2-6.9 1.5-9.9z" fill="currentColor"/></svg>'
    '<span style="font-family:\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;letter-spacing:.02em">' + NAME + '</span></div>')

# 2. 分頁名稱
rep('aria-controls="panel-tcg">卡片目錄（TCG Japan）</button>', 'aria-controls="panel-tcg">卡片目錄</button>')

# 3. 美版併進卡片目錄：多一個「只看美版」篩選
rep('<button class="chip" data-f="box" aria-pressed="false">只看原盒</button>',
    '<button class="chip" data-f="box" aria-pressed="false">只看原盒</button>\n    <button class="chip" data-f="us" aria-pressed="false">只看美版</button>')
rep('const cf={stock:true,', 'const cf={us:false,stock:true,')
# 美版列：點了直接開 TCGplayer
rep('function crow(o,P){', r'''function urow(o){
  const x=o.x,sp=x.img?`<img class="cimg" src="${esc(x.img)}" alt="${esc(x.n)} 商品圖" loading="lazy">`:`<span class="cimg none">無圖</span>`;
  return `<a class="crow" href="${esc(x.url||("https://www.tcgplayer.com/product/"+x.id))}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${sp}<div class="rar ${o.box?"r-box":"r-hi"}"><b>${esc(o.box?"未拆":(x.r||"美版"))}</b><small>美版</small></div>
  <div class="cmain"><div class="nm">${esc(x.zh?(x.zh+(x.num?" "+x.num:"")):x.n)}</div><div class="meta">${x.zh?`<span>${esc(x.n)}</span>`:""}<span>${esc(x.set)}</span>${x.num?`<span>${esc(x.num)}</span>`:""}<span style="color:var(--rev);font-weight:700">TCGplayer 商品頁 ›</span></div></div>
  <div class="cprice"><span class="gp g-na" style="font-weight:600">美國市場價 US$${x.m.toFixed(2)}</span><span class="lbl">約 NT$${fmt(o.price)}（未含運費關稅）</span></div></a>`}
function crow(o,P){if(o.us)return urow(o);''')
rep('let list=ROWS.filter(o=>{if(q&&', 'let list=ROWS.filter(o=>{if(cf.us&&!o.us&&!o.en)return false;if(q&&')
rep('$("csub").textContent=`TCG Japan 收錄 ${fmt(ROWS.length)} 項（${CAT.updated||""} 更新）',
    '$("csub").textContent=`日版 ${fmt(ROWS.filter(o=>!o.us).length)} 項（${CAT.updated||""} 更新）＋美版 ${fmt(ROWS.filter(o=>o.us).length)} 項')
# 日版高稀有度卡：日文卡名放在細項
rep('o.extra=1;', 'o.extra=1;o.jn=e.jn||"";if(e.en){o.en=1;o.hay+=" 美版 us en";}')
rep('<div class="meta">${o.num?`<span>${esc(o.num)}</span>`:""}', '<div class="meta">${o.en?`<span class="tag">美版</span>`:""}${o.jn?`<span>${esc(o.jn)}</span>`:""}${o.num?`<span>${esc(o.num)}</span>`:""}')
# TCG Japan 名稱偶爾重複（「奇樹的奇樹的…」），顯示時去掉
rep('const o={ix,n,price,sold:!!sold,spr,psa,box,base:m?m[1]:n,', 'const o={ix,n,price,sold:!!sold,spr,psa,box,base:(m?m[1]:n).replace(/(.{1,6}的)\\1+/g,"$1"),')
# 頁首「加入 LINE 好友」按鈕（公開的加好友連結，任何人都能加）
LINE_URL = "https://line.me/R/ti/p/@916ctmro"
rep('<small id="stamp"></small>', '<span style="display:flex;align-items:center;gap:10px"><a href="%s" target="_blank" rel="noopener" style="background:#06c755;color:#fff;font-weight:700;font-size:13px;border-radius:999px;padding:5px 14px;text-decoration:none;white-space:nowrap">加入 LINE 好友</a><small id="stamp"></small></span>' % LINE_URL)
h = h.replace("LINE 官方帳號 @916ctmro", '<a href="%s" target="_blank" rel="noopener">LINE 官方帳號 @916ctmro</a>' % LINE_URL)
# 以圖搜尋只對日版
rep('const scored=ROWS.map(o=>{', 'const scored=ROWS.filter(o=>!o.us).map(o=>{')
# 載入 us.json 加進目錄
rep('/* ---------- 商品詳情 + K 線 ---------- */', r'''/* 美版（TCGplayer）：us.json 由 publish 每天產生 */
if(/github\.io$/.test(location.hostname))fetch("us.json").then(r=>r.ok?r.json():null).then(j=>{if(!j)return;const fx=j.usd||32;for(const x of j.items){const box=x.t==="s";ROWS.push({ix:ROWS.length,n:"us:"+x.id,us:1,x,price:Math.round(x.m*fx),sold:false,psa:false,box,base:x.n,rar:x.r||"",num:x.num||"",set:x.set,mq:null,hay:(x.n+" "+(x.zh||"")+" "+x.set+" "+(x.num||"")+" "+(x.r||"")+" "+(x.kw||"")+" 美版 us"+(box?" box 原盒 未拆":"")).toLowerCase()})}try{render(false)}catch(e){}}).catch(()=>{});
/* ---------- 商品詳情 + K 線 ---------- */''')

# 4. LINE 的「看 K 線」連結：日版高稀有度卡（j:sid、j:sidp）與額外原盒（x:sid）在 extra.json 載入後才打開
rep('if(/github\\.io$/.test(location.hostname))fetch("extra.json").then(r=>r.ok?r.json():[]).then(a=>{addExtra(a);try{render()}catch(err){}}).catch(()=>{});',
    'const EXP=/github\\.io$/.test(location.hostname)?fetch("extra.json").then(r=>r.ok?r.json():[]).then(a=>{addExtra(a);try{render()}catch(err){}}).catch(()=>{}):Promise.resolve();')
rep('else if(t==="r:"){const o=ROWS.find(x=>x.n===n);if(o)openDetail({o})}',
    'else if(t==="r:"){const o=ROWS.find(x=>x.n===n);if(o)openDetail({o})}else if(t==="j:"||t==="x:"){const sid=parseInt(n),psa=/p$/.test(n);EXP.then(()=>{const o=ROWS.find(x=>SNK.cards[x.n]&&SNK.cards[x.n].id===sid&&(t==="x:"||x.psa===psa));if(o)openDetail({o})})}')

open(dst, "w", encoding="utf-8").write(h)
print("page patched")
