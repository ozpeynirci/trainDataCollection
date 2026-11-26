"""build/template.html + basemap + hatlar + trenler -> index.html"""
import json
t = open("build/template.html").read()
bm = open("build/basemap.json").read()
lines = json.load(open("build/lines.json"))
lines = {k: {"route": v["route"], "stations": v["stations"]} for k, v in lines.items()}
trains = json.load(open("trains.json"))
for x in trains: x.pop("dir_note", None)
out = t.replace("__BASEMAP__", bm).replace("__LINES__", json.dumps(lines, ensure_ascii=False, separators=(",", ":"))) \
       .replace("__TRAINS__", json.dumps(trains, ensure_ascii=False, separators=(",", ":")))
open("site/index.html", "w").write(out)
print("index.html", len(out) // 1024, "KB")

def mins(t): h, m = map(int, t.split(":")); return h * 60 + m
COLORS = {"konya-mavi": "#2563eb", "izmir-mavi": "#9333ea", "dogu": "#d97706"}
cat = []
for x in trains:
    dep = mins(x["stops"][0]["d"]); prev = dep; dur = 0
    for s in x["stops"][1:]:
        v = mins(s["a"] or s["d"])
        while v < prev: v += 1440
        prev = v; dur = v - dep
    cat.append({"slug": x["slug"], "no": x["no"], "name": x["name"], "line": x["line"], "lineName": x["name"],
                "color": COLORS.get(x["line"], "#64748b"), "from": x["from"], "to": x["to"], "depS": x["stops"][0]["d"], "dep": dep, "dur": dur})
adm = open("build/admin_template.html").read().replace("__CATALOG__", json.dumps(cat, ensure_ascii=False))
open("site/admin.html", "w").write(adm)
print("admin.html", len(adm) // 1024, "KB")
