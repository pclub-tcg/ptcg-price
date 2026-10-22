#!/usr/bin/env python3
"""在 GitHub Actions 上執行：抓朱紫、MEGA、劍盾、太陽月亮系列與特典卡的高稀有度日版卡的 SNKRDUNK 成交（裸卡 A 級、PSA10）與每日均價。
輸出 jp.json：{"updated": ..., "cards": [{sid, b 卡名, r 稀有度, set, num, pk 擴充包, img, a: {s:[中位,筆數], k:[...]}, p: {...}}]}
用法：python3 fetch_jp.py <輸出 jp.json>"""
import json, re, statistics, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

SETS = ["SV1S", "SV1V", "SV1a", "SV2P", "SV2D", "SV2a", "SV3", "SV3a", "SV4K", "SV4M", "SV4a", "SV5K", "SV5M", "SV5a",
        "SV6", "SV6a", "SV7", "SV7a", "SV8", "SV8a", "SV9", "SV9a", "SV10", "SV11B", "SV11W",
        "M1L", "M1S", "M2", "M2a", "M3", "M4", "M5", "M6", "M6a",
        # 劍盾
        "S1W", "S1H", "S1a", "S2", "S2a", "S3", "S3a", "S4", "S4a", "S5I", "S5R", "S5a", "S6H", "S6K", "S6a", "S7D", "S7R",
        "S8", "S8a", "S8b", "S9", "S9a", "S10D", "S10P", "S10a", "S10b", "S11", "S11a", "S12", "S12a",
        # 太陽月亮
        "SM1S", "SM1M", "SM1+", "SM2K", "SM2L", "SM2+", "SM3H", "SM3N", "SM3+", "SM4S", "SM4A", "SM4+", "SM5S", "SM5M", "SM5+",
        "SM6", "SM6a", "SM6b", "SM7", "SM7a", "SM7b", "SM8", "SM8a", "SM8b", "SM9", "SM9a", "SM9b", "SM10", "SM10a", "SM10b",
        "SM11", "SM11a", "SM11b", "SM12", "SM12a",
        # 特典卡
        "S-P", "SV-P", "SM-P", "M-P"]
RARE = {"SAR", "SR", "AR", "UR", "HR", "MUR", "MA", "CHR", "CSR", "SSR", "ACE", "BWR", "S", "K", "RRR", "PR", "TR", "P"}
SETS_U = {x.upper() for x in SETS}
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "Accept": "*/*"}
# 一般卡「[SV8 132/106]」、特典卡「[S-P 143]」「[SV-P 291]」
TITLE = re.compile(r"^(.*?)\s+([A-Z]{1,4})\s+\[([A-Za-z0-9+-]+)\s+(\d{1,3}(?:/[\w-]{1,6})?)\]\s*\((.*?)\)")


def get(url, js=True, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                b = r.read()
                return json.loads(b) if js else b.decode("utf-8", "replace")
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(2 + i * 3)


# 1. 從搜尋頁收集商品 id
ids = set()
for st in SETS:
    seen_empty = 0
    for pg in range(1, 61):
        try:
            h = get("https://snkrdunk.com/search?keywords=%s&page=%d" % (urllib.parse.quote("[%s " % st), pg), js=False)
        except Exception as e:
            print("search fail", st, pg, e); break
        found = set(re.findall(r"/apparels/(\d+)", h))
        new = found - ids
        ids |= found
        seen_empty = seen_empty + 1 if not new else 0
        if not found or seen_empty >= 2:
            break
        time.sleep(0.3)
print("candidate ids", len(ids))


def hist(pid, cond):
    q = "&condition_code=" + cond
    h = get("https://snkrdunk.com/v3/products/%s/trading-history?range=all%s" % (pid, q))
    trades = [t["price"] for t in h.get("trades", []) if "1枚" in (str(t.get("title", "")) + str(t.get("label", ""))) and t.get("price")][:8]
    pts = {}
    for line in (h.get("chart") or {}).get("lines", [])[:1]:
        for p in line.get("points", []):
            ts = p["timestamp"]; ts = ts if ts > 1e11 else ts * 1000
            pts[int((ts + 9 * 3600 * 1000) // 86400000)] = round(p["price"])
    r = {}
    if trades:
        r["s"] = [round(statistics.median(trades)), len(trades)]
    if pts:
        ds = sorted(pts)[-400:]
        k = [ds[0], pts[ds[0]]]
        for a, c in zip(ds, ds[1:]):
            k += [c - a, pts[c]]
        r["k"] = k
    return r


def one(sid):
    try:
        a = get("https://snkrdunk.com/v1/apparels/%s" % sid)
        m = TITLE.match(a.get("localizedName") or "")
        if not m or m.group(2) not in RARE or m.group(3).upper() not in SETS_U:
            return None
        c = {"sid": int(sid), "b": m.group(1).strip(), "r": m.group(2), "set": m.group(3), "num": m.group(4), "pk": m.group(5),
             "en": (a.get("name") or "").split(" [")[0], "img": ((a.get("primaryMedia") or {}).get("imageUrl")) or ""}
        pid = a["productCatalogId"]
        c["a"] = hist(pid, "trading_card_single_nearly_unused")
        c["p"] = hist(pid, "trading_card_single_psa10")
        time.sleep(0.2)
        return c
    except Exception as e:
        print("fail", sid, e)
        return None


with ThreadPoolExecutor(4) as ex:
    cards = [c for c in ex.map(one, sorted(ids)) if c]
json.dump({"updated": time.strftime("%Y-%m-%d %H:%M", time.gmtime(time.time() + 8 * 3600)), "cards": cards},
          open(sys.argv[1], "w"), ensure_ascii=False, separators=(",", ":"))
print("cards", len(cards), "with A", sum(1 for c in cards if c["a"].get("s")), "with PSA10", sum(1 for c in cards if c["p"].get("s")))
