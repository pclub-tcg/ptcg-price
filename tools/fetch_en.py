#!/usr/bin/env python3
"""在 GitHub Actions 上執行：抓 SNKRDUNK 美版（英文版）卡的 PSA10 與裸卡成交、每日均價。
SNKRDUNK 標題像「リザードンex SIR [MEW EN 199/165]【英語版】(…)」，系列代號用 TCGplayer（tcgcsv）的 abbreviation 去搜。
輸出 en.json：{"updated", "sets": {代號: TCGplayer 系列名}, "cards": [{sid, b 日文名, en 英文名, r, set 代號, num, p:{s,k}, a:{s,k}}]}
用法：python3 fetch_en.py <輸出 en.json>"""
import json, re, statistics, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "Accept": "*/*"}
TITLE = re.compile(r"^(.*?)\s+([A-Z]{1,4})?\s*\[([A-Za-z0-9]+) EN ([\w-]+(?:/\d{1,3})?)\]")


def get(url, js=True, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                b = r.read()
                return json.loads(b) if js else b.decode("utf-8", "replace")
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 + i * 3)


groups = get("https://tcgcsv.com/tcgplayer/3/groups")["results"]
SETS = {g["abbreviation"].upper(): g["name"] for g in groups if g.get("abbreviation")}
SETS.setdefault("SVP", "SV: Scarlet & Violet Promo Cards")

ids = set()
for st in sorted(SETS):
    seen_empty = 0
    for pg in range(1, 41):
        try:
            h = get("https://snkrdunk.com/search?keywords=%s&page=%d" % (urllib.parse.quote("[%s EN " % st), pg), js=False)
        except Exception as e:
            print("search fail", st, pg, e); break
        found = set(re.findall(r"/apparels/(\d+)", h))
        new = found - ids
        ids |= found
        seen_empty = seen_empty + 1 if not new else 0
        if not found or seen_empty >= 2:
            break
        time.sleep(0.3)
print("sets", len(SETS), "candidate ids", len(ids))


def hist(pid, cond, grade):
    h = get("https://snkrdunk.com/v3/products/%s/trading-history?range=all&condition_code=%s" % (pid, cond))
    trades = [t["price"] for t in h.get("trades", []) if str(t.get("label", "1枚")).startswith("1枚")
              and str(t.get("title", grade)) == grade and t.get("price")][:8]
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
        loc = a.get("localizedName") or ""
        if "英語版" not in loc:
            return None
        m = TITLE.match(loc)
        if not m or m.group(3).upper() not in SETS:
            return None
        c = {"sid": int(sid), "b": m.group(1).strip(), "r": m.group(2) or "", "set": m.group(3).upper(), "num": m.group(4),
             "en": re.split(r"\s+[A-Z]{1,4}\s*\[|\s*\[", a.get("name") or "")[0].strip()}
        pid = a["productCatalogId"]
        c["p"] = hist(pid, "trading_card_single_psa10", "PSA10")
        c["a"] = hist(pid, "trading_card_single_nearly_unused", "A")
        time.sleep(0.2)
        return c if (c["p"] or c["a"]) else None
    except Exception as e:
        print("fail", sid, e)
        return None


with ThreadPoolExecutor(4) as ex:
    cards = [c for c in ex.map(one, sorted(ids)) if c]
json.dump({"updated": time.strftime("%Y-%m-%d %H:%M", time.gmtime(time.time() + 8 * 3600)), "sets": SETS, "cards": cards},
          open(sys.argv[1], "w"), ensure_ascii=False, separators=(",", ":"))
print("cards", len(cards), "with PSA10", sum(1 for c in cards if c["p"].get("s")), "with A", sum(1 for c in cards if c["a"].get("s")))
