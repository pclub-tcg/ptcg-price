import json, urllib.request, urllib.parse
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36","Accept":"*/*"}
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=30) as r:
            b=r.read(); return r.status, len(b), b[:300]
    except Exception as e: return "ERR", 0, str(e)[:200]
for u in ["https://snkrdunk.com/search?keywords="+urllib.parse.quote("[SV8 "),
          "https://api.pokemontcg.io/v2/cards?q=set.id:sv8&pageSize=2",
          "https://tcgcsv.com/tcgplayer/3/groups",
          "https://snkrdunk.com/v1/search?keyword="+urllib.parse.quote("SV8 SAR"),
          ]:
    print(u, get(u))
