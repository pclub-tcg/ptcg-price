"""手機 App（PWA）：publish.sh 產生網站後呼叫，用法 python3 pwa.py <網站資料夾>
- 首頁、競標、市集都加上 App 圖示、manifest、離線快取（tools/app/）
- 競標、市集補上跟首頁一樣的手機底部選單，在 App 裡換頁時選單不會不見"""
import os, re, shutil, sys

D = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
APP = os.path.join(D, "app")

HEAD = ('<link rel="manifest" href="manifest.webmanifest">'
        '<meta name="theme-color" content="#110D0B">'
        '<meta name="mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-title" content="P’CLUB">'
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
        '<link rel="apple-touch-icon" href="app/apple-touch-icon.png">'
        '<link rel="icon" type="image/png" sizes="32x32" href="app/favicon-32.png">')

CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>'
ITEMS = [
    ("./", "top", "行情", '<path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/>'),
    ("auction.html", "auction", "競標", '<path d="M14 4l6 6"/><path d="M11 7l6 6"/><path d="M12.5 5.5l-5 5 6 6 5-5z"/><path d="M10 13l-6 6"/><path d="M3 21h9"/>'),
    ("./#cam", "cam", "拍照查價", None),
    ("market.html", "market", "市集", '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v11H4z"/><path d="M10 20v-5h4v5"/>'),
    ("./#inv", "inv", "我的庫存", '<path d="M4 7h16v13H4z"/><path d="M8 7V4h8v3"/>'),
]

TABCSS = """<style id="app-tabbar">
.th-tabbar{display:none}
@media (max-width:900px){
  body{padding-bottom:calc(74px + env(safe-area-inset-bottom,0px))}
  .toast{bottom:calc(84px + env(safe-area-inset-bottom,0px))!important}
  .th-tabbar{display:grid;grid-template-columns:repeat(5,1fr);position:fixed;left:0;right:0;bottom:0;z-index:30;height:calc(66px + env(safe-area-inset-bottom,0px));padding-bottom:env(safe-area-inset-bottom,0px);background:color-mix(in srgb,var(--surface) 92%,transparent);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-top:1px solid var(--line)}
  .th-tabbar a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:10.5px;font-weight:700;color:var(--muted);text-decoration:none;-webkit-tap-highlight-color:transparent}
  .th-tabbar svg{width:22px;height:22px}
  .th-tabbar .on{color:var(--brand)}
  .th-tabbar .cam i{width:52px;height:52px;margin-top:-28px;border-radius:50%;background:var(--brand);color:var(--brand-ink);display:grid;place-items:center;border:4px solid var(--bg);box-shadow:0 10px 24px -6px rgba(255,138,43,.6)}
  .th-tabbar .cam svg{width:24px;height:24px}
}
</style>"""


def tabbar(on):
    out = []
    for href, key, label, path in ITEMS:
        cls = ' class="cam"' if key == "cam" else (' class="on" aria-current="page"' if key == on else "")
        icon = "<i>%s</i>" % CAM if key == "cam" else '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">%s</svg>' % path
        out.append('<a href="%s"%s>%s%s</a>' % (href, cls, icon, label))
    return '<nav class="th-tabbar" aria-label="快速選單">' + "".join(out) + "</nav>"


def patch(name, on=None):
    p = os.path.join(OUT, name)
    if not os.path.exists(p):
        print("pwa.py：找不到", name); return
    h = open(p, encoding="utf-8").read()
    if 'rel="manifest"' in h:
        return
    h = re.sub(r'<meta name="theme-color"[^>]*>', "", h)
    h = h.replace("<head>", "<head>" + HEAD, 1)
    if "viewport-fit=cover" not in h:
        h = h.replace("width=device-width,initial-scale=1", "width=device-width,initial-scale=1,viewport-fit=cover", 1)
    tail = '<script src="app/pwa.js" defer></script>\n'
    if on:
        tail = TABCSS + tabbar(on) + "\n" + tail
    i = h.rfind("</body>")
    h = h[:i] + tail + h[i:]
    open(p, "w", encoding="utf-8").write(h)


os.makedirs(os.path.join(OUT, "app"), exist_ok=True)
for f in os.listdir(APP):
    dst = OUT if f in ("sw.js", "manifest.webmanifest") else os.path.join(OUT, "app")
    shutil.copy(os.path.join(APP, f), dst)
patch("index.html")
patch("auction.html", "auction")
patch("market.html", "market")
print("pwa.py：App 設定完成")
