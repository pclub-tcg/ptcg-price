#!/usr/bin/env python3
"""產生 LINE 圖文選單圖片（2500x1686），噴火龍配色、原創版面：
左邊一塊大的「查卡價」主面板（下方兩個小按鈕：開網站、使用說明），右邊 2x3 的功能方塊。
用法：python3 richmenu.py <輸出 jpg 路徑>
按鈕位置要跟 worker/src/index.js 的 setupRichMenu() 一致（AREAS 會印出來）。"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flame import draw_flame
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 2500, 1686
ORANGE, GOLD, CHAR, CHAR2, EMBER, TEAL, CREAM, WHITE = (255, 138, 43), (255, 182, 39), (42, 28, 23), (58, 38, 32), (200, 52, 27), (31, 158, 148), (255, 240, 224), (255, 255, 255)
FB = "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc"
FM = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
f = lambda s, b=True: ImageFont.truetype(FB if b else FM, s)

im = Image.new("RGB", (W, H), CHAR)
d = ImageDraw.Draw(im)
G = 28  # 間距


def shadowed(box, r, fill, grad=None):
    """圓角方塊＋柔和陰影；grad=(上色, 下色) 時做直向漸層。"""
    x0, y0, x1, y1 = box
    sh = Image.new("L", (W, H), 0)
    ImageDraw.Draw(sh).rounded_rectangle((x0 + 6, y0 + 14, x1 + 6, y1 + 14), r, fill=150)
    sh = sh.filter(ImageFilter.GaussianBlur(16))
    im.paste((10, 6, 4), (0, 0), sh)
    if grad:
        g = Image.new("RGB", (x1 - x0, y1 - y0))
        gd = ImageDraw.Draw(g)
        for y in range(y1 - y0):
            t = y / max(1, y1 - y0 - 1)
            gd.line([(0, y), (x1 - x0, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(*grad)))
        m = Image.new("L", g.size, 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, g.width - 1, g.height - 1), r, fill=255)
        im.paste(g, (x0, y0), m)
    else:
        d.rounded_rectangle(box, r, fill=fill)


# ---------- 左邊主面板 ----------
L = (G, G, 1180, H - G)
shadowed(L, 56, None, grad=((255, 150, 52), (214, 66, 24)))
# 背景火星
for x, y, r in [(150, 170, 12), (1060, 140, 16), (980, 520, 9), (120, 760, 10), (1090, 860, 12)]:
    d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 214, 150))
# 卡片＋火焰
card = Image.new("RGBA", (380, 530), (0, 0, 0, 0)); cd = ImageDraw.Draw(card)
cd.rounded_rectangle([0, 0, 379, 529], 40, fill=(255, 244, 228))
cd.rounded_rectangle([24, 24, 355, 505], 26, fill=CHAR)
draw_flame(cd, 190, 275, 340, ORANGE, GOLD, (255, 240, 200))
card = card.rotate(-9, resample=Image.BICUBIC, expand=True)
P = 60
sh = Image.new("RGBA", (card.width + 2 * P, card.height + 2 * P), (0, 0, 0, 0))
mk = Image.new("L", sh.size, 0); mk.paste(card.split()[3], (P, P))
sh.paste((70, 14, 0, 140), mask=mk); sh = sh.filter(ImageFilter.GaussianBlur(20))
cx, cy = 840, 400
im.paste(sh, (cx - card.width // 2 + 16 - P, cy - card.height // 2 + 22 - P), sh)
im.paste(card, (cx - card.width // 2, cy - card.height // 2), card)
d.text((96, 150), "卡價", font=f(170), fill=CHAR)
d.text((96, 340), "查價", font=f(170), fill=WHITE)
d.text((100, 560), "傳卡號、卡名或照片", font=f(58, False), fill=CHAR)
d.text((100, 640), "馬上看日本成交行情", font=f(58, False), fill=CHAR)
# 假搜尋框
d.rounded_rectangle([96, 790, 1112, 920], 65, fill=WHITE)
d.ellipse([136, 822, 200, 886], outline=CHAR, width=12); d.line([(190, 876), (222, 908)], fill=CHAR, width=16)
d.text((250, 855), "例：SV8 132/106、噴火龍 PSA10", font=f(50, False), fill=(150, 120, 100), anchor="lm")
# 下方兩個小按鈕（在主面板裡）
B1 = (96, 1010, 620, 1580)
B2 = (652, 1010, 1112, 1580)
for b, bg, fg, title, sub in [(B1, CHAR, GOLD, "網站 K 線", "日K・週K・均線"), (B2, (255, 244, 228), CHAR, "使用說明", "指令一次看")]:
    d.rounded_rectangle(b, 44, fill=bg)
    x0, y0, x1, y1 = b
    mx = (x0 + x1) // 2
    if title.startswith("網站"):  # K 線圖示
        for i, (h1, h2, up) in enumerate([(90, 40, 1), (60, 120, 0), (110, 60, 1), (40, 150, 1)]):
            x = mx - 150 + i * 100
            col = GOLD if up else (255, 107, 90)
            d.line([(x, y0 + 110), (x, y0 + 330)], fill=col, width=8)
            d.rounded_rectangle([x - 26, y0 + 110 + h1, x + 26, y0 + 110 + h1 + h2], 6, fill=col)
    else:  # 問號圖示
        d.ellipse([mx - 110, y0 + 110, mx + 110, y0 + 330], outline=CHAR, width=20)
        d.text((mx, y0 + 222), "?", font=f(150), fill=CHAR, anchor="mm")
    d.text((mx, y0 + 410), title, font=f(74), fill=fg, anchor="mm")
    d.text((mx, y0 + 490), sub, font=f(44, False), fill=fg if bg != CHAR else (255, 214, 176), anchor="mm")

# ---------- 右邊 2x3 功能方塊 ----------
RX0, RX1 = 1180 + G, W - G
cw = (RX1 - RX0 - G) // 2
ch = (H - 4 * G) // 3


def ic_cam(cx, cy, c):
    d.rounded_rectangle([cx - 105, cy - 62, cx + 105, cy + 84], 24, outline=c, width=20)
    d.rounded_rectangle([cx - 44, cy - 94, cx + 44, cy - 58], 8, fill=c)
    d.ellipse([cx - 46, cy - 30, cx + 46, cy + 62], outline=c, width=18)


def ic_coin(cx, cy, c):
    d.ellipse([cx - 100, cy - 100, cx + 100, cy + 100], outline=c, width=20)
    d.text((cx, cy + 4), "$", font=f(128), fill=c, anchor="mm")


def ic_up(cx, cy, c):
    d.line([(cx - 110, cy + 70), (cx - 35, cy - 5), (cx + 15, cy + 40), (cx + 100, cy - 50)], fill=c, width=24, joint="curve")
    d.polygon([(cx + 122, cy - 98), (cx + 132, cy - 10), (cx + 52, cy - 82)], fill=c)


def ic_box(cx, cy, c):
    d.polygon([(cx, cy - 100), (cx + 105, cy - 48), (cx + 105, cy + 66), (cx, cy + 118), (cx - 105, cy + 66), (cx - 105, cy - 48)], outline=c, width=18)
    d.line([(cx - 105, cy - 48), (cx, cy + 4), (cx + 105, cy - 48)], fill=c, width=18)
    d.line([(cx, cy + 4), (cx, cy + 118)], fill=c, width=18)


def ic_slab(cx, cy, c):
    d.rounded_rectangle([cx - 78, cy - 108, cx + 78, cy + 108], 18, outline=c, width=18)
    d.rectangle([cx - 78, cy - 108, cx + 78, cy - 52], fill=c)
    d.rounded_rectangle([cx - 46, cy - 26, cx + 46, cy + 76], 8, outline=c, width=12)


def ic_fx(cx, cy, c):
    d.text((cx - 44, cy - 34), "¥", font=f(112), fill=c, anchor="mm")
    d.text((cx + 46, cy + 42), "$", font=f(100), fill=c, anchor="mm")
    d.line([(cx - 96, cy + 74), (cx - 22, cy + 74)], fill=c, width=14)
    d.line([(cx + 22, cy - 74), (cx + 96, cy - 74)], fill=c, width=14)


TILES = [
    ("拍照查價", "拍卡號自動辨識", ic_cam, (255, 244, 228), CHAR),
    ("有賺頭", "台灣價差排行", ic_coin, EMBER, WHITE),
    ("漲最多", "30 天漲幅排行", ic_up, TEAL, WHITE),
    ("原盒行情", "成交價高到低", ic_box, CHAR2, GOLD),
    ("鑑定卡行情", "PSA10 漲跌", ic_slab, CHAR2, GOLD),
    ("匯率試算", "日圓換到手成本", ic_fx, (255, 244, 228), CHAR),
]
areas = [("text:查價", (G, G, 1152, 960)), ("uri:site", B1), ("text:說明", B2)]
for i, (title, sub, ic, bg, fg) in enumerate(TILES):
    col, row = i % 2, i // 2
    x0 = RX0 + col * (cw + G); y0 = G + row * (ch + G)
    box = (x0, y0, x0 + cw, y0 + ch)
    shadowed(box, 44, bg)
    ic(x0 + 150, y0 + 165, fg)  # 圖示在左上，標題與說明在下方
    d.text((x0 + 60, y0 + 355), title, font=f(82 if len(title) <= 4 else 74), fill=fg, anchor="lm")
    d.text((x0 + 62, y0 + 448), sub, font=f(44, False), fill=fg if bg in ((255, 244, 228),) else (255, 226, 200), anchor="lm")
    d.text((x1 := x0 + cw - 60, y0 + 165), "›", font=f(110), fill=fg, anchor="mm")
    areas.append((title, box))

im.save(sys.argv[1], quality=90)
print("AREAS", [(a, (b[0], b[1], b[2] - b[0], b[3] - b[1])) for a, b in areas])
