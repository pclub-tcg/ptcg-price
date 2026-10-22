import csv, json, urllib.request, io
B = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/"
def load(f, idcol):
    r = csv.DictReader(io.StringIO(urllib.request.urlopen(B + f, timeout=60).read().decode("utf-8")))
    d = {}
    for row in r:
        d.setdefault(row[idcol], {})[row["local_language_id"]] = row["name"]
    return d
out = {"ja": {}, "en": {}}
for f, col in (("pokemon_species_names.csv", "pokemon_species_id"), ("item_names.csv", "item_id"), ("move_names.csv", "move_id"), ("ability_names.csv", "ability_id")):
    for _, L in load(f, col).items():
        zh = L.get("4")
        if not zh: continue
        for k in ("1", "11"):
            if L.get(k): out["ja"].setdefault(L[k], zh)
        if L.get("9"): out["en"].setdefault(L["9"].lower(), zh)
json.dump(out, open("names.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(len(out["ja"]), len(out["en"]))
