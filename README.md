# P’CLUB（原卡價套利王）

日本 Mercari／SNKRDUNK 成交價 × 台灣社團價格的寶可夢卡比價網站與 LINE 機器人。

- 網站放在 `site` 分支（GitHub Pages 從這裡發佈，每次更新只留一個 commit）：index.html、K 線資料 kline.json、卡圖、走勢圖、機器人資料 data/bot.json、圖文選單圖片
- `worker/`：LINE 機器人（Cloudflare Worker）
- `tools/export.py`：把每日更新後的網頁資料轉成網站內容
- `tools/publish.sh`：產生網站並推到 `site` 分支
- `tools/richmenu.py`：產生 LINE 圖文選單圖片（建立選單：打開 Worker 的 `/setup/richmenu`）

## 美版與日版高稀有度卡（2026-10-22）
- 網站多一個「美版（TCGplayer）」分頁，讀 site 的 us.json（全部美版）；分頁由 `tools/patch_page.py` 在 publish 時自動加進 Artifact 模板
- LINE 機器人：日版資料在 data/bot.json（日版高稀有度卡只收成交中位 ¥3,000 以上），美版在 data/bot-us.json（單卡 US$100、未拆 US$200 以上），查英文或「美版」才載入。門檻可用環境變數 BOT_JP、BOT_US_C、BOT_US_S 調整
- 搜尋字串 h 在 export 時先算好，Worker 冷啟動不必做 NFKC，避免超過免費版 CPU 時間
