#!/usr/bin/env python3
"""產生 LINE「市集使用教學」圖（1080 寬，跟使用說明圖同一套配色）。
用法：python3 guide_market.py <輸出資料夾>  → guide_market.jpg（原圖）與 guide_market_s.jpg（預覽圖）"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, M = 1080, 56
ORANGE, GOLD, CHAR, CARD, CREAM, MUTED, INK = (255, 138, 43), (255, 182, 39), (29, 19, 14), (44, 30, 23), (255, 243, 228), (176, 154, 136), (29, 19, 14)
TEAL = (32, 160, 148)
FB = "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc"
FM = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FR = "/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc"
f = lambda s, w=FB: ImageFont.truetype(w, s)

SECTIONS = [
    ("我要賣", ORANGE, INK, [
        ("刊登", "按「＋ 刊登商品」，從卡片目錄選卡會自動帶入卡名和日本行情；上傳最多 4 張實拍照片、填售價，可以選擇接受議價。"),
        ("等買家", "有人直接購買或出價時，LINE 馬上通知你；出價可以接受或婉拒。"),
        ("交易", "成交後雙方會看到對方的聯絡方式，自行面交或寄送。"),
        ("完成", "收款、出貨後按「交易已完成」，買賣雙方互相評價。"),
    ]),
    ("我要買", TEAL, (255, 255, 255), [
        ("直接購買", "按「直接購買」並留聯絡方式，商品就保留給你，24 小時內聯絡賣家。"),
        ("出價議價", "標示「可議價」的商品可以出比售價低的價格，賣家 48 小時內回覆。"),
        ("關注・到貨提醒", "按「☆ 關注」降價時通知；按「到貨提醒」，有人刊登同一張卡就通知你。"),
    ]),
    ("我要收（求卡）", GOLD, INK, [
        ("貼出求卡", "到「求卡」分頁按「＋ 我要收」，選卡並填收購價上限。"),
        ("等人回應", "有人刊登這張卡、價格又在你的收購價內，LINE 自動通知你；賣家也能直接按「我有這張」賣給你。"),
    ]),
]
TIPS = ["每人同時刊登 10 件，免費", "30 天沒更新自動下架，每天可按「更新」排到最新", "不經手金流，請面交或用賣貨便等有保障的方式", "看賣家評價、發現詐騙請按「檢舉」"]


def wrap(d, s, ft, w):
    out, line = [], ""
    for ch in s:
        if d.textlength(line + ch, font=ft) > w and line:
            out.append(line); line = ch
        else:
            line += ch
    if line: out.append(line)
    return out


def render(H, draw=True):
    im = Image.new("RGB", (W, H), CHAR)
    glow = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse((W - 520, -360, W + 360, 420), fill=120)
    gd.ellipse((-420, H - 520, 420, H + 360), fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    im.paste((20, 110, 100), (0, 0), glow)
    d = ImageDraw.Draw(im)
    # 頁首
    fl = f(34)
    a, q, c = d.textlength("P", font=fl), d.textlength("’", font=fl), d.textlength("CLUB", font=fl)
    bw = a + q * 0.55 + c + 44
    d.rounded_rectangle((M, 56, M + bw, 114), 29, fill=ORANGE)
    x = M + 22
    d.text((x, 62), "P", font=fl, fill=INK); d.text((x + a - q * 0.2, 62), "’", font=fl, fill=INK); d.text((x + a + q * 0.55, 62), "CLUB", font=fl, fill=INK)
    # 店面圖示
    cx, cy, w = W - M - 80, 120, 70
    d.polygon([(cx - w - 10, cy - 30), (cx - w + 4, cy - 78), (cx + w - 4, cy - 78), (cx + w + 10, cy - 30)], fill=TEAL)
    for i in range(4):
        xx = cx - w - 10 + i * (2 * w + 20) / 4
        d.pieslice([xx, cy - 50, xx + (2 * w + 20) / 4, cy - 10], 0, 180, fill=TEAL)
    d.rectangle([cx - w + 6, cy - 22, cx + w - 6, cy + 78], outline=TEAL, width=12)
    d.rectangle([cx - 20, cy + 20, cx + 20, cy + 78], fill=TEAL)
    d.text((M, 136), "市集使用教學", font=f(88), fill=CREAM)
    d.text((M, 252), "玩家直接買賣・刊登免費・附日本行情", font=f(32, FM), fill=GOLD)
    # 第 0 步：登入
    y = 320
    d.rounded_rectangle((M, y, W - M, y + 96), 26, fill=(70, 44, 26), outline=ORANGE, width=2)
    d.text((M + 30, y + 48), "先登入", font=f(32), fill=ORANGE, anchor="lm")
    d.text((M + 170, y + 34), "傳「市集」給 P’CLUB，點機器人回的按鈕", font=f(27, FM), fill=CREAM, anchor="lm")
    d.text((M + 170, y + 68), "就會自動登入（跟競標同一個帳號）", font=f(24, FR), fill=MUTED, anchor="lm")
    y += 96 + 36
    fd = f(25, FR)
    for title, col, fg, steps in SECTIONS:
        tw = d.textlength(title, font=f(36)) + 56
        d.rounded_rectangle((M, y, M + tw, y + 60), 30, fill=col)
        d.text((M + 28, y + 30), title, font=f(36), fill=fg, anchor="lm")
        y += 60 + 18
        top = y
        for i, (st, desc) in enumerate(steps):
            lines = wrap(d, desc, fd, W - M * 2 - 150)
            h = 40 + 46 + len(lines) * 36 + 10
            d.rounded_rectangle((M, y, W - M, y + h), 22, fill=CARD, outline=(78, 52, 36), width=2)
            d.ellipse((M + 26, y + 26, M + 82, y + 82), fill=col)
            d.text((M + 54, y + 54), str(i + 1), font=f(30), fill=fg, anchor="mm")
            d.text((M + 104, y + 54), st, font=f(32), fill=CREAM, anchor="lm")
            yy = y + 92
            for ln in lines:
                d.text((M + 104, yy), ln, font=fd, fill=MUTED); yy += 36
            y += h + 12
        y += 24
    # 小提醒
    d.text((M, y), "小提醒", font=f(32), fill=GOLD); y += 54
    for t in TIPS:
        d.ellipse((M + 4, y + 12, M + 18, y + 26), fill=GOLD)
        for k, ln in enumerate(wrap(d, t, f(25, FR), W - M * 2 - 40)):
            d.text((M + 34, y), ln, font=f(25, FR), fill=CREAM); y += 36
        y += 6
    y += 22
    d.rounded_rectangle((M, y, W - M, y + 120), 28, fill=TEAL)
    d.text((M + 34, y + 40), "傳「市集」開始買賣，傳「市集教學」再看這張", font=f(31), fill=(255, 255, 255), anchor="lm")
    d.text((M + 34, y + 86), "網站：pclub-tcg.github.io/ptcg-price/market.html", font=f(24, FM), fill=(214, 245, 240), anchor="lm")
    y += 120 + 40
    d.text((M, y), "市集只提供刊登與聯絡，不經手金流、不保證商品真偽，請自行判斷交易風險。", font=f(19, FR), fill=(128, 108, 92))
    return im, y + 60


_, H = render(4000)
im, _ = render(H)
out = sys.argv[1] if len(sys.argv) > 1 else "."
im.save(os.path.join(out, "guide_market.jpg"), quality=88, optimize=True)
im.resize((540, round(H * 540 / W)), Image.LANCZOS).save(os.path.join(out, "guide_market_s.jpg"), quality=80, optimize=True)
print("guide_market", W, H)
