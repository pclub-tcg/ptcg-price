"""網站瘦身（2026-11-06）：publish.sh 產生網站後呼叫，用法 python3 slim.py <網站資料夾>
1. index.html 裡 img-data 的 base64 商品照片（約 340KB，壓縮效果很差）改存成 pimg/<代號>.jpg，HTML 只留路徑
2. 美版資料 us.json（約 4.9MB）不要一打開就下載：頁面載入完、瀏覽器空閒時才抓；使用者一開始打字搜尋就立刻抓"""
import base64, json, os, re, sys

OUT = sys.argv[1]
P = os.path.join(OUT, "index.html")
h = open(P, encoding="utf-8").read()
n0 = len(h)

# 1. 商品照片拆檔
m = re.search(r'(<script id="img-data" type="application/json">)(.*?)(</script>)', h, re.S)
nimg = 0
if m:
    imgs = json.loads(m.group(2))
    os.makedirs(os.path.join(OUT, "pimg"), exist_ok=True)
    for k, v in list(imgs.items()):
        mm = re.match(r"data:image/(jpe?g|png|webp);base64,(.*)$", v or "", re.S)
        if not mm or not re.fullmatch(r"[\w-]+", k):
            continue
        ext = "jpg" if mm.group(1).startswith("jp") else mm.group(1)
        open(os.path.join(OUT, "pimg", "%s.%s" % (k, ext)), "wb").write(base64.b64decode(mm.group(2)))
        imgs[k] = "pimg/%s.%s" % (k, ext); nimg += 1
    h = h[:m.start(2)] + json.dumps(imgs, ensure_ascii=False, separators=(",", ":")) + h[m.end(2):]

# 2. 美版資料延後載入
US = 'if(/github\\.io$/.test(location.hostname))fetch("us.json")'
i = h.find(US)
if i >= 0:
    j = h.find("}).catch(()=>{});", i)
    assert j > i, "us.json 載入段落格式變了"
    j += len("}).catch(()=>{});")
    body = h[i + len('if(/github\\.io$/.test(location.hostname))'):j - 1]  # fetch("us.json")…catch(()=>{})
    DEFER = ('function pcLater(f){let d=0;const go=()=>{if(d)return;d=1;f()};'
             'const idle=()=>(window.requestIdleCallback||((c)=>setTimeout(c,1)))(go,{timeout:4000});'
             'if(document.readyState==="complete")setTimeout(idle,1200);else addEventListener("load",()=>setTimeout(idle,1200));'
             'document.addEventListener("input",go,{once:true,capture:true});document.addEventListener("click",e=>{if(e.target.closest&&e.target.closest("[data-us],[data-f=us],[data-cat=us]"))go()},{capture:true})}\n')
    h = h[:i] + DEFER + 'if(/github\\.io$/.test(location.hostname))pcLater(()=>' + body + ');' + h[j:]
else:
    print("slim: 找不到 us.json 載入段落，略過延後載入")

open(P, "w", encoding="utf-8").write(h)
print("slim: index.html %dKB → %dKB，商品照片拆出 %d 張" % (n0 // 1024, len(h) // 1024, nimg))
