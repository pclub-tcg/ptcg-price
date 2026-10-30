#!/usr/bin/env bash
# 建立（第一次）Cloudflare D1 資料庫 → 匯入網站上的 data/d1.sql → 部署 LINE Worker
# GitHub Actions 用：需要 CLOUDFLARE_API_TOKEN（Workers 編輯＋D1 編輯權限）、CLOUDFLARE_ACCOUNT_ID
set -euo pipefail
cd "$(dirname "$0")/../worker"
W="npx -y wrangler@4"
dbid() { $W d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s.slice(s.indexOf("[")));const x=a.find(d=>d.name==="ptcg-bot");console.log(x?(x.uuid||x.id||""):"")}catch(e){console.log("")}})'; }
ID="$(dbid)"
if [ -z "$ID" ]; then echo "建立 D1 資料庫 ptcg-bot"; $W d1 create ptcg-bot; ID="$(dbid)"; fi
[ -n "$ID" ] || { echo "找不到 D1 資料庫，請確認 API Token 有 D1 編輯權限"; exit 1; }
sed -i "s/__D1_ID__/$ID/" wrangler.toml
SITE="$(sed -n 's/^SITE_URL *= *"\(.*\)"/\1/p' wrangler.toml)"
if [ -n "${D1_SQL:-}" ] && [ -s "$D1_SQL" ]; then [ "$D1_SQL" = /tmp/d1.sql ] || cp "$D1_SQL" /tmp/d1.sql; GOT=1
elif curl -fsSL -o /tmp/d1.sql "${SITE}data/d1.sql?t=$(date +%s)"; then GOT=1; else GOT=0; fi
if [ "$GOT" = 1 ]; then
  # 資料沒變就不重新匯入（D1 免費版每天寫入 10 萬列；網站只改版面時 page_build 也會觸發）
  SHA="$(sha256sum /tmp/d1.sql | cut -c1-16)"
  OLD="$($W d1 execute ptcg-bot --remote --json --command "CREATE TABLE IF NOT EXISTS meta(k TEXT, v TEXT); SELECT v FROM meta WHERE k='sha'" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s.slice(s.indexOf("[")));const r=a.flatMap(x=>x.results||[]);console.log(r.length?r[r.length-1].v:"")}catch(e){console.log("")}})' || true)"
  if [ -n "$OLD" ] && [ "$OLD" = "$SHA" ]; then
    echo "D1 資料沒變（$SHA），略過匯入"
  else
    echo "匯入 $(grep -c '^INSERT' /tmp/d1.sql) 筆到 D1"
    $W d1 execute ptcg-bot --remote --file /tmp/d1.sql --yes
    $W d1 execute ptcg-bot --remote --command "DELETE FROM meta WHERE k='sha'; INSERT INTO meta VALUES('sha','$SHA')" >/dev/null || true
  fi
else
  echo "網站上還沒有 data/d1.sql（下次 publish 後就會有），先只部署"
fi
$W deploy
