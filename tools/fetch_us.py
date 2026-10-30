#!/usr/bin/env python3
"""在 GitHub Actions 上執行：從 tcgcsv.com（每天同步 TCGplayer）抓美版寶可夢與海賊王的市場價，並累積每日價格。
只收：卡片市場價 ≥ US$5、未拆商品（盒、ETB 等）市場價 ≥ US$20。
輸出 us.json：{"updated", "items": [{id, n 名稱, set, num, r 稀有度, t c卡/s未拆, img, url, v 版本, m 市場價, l 最低價, k: [起始日, 價格(美分), 間隔天數, 價格...]}]}
用法：python3 fetch_us.py <舊 us.json 或空字串> <輸出 us.json>"""
import json, os, sys, time, urllib.request

UA = {"User-Agent": "Mozilla/5.0 ptcg-price (github.com/pclub-tcg/ptcg-price)"}


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.loads(r.read())
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3 + 3 * i)


old = {}
if sys.argv[1] and os.path.exists(sys.argv[1]):
    old = {str(x["id"]): x for x in json.load(open(sys.argv[1]))["items"]}
today = int((time.time() + 8 * 3600) // 86400)
items = []
groups = []
# 3＝寶可夢、68＝海賊王（ONE PIECE CARD GAME）
for cat in (3, 68):
    groups += [dict(g, _cat=cat) for g in get("https://tcgcsv.com/tcgplayer/%d/groups" % cat)["results"]]
for g in groups:
    gid, cat = g["groupId"], g["_cat"]
    try:
        prods = {p["productId"]: p for p in get("https://tcgcsv.com/tcgplayer/%d/%d/products" % (cat, gid))["results"]}
        prices = get("https://tcgcsv.com/tcgplayer/%d/%d/prices" % (cat, gid))["results"]
    except Exception as e:
        print("fail group", gid, e)
        continue
    best = {}
    for pr in prices:
        m = pr.get("marketPrice") or pr.get("midPrice")
        if not m:
            continue
        if pr["productId"] not in best or m > best[pr["productId"]][0]:
            best[pr["productId"]] = (m, pr.get("lowPrice"), pr.get("subTypeName") or "")
    for pid, (m, low, sub) in best.items():
        p = prods.get(pid)
        if not p:
            continue
        ext = {e["name"]: e["value"] for e in p.get("extendedData", [])}
        card = "Number" in ext
        if (card and m < 5) or (not card and m < 20):
            continue
        it = {"id": pid, "n": p.get("name", ""), "set": g["name"], "num": ext.get("Number", ""), "r": ext.get("Rarity", ""),
              "t": "c" if card else "s", "img": (p.get("imageUrl") or "").replace("_200w.jpg", "_400w.jpg"),
              "url": p.get("url", ""), "v": sub, "m": round(m, 2), "l": round(low, 2) if low else None, **({"ip": "op"} if cat == 68 else {})}
        # 累積每日價格（美分）
        pts = []
        o = old.get(str(pid))
        if o and o.get("k"):
            a = o["k"]; d = a[0]; pts = [(a[0], a[1])]
            for i in range(2, len(a) - 1, 2):
                d += a[i]; pts.append((d, a[i + 1]))
        pts = [x for x in pts if x[0] != today and x[0] > today - 400] + [(today, round(m * 100))]
        k = [pts[0][0], pts[0][1]]
        for (d0, _), (d1, v) in zip(pts, pts[1:]):
            k += [d1 - d0, v]
        it["k"] = k
        items.append(it)
    time.sleep(0.2)
usd = None  # 美元換台幣（open.er-api.com，每天更新）
try:
    usd = round(get("https://open.er-api.com/v6/latest/USD")["rates"]["TWD"], 3)
except Exception as e:
    print("fx fail", e)
json.dump({"updated": time.strftime("%Y-%m-%d %H:%M", time.gmtime(time.time() + 8 * 3600)), "usd_twd": usd, "items": items},
          open(sys.argv[2], "w"), ensure_ascii=False, separators=(",", ":"))
print("groups", len(groups), "items", len(items), "cards", sum(1 for i in items if i["t"] == "c"), "sealed", sum(1 for i in items if i["t"] == "s"))
