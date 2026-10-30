#!/usr/bin/env python3
"""抓 TCG Japan（store.tcg-japan.com）的日版海賊王單卡：繁中卡名、台幣售價、庫存、商品圖。
普通卡（C／UC／R／L 一般版）不要；異圖（/P）、SP、SEC、TR、PSA10 照收；原盒不收（原盒另外由 SNKRDUNK 抓）。
輸出 {"updated", "items": [{u 商品 uuid, n 名稱, r 稀有度, code 卡號, rs 再版系列, psa, img, p 台幣售價, q 庫存}]}
用法：python3 fetch_tcgj_op.py <輸出 json>（抓不到就結束碼 1，publish.sh 會沿用 tools/tcgj_op.json）"""
import json, re, sys, time, urllib.request

API = ("https://api.store.tcg-japan.com/api/v1/bff/storefront-card-list-page/search?langSlug=zh_hant&currencyCode=TWD"
       "&listType=all&limit=100&cursor=%d&sort=StorefrontPriceAsc&ecBrandSlug=onepiece")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      "Accept": "application/json", "Origin": "https://store.tcg-japan.com", "Referer": "https://store.tcg-japan.com/"}
NAME = re.compile(r"^(.*?)【([^】]+)】\{((?:OP|EB|ST|PRB)\d{2}-\d{3}|P-\d{3})(?:\[([A-Z]+\d{2})\])?\}\s*(_PSA10)?\s*$")
COMMON = {"C", "UC", "R", "L"}


def get(url):
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.loads(r.read())
        except Exception:
            if i == 3:
                raise
            time.sleep(3 * (i + 1))


hits = []
for cur in range(0, 5000, 100):
    h = get(API % cur)["result"]["hits"]
    hits += h
    if len(h) < 100:
        break
items, skipped = [], 0
for h in hits:
    if h.get("isBox"):
        continue
    m = NAME.match(h.get("name") or "")
    if not m:
        skipped += 1
        continue
    r = m.group(2)
    if r in COMMON:  # 一般版
        skipped += 1
        continue
    items.append({"u": h["uuid"], "n": m.group(1).strip(), "r": r, "code": m.group(3), "rs": m.group(4) or "", "psa": 1 if m.group(5) else 0,
                  "img": h.get("mainImageUrl") or "", "p": round((h.get("storefrontPrice") or {}).get("value") or 0), "q": h.get("stockQuantity") or 0})
if not items:
    sys.exit("no items")
json.dump({"updated": time.strftime("%Y-%m-%d %H:%M", time.gmtime(time.time() + 8 * 3600)), "items": items},
          open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("tcg japan one piece", len(items), "skipped", skipped)
