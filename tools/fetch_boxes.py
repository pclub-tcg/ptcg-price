#!/usr/bin/env python3
"""在 GitHub Actions 上執行：抓 tools/boxes.json 裡原盒的 SNKRDUNK 最近成交與每日均價。
輸出 boxdata.json：{sid: {"s": [中位數, 筆數], "k": [起始日, 價格, 間隔天數, 價格, ...]}}
用法：python3 fetch_boxes.py tools/boxes.json <輸出 json>"""
import json, statistics, sys, time, urllib.request

boxes, out = json.load(open(sys.argv[1])), sys.argv[2]
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "Accept": "application/json"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return json.loads(r.read())


res, fail = {}, 0
for b in boxes:
    sid = b["sid"]
    try:
        pid = get("https://snkrdunk.com/v1/apparels/%d" % sid)["productCatalogId"]
        h = get("https://snkrdunk.com/v3/products/%s/trading-history?range=all" % pid)
        trades = [t["price"] for t in h.get("trades", []) if "個" in str(t.get("label", "1個")) and t.get("price")]
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
json.dump({"updated": time.strftime("%Y-%m-%d %H:%M", time.gmtime(time.time() + 8 * 3600)), "boxes": res}, open(out, "w"), separators=(",", ":"))
print("ok", len(res), "fail", fail)
