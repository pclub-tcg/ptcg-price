#!/usr/bin/env python3
"""在 GitHub Actions 上執行：抓 SNKRDUNK 海賊王卡牌（ONE PIECE CARD GAME）日版與英文版的成交（裸卡 A 級、PSA10）與每日均價。
跟寶可夢日版卡（fetch_jp.py）同樣規則：只收有成交的卡；普通卡（C／UC／R／L 一般版）不抓，異圖、SP、漫畫、特典照抓；分 3 天輪流更新。
SNKRDUNK 標題像：
  「シャンクス SEC-SP (コミパラ) [OP01-120](ブースターパック「ロマンスドーン」)」
  「キッド＆キラー R-SPC :和柄アート [EB01-003](…)」
  「モンキー・D・ルフィ SR [OP07-109]【英語版】(…)」
  「モンキー・D・ルフィ P-P  [P-001] (…)」
輸出 op.json：{"updated", "cards": [{sid, b 日文名, v 版本, r 稀有度, set 系列, num 編號, code 卡號, lang ja/en, pk 收錄, en 英文名, img, pid, a:{s,k}, p:{s,k}}]}
用法：python3 fetch_op.py <輸出 op.json> [前一天的 op.json]"""
import collections, json, os, re, statistics, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

SETS = (["OP%02d" % i for i in range(1, 17)] + ["EB%02d" % i for i in range(1, 6)] + ["ST%02d" % i for i in range(1, 31)]
        + ["PRB%02d" % i for i in range(1, 4)] + ["P"])
SETS_U = set(SETS)
COMMON = {"C", "UC", "R", "L"}  # 一般版不抓（有 -P／-SP／異圖／特典的照抓）
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "Accept": "*/*"}
CODE = re.compile(r"\[\s*((?:OP|EB|ST|PRB)\d{2}|P)-(\d{3})\s*\]")
RAR = re.compile(r"(?:^|\s)((?:SP CARD|SEC|SR|SP|UC|TR|L|C|R|P)(?:-[A-Z]{1,4})?)(?=\s|$|\()")
STAT = collections.Counter()
SKIP_VER = 1


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


def parse(loc):
    """回傳 dict 或 None（不是海賊王單卡）"""
    m = CODE.search(loc)
    if not m or m.group(1) not in SETS_U:
        return None
    if any(x in loc for x in ("中国語版", "韓国語版")):
        return None
    before, after = loc[:m.start()], loc[m.end():]
    lang = "en" if "英語版" in loc else "ja"
    pk = ""
    pm = re.search(r"\((.*)\)\s*$", after)
    if pm:
        pk = pm.group(1).strip()
    notes = []
    vm = re.search(r":\s*([^\[]+?)\s*$", before)  # 「:和柄アート」
    if vm:
        notes.append(vm.group(1).strip()); before = before[:vm.start()]
    for n in re.findall(r"\(([^)]*)\)", before):  # 「(コミパラ)」「(イラスト修正前)」
        notes.append(n.strip())
    before = re.sub(r"\([^)]*\)", " ", before)
    rs = list(RAR.finditer(before))
    r = rs[-1].group(1) if rs else ""
    name = (before[:rs[-1].start()] if rs else before).strip(" ・:")
    if not name:
        return None
    return {"b": name, "r": r, "v": " ".join(x for x in notes if x), "set": m.group(1), "num": m.group(2),
            "code": "%s-%s" % (m.group(1), m.group(2)), "lang": lang, "pk": pk}


PROMO_PK = re.compile(r"プロモ|記念|応募|コレクション|プレミアム|ジャンプ|大会|Fest|フラッグシップ|チャンピオンシップ|イラストレーション|限定")


def common(c):
    """一般版的 C／UC／R／L 不抓；特典、異圖、-P／-SP 版照抓"""
    base = (c.get("r") or "").split("-")[0]
    return (base in COMMON and "-" not in (c.get("r") or "") and not c.get("v") and c.get("set") != "P"
            and not PROMO_PK.search(c.get("pk") or ""))


T0 = time.time()
BUDGET = float(os.environ.get("BUDGET_MIN", 200)) * 60
TODAY = int((time.time() + 8 * 3600) // 86400)
OLD, SKIP = {}, {}
if len(sys.argv) > 2 and os.path.exists(sys.argv[2]):
    o = json.load(open(sys.argv[2]))
    OLD = {c["sid"]: c for c in o.get("cards", [])}
    if o.get("skip_ver") == SKIP_VER:
        SKIP = {int(k): v for k, v in o.get("skip", {}).items()}

ids = set()
for st in SETS:
    seen_empty = 0
    for pg in range(1, 61):
        try:
            h = get("https://snkrdunk.com/search?keywords=%s&page=%d" % (urllib.parse.quote("[%s-" % st), pg), js=False)
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
        return (TODAY - SKIP[sid]) >= 7 and sid % 3 == TODAY % 3
    return True  # 有成交的海賊王卡每天都更新（沒成交／普通卡才分 7 天重查）


def one(sid):
    if time.time() - T0 > BUDGET:
        STAT["out of time"] += 1
        return OLD.get(sid)
    if not due(sid):
        STAT["kept"] += 1
        return OLD.get(sid)
    try:
        o = OLD.get(sid)
        if o and o.get("pid") and o.get("code"):
            c = {k: v for k, v in o.items() if k not in ("a", "p")}
        else:
            a = get("https://snkrdunk.com/v1/apparels/%s" % sid)
            c = parse(a.get("localizedName") or "")
            if not c:
                SKIP[sid] = TODAY; STAT["not op card"] += 1
                return None
            c.update({"sid": int(sid), "en": (a.get("name") or "").split(" [")[0], "img": ((a.get("primaryMedia") or {}).get("imageUrl")) or "", "pid": a["productCatalogId"]})
        if common(c):
            SKIP[sid] = TODAY; STAT["common skipped"] += 1
            return None
        c["a"] = hist(c["pid"], "trading_card_single_nearly_unused", "A")
        c["p"] = hist(c["pid"], "trading_card_single_psa10", "PSA10")
        time.sleep(0.2)
        if not (c["a"].get("s") or c["p"].get("s")):
            SKIP[sid] = TODAY; STAT["no sales"] += 1
            return None
        SKIP.pop(sid, None); STAT["updated %s" % c["lang"]] += 1
        return c
    except Exception:
        STAT["fail"] += 1
        return OLD.get(sid)


with ThreadPoolExecutor(4) as ex:
    cards = [c for c in ex.map(one, sorted(ids | set(OLD))) if c and not common(c)]
json.dump({"updated": time.strftime("%Y-%m-%d %H:%M", time.gmtime(time.time() + 8 * 3600)), "cards": cards, "skip": {str(k): v for k, v in SKIP.items()}, "skip_ver": SKIP_VER},
          open(sys.argv[1], "w"), ensure_ascii=False, separators=(",", ":"))
print("cards", len(cards), "ja", sum(1 for c in cards if c["lang"] == "ja"), "en", sum(1 for c in cards if c["lang"] == "en"),
      "with A", sum(1 for c in cards if c["a"].get("s")), "with PSA10", sum(1 for c in cards if c["p"].get("s")), dict(STAT))
