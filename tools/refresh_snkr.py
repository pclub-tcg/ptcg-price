#!/usr/bin/env python3
"""發布前（GitHub Actions）直接更新網站模板裡的 SNKRDUNK 成交價與 K 線，不再依賴電腦上的瀏覽器排程：
- snkr-data：卡片目錄的卡（裸卡 A／PSA10）、原盒
- price-data：比價商品（有 sid 的）
- extra-data：額外原盒
- kline.json：每日均價（最近 400 天）
用法：python3 refresh_snkr.py <index.html> <kline.json> [jp.json（拿 productCatalogId 快取用）]"""
import json, os, re, statistics, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

HTML, KL = sys.argv[1], sys.argv[2]
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "Accept": "application/json"}
BUDGET = float(os.environ.get("BUDGET_MIN", 30)) * 60
T0 = time.time()
CC = {"p": "&condition_code=trading_card_single_psa10", "a": "&condition_code=trading_card_single_nearly_unused", "9": "&condition_code=trading_card_single_psa9", "b": ""}
GRADE = {"p": "PSA10", "a": "A", "9": "PSA9"}
DAY = lambda ms: int((ms + 9 * 3600e3) // 86400000)
STAT = {"ok": 0, "fail": 0, "empty": 0, "timeout": 0}


def get(url):
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:
            if getattr(e, "code", None) == 404 or i == 3:
                raise
            time.sleep((10 if getattr(e, "code", None) == 429 else 2) * (i + 1))


h = open(HTML, encoding="utf-8").read()
def blk(i):
    m = re.search(r'(<script id="%s" type="application/json">)(.*?)(</script>)' % i, h, re.S)
    return m, json.loads(m.group(2))
_, snk = blk("snkr-data"); _, price = blk("price-data"); _, extra = blk("extra-data")
kl = json.load(open(KL)) if os.path.exists(KL) else {"d": {}}

PID = {}
if len(sys.argv) > 3 and os.path.exists(sys.argv[3]):
    for c in json.load(open(sys.argv[3])).get("cards", []):
        if c.get("pid"): PID[int(c["sid"])] = c["pid"]

jobs = set()
for name, c in snk["cards"].items():
    if c.get("id"):
        jobs.add((int(c["id"]), "p" if re.search(r"_PS(A)?10$", name) else "a" if "【" in name else "b"))
TY = {"PSA10": "p", "PSA9": "9", "A": "a", "BOX": "b"}
for it in price["items"]:
    if it.get("sid") and it.get("sc") in TY: jobs.add((int(it["sid"]), TY[it["sc"]]))
for e in extra:
    if e.get("sid"): jobs.add((int(e["sid"]), "b"))
jobs = sorted(jobs)
print("jobs", len(jobs), "pid cache", len(PID))


def one(job):
    sid, ty = job
    if time.time() - T0 > BUDGET:
        STAT["timeout"] += 1; return job, None
    try:
        pid = PID.get(sid)
        if not pid:
            pid = get("https://snkrdunk.com/v1/apparels/%d" % sid).get("productCatalogId"); PID[sid] = pid
        hj = get("https://snkrdunk.com/v3/products/%s/trading-history?range=all%s" % (pid, CC[ty]))
        if ty == "b":
            tr = [t["price"] for t in hj.get("trades", []) if (str(t.get("label", "")).startswith("1個") or t.get("title") == "1個") and t.get("price")][:8]
        else:
            tr = [t["price"] for t in hj.get("trades", []) if str(t.get("label", "1枚")).startswith("1枚") and str(t.get("title", GRADE[ty])) == GRADE[ty] and t.get("price")][:8]
        pts = {}
        for line in (hj.get("chart") or {}).get("lines", [])[:1]:
            for p in line.get("points", []):
                ts = p["timestamp"]; ts = ts if ts > 1e11 else ts * 1000
                pts[DAY(ts)] = round(p["price"])
        time.sleep(0.15)
        STAT["ok" if tr or pts else "empty"] += 1
        return job, (tr, pts)
    except Exception:
        STAT["fail"] += 1; return job, None


with ThreadPoolExecutor(4) as ex:
    R = dict(ex.map(one, jobs))


def enc(pts):
    ds = sorted(pts)[-400:]
    if not ds: return None
    k = [ds[0], pts[ds[0]]]
    for a, b in zip(ds, ds[1:]): k += [b - a, pts[b]]
    return k
def dec(k):
    out, d = {}, None
    if not k: return out
    d = k[0]; out[d] = k[1]
    for i in range(2, len(k) - 1, 2):
        d += k[i]; out[d] = k[i + 1]
    return out


now = time.strftime("%Y-%m-%d %H:%M", time.gmtime(time.time() + 8 * 3600))
nk = 0
for (sid, ty), r in R.items():
    if not r: continue
    tr, pts = r
    key = "%d~%s" % (sid, ty)
    if ty == "b" and pts and tr:  # 原盒：每日均價偶爾混到整箱／沒膠膜，離中位太遠的點不要
        med = statistics.median(tr); pts = {d: v for d, v in pts.items() if 0.7 * med <= v <= 1.4 * med}
    if pts:
        old = dec(kl["d"].get(key)); old.update(pts); kl["d"][key] = enc(old); nk += 1
R2 = {k: v for k, v in R.items() if v and v[0]}
for name, c in snk["cards"].items():
    if not c.get("id"): continue
    ty = "p" if re.search(r"_PS(A)?10$", name) else "a" if "【" in name else "b"
    r = R2.get((int(c["id"]), ty))
    if r: c["s"] = r[0]
for it in price["items"]:
    r = R2.get((int(it["sid"]), TY.get(it.get("sc")))) if it.get("sid") else None
    if r and len(r[0]) >= 2: it["s"] = r[0]; it["st"] = now
for e in extra:
    r = R2.get((int(e["sid"]), "b")) if e.get("sid") else None
    if r: e["m"] = round(statistics.median(r[0])); e["c"] = len(r[0])
snk["updated"] = now
kl["updated"] = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 8 * 3600))
for i, d in (("snkr-data", snk), ("price-data", price), ("extra-data", extra)):
    m, _ = blk(i)
    h = h[:m.start(2)] + json.dumps(d, ensure_ascii=False, separators=(",", ":")) + h[m.end(2):]
open(HTML, "w", encoding="utf-8").write(h)
json.dump(kl, open(KL, "w"), separators=(",", ":"))
print("snkrdunk refresh", STAT, "kline keys updated", nk, "in %.0fs" % (time.time() - T0))
