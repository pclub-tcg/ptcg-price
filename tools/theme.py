"""2026-11 改版（A 深色收藏館）：patch_page.py 最後一步呼叫 apply(h)。
只換頁首、主視覺排版、加手機底部導覽，原本的 JS／id 都保留；樣式在 theme.css、行為在 theme.js。"""
import os, re

D = os.path.dirname(os.path.abspath(__file__))
LINE = "https://line.me/R/ti/p/@916ctmro"
CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>'
LINEIC = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 .9l-.1.9c0 .3-.2 1 .9.5s5.9-3.5 8-6c1.5-1.6 2-3.2 2-4.8C22 6.6 17.5 3 12 3z"/></svg>'


def _rep(h, old, new, count=1):
    if old not in h:
        raise SystemExit("theme.py：找不到要替換的片段：" + old[:80])
    return h.replace(old, new, count)


def apply(h):
    h = _rep(h, "<!doctype html><html>", '<!doctype html><html lang="zh-Hant" data-theme="dark">')
    h = _rep(h, "<head>", '<head><meta name="theme-color" content="#110D0B">')
    if "family=IBM+Plex+Mono" in h:
        h = h.replace("family=IBM+Plex+Mono:wght@500;600", "family=IBM+Plex+Mono:wght@500;600&family=Inter:wght@500;600;700;800", 1)

    # 頁首：logo｜行情 卡片目錄 競標 市集｜幣值 LINE；下面一條資料更新狀態列
    m = re.search(r'<header class="bar"><div class="wrap">\s*(<div class="brand">.*?</div>)\s*<span.*?(<span class="cur".*?</span>).*?</header>', h, re.S)
    if not m:
        raise SystemExit("theme.py：找不到頁首")
    head = ('<header class="bar"><div class="wrap">\n  ' + m.group(1) +
            '\n  <nav class="th-nav" aria-label="主選單"><a href="./" class="on">行情</a><a href="#tab-tcg" data-th="tcg">卡片目錄</a>'
            '<a href="community.html">社群</a><a href="market.html">市集</a><a href="auction.html">競標</a><a href="dex.html">圖鑑・卡冊</a><a href="draw.html">抽卡助手</a></nav>\n  <div class="th-sp"></div>\n'
            '  <div class="th-right">' + m.group(2) +
            '<a class="th-line" href="%s" target="_blank" rel="noopener">%s<span>加入 LINE 查價</span></a><small id="stamp"></small></div>\n'
            '</div><div class="th-status"><div class="wrap" id="th-status"></div></div></header>' % (LINE, LINEIC))
    h = h[:m.start()] + head + h[m.end():]

    # 主視覺：左邊標語＋搜尋，右邊漲幅排行板
    h = _rep(h, '  <span class="eyebrow">', '  <div class="th-hl"><span class="eyebrow">')
    h = re.sub(r'(<h1>傳個卡號，<mark>秒查日本行情</mark></h1>\s*)<p>.*?</p>',
               r'\1<p>SNKRDUNK、Mercari、TCG Japan 的實際成交價，一次換算成台幣，和台灣社團價格一起比較。卡名、卡號、系列代號都能查。</p>', h, count=1, flags=re.S)
    h = _rep(h, '<span>以圖搜尋</span></button>', '<span>拍照查價</span></button>')
    h = _rep(h, '  <div class="ticker" id="ticker"', '  <nav class="th-grid" aria-label="功能"><a href="dex.html"><i style="background:linear-gradient(135deg,#3b82f6,#6366f1)">📚</i><span>圖鑑卡冊</span></a><a href="draw.html"><i style="background:linear-gradient(135deg,#8b5cf6,#d946ef)">🎴</i><span>抽卡助手</span></a><a href="community.html"><i style="background:linear-gradient(135deg,#f97316,#ef4444)">💬</i><span>社群</span></a><a href="market.html"><i style="background:linear-gradient(135deg,#10b981,#059669)">🛒</i><span>市集</span></a><a href="auction.html"><i style="background:linear-gradient(135deg,#f59e0b,#ea580c)">🔨</i><span>競標</span></a><a href="dex.html?new=1"><i style="background:linear-gradient(135deg,#ec4899,#f43f5e)">✨</i><span>新彈專區</span></a><a href="#inv" data-th="inv"><i style="background:linear-gradient(135deg,#64748b,#475569)">📦</i><span>我的庫存</span></a><a href="notes.html"><i style="background:linear-gradient(135deg,#0ea5e9,#2563eb)">🔔</i><span>通知</span></a></nav>\n  <div class="ticker" id="ticker"')
    h = _rep(h, '  <div class="ticker" id="ticker"',
             '  </div>\n  <div class="th-board" id="th-board" hidden><h3>近 30 天漲幅 TOP<small>SNKRDUNK 日本成交</small></h3><div id="th-rows"></div></div>\n  <div class="ticker" id="ticker"')

    # 手機底部導覽
    tab = ('<nav class="th-tabbar" aria-label="快速選單">'
           '<button type="button" class="on" data-th="top"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/></svg>行情</button>'
           '<a href="community.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/></svg>社群</a>'
           '<button type="button" class="cam" onclick="window.PCPlus&&PCPlus()" aria-label="新增：拍照查價、刊登、發文"><i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></i>新增</button>'
           '<a href="market.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v11H4z"/><path d="M10 20v-5h4v5"/></svg>市集</a>'
           '<button type="button" data-th="inv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3"/></svg>我的庫存<b id="th-invn"></b></button>'
           '</nav>')
    css = open(os.path.join(D, "theme.css"), encoding="utf-8").read()
    js = open(os.path.join(D, "theme.js"), encoding="utf-8").read()
    i = h.rfind("</body>")
    h = h[:i] + tab + '\n<style id="theme-a">\n' + css + '</style>\n<script>\n' + js + '\n</script>\n' + h[i:]
    return h


if __name__ == "__main__":  # 測試用：python3 theme.py 原網頁.html 輸出.html
    import sys
    open(sys.argv[2], "w", encoding="utf-8").write(apply(open(sys.argv[1], encoding="utf-8").read()))
