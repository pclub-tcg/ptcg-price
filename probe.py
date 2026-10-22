import json,re,time,urllib.request,urllib.parse,urllib.error
UA={"User-Agent":"Mozilla/5.0 PCLUB-price-site (spickertop-afk)"}
def get(u):
  for i in range(6):
    try: return json.loads(urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=40).read())
    except urllib.error.HTTPError as e:
      if e.code!=429 or i==5: raise
      time.sleep(15*(i+1))
def api(**q):
  q.update(format="json"); return get("https://wiki.52poke.com/api.php?"+urllib.parse.urlencode(q))
names=[("ja",b["jp"]) for b in json.load(open("boxes.json"))]
for g in get("https://tcgcsv.com/tcgplayer/3/groups")["results"]:
  n=re.sub(r"^[A-Z]{1,4}\d*[a-z]?:\s*","",g["name"]); names.append(("en",n))
out={"ja":{},"en":{}};seen=set()
for lang,n in names:
  if (lang,n) in seen: continue
  seen.add((lang,n))
  try:
    r=api(action="query",list="search",srsearch=n,srlimit=5)["query"]["search"]
    hit=next((x["title"] for x in r if x["title"].endswith("（TCG）")),None)
    if not hit: continue
    q=api(action="query",titles=hit,prop="revisions",rvprop="content",rvslots="main",converttitles=1)
    pg=next(iter(q["query"]["pages"].values()))
    wt=pg["revisions"][0]["slots"]["main"]["*"][:4000]
    zh=hit.replace("（TCG）","").strip()
    ok = (n in wt) if lang=="ja" else (n.lower() in wt.lower())  # 頁面裡要真的有這個名字才算
    if ok: out[lang][n]=zh
    time.sleep(1.2)
  except Exception as e: print("fail",n,e)
json.dump(out,open("/tmp/o/setnames.json","w"),ensure_ascii=False,indent=0)
print("ja",len(out["ja"]),"en",len(out["en"]))
open("/tmp/o/sample.txt","w").write(json.dumps(list(out["ja"].items())[:5]+list(out["en"].items())[:5],ensure_ascii=False))
