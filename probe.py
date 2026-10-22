import json,urllib.request,urllib.parse
UA={"User-Agent":"Mozilla/5.0 PCLUB-price-site (spickertop-afk)"}
def api(**q):
  q.update(format="json"); u="https://wiki.52poke.com/api.php?"+urllib.parse.urlencode(q)
  return json.loads(urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=40).read())
for s in ["パラダイムトリガー","扩充包列表","集换式卡牌游戏扩充包"]:
  r=api(action="query",list="search",srsearch=s,srlimit=8)
  print("SEARCH",s,[x["title"] for x in r["query"]["search"]])
