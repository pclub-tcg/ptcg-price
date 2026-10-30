#!/usr/bin/env bash
# 把 Artifact（4zUp4uN63W77EcmRmG8u36）最新的網頁模板、K 線、卡圖存到 tpl 分支，GitHub Actions 每天 10:41 發布網站時會用。
# Mercari／台灣社團／TCG Japan 目錄這幾個排程只更新 Artifact，所以每天發布前要跑這支同步一次。
# 用法：tools/sync_tpl.sh <artifact.html> <kline.json> <sprites 資料夾> [push 網址]
set -euo pipefail
HTML="$1"; KL="$2"; SPR="$3"
REMOTE="${4:-https://github.com/spickertop-afk/ptcg-price}"
python3 - "$HTML" <<'E'
import json, re, sys
h = open(sys.argv[1], encoding="utf-8").read()
for i in ("price-data", "catalog-data", "snkr-data", "mercari-data", "extra-data"):
    m = re.search(r'<script id="%s" type="application/json">(.*?)</script>' % i, h, re.S)
    assert m, "缺少 " + i
    json.loads(m.group(1))
assert len(h) > 300000, "HTML 太小"
print("template ok", len(h))
E
N=$(ls "$SPR"/*.jpg | wc -l); [ "$N" -ge 50 ] || { echo "sprites 只有 $N 張，不同步"; exit 1; }
OUT="$(mktemp -d)"
cp "$HTML" "$OUT/index.html"; cp "$KL" "$OUT/kline.json"; mkdir -p "$OUT/sprites"; cp "$SPR"/*.jpg "$OUT/sprites/"
cd "$OUT"; git init -q -b tpl; git add -A
git -c user.name="spickertop-afk" -c user.email="spickertop@gmail.com" commit -qm "網站模板 $(date -u +%F)"
git push -q --force "$REMOTE" tpl 2>&1 | grep -v -i "moved\|github.com/pclub-tcg" || true
[ "$(git ls-remote "$REMOTE" tpl | cut -f1)" = "$(git rev-parse HEAD)" ] || { echo "推送 tpl 失敗"; exit 1; }
echo "tpl synced, sprites $N"
