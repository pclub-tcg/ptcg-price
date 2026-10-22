#!/usr/bin/env python3
"""把「P’CLUB」Artifact 的 HTML 轉成 GitHub Pages 網站 + LINE 機器人資料。

用法：python3 export.py <artifact.html> <kline.json> <sprites 資料夾> <輸出 site 資料夾>

產出：
  site/index.html      獨立網站（可用 ?p=i:商品名 或 ?p=r:目錄名 直接打開某商品的 K 線）
  site/kline.json      K 線資料（原樣複製）
  site/sprites/*.jpg   目錄卡圖（原樣複製）
  site/img/*.jpg       每個商品一張縮圖（給 LINE 卡片訊息用）
  site/data/bot.json   機器人用的精簡價格資料
"""
import base64, io, json, os, re, shutil, sys, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zhname import ja2zh, en2zh  # 日文／英文卡名翻成繁中
from PIL import Image

src, kline, sprites, out = sys.argv[1:5]
html = open(src, encoding="utf-8").read()


def block(id_):
    m = re.search(r'<script id="%s" type="application/json">(.*?)</script>' % id_, html, re.S)
    return json.loads(m.group(1)) if m else None


price, cat, merc, imgs, snkr = (block(x) for x in ("price-data", "catalog-data", "mercari-data", "img-data", "snkr-data"))
rate = float(re.search(r'id="rate" type="number" step="0.0001" value="([\d.]+)"', html).group(1))

os.makedirs(os.path.join(out, "data"), exist_ok=True)
os.makedirs(os.path.join(out, "img"), exist_ok=True)

# 1. 獨立網站：Artifact 發布時會自動包 <!doctype>…<body>，獨立網站要自己補上
page = html
if "<!doctype html>" not in page[:200].lower():
    page = ('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
            'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'
            + page + "</body></html>")
open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(page)
shutil.copy(kline, os.path.join(out, "kline.json"))
if os.path.abspath(sprites) != os.path.abspath(os.path.join(out, "sprites")):
    shutil.copytree(sprites, os.path.join(out, "sprites"), dirs_exist_ok=True)

# 2. 縮圖
sheets = {}


def sprite_cell(k):
    n = k // 20
    if n not in sheets:
        f = os.path.join(sprites, "s%02d.jpg" % n)
        sheets[n] = Image.open(f).convert("RGB") if os.path.exists(f) else None
    sh = sheets[n]
    if sh is None:
        return None
    c, r = k % 20 % 5, k % 20 // 5
    return sh.crop((c * 60, r * 84, c * 60 + 60, r * 84 + 84))


def save_thumb(im, name):
    """LINE 卡片的主圖比例設為 5:7，貼到深色底上。"""
    W, H = 300, 420
    bg = Image.new("RGB", (W, H), (35, 42, 59))
    im = im.convert("RGB")
    s = min(W / im.width, H / im.height)
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    bg.paste(im, ((W - im.width) // 2, (H - im.height) // 2))
    bg.save(os.path.join(out, "img", name), quality=82)
    return "img/" + name


R = re.compile(r"^(.*?)【(.*?)】\{(.*?)\}\s*\[(.*?)\](_PSA10|_PS10)?$")
spr = {}
for r in cat["rows"]:
    if len(r) > 3 and r[3] is not None and r[0] not in spr:
        spr[r[0]] = r[3]

med = lambda a: (round(statistics.median(a)), len(a)) if a else None
TY = {"PSA10": "p", "PSA9": "9", "A": "a", "BOX": "b"}
prods = []
item_cn = set()

# 3. 比價商品（有台灣社團價格的）
for i, it in enumerate(price["items"]):
    img = None
    d = imgs.get(it.get("img") or "")
    if d and d.startswith("data:image"):
        img = save_thumb(Image.open(io.BytesIO(base64.b64decode(d.split(",", 1)[1]))), "i%d.jpg" % i)
    elif it.get("cn") in spr:
        cell = sprite_cell(spr[it["cn"]])
        if cell:
            img = save_thumb(cell, "i%d.jpg" % i)
    if it.get("cn"):
        item_cn.add(it["cn"])
    m = re.match(r"(.*?)\s*(\d{3}/[\w-]+)", it["n"])
    prods.append({
        "k": "i:" + it["n"], "n": it["n"], "j": it.get("jp", ""), "kw": it.get("kw", ""),
        "num": (re.search(r"\d{1,3}/[\w-]+", it["n"] + " " + it.get("jp", "")) or [None])[0] or "",
        "set": (R.match(it.get("cn") or "") or [None]*5)[4] if R.match(it.get("cn") or "") else "",
        "rar": R.match(it["cn"]).group(2) if R.match(it.get("cn") or "") else "", "p": 1 if "PSA10" in it["n"] else 0, "b": 1 if it.get("cat") == "box" else 0,
        "img": img, "m": med(it.get("p") or []), "s": med(it.get("s") or []), "sid": it.get("sid"),
        "kk": ("%s~%s" % (it["sid"], TY[it["sc"]])) if it.get("sid") and it.get("sc") in TY else None,
        "tw": None if it.get("force") else it.get("tw"), "tt": it.get("twType", ""), "note": it.get("twNote", ""),
        "mq": it.get("mq", ""), "cn": it.get("cn"), "sold": 0,
    })

# 4. 目錄卡（沒有比價商品的才另外列）
for r in cat["rows"]:
    name = r[0]
    if name in item_cn:
        continue
    m = R.match(name)
    box = not m
    base, rar, num, st, psa = (m.groups() if m else (name, "BOX", "", "", None))
    s = snkr["cards"].get(name)
    mp = (merc["cards"].get(name) or {}).get("p") or []
    img = None
    if len(r) > 3 and r[3] is not None:
        cell = sprite_cell(r[3])
        if cell:
            img = save_thumb(cell, "c%d.jpg" % r[3])
    kind = "b" if box else ("p" if psa else "a")
    mq = None if box else ((num if num and not re.match(r"^[-舊]", num) else base)
                           + (" " + rar if rar and rar not in ("-", "P", "C", "U", "R", "RR") else "")
                           + (" PSA10" if psa else ""))
    prods.append({
        "k": "r:" + name, "n": base + (" PSA10" if psa else "") + (" " + num if num else ""), "j": name, "kw": "",
        "num": num, "set": st, "rar": rar, "p": 1 if psa else 0, "b": 1 if box else 0, "img": img,
        "m": med(mp), "s": med(s["s"]) if s and s.get("s") else None, "sid": s["id"] if s else None,
        "kk": ("%s~%s" % (s["id"], kind)) if s else None, "tw": None, "tt": "", "note": "",
        "mq": mq, "cn": None, "sold": r[2], "tcg": r[1],
    })

# 4b. 額外原盒（tools/boxes.json＋GitHub Actions 每天抓的 boxdata.json，publish.sh 用 BOX_DATA 傳進來）
EXTRA_K = {}
bd_path = os.environ.get("BOX_DATA")
if bd_path and os.path.exists(bd_path):
    bd = json.load(open(bd_path, encoding="utf-8"))["boxes"]
    have = {p.get("sid"): p for p in prods if p.get("b") and p.get("sid")}
    nb = 0
    for b in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "boxes.json"), encoding="utf-8")):
        d = bd.get(str(b["sid"]))
        if b["sid"] in have:  # 已經有的原盒：補上中日文名稱方便搜尋
            q = have[b["sid"]]
            q["kw"] = " ".join(x for x in [q.get("kw", ""), b["zh"], b["jp"], b["set"]] if x)
            continue
        if not d:
            continue
        name = (b["zh"] or b["jp"]) + " BOX"
        prods.append({"k": "x:%d" % b["sid"], "n": name, "j": b["jp"] + " ボックス", "kw": " ".join([b["zh"], b["jp"], b["set"], "box 原盒"]),
                      "num": "", "set": b["set"], "rar": "BOX", "p": 0, "b": 1, "img": None, "m": None,
                      "s": d.get("s"), "sid": b["sid"], "kk": "%d~b" % b["sid"], "tw": None, "tt": "", "note": "",
                      "mq": b["jp"] + " BOX シュリンク付き", "cn": None, "sold": 0})
        if d.get("k"):
            EXTRA_K["%d~b" % b["sid"]] = d["k"]
        nb += 1
    print("extra boxes", nb)

# 4c. 日版高稀有度卡（GitHub Actions 每天抓的 jp.json，publish.sh 用 JP_DATA 傳進來）
jp_path = os.environ.get("JP_DATA")
EN2ZH = {}
if jp_path and os.path.exists(jp_path):
    jcards = json.load(open(jp_path, encoding="utf-8"))["cards"]
    have_kk = {p.get("kk") for p in prods if p.get("kk")}
    setnum = {}
    for r in cat["rows"]:  # 目錄裡已有的卡：用系列＋卡號對出中文名
        m = R.match(r[0])
        if m:
            setnum[(m.group(4).upper(), m.group(3))] = m.group(1)
    JP2ZH = {}
    for c in jcards:
        zh = setnum.get((c["set"].upper(), c["num"]))
        if zh:
            JP2ZH.setdefault(c["b"], zh)
            if c.get("en"):  # SNKRDUNK 英文名像「Charizard ex SAR」：去掉 [..] 和結尾稀有度，才能對上美版名稱
                en = re.sub(r"\s+[A-Z]{1,4}$", "", c["en"].split("[")[0].strip())
                EN2ZH.setdefault(en.lower(), zh)
    nj = 0
    for c in jcards:
        zh = setnum.get((c["set"].upper(), c["num"])) or JP2ZH.get(c["b"])
        if not zh or re.search(r"(.{2,}的)\1", zh):  # TCG Japan 偶爾有「奇樹的奇樹的…」這種重複，改用翻譯
            zh = ja2zh(c["b"]) or zh
        name = zh or c["b"]
        for kind, d in (("a", c.get("a") or {}), ("p", c.get("p") or {})):
            kk = "%d~%s" % (c["sid"], kind)
            if kk in have_kk or not d.get("s"):
                continue
            psa = kind == "p"
            prods.append({"k": "j:%d%s" % (c["sid"], "p" if psa else ""), "n": "%s %s %s%s" % (name, c["r"], c["num"], " PSA10" if psa else ""),
                          "j": "%s %s [%s %s]" % (c["b"], c["r"], c["set"], c["num"]),
                          "kw": " ".join(x for x in [c["b"], c.get("en", ""), c["set"], c["r"], "psa10 鑑定" if psa else ""] if x),
                          "num": c["num"], "set": c["set"], "rar": c["r"], "p": 1 if psa else 0, "b": 0, "img": None, "m": None,
                          "s": d["s"], "sid": c["sid"], "kk": kk, "tw": None, "tt": "", "note": "",
                          "mq": "%s %s%s" % (c["num"], c["r"], " PSA10" if psa else ""), "cn": None, "sold": 0,
                          "cat": "%s【%s】{%s} [%s]%s" % (name, c["r"], c["num"], c["set"], "_PSA10" if psa else ""), "jn": c["b"]})
            if d.get("k"):
                EXTRA_K[kk] = d["k"]
            nj += 1
    print("jp cards", nj)

# 4d. 美版（GitHub Actions 每天從 tcgcsv＝TCGplayer 抓的 us.json，publish.sh 用 US_DATA 傳進來）
us_path = os.environ.get("US_DATA")
USD = None
if us_path and os.path.exists(us_path):
    ud = json.load(open(us_path, encoding="utf-8"))
    USD = ud.get("usd_twd") or 32.0
    def zh_for(n):
        b = n.split(" - ")[0].split(" (")[0].lower()
        return EN2ZH.get(b, "")
    nu = 0
    for it in ud["items"]:
        kk = "u%d" % it["id"]
        zh = en2zh(it["n"], it["t"] == "s")
        if it["t"] == "s" and zh:  # 原盒名稱裡的寶可夢名也翻
            zh = re.sub(r"[A-Z][a-z]+(?: [A-Z][a-z]+)?(?: (?:VSTAR|VMAX|ex|EX|GX|V))?", lambda m: en2zh(m.group(0)) or m.group(0), zh)
        nzh = (zh + (" " + it["num"] if it.get("num") else "")) if zh else it["n"]
        prods.append({"k": "u:%d" % it["id"], "n": nzh, "j": it["n"], "zh": zh or "", "kw": " ".join(x for x in [zh or "", zh_for(it["n"]), it.get("v", ""), "美版 英文 us en", "box 原盒 未拆" if it["t"] == "s" else ""] if x),
                      "num": it.get("num", ""), "set": it["set"], "rar": it.get("r", ""), "p": 0, "b": 1 if it["t"] == "s" else 0,
                      "us": 1, "um": it["m"], "ul": it.get("l"), "uurl": it.get("url"), "uimg": it.get("img"), "img": it.get("img"),
                      "kk": kk, "fx": round(USD / 100, 5)})
        EXTRA_K[kk] = it["k"]
        nu += 1
    print("us items", nu, "usd", USD)

# 4e. 美版 PSA10（GitHub Actions 每天抓的 SNKRDUNK 英文版卡成交 en.json，publish.sh 用 EN_DATA 傳進來；價格是日圓）
en_path = os.environ.get("EN_DATA")
if en_path and os.path.exists(en_path):
    ed = json.load(open(en_path, encoding="utf-8"))
    usz = {}  # (TCGplayer 系列名, 卡號) → 美版商品的中文名
    for q in prods:
        if q.get("us") and q.get("zh") and q.get("num"):
            usz.setdefault((q["set"], q["num"]), q["zh"])
    ne = 0
    for c in ed["cards"]:
        d = c.get("p") or {}
        if not d.get("s"):
            continue
        sname = ed["sets"].get(c["set"], c["set"])
        zh = usz.get((sname, c["num"])) or en2zh(c["en"]) or ja2zh(c["b"]) or c["en"]
        kk = "%d~p" % c["sid"]
        prods.append({"k": "e:%d" % c["sid"], "n": "%s %s PSA10" % (zh, c["num"]), "j": "%s %s [%s EN %s]" % (c["en"], c["r"], c["set"], c["num"]),
                      "kw": " ".join(x for x in [c["en"], c["b"], c["set"], sname, c["r"], "美版 英文 us en psa10 鑑定"] if x),
                      "num": c["num"], "set": c["set"] + " EN", "rar": c["r"], "p": 1, "b": 0, "en": 1, "img": None, "m": None,
                      "s": d["s"], "sid": c["sid"], "kk": kk, "tw": None, "tt": "", "note": "", "mq": "", "cn": None, "sold": 0,
                      "cat": "%s【%s】{%s} [%s EN]_PSA10" % (zh, c["r"] or "-", c["num"], c["set"])})
        if d.get("k"):
            EXTRA_K[kk] = d["k"]
        ne += 1
    print("en psa10", ne)

# 5. 走勢圖（給 LINE 卡片用，噴火龍配色）＋ 統計數字
from PIL import ImageDraw, ImageFont
import datetime
KL = json.load(open(kline, encoding="utf-8"))["d"]
KL.update(EXTRA_K)
FB = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
F = ImageFont.truetype(FB, 17)
BG, GRID, LINE, TXT = (42, 28, 23), (74, 52, 40), (255, 182, 39), (255, 214, 176)  # 噴火龍配色：炭黑底、火焰金線


def kpts(key):
    a = KL.get(key)
    if not a:
        return []
    d, o = a[0], [(a[0], a[1])]
    for i in range(2, len(a) - 1, 2):
        d += a[i]
        o.append((d, a[i + 1]))
    return o


FX = rate


def ntd(v):  # 走勢圖座標用台幣
    v *= FX
    return "%.1fk" % (v / 1000) if v >= 10000 else format(round(v, -1), ",.0f")


def chart(pts, name):
    S = 2  # 先畫兩倍大再縮小，線條比較平滑
    W, H = 600, 300
    im = Image.new("RGB", (W * S, H * S), BG)
    dr = ImageDraw.Draw(im)
    f = ImageFont.truetype(FB, 17 * S)
    lo, hi = min(v for _, v in pts), max(v for _, v in pts)
    if hi == lo:
        hi, lo = hi * 1.05, lo * 0.95
    pad = (hi - lo) * 0.12
    lo, hi = max(0, lo - pad), hi + pad
    x0, x1, y0, y1 = 62 * S, (W - 14) * S, 14 * S, (H - 34) * S
    d0, d1 = pts[0][0], pts[-1][0]
    X = lambda d: x0 + (d - d0) / max(1, d1 - d0) * (x1 - x0)
    Y = lambda v: y1 - (v - lo) / (hi - lo) * (y1 - y0)
    for i in range(5):
        v = lo + (hi - lo) * i / 4
        y = Y(v)
        dr.line([(x0, y), (x1, y)], fill=GRID, width=S)
        dr.text((x0 - 8 * S, y), ntd(v), fill=TXT, font=f, anchor="rm")
    seen = set()
    for d in range(d0, d1 + 1):  # 月份刻度
        dt = datetime.date(1970, 1, 1) + datetime.timedelta(days=d)
        if dt.day == 1 or d == d0:
            k = (dt.year, dt.month)
            if k in seen or (d == d0 and dt.day > 20):
                continue
            seen.add(k)
            dr.text((X(d), y1 + 10 * S), "%d月" % dt.month, fill=TXT, font=f, anchor="mt")
    xy = [(X(d), Y(v)) for d, v in pts]
    if len(xy) == 1:
        xy = [(x0, xy[0][1]), (x1, xy[0][1])]
    ov = Image.new("RGB", im.size, (226, 86, 27))
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).polygon(xy + [(xy[-1][0], y1), (xy[0][0], y1)], fill=95)
    im.paste(ov, (0, 0), mask)
    dr.line(xy, fill=LINE, width=4 * S, joint="curve")
    lx, ly = xy[-1]
    dr.ellipse([lx - 9 * S, ly - 9 * S, lx + 9 * S, ly + 9 * S], fill=LINE)
    dr.ellipse([lx - 4 * S, ly - 4 * S, lx + 4 * S, ly + 4 * S], fill=(255, 255, 255))
    im = im.resize((W, H), Image.LANCZOS).quantize(64)
    im.save(os.path.join(out, "img", name), optimize=True)
    return "img/" + name


def clean(pts, ref, box):
    """SNKRDUNK 每日均價有時會混到別的規格（例如原盒混到整箱、無膠膜），
    以最近成交中位數為基準，把差太多的日子拿掉。"""
    if not pts:
        return pts
    if not ref:
        recent = sorted(v for d, v in pts if d >= pts[-1][0] - 60)
        ref = recent[len(recent) // 2]
    lo, hi = (0.7, 1.4) if box else (0.5, 2.0)
    return [(d, v) for d, v in pts if ref * lo <= v <= ref * hi]


def encode(pts):
    a = [pts[0][0], pts[0][1]]
    for (d0, _), (d1, v) in zip(pts, pts[1:]):
        a += [d1 - d0, v]
    return a


KL_OUT = dict(KL)
nch = 0
for p in prods:
    kk = p.get("kk") or ""
    raw = kpts(kk)
    if not raw:
        continue
    FX = p.get("fx") or rate
    pts = raw if p.get("us") else clean(raw, (p.get("s") or [None])[0], kk.endswith("~b"))
    if len(pts) < (5 if p.get("us") else 3):
        KL_OUT.pop(kk, None)
        continue
    KL_OUT[kk] = encode(pts)
    last = pts[-1][0]
    w = [v for d, v in pts if d >= last - 90]
    p["k1"] = pts[-1][1]
    p["kh"], p["kl"], p["ka"], p["kn"] = max(w), min(w), round(sum(w) / len(w)), len(w)
    p["kd"] = str(datetime.date(1970, 1, 1) + datetime.timedelta(days=last))
    old = [v for d, v in pts if d <= last - 30]
    if old:
        p["c30"] = round((pts[-1][1] - old[-1]) / old[-1] * 100, 1)
    p["ch"] = chart([q for q in pts if q[0] >= last - 120] or pts[-2:], "k%s.png" % re.sub(r"[^0-9a-z]", "_", kk))
    nch += 1
# 網站的 K 線也用清理過的資料
kd = json.load(open(kline, encoding="utf-8"))
kd["d"] = KL_OUT
json.dump(kd, open(os.path.join(out, "kline.json"), "w", encoding="utf-8"), separators=(",", ":"))
print("charts", nch)

# 6. 網站設定（以圖搜尋的 Worker 網址）
cfg = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site-config.json")
if os.path.exists(cfg):
    shutil.copy(cfg, os.path.join(out, "config.json"))

# 7. 商品大圖（GitHub Actions 從 SNKRDUNK 下載好的 600x840 JPEG，放在 img 分支，publish.sh 會傳進來）
HI = os.environ.get("HI_DIR")
nhi = 0
if HI and os.path.isdir(HI):
    os.makedirs(os.path.join(out, "hi"), exist_ok=True)
    for p in prods:
        f = os.path.join(HI, "%s.jpg" % p.get("sid"))
        if p.get("sid") and os.path.exists(f):
            dst = os.path.join(out, "hi", os.path.basename(f))
            if not os.path.exists(dst):
                shutil.copy(f, dst)
            p["img"] = "hi/" + os.path.basename(f)
            nhi += 1
json.dump(sorted(int(f[:-4]) for f in os.listdir(os.path.join(out, "hi"))) if os.path.isdir(os.path.join(out, "hi")) else [], open(os.path.join(out, "hi.json"), "w"))
print("hi-res images", nhi)

# 8. 網站目錄要額外加的列：額外原盒＋日版高稀有度卡（名稱用目錄格式）
json.dump([{"n": q.get("cat") or q["n"], "sid": q["sid"], "m": q["s"][0], "c": q["s"][1], "kw": q["kw"], "mq": q["mq"], **({"jn": q["jn"]} if q.get("jn") else {}), **({"en": 1, "jn": q["j"]} if q.get("en") else {})}
           for q in prods if q["k"][:2] in ("x:", "j:", "e:") and q.get("s")],
          open(os.path.join(out, "extra.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
# 美版另外給網站用
json.dump({"usd": USD, "items": [{"id": int(q["k"][2:]), "n": q["j"], "zh": q.get("zh", ""), "set": q["set"], "num": q.get("num", ""), "r": q.get("rar", ""), "t": "s" if q.get("b") else "c",
            "m": q["um"], "img": q.get("uimg"), "url": q.get("uurl"), "kw": q.get("kw", "")} for q in prods if q.get("us")]},
          open(os.path.join(out, "us.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
for p in prods:
    p.pop("cat", None); p.pop("uimg", None); p.pop("jn", None); p.pop("zh", None)
    if p.get("us"):  # 機器人用 id 自己組 TCGplayer 圖片／商品網址，bot.json 小很多
        p.pop("img", None); p.pop("uurl", None); p.pop("kk", None); p.pop("fx", None)

for p in prods:  # 去掉空值，縮小檔案
    for k in [k for k, v in p.items() if v in (None, "", 0) and k not in ("k", "n")]:
        del p[k]

BOT_US_C, BOT_US_S = float(os.environ.get("BOT_US_C", 100)), float(os.environ.get("BOT_US_S", 200))  # 美版進機器人的門檻（US$）
BOT_JP = float(os.environ.get("BOT_JP", 3000))  # 日版高稀有度卡進機器人的門檻（成交中位 ¥）
def to_bot(p):
    if p.get("us"):
        return p.get("um", 0) >= (BOT_US_S if p.get("b") else BOT_US_C)
    return p["k"][:2] not in ("j:", "e:") or (p.get("s") or [0])[0] >= BOT_JP
import unicodedata
bprods = [p for p in prods if to_bot(p)]
for p in bprods:  # 搜尋用字串先算好（Worker 不用每次冷啟動都做 NFKC，省 CPU）
    p["h"] = unicodedata.normalize("NFKC", " ".join(str(p.get(k) or "") for k in ("n", "j", "kw", "cn", "num", "set", "rar"))
                                   + (" box 原盒" if p.get("b") else "") + (" psa10 鑑定" if p.get("p") else "") + (" 美版 us en" if p.get("us") or p.get("en") else " 日版 jp")).lower()
    for k in ("kw", "cn", "kd"):  # 已併進 h，或機器人沒用到
        p.pop(k, None)
# 美版另存 bot-us.json：查英文或「美版」時機器人才載入
json.dump({"products": [p for p in bprods if p.get("us")]}, open(os.path.join(out, "data", "bot-us.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
bprods = [p for p in bprods if not p.get("us")]
bot = {"updated": price.get("updated"), "rate": rate, "usd": USD, "coupon": 600, "ship": 293, "sship": 600, "products": bprods}
json.dump(bot, open(os.path.join(out, "data", "bot.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("products", len(prods), "bot products", len(bprods), "bot.json bytes", os.path.getsize(os.path.join(out, "data", "bot.json")),
      "thumbs", len(os.listdir(os.path.join(out, "img"))))
