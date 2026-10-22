import json,re,urllib.request,urllib.parse
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36","Accept":"*/*"}
def get(u,js=False):
  b=urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=30).read()
  return json.loads(b) if js else b.decode("utf-8","replace")
for kw in ["[OBF EN ","[MEW EN ","[PAL EN ","英語版 PSA10","英語版 SAR"]:
  h=get("https://snkrdunk.com/search?keywords="+urllib.parse.quote(kw))
  ids=list(dict.fromkeys(re.findall(r"/apparels/(\d+)",h)))
  print("KW",kw,len(ids))
  for i in ids[:10]:
    a=get("https://snkrdunk.com/v1/apparels/%s"%i,True); print(" ",i,a.get("localizedName"))
