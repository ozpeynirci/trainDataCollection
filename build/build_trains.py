"""data_src/tcdd_raw.json -> trains.json (site ve veri çekici ortak kullanır)."""
import json
raw = json.load(open("data_src/tcdd_raw.json"))
lines = json.load(open("build/lines.json"))
META = [  # slug, trenNo, ad, hat, yön(+1 ileri / -1 geri)
  ("konya-mavi-izmir-konya", "32007", "Konya Mavi Treni", "konya-mavi", 1),
  ("konya-mavi-konya-izmir", "72008", "Konya Mavi Treni", "konya-mavi", -1),
  ("izmir-mavi-izmir-ankara", "32005", "İzmir Mavi Treni", "izmir-mavi", 1),
  ("izmir-mavi-ankara-izmir", "22006", "İzmir Mavi Treni", "izmir-mavi", -1),
  ("dogu-ankara-kars", "22010", "Doğu Ekspresi", "dogu", 1),
  ("dogu-kars-ankara", "92009", "Doğu Ekspresi", "dogu", -1),
]
def title(n):
    s = n.lower().replace("i̇", "i")
    s = n.translate(str.maketrans("İIÇŞĞÜÖ", "iıçşğüö")).lower()
    out, up = [], True
    for ch in s:
        if up and ch.isalpha():
            out.append(ch.translate(str.maketrans("iıçşğüö", "İIÇŞĞÜÖ")).upper()); up = False
        else:
            out.append(ch)
        if ch in " (.-/": up = True
    return "".join(out)
trains = []
for slug, no, name, line, d in META:
    stops = []
    for row in raw[no]:
        n, a, dep = row.split(",")
        if n.startswith("KM."): continue
        stops.append({"tcdd": n, "name": title(n), "a": a or None, "d": dep or None})
    trains.append({"slug": slug, "no": no, "name": name, "line": line, "dir": d,
                   "from": stops[0]["name"], "to": stops[-1]["name"], "stops": stops})
json.dump(trains, open("trains.json", "w"), ensure_ascii=False, indent=1)
for t in trains: print(t["no"], t["name"], t["from"], "→", t["to"], len(t["stops"]), t["stops"][0]["d"], t["stops"][-1]["a"])
print([s["name"] for s in trains[4]["stops"]][:12])
