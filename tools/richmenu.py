#!/usr/bin/env python3
"""產生 LINE 圖文選單圖片（2500x1686），噴火龍配色，版面參考皮卡屋：上方分頁列、中間大橫幅＋兩個小方塊、下方六個功能鍵。
用法：python3 richmenu.py <輸出 jpg 路徑>"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flame import draw_flame
from PIL import Image, ImageDraw, ImageFont

W, H = 2500, 1686
# 噴火龍配色：火焰橘、火焰金、炭黑、餘燼紅、翅膀青綠
Y, GOLD, NAVY, EMBER, TEAL, WHITE, INK = (255, 138, 43), (255, 182, 39), (42, 28, 23), (200, 52, 27), (31, 158, 148), (255, 255, 255), (42, 28, 23)
FB = "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc"
FM = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
f = lambda s, b=True: ImageFont.truetype(FB if b else FM, s)
im = Image.new("RGB", (W, H), (255, 240, 224))
d = ImageDraw.Draw(im)

# 1. 分頁列 0..170
d.polygon([(0, 0), (1240, 0), (1150, 170), (0, 170)], fill=Y)
d.text((580, 85), "主選單", font=f(84), fill=INK, anchor="mm")
d.text((1720, 85), "卡價套利王", font=f(76), fill=INK, anchor="mm")
d.rounded_rectangle([2040, 42, 2440, 128], 18, fill=EMBER)
d.text((2240, 85), "@916ctmro", font=f(52, False), fill=WHITE, anchor="mm")


# 2. 大橫幅 200..1000 x 30..1640（點了開網站）
d.rounded_rectangle([30, 200, 1640, 1000], 44, fill=NAVY)
for i, (x, y, r) in enumerate([(1450, 330, 70), (1560, 820, 44), (1250, 900, 30), (980, 280, 26)]):
    d.ellipse([x - r, y - r, x + r, y + r], outline=(84, 56, 42), width=10)
d.rounded_rectangle([1210, 360, 1490, 760], 26, outline=Y, width=16)  # 卡片外框
draw_flame(d, 1350, 560, 300, Y, GOLD, (255, 240, 200))
d.text((110, 300), "先查日本行情", font=f(132), fill=GOLD)
d.text((110, 470), "再決定搬不搬回台灣", font=f(104), fill=WHITE)
d.text((110, 640), "Mercari・SNKRDUNK 成交價 × 台灣社團價", font=f(52, False), fill=(230, 200, 175))
d.rounded_rectangle([110, 800, 760, 920], 60, fill=Y)
d.text((435, 860), "開啟網站看 K 線  ›", font=f(56), fill=INK, anchor="mm")

# 3. 右側兩個方塊
def tile_big(box, bg, title, sub, icon):
    d.rounded_rectangle(box, 44, fill=bg)
    x0, y0, x1, y1 = box
    d.text((x0 + 60, y0 + 60), title, font=f(96), fill=WHITE)
    d.text((x0 + 60, y0 + 200), sub, font=f(50, False), fill=(255, 240, 240))
    icon(x1 - 170, (y0 + y1) // 2 + 20)


def up_arrow(cx, cy):
    d.line([(cx - 110, cy + 70), (cx - 30, cy - 10), (cx + 20, cy + 40), (cx + 110, cy - 60)], fill=WHITE, width=26, joint="curve")
    d.polygon([(cx + 120, cy - 110), (cx + 130, cy - 20), (cx + 50, cy - 90)], fill=WHITE)


def coin(cx, cy):
    d.ellipse([cx - 100, cy - 100, cx + 100, cy + 100], outline=WHITE, width=22)
    d.text((cx, cy), "$", font=f(130), fill=WHITE, anchor="mm")


tile_big((1680, 200, 2470, 585), EMBER, "有賺頭", "台灣價差排行", coin)
tile_big((1680, 615, 2470, 1000), TEAL, "漲最多", "30 天漲幅排行", up_arrow)

# 4. 下方六個功能鍵 1040..1656
labels = ["使用說明", "拍照查價", "卡片搜尋", "原盒行情", "鑑定卡行情", "匯率試算"]
tw = (W - 60 - 5 * 24) / 6


def ic_info(cx, cy, c):
    d.ellipse([cx - 80, cy - 80, cx + 80, cy + 80], outline=c, width=20)
    d.text((cx, cy + 4), "i", font=f(110), fill=c, anchor="mm")


def ic_cam(cx, cy, c):
    d.rounded_rectangle([cx - 100, cy - 60, cx + 100, cy + 80], 22, outline=c, width=20)
    d.rectangle([cx - 40, cy - 90, cx + 40, cy - 60], fill=c)
    d.ellipse([cx - 45, cy - 30, cx + 45, cy + 60], outline=c, width=18)


def ic_search(cx, cy, c):
    d.ellipse([cx - 85, cy - 85, cx + 45, cy + 45], outline=c, width=24)
    d.line([(cx + 30, cy + 30), (cx + 95, cy + 95)], fill=c, width=34)


def ic_box(cx, cy, c):
    d.polygon([(cx, cy - 95), (cx + 100, cy - 45), (cx + 100, cy + 65), (cx, cy + 115), (cx - 100, cy + 65), (cx - 100, cy - 45)], outline=c, width=18)
    d.line([(cx - 100, cy - 45), (cx, cy + 5), (cx + 100, cy - 45)], fill=c, width=18)
    d.line([(cx, cy + 5), (cx, cy + 115)], fill=c, width=18)


def ic_slab(cx, cy, c):
    d.rounded_rectangle([cx - 75, cy - 105, cx + 75, cy + 105], 18, outline=c, width=18)
    d.rectangle([cx - 75, cy - 105, cx + 75, cy - 50], fill=c)
    d.rounded_rectangle([cx - 45, cy - 25, cx + 45, cy + 75], 8, outline=c, width=12)


def ic_fx(cx, cy, c):
    d.text((cx - 40, cy - 30), "¥", font=f(110), fill=c, anchor="mm")
    d.text((cx + 45, cy + 40), "$", font=f(100), fill=c, anchor="mm")
    d.line([(cx - 90, cy + 70), (cx - 20, cy + 70)], fill=c, width=14)
    d.line([(cx + 20, cy - 70), (cx + 90, cy - 70)], fill=c, width=14)


icons = [ic_info, ic_cam, ic_search, ic_box, ic_slab, ic_fx]
for i, (lab, ic) in enumerate(zip(labels, icons)):
    x0 = 30 + i * (tw + 24)
    hot = i == 2
    d.rounded_rectangle([x0, 1040, x0 + tw, 1656], 40, fill=Y if hot else WHITE)
    cx = x0 + tw / 2
    ic(cx, 1260, INK)
    d.text((cx, 1530), lab, font=f(68), fill=INK, anchor="mm")

im.save(sys.argv[1], quality=88)
print("areas", [(round(30 + i * (tw + 24)), round(tw)) for i in range(6)])
