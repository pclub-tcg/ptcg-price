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

for p in prods:  # 去掉空值，縮小檔案
    for k in [k for k, v in p.items() if v in (None, "", 0) and k not in ("k", "n")]:
        del p[k]

bot = {"updated": price.get("updated"), "rate": rate, "coupon": 600, "ship": 293, "sship": 600, "products": prods}
json.dump(bot, open(os.path.join(out, "data", "bot.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("products", len(prods), "bot.json bytes", os.path.getsize(os.path.join(out, "data", "bot.json")),
      "thumbs", len(os.listdir(os.path.join(out, "img"))))
