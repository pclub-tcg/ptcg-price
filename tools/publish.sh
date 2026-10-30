#!/usr/bin/env bash
# 產生網站並推到 GitHub 的 site 分支（GitHub Pages 從這個分支發佈）。
# site 分支每次都只保留一個 commit，避免每天的價格圖檔把儲存庫越塞越大。
# 用法：tools/publish.sh <artifact.html> <kline.json> <sprites 資料夾>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(dirname "$HERE")"
OUT="$(mktemp -d)"
REMOTE="$(git -C "$REPO" remote get-url origin)"
# 商品大圖在 img 分支（GitHub Actions 下載的）
IMGDIR="$(mktemp -d)"
if git -C "$REPO" fetch -q origin img 2>/dev/null; then git -C "$REPO" --work-tree="$IMGDIR" checkout FETCH_HEAD -- . && git -C "$REPO" reset -q; fi
BOXDIR="$(mktemp -d)"
if git -C "$REPO" fetch -q origin boxdata 2>/dev/null; then git -C "$REPO" --work-tree="$BOXDIR" checkout FETCH_HEAD -- . && git -C "$REPO" reset -q; fi
JPDIR="$(mktemp -d)"; USDIR="$(mktemp -d)"; ENDIR="$(mktemp -d)"; OPDIR="$(mktemp -d)"
if git -C "$REPO" fetch -q origin jpdata 2>/dev/null; then git -C "$REPO" --work-tree="$JPDIR" checkout FETCH_HEAD -- . && git -C "$REPO" reset -q; fi
if git -C "$REPO" fetch -q origin endata 2>/dev/null; then git -C "$REPO" --work-tree="$ENDIR" checkout FETCH_HEAD -- . && git -C "$REPO" reset -q; fi
if git -C "$REPO" fetch -q origin opdata 2>/dev/null; then git -C "$REPO" --work-tree="$OPDIR" checkout FETCH_HEAD -- . && git -C "$REPO" reset -q; fi
if git -C "$REPO" fetch -q origin usdata 2>/dev/null; then git -C "$REPO" --work-tree="$USDIR" checkout FETCH_HEAD -- . && git -C "$REPO" reset -q; fi
# Artifact 模板：改網站名稱、美版併進卡片目錄
TPL="$(mktemp --suffix=.html)"; python3 "$HERE/patch_page.py" "$1" "$TPL"
OP_DATA="$OPDIR/op.json" EN_DATA="$ENDIR/en.json" JP_DATA="$JPDIR/jp.json" US_DATA="$USDIR/us.json" BOX_DATA="$BOXDIR/boxdata.json" HI_DIR="$IMGDIR/hi" python3 "$HERE/export.py" "$TPL" "$2" "$3" "$OUT"
python3 "$HERE/richmenu.py" "$OUT/richmenu.jpg"
python3 "$HERE/guide.py" "$OUT"
cp "$HERE/auction.html" "$OUT/auction.html"
mkdir -p "$OUT/icons" && cp "$HERE"/icons/*.png "$OUT/icons/"
touch "$OUT/.nojekyll"
cd "$OUT"
git init -q -b site
git add -A
git -c user.name="spickertop-afk" -c user.email="spickertop@gmail.com" commit -qm "網站資料 $(date -u +%F)"
git push -q --force "$REMOTE" site
echo "published $(du -sh "$OUT" | cut -f1)"
