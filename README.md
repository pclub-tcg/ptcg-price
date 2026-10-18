# 卡價套利王

日本 Mercari／SNKRDUNK 成交價 × 台灣社團價格的寶可夢卡比價網站與 LINE 機器人。

- `docs/`：GitHub Pages 網站（index.html、K 線資料 kline.json、卡圖、機器人資料 data/bot.json）
- `worker/`：LINE 機器人（Cloudflare Worker）
- `tools/export.py`：把每日更新後的網頁資料轉成 `docs/` 的內容
