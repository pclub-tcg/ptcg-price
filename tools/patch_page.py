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
if(/github\.io$/.test(location.hostname))fetch("us.json").then(r=>r.ok?r.json():null).then(j=>{if(!j)return;const fx=j.usd||32;for(const x of j.items){const box=x.t==="s";ROWS.push({ix:ROWS.length,n:"us:"+x.id,us:1,x,price:Math.round(x.m*fx),sold:false,psa:false,box,base:x.n,rar:x.r||"",num:x.num||"",set:x.set,mq:null,hay:(x.n+" "+(x.zh||"")+" "+x.set+" "+(x.num||"")+" "+(x.r||"")+" "+(x.kw||"")+" 美版 us"+(box?" box 原盒 未拆":"")).toLowerCase()})}try{render(false)}catch(e){}}).catch(()=>{});
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
if(/github\.io$/.test(location.hostname))fetch("trend.json").then(r=>r.ok?r.json():null).then(j=>{if(!j||!(j.up||[]).length)return;
  const tc=(x,i)=>`<div class="tcard" data-k="${esc(x.k)}" tabindex="0" role="button" aria-label="${esc(x.n)} 詳情與 K 線"><span class="rk">${i+1}</span><div class="ti"><img src="${esc(x.img)}" alt="${esc(x.n)}" loading="lazy"></div><div class="tb"><div class="tn">${esc(x.n)}</div><div class="ts">${esc([x.set,x.num,x.b?"原盒":x.rar].filter(Boolean).join("・"))}</div><div class="tp"><b>¥${fmt(x.y)}</b><span class="${x.c>0?"up-t":"down-t"}">${x.c>0?"+":""}${x.c}%</span></div><div class="tnt">≈ NT$${fmt(Math.round(x.y*(j.rate||0.2)))}</div></div></div>`;
  const n=matchMedia("(max-width:560px)").matches?4:5;
  $("tup").innerHTML=j.up.slice(0,n).map(tc).join("");$("tdown").innerHTML=(j.down||[]).slice(0,n).map(tc).join("");$("trend").hidden=false;
  const go=e=>{const c=e.target.closest(".tcard[data-k]");if(!c)return;if(e.type==="keydown"&&e.key!=="Enter")return;openKey(c.dataset.k)};
  $("trend").addEventListener("click",go);$("trend").addEventListener("keydown",go);
}).catch(()=>{});""")

open(dst, "w", encoding="utf-8").write(h)
print("page patched")
