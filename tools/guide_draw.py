#!/usr/bin/env python3
"""產生 LINE「抽卡助手教學」圖（1080 寬，跟使用說明圖同一套配色）。
用法：python3 guide_draw.py <輸出資料夾>  → guide_draw.jpg（原圖）與 guide_draw_s.jpg（預覽圖）"""
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

PURPLE = (124, 92, 230)
SECTIONS = [
    ("方法 1：傳截圖（最快）", ORANGE, INK, [
        ("截圖", "在 DOPA、CLOVE、日本卡牌中心抽完，把結果畫面截圖：要看得到卡片和金幣旁邊的回收點數（平台給每張卡的固定數字）。"),
        ("傳給 P’CLUB", "直接把截圖傳到 LINE，機器人會認出卡片、平台和回收點數。"),
        ("看建議", "馬上回一張結果卡片：建議「換點數」還是「出貨回台灣賣」，哪個多拿多少錢"),
    ]),
    ("方法 2：打字", TEAL, (255, 255, 255), [
        ("卡號＋回收點數", "打「卡號 回收點數點」，回收點數照平台畫面上金幣旁的數字填，例如：100/078 PSA10 27000點"),
        ("順便算賺虧", "後面加這抽花多少，例如：100/078 PSA10 27000點 花30000"),
    ]),
    ("看賺虧・存成圖分享", PURPLE, (255, 255, 255), [
        ("按花費按鈕", "結果卡片下方有「花 1,000 點」「花 5,000 點」⋯按鈕，按一下就算出這抽賺還是虧。"),
        ("存成分享圖", "按「存成分享圖」產生結果圖，可以存起來或分享到社團、限動。"),
        ("調整運費", "按「調整運費」到網站改點數比例、轉運運費、台灣賣價折數。"),
    ]),
]
TIPS = ["出貨回台灣賣價＝鞋店成交價 × 85 折 − 轉運運費（每張預設 150 元）", "DOPA、CLOVE 1 點＝1 日圓；點數只能在原平台繼續抽，不等於現金", "DOPA 抽到的卡 3 天內沒處理會自動換成點數，要出貨記得早點決定", "認錯卡時改用打字：卡號 回收點數點", "僅供試算，P’CLUB 和任何抽卡平台都沒有合作或抽成"]


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
    # 卡片圖示
    cx, cy = W - M - 100, 150
    d.rounded_rectangle((cx - 52, cy - 70, cx + 52, cy + 78), 14, outline=PURPLE, width=10)
    d.rounded_rectangle((cx - 22, cy - 92, cx + 82, cy + 56), 14, outline=ORANGE, width=10)
    d.text((M, 136), "抽卡助手教學", font=f(88), fill=CREAM)
    d.text((M, 252), "抽到的卡要換點數還是出貨？傳截圖就知道", font=f(32, FM), fill=GOLD)
    # 第 0 步：登入
    y = 320
    d.rounded_rectangle((M, y, W - M, y + 96), 26, fill=(70, 44, 26), outline=ORANGE, width=2)
    d.text((M + 30, y + 48), "不用登入", font=f(32), fill=ORANGE, anchor="lm")
    d.text((M + 170, y + 34), "加 P’CLUB LINE 好友就能用，完全免費", font=f(27, FM), fill=CREAM, anchor="lm")
    d.text((M + 170, y + 68), "傳「抽卡」可以再看這張教學", font=f(24, FR), fill=MUTED, anchor="lm")
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
    d.rounded_rectangle((M, y, W - M, y + 120), 28, fill=PURPLE)
    d.text((M + 34, y + 40), "抽完卡，截圖傳給 P’CLUB 就對了", font=f(31), fill=(255, 255, 255), anchor="lm")
    d.text((M + 34, y + 86), "網站：pclub-tcg.github.io/ptcg-price/draw.html", font=f(24, FM), fill=(228, 220, 255), anchor="lm")
    y += 120 + 40
    d.text((M, y), "行情來自 P’CLUB 每日更新的成交資料，實際價格以成交為準。", font=f(19, FR), fill=(128, 108, 92))
    return im, y + 60


_, H = render(4000)
im, _ = render(H)
out = sys.argv[1] if len(sys.argv) > 1 else "."
im.save(os.path.join(out, "guide_draw.jpg"), quality=88, optimize=True)
im.resize((540, round(H * 540 / W)), Image.LANCZOS).save(os.path.join(out, "guide_draw_s.jpg"), quality=80, optimize=True)
print("guide_draw", W, H)
