#!/usr/bin/env python3
"""產生 LINE 加好友時傳送的「使用說明」介紹圖（1080 寬，噴火龍配色）。
用法：python3 guide.py <輸出資料夾>  → 產生 guide.jpg（原圖）與 guide_s.jpg（預覽圖）"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flame import draw_flame
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W = 1080
ORANGE, GOLD, CHAR, CARD, CREAM, MUTED, INK = (255, 138, 43), (255, 182, 39), (29, 19, 14), (44, 30, 23), (255, 243, 228), (176, 154, 136), (29, 19, 14)
FB = "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc"
FM = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FR = "/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc"
f = lambda s, w=FB: ImageFont.truetype(w, s)

FEAT = [
    ("查卡價", "傳卡號、卡名或系列，馬上看日本成交價和台灣價", "201/165、噴火龍 PSA10"),
    ("拍照查價", "拍下卡片或選相簿照片，自動辨識是哪一張", "點下方「拍照查價」"),
    ("競標市場", "玩家間競標，出價、上架自己的卡，結標 LINE 通知", "競標"),
    ("漲最多", "SNKRDUNK 近 30 天漲幅排行，看市場熱度", "漲最多"),
    ("原盒・鑑定卡", "原盒行情、PSA10 鑑定卡近期漲跌", "原盒、鑑定卡"),
    ("玩家市集", "刊登要賣的卡，買家直接購買或出價議價", "市集"),
    ("看 K 線走勢", "點卡片上的「看 K 線」，日 K／週 K 一目了然", "點卡片按鈕"),
    ("庫存・賣卡出圖", "記成本算損益，一鍵產生出售清單圖", "我的庫存"),
]

M, G, CW = 56, 24, (W - 56 * 2 - 24) // 2
CH = 250
HEAD = 360
rows = (len(FEAT) + 1) // 2
H = HEAD + rows * (CH + G) + 230

im = Image.new("RGB", (W, H), CHAR)
# 背景火光
glow = Image.new("L", (W, H), 0)
gd = ImageDraw.Draw(glow)
gd.ellipse((W - 520, -360, W + 360, 420), fill=120)
gd.ellipse((-420, H - 520, 420, H + 360), fill=90)
glow = glow.filter(ImageFilter.GaussianBlur(120))
im.paste((150, 62, 18), (0, 0), glow)
d = ImageDraw.Draw(im)


def text_w(s, ft):
    return d.textlength(s, font=ft)


def wrap(s, ft, w):
    out, line = [], ""
    for ch in s:
        if text_w(line + ch, ft) > w and line:
            out.append(line); line = ch
        else:
            line += ch
    if line: out.append(line)
    return out


# 頁首：logo 徽章＋火焰＋標題
fl = f(34)
a, q, c = text_w("P", fl), text_w("’", fl), text_w("CLUB", fl)
bw = a + q * 0.55 + c + 44
d.rounded_rectangle((M, 56, M + bw, 56 + 58), 29, fill=ORANGE)
x = M + 22
d.text((x, 56 + 6), "P", font=fl, fill=INK)
d.text((x + a - q * 0.2, 56 + 6), "’", font=fl, fill=INK)
d.text((x + a + q * 0.55, 56 + 6), "CLUB", font=fl, fill=INK)
draw_flame(d, W - M - 70, 150, 150, ORANGE, GOLD, (255, 240, 200))
d.text((M, 136), "使用說明", font=f(96), fill=CREAM)
d.text((M, 262), "日本成交價 × 台灣社團價・每日更新", font=f(32, FM), fill=GOLD)
d.text((M, 306), "直接在聊天室打字或點下方選單就能用", font=f(26, FR), fill=MUTED)

# 功能卡片
for i, (t, desc, ex) in enumerate(FEAT):
    col, row = i % 2, i // 2
    x0, y0 = M + col * (CW + G), HEAD + row * (CH + G)
    d.rounded_rectangle((x0, y0, x0 + CW, y0 + CH), 26, fill=CARD, outline=(78, 52, 36), width=2)
    # 編號圓
    d.ellipse((x0 + 24, y0 + 24, x0 + 24 + 56, y0 + 24 + 56), fill=ORANGE)
    n = str(i + 1)
    fn = f(32)
    d.text((x0 + 52 - text_w(n, fn) / 2, y0 + 52), n, font=fn, fill=INK, anchor="lm")
    d.text((x0 + 96, y0 + 52), t, font=f(36), fill=CREAM, anchor="lm")
    yy = y0 + 100
    for ln in wrap(desc, f(24, FR), CW - 48)[:2]:
        d.text((x0 + 24, yy), ln, font=f(24, FR), fill=MUTED); yy += 34
    # 範例膠囊
    lab = "傳" if not ex.startswith("點") else ""
    fe = f(24, FM)
    exs = ex if ex.startswith("點") else ex
    py = y0 + CH - 24 - 48
    tw = min(CW - 48, text_w(exs, fe) + (text_w("傳", fe) + 30 if lab else 0) + 36)
    d.rounded_rectangle((x0 + 24, py, x0 + 24 + tw, py + 48), 24, fill=(70, 44, 26), outline=ORANGE, width=2)
    xx = x0 + 42
    if lab:
        d.text((xx, py + 24), "傳", font=fe, fill=ORANGE, anchor="lm"); xx += text_w("傳", fe) + 12
        d.line((xx - 6, py + 12, xx - 6, py + 36), fill=(140, 88, 50), width=2); xx += 6
    d.text((xx, py + 24), exs, font=fe, fill=CREAM, anchor="lm")

# 頁尾
fy = HEAD + rows * (CH + G) + 10
d.rounded_rectangle((M, fy, W - M, fy + 120), 28, fill=ORANGE)
d.text((M + 34, fy + 38), "傳「說明」隨時再看這張圖", font=f(34), fill=INK, anchor="lm")
d.text((M + 34, fy + 84), "網站：pclub-tcg.github.io/ptcg-price", font=f(24, FM), fill=(70, 40, 20), anchor="lm")
d.text((M, H - 58), "價格取自各平台公開資訊，僅供參考；本服務與寶可夢公司、任天堂、SNKRDUNK、Mercari 無關。", font=f(19, FR), fill=(128, 108, 92))

out = sys.argv[1] if len(sys.argv) > 1 else "."
im.save(os.path.join(out, "guide.jpg"), quality=88, optimize=True)
s = im.resize((540, round(H * 540 / W)), Image.LANCZOS)
s.save(os.path.join(out, "guide_s.jpg"), quality=80, optimize=True)
print("guide", W, H)
