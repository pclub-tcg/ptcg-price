# 卡價套利王

日本 Mercari／SNKRDUNK 成交價 × 台灣社團價格的寶可夢卡比價網站與 LINE 機器人。

- 網站放在 `site` 分支（GitHub Pages 從這裡發佈，每次更新只留一個 commit）：index.html、K 線資料 kline.json、卡圖、走勢圖、機器人資料 data/bot.json、圖文選單圖片
- `worker/`：LINE 機器人（Cloudflare Worker）
- `tools/export.py`：把每日更新後的網頁資料轉成網站內容
- `tools/publish.sh`：產生網站並推到 `site` 分支
- `tools/richmenu.py`：產生 LINE 圖文選單圖片（建立選單：打開 Worker 的 `/setup/richmenu`）
