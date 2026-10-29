#!/usr/bin/env python3
"""在 GitHub Actions 上執行：抓朱紫、MEGA、劍盾、太陽月亮、XY、BW 系列與特典卡的日版卡（C／U／R 普通卡不抓，鏡面與特典照抓）的 SNKRDUNK 成交（裸卡 A 級、PSA10）與每日均價。
只收有成交的卡。卡很多，所以分 3 天輪流更新：sid % 3 == 今天 % 3 的卡、新卡、成交中位 ¥3,000 以上的卡每天更新，其他沿用前一天的資料。
輸出 jp.json：{"updated": ..., "cards": [{sid, b 卡名, r 稀有度, set, num, pk 擴充包, img, a: {s:[中位,筆數], k:[...]}, p: {...}}]}
用法：python3 fetch_jp.py <輸出 jp.json> [前一天的 jp.json]"""
import collections, json, os, re, statistics, sys, time, urllib.error, urllib.parse, urllib.request
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
        # XY
        "XY1", "XY2", "XY3", "XY4", "XY5", "XY6", "XY7", "XY8", "XY9", "XY10", "XY11", "XYA", "XYB", "XYC", "XYD", "XYE", "XYF",
        "CP1", "CP2", "CP3", "CP4", "CP5", "CP6",
        # BW
        "BW1", "BW2", "BW3", "BW4", "BW5", "BW6", "BW7", "BW8", "BW9", "EBB", "SC",
        # 之後的新系列（還沒出的會自動略過）
        "M7", "M8", "M9", "M7a", "M8a",
        # 特典卡
        "S-P", "SV-P", "SM-P", "M-P", "XY-P", "BW-P"]
RARE = {"SAR", "SR", "AR", "UR", "HR", "MUR", "MA", "CHR", "CSR", "SSR", "ACE", "BWR", "S", "K", "RRR", "PR", "TR", "P"}
SETS_U = {x.upper() for x in SETS}
COMMON = {"C", "U", "R"}
PROMO = {"S-P", "SV-P", "SM-P", "M-P", "XY-P", "BW-P"}
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "Accept": "*/*"}
# 「ピカチュウex SAR [SV8 132/106](…)」「ピカチュウ C :マスターボールミラー [SV2a 025/165](…)」「ピカチュウ [S-P 143]」
TITLE = re.compile(r"^(.*?)(?:\s+([A-Z]{1,4}))?\s*(?::\s*([^\[]*?))?\s*\[([A-Za-z0-9+-]+)\s+(\d{1,3}(?:/[\w-]{1,6})?)\]\s*(?:\((.*?)\))?")
STAT = collections.Counter()
SKIP_VER = 3  # 標題格式或系列清單改過：舊的「不是日版卡」名單作廢重查


def get(url, js=True, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                b = r.read()
                return json.loads(b) if js else b.decode("utf-8", "replace")
        except Exception as e:
            code = getattr(e, "code", None)
            if code == 404 or i == tries - 1:
                STAT["http %s" % code] += 1
                raise
            time.sleep((10 if code == 429 else 2) * (i + 1))


old_path = sys.argv[2] if len(sys.argv) > 2 else ""
old = json.load(open(old_path)) if old_path and os.path.exists(old_path) else {"cards": [], "skip": {}}
OLD = {c["sid"]: c for c in old.get("cards", [])}
SKIP = {int(k): v for k, v in (old.get("skip") or {}).items()} if old.get("skip_ver") == SKIP_VER else {}  # 不是寶可夢日版卡、或沒有成交的商品 → 下次輪到才重查
TODAY = int(time.time() // 86400)
T0 = time.time()
BUDGET = float(os.environ.get("BUDGET_MIN", 200)) * 60  # 時間快用完就停，剩下的沿用舊資料

# 1. 從搜尋頁收集商品 id
ids = set()
for st in SETS:
    seen_empty = 0
    for pg in range(1, 81):
        try:
            h = get("https://snkrdunk.com/search?keywords=%s&page=%d" % (urllib.parse.quote("[%s " % st), pg), js=False)
        except Exception as e:
            print("search fail", st, pg, e); break
        found = set(int(x) for x in re.findall(r"/apparels/(\d+)", h))
        new = found - ids
        ids |= found
        seen_empty = seen_empty + 1 if not new else 0
        if not found or seen_empty >= 2:
            break
        time.sleep(0.3)
print("candidate ids", len(ids), "old cards", len(OLD), "skip", len(SKIP))


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


def due(sid):
    o = OLD.get(sid)
    if sid in SKIP:
        return (TODAY - SKIP[sid]) >= 7 and sid % 3 == TODAY % 3  # 沒成交的每 7 天以上、輪到才重查
    if not o:
        return True
    hi = max(((o.get("a") or {}).get("s") or [0])[0], ((o.get("p") or {}).get("s") or [0])[0])
    return hi >= 3000 or sid % 3 == TODAY % 3


def one(sid):
    if time.time() - T0 > BUDGET:
        STAT["out of time"] += 1
        return OLD.get(sid)
    if not due(sid):
        STAT["kept"] += 1
        return OLD.get(sid)
    try:
        o = OLD.get(sid)
        if o and o.get("pid") and o.get("set"):  # 有完整資料才沿用，不然重抓商品資訊
            c = {k: v for k, v in o.items() if k not in ("a", "p")}
        else:
            a = get("https://snkrdunk.com/v1/apparels/%s" % sid)
            loc = a.get("localizedName") or ""
            m = TITLE.match(loc)
            if not m or m.group(4).upper() not in SETS_U or any(x in loc for x in ("英語版", "中国語版", "韓国語版")):
                SKIP[sid] = TODAY; STAT["not jp card"] += 1
                return None
            # v：鏡面等版本
            c = {"sid": int(sid), "b": m.group(1).strip(), "v": (m.group(3) or "").strip(), "r": m.group(2) or "", "set": m.group(4), "num": m.group(5), "pk": m.group(6) or "",
                 "en": (a.get("name") or "").split(" [")[0], "img": ((a.get("primaryMedia") or {}).get("imageUrl")) or "",
                 "pid": a["productCatalogId"]}
        # 很普通的卡（C／U／R）不抓；特典卡、鏡面等特殊版本照抓
        if c.get("r") in COMMON and c.get("set", "").upper() not in PROMO and not c.get("v"):
            SKIP[sid] = TODAY; STAT["common skipped"] += 1
            return None
        c["a"] = hist(c["pid"], "trading_card_single_nearly_unused", "A")
        c["p"] = hist(c["pid"], "trading_card_single_psa10", "PSA10")
        time.sleep(0.2)
        if not (c["a"].get("s") or c["p"].get("s")):
            SKIP[sid] = TODAY; STAT["no sales"] += 1
            return None
        SKIP.pop(sid, None); STAT["updated"] += 1
        return c
    except Exception as e:
        STAT["fail"] += 1
        return OLD.get(sid)


with ThreadPoolExecutor(4) as ex:
    cards = [c for c in ex.map(one, sorted(ids | set(OLD))) if c]
json.dump({"updated": time.strftime("%Y-%m-%d %H:%M", time.gmtime(time.time() + 8 * 3600)), "cards": cards, "skip": {str(k): v for k, v in SKIP.items()}, "skip_ver": SKIP_VER},
          open(sys.argv[1], "w"), ensure_ascii=False, separators=(",", ":"))
print("cards", len(cards), "with A", sum(1 for c in cards if c["a"].get("s")), "with PSA10", sum(1 for c in cards if c["p"].get("s")), dict(STAT))
