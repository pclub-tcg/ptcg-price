#!/usr/bin/env python3
"""產生卡牌圖鑑資料 dex.json（圖鑑／卡冊頁 dex.html 用）。
來源：日版卡目錄 jp.json（SNKRDUNK 成交，publish.sh 用 JP_DATA 傳進來）、網站已有的大圖清單 hi.json、bot.json 的匯率。
輸出：{"u": 更新時間, "rate": 日圓匯率, "sets": [{"c": 系列代號, "z": 中文名, "j": 日文名, "cards": [[sid, 卡號, 稀有度, 卡名, 裸卡中位¥, PSA10中位¥, 圖]]}]}
圖：1＝網站 hi/<sid>.jpg，否則放 SNKRDUNK 圖片網址。
用法：JP_DATA=jp.json python3 dex.py <網站輸出資料夾>"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from zhname import ja2zh
except Exception:
    ja2zh = lambda s: ""

out = sys.argv[1]
jp_path = os.environ.get("JP_DATA")
if not jp_path or not os.path.exists(jp_path):
    print("dex: 沒有 jp.json，略過"); sys.exit(0)
jp = json.load(open(jp_path, encoding="utf-8"))
TW = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "setnames_tw.json"), encoding="utf-8"))
try:
    HI = set(json.load(open(os.path.join(out, "hi.json"))))
except Exception:
    HI = set()
try:
    bot = json.load(open(os.path.join(out, "data", "bot.json"), encoding="utf-8"))
    rate, upd = bot.get("rate"), bot.get("updated")
except Exception:
    rate, upd = None, jp.get("updated")


def set_zh(pk):
    m = re.search(r"「(.+?)」", pk or "")
    inner = m.group(1) if m else (pk or "")
    if inner in TW:
        return TW[inner], inner
    for k, v in TW.items():  # 「ポケモンカード151」→ 151 這類部分相符
        if k and k in inner and len(k) >= len(inner) * 0.6:  # 「プレミアムデッキセット」這種加長名不算
            return v, inner
    return "", inner


def num_key(n):
    m = re.match(r"(\d+)", str(n or ""))
    return (0, int(m.group(1)), str(n)) if m else (1, 0, str(n))


sets = {}
for c in jp.get("cards", []):
    code, num = c.get("set") or "", c.get("num") or ""
    if not code or not num:
        continue
    s = sets.setdefault(code, {"c": code, "pk": {}, "cards": [], "ids": []})
    s["pk"][c.get("pk", "")] = s["pk"].get(c.get("pk", ""), 0) + 1
    s["ids"].append(c.get("sid") or 0)
    name = c.get("b") or ""
    zh = ja2zh(name) or ""
    if c.get("v"):
        name += "（%s）" % c["v"]
        zh = (zh + "（%s）" % c["v"]) if zh else ""
    a, p = (c.get("a") or {}).get("s") or [None, 0], (c.get("p") or {}).get("s") or [None, 0]
    sid = c.get("sid")
    img = 1 if sid in HI else (c.get("img") or "")
    s["cards"].append([sid, num, c.get("r") or "", zh or name, a[0], p[0], img])

res = []
for code, s in sets.items():
    pk = max(s["pk"], key=s["pk"].get) if s["pk"] else ""
    z, j = set_zh(pk)
    cards = sorted(s["cards"], key=lambda x: num_key(x[1]))
    ids = sorted(s["ids"]); res.append({"c": code, "z": z, "j": j, "mx": ids[len(ids) // 2], "cards": cards})
res.sort(key=lambda s: -s["mx"])  # 新的系列在前（SNKRDUNK 商品編號越大越新；用中位數，舊系列後來補上架的卡不會把它排到前面）
for s in res:
    s.pop("mx")
json.dump({"u": upd, "rate": rate, "sets": res}, open(os.path.join(out, "dex.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("dex sets", len(res), "cards", sum(len(s["cards"]) for s in res), "bytes", os.path.getsize(os.path.join(out, "dex.json")))
