#!/usr/bin/env python3
"""在 GitHub Actions 上執行：抓 tools/boxes.json 裡原盒、以及在 SNKRDUNK 搜到的其他日版寶可夢原盒的最近成交與每日均價。
輸出 boxdata.json：{"boxes": {sid: {"s": [中位數, 筆數], "k": [...]}}, "found": [{sid, jp 名稱, t 完整標題}]}
用法：python3 fetch_boxes.py tools/boxes.json <輸出 json>"""
import json, re, statistics, sys, time, urllib.parse, urllib.request

boxes, out = json.load(open(sys.argv[1])), sys.argv[2]
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "Accept": "application/json"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return json.loads(r.read())


# 自動找其他原盒：搜尋「BOX」相關關鍵字，只收日版寶可夢卡的原盒（排除英文／中文／韓文版、整箱、空盒、沒有收縮膜）
known = {b["sid"] for b in boxes}
found = []
seen = set()
BAD = ("英語版", "中国語版", "韓国語版", "カートン", "空箱", "シュリンクなし", "ケース", "スリーブ", "デッキシールド", "プレイマット", "ファイル", "切手", "ポケモンセンター", "未開封パック")
import os
_D = os.path.dirname(os.path.abspath(__file__))
names = set()
for f in ("setnames_tw.json", "setnames.json"):  # 已知的日版擴充包名稱，逐一搜「名稱 BOX」
    if os.path.exists(os.path.join(_D, f)):
        d = json.load(open(os.path.join(_D, f), encoding="utf-8"))
        names |= set(d.get("ja", d) if f == "setnames.json" else d)
KWS = sorted(n + " BOX" for n in names if n and len(n) > 1) + ["拡張パック BOX", "強化拡張パック BOX", "ハイクラスパック BOX", "BOX シュリンク付き"]
for kw in KWS:
    for pg in range(1, 4):
        try:
            with urllib.request.urlopen(urllib.request.Request("https://snkrdunk.com/search?keywords=%s&page=%d" % (urllib.parse.quote(kw), pg), headers=UA), timeout=30) as r:
                h = r.read().decode("utf-8", "replace")
        except Exception as e:
            print("search fail", kw, pg, e); break
        ids = set(int(x) for x in re.findall(r"/apparels/(\d+)", h)) - seen
        if not ids:
            break
        seen |= ids
        time.sleep(0.3)
for sid in sorted(seen - known):
    try:
        t = get("https://snkrdunk.com/v1/apparels/%d" % sid).get("localizedName") or ""
    except Exception:
        continue
    if "BOX" not in t.upper() or "ポケモン" not in t or not any(x in t for x in ("パック", "セット", "デッキ")) or any(x in t for x in BAD):
        continue
    m = re.search(r"[「『](.+?)[」』]", t)
    found.append({"sid": sid, "jp": (m.group(1) if m else re.sub(r"ポケモンカードゲーム|BOX.*", "", t)).strip(), "t": t})
    time.sleep(0.2)
print("found boxes", len(found))

res, fail = {}, 0
for b in boxes + found:
    sid = b["sid"]
    try:
        pid = get("https://snkrdunk.com/v1/apparels/%d" % sid)["productCatalogId"]
        h = get("https://snkrdunk.com/v3/products/%s/trading-history?range=all" % pid)
        trades = [t["price"] for t in h.get("trades", []) if str(t.get("title", "1個")).startswith("1個") and t.get("price")]
        r = {}
        if trades:
            r["s"] = [round(statistics.median(trades[:8])), len(trades[:8])]
        pts = {}
        for line in (h.get("chart") or {}).get("lines", [])[:1]:
            for p in line.get("points", []):
                ts = p["timestamp"]
                ts = ts if ts > 1e11 else ts * 1000
                pts[int((ts + 9 * 3600 * 1000) // 86400000)] = round(p["price"])
        if pts:
            ds = sorted(pts)
            k = [ds[0], pts[ds[0]]]
            for a, c in zip(ds, ds[1:]):
                k += [c - a, pts[c]]
            r["k"] = k
        if r:
            res[str(sid)] = r
    except Exception as e:
        print("fail", sid, e)
        fail += 1
    time.sleep(0.4)
json.dump({"updated": time.strftime("%Y-%m-%d %H:%M", time.gmtime(time.time() + 8 * 3600)), "boxes": res,
           "found": [f for f in found if str(f["sid"]) in res]}, open(out, "w"), ensure_ascii=False, separators=(",", ":"))
print("ok", len(res), "fail", fail)
