import json,urllib.request
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36","Accept":"*/*"}
g=lambda u:json.loads(urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=30).read())
for sid in (110910,408333):
  a=g("https://snkrdunk.com/v1/apparels/%d"%sid); pid=a["productCatalogId"]; print("SID",sid,a.get("localizedName"),pid)
  for c in ("","&condition_code=trading_card_single_nearly_unused","&condition_code=trading_card_single_psa10"):
    h=g("https://snkrdunk.com/v3/products/%s/trading-history?range=all%s"%(pid,c))
    print("COND",c,"keys",list(h.keys()),"ntr",len(h.get("trades") or []))
    print(json.dumps((h.get("trades") or [])[:3],ensure_ascii=False)[:900])
