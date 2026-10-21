#!/usr/bin/env python3
"""把「卡價套利王」Artifact 的 HTML 轉成 GitHub Pages 網站 + LINE 機器人資料。

用法：python3 export.py <artifact.html> <kline.json> <sprites 資料夾> <輸出 site 資料夾>

產出：
  site/index.html      獨立網站（可用 ?p=i:商品名 或 ?p=r:目錄名 直接打開某商品的 K 線）
  site/kline.json      K 線資料（原樣複製）
  site/sprites/*.jpg   目錄卡圖（原樣複製）
  site/img/*.jpg       每個商品一張縮圖（給 LINE 卡片訊息用）
  site/data/bot.json   機器人用的精簡價格資料
"""
import base64, io, json, os, re, shutil, sys, statistics
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

# 5. 走勢圖（給 LINE 卡片用，皮卡屋風格的咖啡色底）＋ 統計數字
from PIL import ImageDraw, ImageFont
import datetime
KL = json.load(open(kline, encoding="utf-8"))["d"]
FB = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
F = ImageFont.truetype(FB, 17)
BG, GRID, LINE, TXT = (91, 58, 30), (122, 88, 52), (255, 210, 31), (236, 214, 170)


def kpts(key):
    a = KL.get(key)
    if not a:
        return []
    d, o = a[0], [(a[0], a[1])]
    for i in range(2, len(a) - 1, 2):
        d += a[i]
        o.append((d, a[i + 1]))
    return o


def yen(v):
    return "%.0fk" % (v / 1000) if v >= 10000 else format(round(v), ",")


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
    lo, hi = lo - pad, hi + pad
    x0, x1, y0, y1 = 62 * S, (W - 14) * S, 14 * S, (H - 34) * S
    d0, d1 = pts[0][0], pts[-1][0]
    X = lambda d: x0 + (d - d0) / max(1, d1 - d0) * (x1 - x0)
    Y = lambda v: y1 - (v - lo) / (hi - lo) * (y1 - y0)
    for i in range(5):
        v = lo + (hi - lo) * i / 4
        y = Y(v)
        dr.line([(x0, y), (x1, y)], fill=GRID, width=S)
        dr.text((x0 - 8 * S, y), yen(v), fill=TXT, font=f, anchor="rm")
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
    ov = Image.new("RGB", im.size, (150, 108, 44))
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).polygon(xy + [(xy[-1][0], y1), (xy[0][0], y1)], fill=120)
    im.paste(ov, (0, 0), mask)
    dr.line(xy, fill=LINE, width=4 * S, joint="curve")
    lx, ly = xy[-1]
    dr.ellipse([lx - 9 * S, ly - 9 * S, lx + 9 * S, ly + 9 * S], fill=LINE)
    dr.ellipse([lx - 4 * S, ly - 4 * S, lx + 4 * S, ly + 4 * S], fill=(255, 255, 255))
    im = im.resize((W, H), Image.LANCZOS).quantize(64)
    im.save(os.path.join(out, "img", name), optimize=True)
    return "img/" + name


nch = 0
for p in prods:
    pts = kpts(p.get("kk") or "")
    if not pts:
        continue
    last = pts[-1][0]
    w = [v for d, v in pts if d >= last - 90]
    p["k1"] = pts[-1][1]
    p["kh"], p["kl"], p["ka"], p["kn"] = max(w), min(w), round(sum(w) / len(w)), len(w)
    p["kd"] = str(datetime.date(1970, 1, 1) + datetime.timedelta(days=last))
    old = [v for d, v in pts if d <= last - 30]
    if old:
        p["c30"] = round((pts[-1][1] - old[-1]) / old[-1] * 100, 1)
    p["ch"] = chart([q for q in pts if q[0] >= last - 120] or pts[-2:], "k%s.png" % re.sub(r"[^0-9a-z]", "_", p["kk"]))
    nch += 1
print("charts", nch)

# 6. 網站設定（以圖搜尋的 Worker 網址）
cfg = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site-config.json")
if os.path.exists(cfg):
    shutil.copy(cfg, os.path.join(out, "config.json"))

for p in prods:  # 去掉空值，縮小檔案
    for k in [k for k, v in p.items() if v in (None, "", 0) and k not in ("k", "n")]:
        del p[k]

bot = {"updated": price.get("updated"), "rate": rate, "coupon": 600, "ship": 293, "sship": 600, "products": prods}
json.dump(bot, open(os.path.join(out, "data", "bot.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("products", len(prods), "bot.json bytes", os.path.getsize(os.path.join(out, "data", "bot.json")),
      "thumbs", len(os.listdir(os.path.join(out, "img"))))
