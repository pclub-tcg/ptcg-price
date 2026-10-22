#!/usr/bin/env python3
"""產生 LINE 官方帳號背景圖片（2:1，1500x750），噴火龍配色。用法：python3 cover.py <輸出 jpg>"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flame import draw_flame
from PIL import Image, ImageDraw, ImageFont, ImageFilter
W, H = 1500, 750
FB = "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc"
FM = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
im = Image.new("RGB", (W, H)); px = im.load()
for y in range(H):  # 背景：左上亮橘 → 右下餘燼紅
    for x in range(W):
        t = min(1, math.hypot(x - W * 0.3, y - H * 0.2) / (W * 0.95))
        px[x, y] = tuple(int(a + (b - a) * t) for a, b in zip((255, 146, 48), (150, 34, 16)))
d = ImageDraw.Draw(im)
for x, y, r in [(120, 110, 10), (1380, 90, 14), (1300, 640, 9), (90, 640, 12), (760, 70, 7), (980, 690, 8), (1440, 360, 6)]:
    d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 214, 140))
# 右側卡片＋火焰（重點放中間附近，避免被頭貼或裁切擋住）
card = Image.new("RGBA", (330, 455), (0, 0, 0, 0)); cd = ImageDraw.Draw(card)
cd.rounded_rectangle([0, 0, 329, 454], 34, fill=(255, 244, 228))
cd.rounded_rectangle([22, 22, 307, 432], 22, fill=(42, 28, 23))
draw_flame(cd, 165, 236, 300, (255, 138, 43), (255, 182, 39), (255, 240, 200))
card = card.rotate(-8, resample=Image.BICUBIC, expand=True)
P = 60
sh = Image.new("RGBA", (card.width + 2 * P, card.height + 2 * P), (0, 0, 0, 0))
m = Image.new("L", sh.size, 0); m.paste(card.split()[3], (P, P))
sh.paste((60, 10, 0, 130), mask=m); sh = sh.filter(ImageFilter.GaussianBlur(18))
cx, cy = 1060, 375
im.paste(sh, (cx - card.width // 2 + 14 - P, cy - card.height // 2 + 18 - P), sh)
im.paste(card, (cx - card.width // 2, cy - card.height // 2), card)
# 文字
d.text((250, 255), "P’CLUB", font=ImageFont.truetype(FB, 112), fill=(42, 28, 23), anchor="lm")
d.text((254, 360), "先查日本行情，再搬回台灣", font=ImageFont.truetype(FM, 46), fill=(255, 244, 228), anchor="lm")
d.rounded_rectangle([250, 420, 760, 500], 40, fill=(42, 28, 23))
d.text((505, 460), "傳卡號・卡名・照片就能查價", font=ImageFont.truetype(FM, 34), fill=(255, 182, 39), anchor="mm")
im.save(sys.argv[1], quality=90)
