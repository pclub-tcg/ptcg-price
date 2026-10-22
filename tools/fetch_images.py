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


ok = skip = fail = 0
for sid in sids:
    dst = os.path.join(out, "%d.jpg" % sid)
    if os.path.exists(dst):
        skip += 1
        continue
    try:
        meta = json.loads(get("https://snkrdunk.com/v1/apparels/%d" % sid))
        url = ((meta.get("primaryMedia") or {}).get("imageUrl")) or ""
        if not url:
            fail += 1
            continue
        im = Image.open(io.BytesIO(get(url)))
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
