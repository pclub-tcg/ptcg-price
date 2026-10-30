#!/usr/bin/env python3
"""海賊王日版高價卡的 Mercari 成交價（Claude 每日排程用內建瀏覽器查，存在 opmerc 分支的 opmerc.json）。
  挑卡：python3 op_mercari.py pick <op.json> <opmerc.json> [張數=30] > todo.json
        從 SNKRDUNK 成交中位數最高的 300 筆日版（裸卡 a／PSA10 p）裡，挑沒查過或最久沒查的。
        輸出 [{k, q 搜尋字, num 卡號, psa, inc 標題必含(regex), exc 標題排除(regex), n 日文名, r, v, snkr 中位數}]
  合併：python3 op_mercari.py merge <opmerc.json> <results.json>
        results.json = {k: [日圓成交價...]}；2 筆以上才存，少於 2 筆存空陣列（記下查過的時間）。
opmerc.json：{"updated": "YYYY-MM-DD HH:MM", "d": {"<sid>~a|p": {"p": [...], "t": "YYYY-MM-DD HH:MM"}}}
export.py 用 OPM_DATA 讀進來，填到海賊王商品的 m（Mercari 中位數）。"""
import datetime, json, os, re, sys

POOL = 300
ONEOFF = re.compile(r"開封|シリアル|優勝|ベスト|トップ|上位|大会|記念品|サイン|直筆")


def now():
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).strftime("%Y-%m-%d %H:%M")


def load(p, default):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return default


def pick(op_path, om_path, n=30):
    om = load(om_path, {"d": {}})["d"]
    L = []
    for c in load(op_path, {"cards": []})["cards"]:
        if c.get("lang") == "en" or ONEOFF.search(c.get("v") or ""):
            continue
        for kind in "ap":
            s = (c.get(kind) or {}).get("s")
            if s:
                L.append((s[0], c, kind))
    L.sort(key=lambda x: -x[0])
    L = L[:POOL]
    L.sort(key=lambda x: ((om.get("%d~%s" % (x[1]["sid"], x[2])) or {}).get("t", ""), -x[0]))
    out = []
    for snkr, c, kind in L[:n]:
        r, v = c.get("r") or "", c.get("v") or ""
        base = r.split("-")[0]
        if "コミパラ" in v or r.endswith("-SP") or "スーパーパラレル" in v:
            w, inc, exc = "コミパラ", "コミパラ|スーパーパラレル|SP", ""
        elif r.endswith("-SPC") or "スペシャル" in v:
            w, inc, exc = "スペシャル", "SP|スペシャル", "コミパラ"
        elif r.endswith("-P") or "パラレル" in v:
            w, inc, exc = "パラレル", "パラ", "コミパラ|スーパーパラレル"
        elif "和柄" in v:
            w, inc, exc = "和柄", "和柄", ""
        else:
            w, inc, exc = (base + " " + v) if v else base, re.escape(v) if v else "", "パラ|コミパラ|SP|スペシャル|和柄"
        out.append({"k": "%d~%s" % (c["sid"], kind), "q": " ".join(x for x in [c["code"], w, "PSA10" if kind == "p" else ""] if x),
                    "num": c["code"], "psa": kind == "p", "inc": inc, "exc": exc, "n": c["b"], "r": r, "v": v, "snkr": snkr})
    json.dump(out, sys.stdout, ensure_ascii=False)


def merge(om_path, res_path):
    om = load(om_path, {"d": {}})
    t = now()
    res = load(res_path, {})
    for k, p in res.items():
        p = [int(x) for x in p if x]
        om["d"][k] = {"p": p[:8] if len(p) >= 2 else [], "t": t}
    om["updated"] = t
    json.dump(om, open(om_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("merged", len(res), "with price", sum(1 for p in res.values() if len(p) >= 2), "total", len(om["d"]))


if __name__ == "__main__":
    if sys.argv[1] == "pick":
        pick(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 30)
    else:
        merge(sys.argv[2], sys.argv[3])
