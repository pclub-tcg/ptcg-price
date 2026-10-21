#!/usr/bin/env python3
"""給 Claude 裡的網頁版用：把額外原盒做成 extra-data 區塊、卡圖 sprite（從 s90 開始，避開目錄用的編號）、合併進 K 線。
用法：python3 claude_extra.py <boxdata.json> <hi 資料夾> <舊 kline.json> <輸出資料夾> <網頁 html>
（網頁裡已經有的原盒會跳過）
輸出：extra.json（放進 extra-data 區塊）、kline.json、sprites/s90.jpg…"""
import json, os, statistics, sys
from PIL import Image

import re
bd_path, hi, kl_path, out, page = sys.argv[1:6]
html = open(page, encoding="utf-8").read()
J = lambda i: json.loads(re.search(r'<script id="%s" type="application/json">(.*?)</script>' % i, html, re.S).group(1))
have = {c.get("id") for c in J("snkr-data")["cards"].values()} | {it.get("sid") for it in J("price-data")["items"]}
HERE = os.path.dirname(os.path.abspath(__file__))
bd = json.load(open(bd_path, encoding="utf-8"))["boxes"]
boxes = json.load(open(os.path.join(HERE, "boxes.json"), encoding="utf-8"))
kl = json.load(open(kl_path, encoding="utf-8"))
os.makedirs(os.path.join(out, "sprites"), exist_ok=True)
START = 90 * 20  # 第 90 張 sprite 起
extra, cells = [], []
for b in boxes:
    d = bd.get(str(b["sid"]))
    if not d or not d.get("s") or b["sid"] in have:
        continue
    e = {"n": (b["zh"] or b["jp"]) + " BOX", "sid": b["sid"], "m": d["s"][0], "c": d["s"][1],
         "kw": " ".join(x for x in [b["zh"], b["jp"], b["set"], "box 原盒"] if x), "mq": b["jp"] + " BOX シュリンク付き"}
    f = os.path.join(hi, "%d.jpg" % b["sid"])
    if os.path.exists(f):
        e["spr"] = START + len(cells)
        cells.append(f)
    if d.get("k"):  # 每日均價：以成交中位數為準，拿掉混到其他規格的日子（跟網站一樣 0.7～1.4 倍）
        a, ref = d["k"], d["s"][0]
        day, pts = a[0], [(a[0], a[1])]
        for i in range(2, len(a) - 1, 2):
            day += a[i]; pts.append((day, a[i + 1]))
        pts = [p for p in pts if ref * 0.7 <= p[1] <= ref * 1.4][-400:]
        if len(pts) >= 3:
            enc = [pts[0][0], pts[0][1]]
            for (d0, _), (d1, v) in zip(pts, pts[1:]):
                enc += [d1 - d0, v]
            kl["d"]["%d~b" % b["sid"]] = enc
    extra.append(e)
for g in range(0, len(cells), 20):
    sheet = Image.new("RGB", (300, 336), (255, 255, 255))
    for i, f in enumerate(cells[g:g + 20]):
        im = Image.open(f).convert("RGB"); im.thumbnail((60, 84), Image.LANCZOS)
        sheet.paste(im, ((i % 5) * 60 + (60 - im.width) // 2, (i // 5) * 84 + (84 - im.height) // 2))
    sheet.save(os.path.join(out, "sprites", "s%02d.jpg" % (90 + g // 20)), quality=86)
json.dump(extra, open(os.path.join(out, "extra.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
json.dump(kl, open(os.path.join(out, "kline.json"), "w", encoding="utf-8"), separators=(",", ":"))
print("extra", len(extra), "sprites", (len(cells) + 19) // 20)
