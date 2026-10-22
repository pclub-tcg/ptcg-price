import json,re,urllib.request,urllib.parse
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36","Accept":"*/*"}
TITLE = re.compile(r"^(.*?)\s+([A-Z]{1,4})?\s*\[([A-Za-z0-9]+) EN ([\w-]+(?:/\d{1,3})?)\]")
def get(u,js=False):
  b=urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=30).read()
  return json.loads(b) if js else b.decode("utf-8","replace")
for kw in ["[OBF EN ","[MEW EN "]:
  h=get("https://snkrdunk.com/search?keywords="+urllib.parse.quote(kw))
  for i in list(dict.fromkeys(re.findall(r"/apparels/(\d+)",h)))[:12]:
    a=get("https://snkrdunk.com/v1/apparels/%s"%i,True); t=a.get("localizedName") or ""
    print(bool(TITLE.match(t)), repr(t[:70]))
