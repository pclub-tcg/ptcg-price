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

# 1c. 比價結果裡的原盒名稱統一用台灣官方擴充包名稱（tools/setnames_tw.json），舊名稱留在搜尋關鍵字
import json as _json, os as _os, re as _re
_tw = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "setnames_tw.json")
if _os.path.exists(_tw):
    TW = _json.load(open(_tw, encoding="utf-8"))
    _m = _re.search(r'(<script id="price-data" type="application/json">)(.*?)(</script>)', h, _re.S)
    if _m:
        pdata = _json.loads(_m.group(2))
        for it in pdata.get("items", []):
            if it.get("cat") != "box":
                continue
            base = _re.split(r"\s*BOX|\s*ボックス|（", it.get("jp", ""))[0].strip()
            if base in TW:
                code = _re.match(r"^([A-Za-z]{1,3}\d+[a-zA-Z]?\s+)", it["n"])
                new = (code.group(1) if code else "") + TW[base] + " BOX"
                if new != it["n"]:
                    it["kw"] = (it.get("kw", "") + " " + it["n"]).strip()
                    it["n"] = new
        h = h[:_m.start(2)] + _json.dumps(pdata, ensure_ascii=False, separators=(",", ":")) + h[_m.end(2):]

# 1d. TCG Japan 目錄的原盒名稱有些是英文／日文，照台灣官方名稱（呼卡）改；所有用到這個名稱當 key 的區塊一起改
_rn = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "catalog_rename.json")
if _os.path.exists(_rn):
    REN = _json.load(open(_rn, encoding="utf-8"))
    def _blk(i):
        m = _re.search(r'(<script id="%s" type="application/json">)(.*?)(</script>)' % i, h, _re.S)
        return m, (_json.loads(m.group(2)) if m else None)
    def _put(m, d):
        global h
        h = h[:m.start(2)] + _json.dumps(d, ensure_ascii=False, separators=(",", ":")) + h[m.end(2):]
    m, d = _blk("catalog-data")
    if d:
        for r in d["rows"]:
            r[0] = REN.get(r[0], r[0])
        _put(m, d)
    for bid in ("snkr-data", "mercari-data"):
        m, d = _blk(bid)
        if d:
            d["cards"] = {REN.get(k, k): v for k, v in d["cards"].items()}
            _put(m, d)
    m, d = _blk("price-data")
    if d:
        for it in d["items"]:
            if it.get("cn") in REN:
                it["cn"] = REN[it["cn"]]
        _put(m, d)

# 1e. 頁面內建的額外原盒清單（extra-data）也翻成中文名（台灣官方名稱優先），舊名稱留在搜尋關鍵字
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import zhname as _zh
_bx = {x["sid"]: x for x in _json.load(open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "boxes.json"), encoding="utf-8"))}
_m = _re.search(r'(<script id="extra-data" type="application/json">)(.*?)(</script>)', h, _re.S)
if _m:
    ex = _json.loads(_m.group(2))
    for e in ex:
        bx = _bx.get(e.get("sid"))
        if not bx:
            continue
        zh = _zh.SET_TW.get(bx["jp"]) or bx.get("zh") or _zh.set_ja(bx["jp"])
        if zh and e["n"] != zh + " BOX":
            e["kw"] = (str(e.get("kw") or "") + " " + e["n"] + " " + bx["jp"]).strip()
            e["n"] = zh + " BOX"
    h = h[:_m.start(2)] + _json.dumps(ex, ensure_ascii=False, separators=(",", ":")) + h[_m.end(2):]

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
# 卡片目錄清單改用小縮圖 ht/（大圖 hi/ 只在點開商品時用）
# 卡片目錄清單直接用清楚的大圖 hi/（360x504，loading=lazy）
# 以圖搜尋只對日版
rep('const scored=ROWS.map(o=>{', 'const scored=ROWS.filter(o=>!o.us).map(o=>{')
# 載入 us.json 加進目錄
rep('/* ---------- 商品詳情 + K 線 ---------- */', r'''/* 美版（TCGplayer）：us.json 由 publish 每天產生 */
if(/github\.io$/.test(location.hostname))fetch("us.json").then(r=>r.ok?r.json():null).then(j=>{if(!j)return;const fx=j.usd||32;USDTW=fx;for(const x of j.items){const box=x.t==="s";ROWS.push({ix:ROWS.length,n:"us:"+x.id,us:1,x,price:Math.round(x.m*fx),sold:false,psa:false,box,base:x.n,rar:x.r||"",num:x.num||"",set:x.set,mq:null,hay:(x.n+" "+(x.zh||"")+" "+x.set+" "+(x.num||"")+" "+(x.r||"")+" "+(x.kw||"")+" 美版 us"+(box?" box 原盒 未拆":"")).toLowerCase()})}try{render(false)}catch(e){}}).catch(()=>{});
/* ---------- 商品詳情 + K 線 ---------- */''')

# 4. LINE 的「看 K 線」連結：日版高稀有度卡（j:sid、j:sidp）與額外原盒（x:sid）在 extra.json 載入後才打開
rep('if(/github\\.io$/.test(location.hostname))fetch("extra.json").then(r=>r.ok?r.json():[]).then(a=>{addExtra(a);try{render()}catch(err){}}).catch(()=>{});',
    'const EXP=/github\\.io$/.test(location.hostname)?fetch("extra.json").then(r=>r.ok?r.json():[]).then(a=>{addExtra(a);try{render()}catch(err){}}).catch(()=>{}):Promise.resolve();')
rep('else if(t==="r:"){const o=ROWS.find(x=>x.n===n);if(o)openDetail({o})}',
    'else if(t==="r:"){const o=ROWS.find(x=>x.n===n);if(o)openDetail({o})}else if(t==="j:"||t==="x:"){const sid=parseInt(n),psa=/p$/.test(n);EXP.then(()=>{const o=ROWS.find(x=>SNK.cards[x.n]&&SNK.cards[x.n].id===sid&&(t==="x:"||x.psa===psa));if(o)openDetail({o})})}')

# 5. 關鍵字模糊搜尋：每個詞完整出現＝符合；沒有的話用「每兩個字一組」比對，符合一半以上就列出，依符合程度排序
#    卡號、含數字的詞（psa10、sv8）和 4 個字以內的英文（sar、box）維持精準比對
rep('function renderFB(P,q){', r"""function fz(hay,q){if(!q)return 1;let w=0,g=0;for(const t of q.split(/\s+/)){if(!t)continue;w++;if(hay.includes(t)){g++;continue}if(/\d/.test(t)||/^[a-z.\-&']{1,4}$/.test(t))return 0;const a=[...t],bs=a.length<2?a:a.slice(1).map((c,i)=>a[i]+c);let k=0;for(const b of bs)if(hay.includes(b))k++;const r=(k/bs.length+a.filter(c=>hay.includes(c)).length/a.length)/2;if(r<FZ)return 0;g+=r}return w?g/w:1}
const FZ=.5;
function renderFB(P,q){""")
rep('const okQ=!q||q.split(/\\s+/).every(t=>hay.includes(t));', 'it._fz=fz(hay,q);const okQ=it._fz>=FZ;')
rep('list.sort((a,b)=>{const s=x=>x.na?-1e9:(x.v==="good"?1e6:0)+x.pct;return s(calc(b,P))-s(calc(a,P))});',
    'list.sort((a,b)=>{const s=x=>x.na?-1e9:(x.v==="good"?1e6:0)+x.pct;return (q?b._fz-a._fz:0)||s(calc(b,P))-s(calc(a,P))});')
rep('if(q&&!q.split(/\\s+/).every(t=>o.hay.includes(t)))return false;', 'o._fz=fz(o.hay,q);if(o._fz<FZ)return false;')
rep('list.sort((a,b)=>{if(s==="hi")', 'list.sort((a,b)=>{if(q&&b._fz!==a._fz)return b._fz-a._fz;if(s==="hi")')

# 6. 新版型（參考 tradecard.jp，配色維持噴火龍橘）：首頁「近 30 天漲跌 TOP」大圖卡片＋卡片目錄改成大圖商品卡格狀排列
rep('</style>\n\n<header class="bar">', r"""
/* 漲跌 TOP */
.trend{padding-block:18px 4px}
.trend-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:8px 0 10px}
.trend-head h2{margin:0;font-family:var(--f-display);font-weight:900;font-size:21px}
.trend-head span{font-size:12px;color:var(--muted)}
.tlabel{display:flex;align-items:center;gap:10px;margin:14px 0 10px;font-weight:700}
.tlabel b{color:#fff;border-radius:8px;padding:3px 12px;font-size:13.5px;letter-spacing:.04em}
.tlabel b.u{background:var(--up)} .tlabel b.d{background:#2f5fb8}
.tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px}
.tcard,.crow{background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);overflow:hidden;cursor:pointer;position:relative;display:flex;flex-direction:column;transition:transform .15s,box-shadow .15s;color:inherit;text-decoration:none}
.tcard:hover,.crow:hover{transform:translateY(-3px);box-shadow:0 2px 4px rgba(42,28,23,.08),0 14px 30px rgba(42,28,23,.14)}
.tcard .ti{aspect-ratio:5/7;background:#fff;display:grid;place-items:center;overflow:hidden;border-bottom:1px solid var(--line)}
.tcard .ti img{width:100%;height:100%;object-fit:contain}
.tcard .rk{position:absolute;top:10px;left:10px;width:30px;height:30px;border-radius:10px;background:#fff;color:var(--brand-deep);font-weight:900;display:grid;place-items:center;box-shadow:0 1px 4px rgba(0,0,0,.18);font-family:var(--f-num)}
.tcard .tb{padding:10px 12px 12px;display:flex;flex-direction:column;gap:2px;min-width:0}
.tcard .tn{font-weight:900;font-size:15px;line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.tcard .ts{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tcard .tp{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-top:4px}
.tcard .tp b{font-family:var(--f-num);font-size:20px;font-weight:600}
.tcard .tp .up-t,.tcard .tp .down-t{font-family:var(--f-num);font-weight:700;font-size:14px}
.tcard .tp .down-t{color:#2f5fb8}
.tcard .tnt{font-size:12px;color:var(--muted)}
/* 卡片目錄：大圖商品卡 */
.clist{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px}
.crow{display:flex;padding:0;gap:0;grid-template-columns:none}
.crow>img.cimg{width:100%;height:auto;aspect-ratio:5/7;border-radius:0;object-fit:contain;background:#fff;border-bottom:1px solid var(--line)}
.crow>span.cimg{align-self:center;margin:62px 0 58px;transform:scale(2.3)}
.crow>span.cimg.none{transform:none;width:100%;height:auto;aspect-ratio:5/7;margin:0;border-radius:0;font-size:13px;background:var(--surface-2);color:var(--muted)}
.crow .rar{position:absolute;top:10px;left:10px;width:auto;height:auto;flex-direction:row;gap:5px;padding:3px 10px;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.2);z-index:1}
.crow .rar b{font-size:12px}.crow .rar small{margin:0;font-size:10px}
.crow .cmain{padding:10px 12px 0}
.crow .cmain .nm{font-weight:900}
.crow .cprice{padding:6px 12px 12px;text-align:left;max-width:none;align-items:flex-start;flex-direction:column;gap:3px;margin-top:auto}
.crow .cprice .gp{align-self:flex-start;font-size:12px}
.crow .cprice .lbl{font-size:11px;line-height:1.45}
.crow .meta{font-size:11.5px}
.pbig{font-family:var(--f-num);font-size:20px;font-weight:600;line-height:1.2}
.pbig small{display:block;font-family:var(--f-body);font-size:12px;color:var(--muted);font-weight:400}
.thumb{background:#fff;aspect-ratio:5/6}
@media (max-width:560px){.tgrid,.clist{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.crow{grid-template-columns:none}.crow .cprice{grid-column:auto;flex-direction:column}.tcard .tp b,.pbig{font-size:17px}.crow .meta a{display:none}}
</style>

<header class="bar">""")
rep('<section class="wrap">\n  <div class="tabs"', r"""<section class="wrap trend" id="trend" hidden>
  <div class="trend-head"><h2>近 30 天價格趨勢</h2><span>SNKRDUNK 每日成交均價・點卡片看 K 線</span></div>
  <div class="tlabel"><b class="u">漲 UP</b>漲最多 TOP</div><div class="tgrid" id="tup"></div>
  <div class="tlabel"><b class="d">跌 DOWN</b>跌最多 TOP</div><div class="tgrid" id="tdown"></div>
</section>

<section class="wrap">
  <div class="tabs" """[:-1])
# 目錄卡片加上大字價格
rep('<div class="cprice">${gp}', '<div class="cprice">${c&&c.m?`<span class="pbig">¥${fmt(c.m)}<small>≈ NT$${fmt(c.nt)}</small></span>`:""}${gp}')
# 「看 K 線」連結處理改成函式，首頁趨勢卡片也能用
rep('(()=>{try{const q=new URLSearchParams(location.search).get("p");if(!q)return;', 'function openKey(q){try{if(!q)return;')
rep('if(o)openDetail({o})})}}catch(e){}})();', r"""if(o)openDetail({o})})}}catch(e){}}
openKey(new URLSearchParams(location.search).get("p"));
/* 首頁漲跌 TOP（trend.json 由 publish 每天產生） */
if(/github\.io$/.test(location.hostname))fetch("trend.json").then(r=>r.ok?r.json():null).then(window.TREND=j=>{window.TJ=j;if(!j||!(j.up||[]).length)return;
  const tc=(x,i)=>`<div class="tcard" data-k="${esc(x.k)}" tabindex="0" role="button" aria-label="${esc(x.n)} 詳情與 K 線"><span class="rk">${i+1}</span><div class="ti"><img src="${esc(x.img)}" alt="${esc(x.n)}" loading="lazy"></div><div class="tb"><div class="tn">${esc(x.n)}</div><div class="ts">${esc([x.set,x.num,x.b?"原盒":x.rar].filter(Boolean).join("・"))}</div><div class="tp"><b>¥${fmt(x.y)}</b><span class="${x.c>0?"up-t":"down-t"}">${x.c>0?"+":""}${x.c}%</span></div><div class="tnt">≈ NT$${fmt(Math.round(x.y*(j.rate||0.2)))}</div></div></div>`;
  const n=matchMedia("(max-width:560px)").matches?4:5;
  $("tup").innerHTML=j.up.slice(0,n).map(tc).join("");$("tdown").innerHTML=(j.down||[]).slice(0,n).map(tc).join("");$("trend").hidden=false;
  const go=e=>{const c=e.target.closest(".tcard[data-k]");if(!c)return;if(e.type==="keydown"&&e.key!=="Enter")return;openKey(c.dataset.k)};
  $("trend").onclick=go;$("trend").onkeydown=go;
}).catch(()=>{});""")

rep('b.onclick=()=>{$("q").value=h;render()};', 'b.onclick=()=>{$("q").value=h;goSearch()};')
# 7. 搜尋時：隱藏首頁趨勢區，直接跳到完整商品清單（卡片目錄），不限「只看有貨」，標題顯示找到幾件
rep('$("ctitle").textContent=q?`「${$("q").value.trim()}」在卡片目錄`:"卡片目錄";', '$("ctitle").textContent=q?`「${$("q").value.trim()}」找到 ${fmt(list.length)} 件商品`:"卡片目錄";')
rep('if(tab==="fb") renderFB(P,q); else renderTCG(P,q,reset);', 'const tr=$("trend");if(tr)tr.hidden=!!q||!window.TRD;\n  if(tab==="fb") renderFB(P,q); else renderTCG(P,q,reset);')
rep('$("f").addEventListener("submit",e=>{e.preventDefault();render()});', r"""function goSearch(){if(!$("q").value.trim())return render();if(cf.stock){cf.stock=false;const b=document.querySelector('.chip[data-f="stock"]');if(b)b.setAttribute("aria-pressed","false")}if(tab!=="tcg")setTab("tcg");else render();const el=$("panel-tcg");if(el)window.scrollTo({top:el.getBoundingClientRect().top+scrollY-((document.querySelector("header.bar")||{}).offsetHeight||70)-8,behavior:"smooth"})}
$("f").addEventListener("submit",e=>{e.preventDefault();$("q").blur();goSearch()});""")
rep('$("tup").innerHTML=j.up.slice(0,n).map(tc).join("");$("tdown").innerHTML=(j.down||[]).slice(0,n).map(tc).join("");$("trend").hidden=false;',
    '$("tup").innerHTML=j.up.slice(0,n).map(tc).join("");$("tdown").innerHTML=(j.down||[]).slice(0,n).map(tc).join("");window.TRD=1;$("trend").hidden=!!$("q").value.trim();')

# 8. 流暢特效：卡片依序淡入上滑、圖片載入後淡入、詳情視窗滑入、按鈕按壓回饋（系統設定減少動態時全部關閉）
rep('</style>\n\n<header class="bar">', r"""
@keyframes pin{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
@keyframes fadein{from{opacity:0}to{opacity:1}}
@keyframes sheetin{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}
@keyframes showimg{to{opacity:1}}
html{scroll-behavior:smooth}
.anim>.crow,.anim>.card,.tgrid>.tcard{animation:pin .42s cubic-bezier(.2,.75,.25,1) both}
.anim>:nth-child(2),.tgrid>:nth-child(2){animation-delay:.04s}.anim>:nth-child(3),.tgrid>:nth-child(3){animation-delay:.08s}.anim>:nth-child(4),.tgrid>:nth-child(4){animation-delay:.12s}
.anim>:nth-child(5),.tgrid>:nth-child(5){animation-delay:.16s}.anim>:nth-child(6){animation-delay:.2s}.anim>:nth-child(7){animation-delay:.24s}.anim>:nth-child(8){animation-delay:.28s}
.anim>:nth-child(n+9){animation-delay:.3s}
.crow>img.cimg,.tcard .ti img,.thumb img{opacity:0;transition:opacity .35s ease;animation:showimg 0s 2.5s forwards}
.crow>img.cimg.ld,.tcard .ti img.ld,.thumb img.ld{opacity:1;animation:none}
.crow,.tcard,.card{transition:transform .22s cubic-bezier(.2,.75,.25,1),box-shadow .22s,background .2s}
.crow:active,.tcard:active,.card:active{transform:scale(.975)}
.sheet-bg:not([hidden]){animation:fadein .22s ease both}
.sheet-bg:not([hidden]) .sheet{animation:sheetin .34s cubic-bezier(.2,.75,.25,1) both}
.chip,.cat,.tabs button,.seg button,.hot button,.more,.search button{transition:background .2s,color .2s,transform .12s,box-shadow .2s}
.chip:active,.cat:active,.tabs button:active,.seg button:active,.hot button:active,.more:active,.search button:active{transform:scale(.95)}
.search{transition:box-shadow .2s,transform .2s}.search:focus-within{transform:translateY(-1px);box-shadow:0 8px 0 var(--navy),0 10px 26px rgba(226,86,27,.25)}
#panel-fb:not([hidden]),#panel-tcg:not([hidden]){animation:fadein .25s ease both}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}.crow>img.cimg,.tcard .ti img,.thumb img{opacity:1}}
</style>

<header class="bar">""")
rep('function goSearch(){', r"""function animList(){for(const id of ["clist","grid"]){const el=$(id);if(!el)continue;el.classList.remove("anim");void el.offsetWidth;el.classList.add("anim");clearTimeout(el._at);el._at=setTimeout(()=>el.classList.remove("anim"),1200)}}
function markImgs(){requestAnimationFrame(()=>document.querySelectorAll("img:not(.ld)").forEach(i=>{if(i.complete)i.classList.add("ld")}))}
document.addEventListener("load",e=>{if(e.target.tagName==="IMG")e.target.classList.add("ld")},true);
document.addEventListener("error",e=>{if(e.target.tagName==="IMG")e.target.classList.add("ld")},true);
function goSearch(){animList();""")
rep('function setTab(t){tab=t;', 'function setTab(t){tab=t;try{animList()}catch(e){}')
rep('  if(tab==="fb") renderFB(P,q); else renderTCG(P,q,reset);', '  if(tab==="fb") renderFB(P,q); else renderTCG(P,q,reset);\n  try{markImgs()}catch(e){}')

# 9. 首頁上方動態背景（參考 tradecard.jp）：噴火龍色系流動光暈、漲幅前三名卡片扇形展開、即時行情跑馬燈
rep('</style>\n\n<header class="bar">', r"""
@keyframes aurora{0%{background-position:0% 0%,100% 0%,50% 100%,0 0}50%{background-position:60% 40%,30% 60%,80% 20%,0 0}100%{background-position:0% 0%,100% 0%,50% 100%,0 0}}
@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes tick{from{transform:translateY(0)}to{transform:translateY(-50%)}}
.hero{background:
  radial-gradient(40% 55% at 15% 20%,rgba(255,214,120,.85),transparent 70%),
  radial-gradient(45% 60% at 85% 15%,rgba(226,60,27,.75),transparent 70%),
  radial-gradient(60% 50% at 50% 90%,rgba(255,170,80,.8),transparent 70%),
  linear-gradient(180deg,#ff7a1f 0%,#ffb067 70%,var(--bg) 100%);
  background-size:180% 180%,180% 180%,180% 180%,100% 100%;animation:aurora 16s ease-in-out infinite}
.fan{position:relative;height:250px;max-width:360px;margin:0 auto 6px;cursor:pointer}
.fan .fc{position:absolute;left:50%;top:12px;width:150px;aspect-ratio:5/7;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 14px 34px rgba(90,20,8,.35);border:3px solid #2a1c17}
.fan .fc img{width:100%;height:100%;object-fit:cover;display:block}
.fan .f0{z-index:3;margin-left:-75px;animation:floaty 5s ease-in-out infinite}
.fan .f1{z-index:2;width:124px;top:38px;margin-left:-158px;transform:rotate(-11deg);filter:brightness(.85)}
.fan .f2{z-index:2;width:124px;top:38px;margin-left:34px;transform:rotate(11deg);filter:brightness(.85)}
.fan .ov{position:absolute;inset:auto 0 0 0;padding:26px 9px 8px;background:linear-gradient(transparent,rgba(20,10,6,.88));color:#fff;text-align:left}
.fan .ov b{display:block;font-size:12px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fan .ov span{font-family:var(--f-num);font-size:17px;font-weight:600}.fan .ov i{font-style:normal;color:#ff8a8f;font-size:12px;font-weight:700;margin-left:5px}
.fan .bd{position:absolute;top:7px;left:7px;background:var(--up);color:#fff;font-size:10.5px;font-weight:700;border-radius:6px;padding:1px 7px}
.fan .f1 .ov span,.fan .f2 .ov span{font-size:13px}
.ticker{max-width:660px;margin:16px auto 0;height:132px;overflow:hidden;border-radius:14px;-webkit-mask-image:linear-gradient(transparent,#000 14%,#000 86%,transparent);mask-image:linear-gradient(transparent,#000 14%,#000 86%,transparent)}
.ticker .tk{display:flex;flex-direction:column;gap:8px;animation:tick var(--tkd,30s) linear infinite}
.ticker:hover .tk{animation-play-state:paused}
.ticker .ti2{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;background:rgba(255,255,255,.88);color:#2a1c17;border-radius:12px;padding:8px 12px;text-align:left;cursor:pointer;box-shadow:0 2px 8px rgba(90,20,8,.12)}
.ticker .ti2 em{font-style:normal;font-size:11px;font-weight:700;color:#fff;border-radius:6px;padding:1px 7px;background:var(--up)}.ticker .ti2 em.d{background:#2f5fb8}
.ticker .ti2 b{font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ticker .ti2 span{font-family:var(--f-num);font-size:13.5px;font-weight:600;color:var(--brand-deep)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .ticker .ti2{background:rgba(42,29,23,.9);color:#f7eadf}}
</style>

<header class="bar">""")
rep('<span class="eyebrow">', '<div class="fan" id="fan" hidden aria-label="近 30 天漲最多的商品"></div>\n  <span class="eyebrow">')
rep('<div class="hot" id="hot"><b>熱門搜尋：</b></div>', '<div class="hot" id="hot"><b>熱門搜尋：</b></div>\n  <div class="ticker" id="ticker" hidden aria-label="行情跑馬燈"><div class="tk" id="tk"></div></div>')
rep('window.TRD=1;', r"""window.TRD=1;
  const f3=j.up.slice(0,3);if(f3.length===3){const fc=(x,i)=>`<div class="fc f${i}" data-k="${esc(x.k)}"><img src="${esc(x.img)}" alt="${esc(x.n)}">${i===0?'<span class="bd">漲 UP</span>':""}<div class="ov"><b>${esc(x.n)}</b><span>¥${fmt(x.y)}</span><i>+${x.c}%</i></div></div>`;
    $("fan").innerHTML=fc(f3[1],1)+fc(f3[2],2)+fc(f3[0],0);$("fan").hidden=false;$("fan").onclick=e=>{const c=e.target.closest("[data-k]");if(c)openKey(c.dataset.k)}}
  const tl=[...j.up.map(x=>[x,0]),...(j.down||[]).map(x=>[x,1])];if(tl.length>3){const row=([x,d])=>`<div class="ti2" data-k="${esc(x.k)}"><em class="${d?"d":""}">${d?"跌":"漲"} ${x.c>0?"+":""}${x.c}%</em><b>${esc(x.n)}</b><span>NT$${fmt(Math.round(x.y*(j.rate||0.2)))}</span></div>`;
    const html=tl.map(row).join("");$("tk").innerHTML=html+html;$("tk").style.setProperty("--tkd",tl.length*2.6+"s");$("ticker").hidden=false;$("ticker").onclick=e=>{const c=e.target.closest("[data-k]");if(c)openKey(c.dataset.k)}}""")

# 10. 幣值切換：全站預設台幣，頁首按鈕可切成日圓、美元（記在瀏覽器）。資料本身仍是日圓／台幣，只在顯示時換算
rep('function renderFB(P,q){', r"""let CUR=(()=>{try{return localStorage.getItem("cur")||"TWD"}catch(e){return "TWD"}})(),USDTW=32;
function RATE(){const v=+(document.getElementById("rate")||{}).value;return v>0?v:0.2079}
function cv(t){if(t==null||!isFinite(t))return "—";if(CUR==="JPY")return "¥"+ fmt(Math.round(t/RATE()));if(CUR==="USD"){const u=t/USDTW;return "US$"+ (Math.abs(u)>=100?fmt(Math.round(u)):u.toFixed(2))}return "NT$"+ fmt(Math.round(t))}
function Y(y){return CUR==="JPY"?"¥"+ fmt(Math.round(y)):cv(y*RATE())}
function N(t){return cv(t)}
function ALT(y){return CUR==="JPY"?"≈ NT$"+fmt(Math.round(y*RATE())):"日圓 ¥"+fmt(Math.round(y))}
function setCur(c){CUR=c;try{localStorage.setItem("cur",c)}catch(e){}document.querySelectorAll(".cur button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.c===c));try{render(false)}catch(e){}try{if(window.TJ&&window.TREND)window.TREND(window.TJ)}catch(e){}}
function renderFB(P,q){""")
rep('<span style="display:flex;align-items:center;gap:10px"><a href=', '<span style="display:flex;align-items:center;gap:10px"><span class="cur" role="group" aria-label="顯示幣值"><button type="button" data-c="TWD">NT$</button><button type="button" data-c="JPY">¥</button><button type="button" data-c="USD">US$</button></span><a href=')
rep('</style>\n\n<header class="bar">', """
.cur{display:inline-flex;background:rgba(255,255,255,.1);border-radius:999px;padding:3px;gap:2px}
.cur button{border:0;background:transparent;color:var(--navy-fg);font:inherit;font-family:var(--f-num);font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;cursor:pointer}
.cur button[aria-pressed="true"]{background:var(--brand);color:var(--brand-ink)}
@media (max-width:560px){header.bar small#stamp{display:none}.cur button{padding:3px 7px}}
</style>

<header class="bar">""")
# 次要價格：台幣模式顯示原始日圓，日圓模式顯示約合台幣
rep('<span class="pbig">¥${fmt(c.m)}<small>≈ NT$${fmt(c.nt)}</small></span>', '<span class="pbig">${Y(c.m)}<small>${ALT(c.m)}</small></span>')
rep('<div class="tp"><b>¥${fmt(x.y)}</b>', '<div class="tp"><b>${Y(x.y)}</b>')
rep('<div class="tnt">≈ NT$${fmt(Math.round(x.y*(j.rate||0.2)))}</div>', '<div class="tnt">${ALT(x.y)}</div>')
rep('<span>NT$${fmt(Math.round(x.y*(j.rate||0.2)))}</span></div>`;', '<span>${Y(x.y)}</span></div>`;')
rep('`¥${fmt(Math.min(...arr))}～${fmt(Math.max(...arr))}`', '`${Y(Math.min(...arr))}～${Y(Math.max(...arr))}`')
h = h.replace('${c.gap>=0?"+":""}${fmt(c.gap)}', '${c.gap>=0?"+":"−"}${N(Math.abs(c.gap))}')
rep('<dt>換算台幣</dt>', '<dt>換算金額</dt>')
# 其餘「¥/NT$ + fmt(...)」一律改成依幣值顯示（快速試算維持台幣輸入，不改）
import re as _re2
def _conv(src):
    out, i = [], 0
    pats = [('¥${fmt(', 'Y', True), ('NT$${fmt(', 'N', True), ('"¥"+fmt(', 'Y', False), ('"NT$"+fmt(', 'N', False)]
    while True:
        best = None
        for pat, fn, tpl in pats:
            k = src.find(pat, i)
            if k != -1 and (best is None or k < best[0]):
                best = (k, pat, fn, tpl)
        if not best:
            out.append(src[i:]); break
        k, pat, fn, tpl = best
        j = k + len(pat); d = 1
        while d:
            d += {"(": 1, ")": -1}.get(src[j], 0); j += 1
        expr = src[k + len(pat):j - 1]
        if tpl:  # 範本字串：¥${fmt(x)} → ${Y(x)}，要吃掉後面的 }
            assert src[j] == "}"; out.append(src[i:k] + "${%s(%s)}" % (fn, expr)); i = j + 1
        else:
            out.append(src[i:k] + "%s(%s)" % (fn, expr)); i = j
    return "".join(out)
h = h.replace('" / ¥"+fmt(Math.min(...vs))', '" / "+Y(Math.min(...vs))')
_q0 = h.index('$("qout").innerHTML='); _q1 = h.index("\n", _q0)
h = _conv(h[:_q0]) + h[_q0:_q1] + _conv(h[_q1:])
rep('document.addEventListener("load",e=>{', 'document.querySelectorAll(".cur button").forEach(b=>{b.setAttribute("aria-pressed",b.dataset.c===CUR);b.onclick=()=>setCur(b.dataset.c)});\ndocument.addEventListener("load",e=>{')

# 11. 我的庫存＋出售清單一鍵出圖（tools/inv.css、tools/inv.js）：商品詳情多一顆「加入我的庫存」，右下角開庫存
_D = _os.path.dirname(_os.path.abspath(__file__))
rep('</style>\n\n<header class="bar">', open(_os.path.join(_D, "inv.css"), encoding="utf-8").read() + '</style>\n\n<header class="bar">')
rep('<div class="sh-links">${links.map', '<div><button type="button" class="inv-add" id="inv-add">＋ 加入我的庫存</button></div>\n   <div class="sh-links">${links.map')
rep('$("sh-close").onclick=closeDetail;', '$("sh-close").onclick=closeDetail;{const ib=$("inv-add");if(ib)ib.onclick=()=>window.INV&&INV.addFrom(src,ib)}')
h += "\n<script>\n" + open(_os.path.join(_D, "inv.js"), encoding="utf-8").read() + "\n</script>\n"

# 12. 頁首加「競標」入口（tools/auction.html，publish 時複製到網站根目錄）
rep('<a href="%s" target="_blank" rel="noopener" style="background:#06c755' % LINE_URL, '<a href="auction.html" class="nav-auc" style="background:#ff8a2b;color:#2a1c17;font-weight:900;font-size:13px;border-radius:999px;padding:5px 12px;text-decoration:none;white-space:nowrap"><span class="lw">🔨 </span>競標</a><a href="%s" target="_blank" rel="noopener" style="background:#06c755' % LINE_URL)

rep('text-decoration:none;white-space:nowrap">加入 LINE 好友</a>', 'text-decoration:none;white-space:nowrap"><span class="lw">加入 </span>LINE<span class="lw"> 好友</span></a><style>@media (max-width:480px){.lw{display:none}.nav-auc{padding:5px 10px!important}.bar .wrap>span{gap:6px!important}.bar .wrap>span>a{padding:5px 10px!important}}@media (max-width:360px){.bar .brand span{display:none}}</style>')

# 13. 用詞：網站主打查行情，不再強調「賺價差」
rep('<h1>先查<mark>日本行情</mark>，再決定要不要搬回台灣</h1>', '<h1>傳個卡號，<mark>秒查日本行情</mark></h1>')
rep('和台灣臉書社團的價格比價。', '和台灣臉書社團的價格一起比較。')
for _ in range(2):
    rep('有賺頭</button>', '價差大</button>')
rep('const VL={good:"有賺頭",warn:"利潤薄",bad:"不划算",rev:"反向機會",na:"無法比"}', 'const VL={good:"價差大",warn:"價差小",bad:"日本較貴",rev:"台灣較便宜",na:"無法比"}')
rep('筆有賺頭｜依報酬率排序', '筆價差大｜依價差比例排序')
h = h.replace("不能直接套利", "不能直接比價")

# 14. 卡片目錄分「寶可夢／海賊王」（extra.json、us.json 的 op 欄位）；搜尋時兩種都找
rep('<h2 class="sec" id="ctitle">卡片目錄</h2>', '<div class="ipseg" role="group" aria-label="卡牌種類"><button type="button" data-ip="pk" aria-pressed="true"><span class="ic">⚡</span><span class="tx"><b>寶可夢</b><small id="ipn-pk">&nbsp;</small></span></button><button type="button" data-ip="op" aria-pressed="false"><span class="ic">☠️</span><span class="tx"><b>海賊王</b><small id="ipn-op">&nbsp;</small></span></button></div>\n  <h2 class="sec" id="ctitle">卡片目錄</h2>')
rep('o.extra=1;o.jn=e.jn||"";', 'o.extra=1;o.op=e.op?1:0;if(o.op)o.hay+=" 海賊王 航海王 one piece";o.jn=e.jn||"";')
rep('ROWS.push({ix:ROWS.length,n:"us:"+x.id,us:1,x,', 'ROWS.push({ix:ROWS.length,n:"us:"+x.id,us:1,op:x.op?1:0,x,')
rep('let list=ROWS.filter(o=>{if(cf.us&&!o.us&&!o.en)return false;', 'let list=ROWS.filter(o=>{if(!q&&(window.IP==="op")!==!!o.op)return false;if(cf.us&&!o.us&&!o.en)return false;')
rep('</style>\n\n<header class="bar">', """.ipseg{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:26px 0 18px}
.ipseg button{border:2px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;border-radius:18px;cursor:pointer;display:flex;align-items:center;gap:12px;padding:12px 16px;text-align:left;box-shadow:var(--shadow);transition:transform .15s,border-color .15s,background .15s;min-height:72px}
.ipseg button:hover{transform:translateY(-2px)}
.ipseg .ic{width:44px;height:44px;border-radius:14px;background:var(--surface-2);display:grid;place-items:center;font-size:22px;flex:none}
.ipseg .tx{display:flex;flex-direction:column;min-width:0}
.ipseg b{font-size:17px;font-weight:900;line-height:1.2}
.ipseg small{font-size:12px;color:var(--muted);font-family:var(--f-num);margin-top:2px}
.ipseg button[aria-pressed="true"]{background:var(--navy);border-color:var(--navy);color:#fff3e4}
.ipseg button[aria-pressed="true"] .ic{background:var(--brand)}
.ipseg button[aria-pressed="true"] small{color:#d9bfa6}
.ipseg.dim button[aria-pressed="true"]{background:var(--surface);color:var(--ink);border-color:var(--brand)}
@media (max-width:480px){.ipseg{gap:8px}.ipseg button{padding:10px 12px;gap:10px;min-height:64px}.ipseg .ic{width:38px;height:38px;font-size:19px}.ipseg b{font-size:16px}}
</style>

<header class="bar">""")
h += """
<script>
(function(){let ip="pk";try{ip=localStorage.getItem("ip")||"pk"}catch(e){}if(new URLSearchParams(location.search).get("ip")==="op")ip="op";window.IP=ip;
const seg=document.querySelector(".ipseg");if(!seg)return;const T={pk:"寶可夢卡片目錄",op:"海賊王卡片目錄"};
function cnt(){try{let a=0,b=0;for(const o of ROWS){if(o.op)b++;else a++}const f=n=>n.toLocaleString("en-US")+" 項商品";document.getElementById("ipn-pk").textContent=f(a);document.getElementById("ipn-op").textContent=f(b)}catch(e){}}
setInterval(cnt,1500);setTimeout(cnt,300);
function sync(){cnt();seg.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.ip===window.IP));const q=document.getElementById("q");seg.classList.toggle("dim",!!(q&&q.value.trim()))}
seg.querySelectorAll("button").forEach(b=>b.onclick=()=>{window.IP=b.dataset.ip;try{localStorage.setItem("ip",window.IP)}catch(e){}const q=document.getElementById("q");if(q&&q.value.trim()){q.value="";}sync();try{render(true)}catch(e){try{render()}catch(_){}}});
document.getElementById("q")&&document.getElementById("q").addEventListener("input",sync);sync();})();
</script>
"""

# 15. 補進來的日版卡：同一張卡的裸卡和 PSA10 都要顯示（原本同一個 SNKRDUNK id 只留一筆）
rep('if(Object.values(SNK.cards).some(c=>c.id===e.sid&&c!==SNK.cards[e.n]))continue;', 'const ep=/PSA10/i.test(e.n);if(Object.entries(SNK.cards).some(([k,c])=>c.id===e.sid&&k!==e.n&&/PSA10/i.test(k)===ep))continue;')

# 16. 補進來的卡（非原盒）不要寫「SNKRDUNK 原盒」
rep('${o.extra?"SNKRDUNK 原盒（TCG Japan 未販售）":', '${o.extra?(o.box?"SNKRDUNK 原盒（TCG Japan 未販售）":o.op?"SNKRDUNK 成交價":"SNKRDUNK 成交價（TCG Japan 未販售）"):')

open(dst, "w", encoding="utf-8").write(h)
print("page patched")
