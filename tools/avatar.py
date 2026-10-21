#!/usr/bin/env python3
"""產生 LINE 官方帳號頭貼（1024x1024，原創火焰卡片圖案，噴火龍配色）。用法：python3 avatar.py <輸出 png>"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flame import draw_flame
from PIL import Image, ImageDraw, ImageFilter
S = 1024 * 2
im = Image.new("RGB", (S, S), (42, 28, 23))
# 背景：中心亮橘往外變餘燼紅
bg = Image.new("RGB", (S, S)); px = bg.load()
for y in range(0, S, 4):
    for x in range(0, S, 4):
        r = math.hypot(x - S / 2, y - S * 0.42) / (S * 0.75)
        c = tuple(int(a + (b - a) * min(1, r)) for a, b in zip((255, 150, 50), (176, 40, 20)))
        for dy in range(4):
            for dx in range(4):
                px[x + dx, y + dy] = c
im = bg
d = ImageDraw.Draw(im)
# 火星點點
for x, y, r in [(330, 360, 22), (1700, 520, 30), (1600, 1650, 18), (420, 1500, 26), (1500, 300, 14), (260, 980, 12)]:
    d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 210, 120))
# 卡片（白框、炭黑面、微傾斜）
card = Image.new("RGBA", (900, 1240), (0, 0, 0, 0)); cd = ImageDraw.Draw(card)
cd.rounded_rectangle([0, 0, 899, 1239], 90, fill=(255, 244, 228))
cd.rounded_rectangle([60, 60, 839, 1179], 60, fill=(42, 28, 23))
draw_flame(cd, 450, 640, 820, (255, 138, 43), (255, 182, 39), (255, 240, 200))
card = card.rotate(-8, resample=Image.BICUBIC, expand=True)
P = 120
sh = Image.new("RGBA", (card.width + 2 * P, card.height + 2 * P), (0, 0, 0, 0))
m = Image.new("L", sh.size, 0); m.paste(card.split()[3], (P, P))
sh.paste((60, 10, 0, 140), mask=m); sh = sh.filter(ImageFilter.GaussianBlur(30))
ox, oy = (S - card.width) // 2, (S - card.height) // 2 + 40
im.paste(sh, (ox + 30 - P, oy + 40 - P), sh); im.paste(card, (ox, oy), card)
im.resize((1024, 1024), Image.LANCZOS).save(sys.argv[1])
