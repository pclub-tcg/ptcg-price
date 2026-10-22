#!/usr/bin/env python3
"""在 GitHub Actions 上執行：下載 SNKRDUNK 商品大圖，轉成 JPEG（LINE 卡片只吃 JPEG/PNG）。
已經下載過的圖片不會重抓。用法：python3 fetch_images.py tools/sids.json <輸出資料夾> [jp.json] [en.json]（這些檔裡的卡也一起抓）"""
import io, json, os, sys, time, urllib.request
from PIL import Image

sids, out = json.load(open(sys.argv[1])), sys.argv[2]
for extra in sys.argv[3:]:  # jp.json、en.json 的卡也一起抓
    if os.path.exists(extra):
        sids = sorted(set(sids) | {c["sid"] for c in json.load(open(extra))["cards"]})
os.makedirs(out, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "Accept": "application/json, image/*"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read()


from PIL import ImageFilter, ImageChops

CUT = os.path.join(os.path.dirname(out.rstrip("/")), "cut")  # 去背 PNG（商品輪廓外一圈細白邊），跟 hi 放在同一層
os.makedirs(CUT, exist_ok=True)


def cutout(src, dst, W=300, H=420, edge=2):
    """去背：來源有透明就用；沒有就把跟四周相連的白底去掉。再沿輪廓加一圈 edge px 的細白邊。"""
    im = src.convert("RGBA")
    a = im.split()[-1]
    if a.getextrema()[0] == 255:  # 沒有透明：從四角把接近白色的背景填掉
        rgb = im.convert("RGB")
        mask = Image.new("L", im.size, 0)
        work = rgb.copy()
        for xy in ((0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)):
            if min(work.getpixel(xy)) > 235:
                from PIL import ImageDraw
                ImageDraw.floodfill(work, xy, (255, 0, 255), thresh=18)
        r, g, b = work.split()
        bgm = ImageChops.multiply(Image.eval(r, lambda v: 255 if v == 255 else 0), Image.eval(g, lambda v: 255 if v == 0 else 0))
        a = ImageChops.invert(ImageChops.multiply(bgm, Image.eval(b, lambda v: 255 if v == 255 else 0)))
        im.putalpha(a)
    box = a.point(lambda v: 255 if v > 20 else 0).getbbox()
    if box:
        im = im.crop(box)
    s = min((W - 2 * edge - 2) / im.width, (H - 2 * edge - 2) / im.height)
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    canvas.paste(im, ((W - im.width) // 2, (H - im.height) // 2), im)
    alpha = canvas.split()[-1].point(lambda v: 255 if v > 40 else 0)
    ring = alpha.filter(ImageFilter.MaxFilter(edge * 2 + 1))
    out_im = Image.new("RGBA", (W, H), (255, 255, 255, 0))
    out_im.putalpha(ring)  # 白色外框
    out_im.alpha_composite(canvas)
    out_im.quantize(colors=255, method=Image.Quantize.FASTOCTREE).save(dst, optimize=True)


ok = skip = fail = 0
for sid in sids:
    dst = os.path.join(out, "%d.jpg" % sid)
    cdst = os.path.join(CUT, "%d.png" % sid)
    if os.path.exists(dst) and os.path.exists(cdst):
        skip += 1
        continue
    try:
        meta = json.loads(get("https://snkrdunk.com/v1/apparels/%d" % sid))
        url = ((meta.get("primaryMedia") or {}).get("imageUrl")) or ""
        if not url:
            fail += 1
            continue
        im = Image.open(io.BytesIO(get(url)))
        cutout(im, cdst)
        if os.path.exists(dst):
            ok += 1
            time.sleep(0.3)
            continue
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1])
            im = bg
        im = im.convert("RGB")
        bbox = Image.eval(im.convert("L"), lambda v: 255 if v < 245 else 0).getbbox()  # 裁掉四周白邊
        if bbox:
            im = im.crop(bbox)
        W, H = 450, 630  # 5:7，跟 LINE 卡片的圖片比例一樣（450 寬就夠清楚，檔案比較小）
        s = min(W / im.width, H / im.height)
        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
        canvas = Image.new("RGB", (W, H), (255, 255, 255))
        canvas.paste(im, ((W - im.width) // 2, (H - im.height) // 2))
        canvas.save(dst, quality=82, optimize=True)
        ok += 1
    except Exception as e:
        print("fail", sid, e)
        fail += 1
    time.sleep(0.3)
print("ok", ok, "skip", skip, "fail", fail)
