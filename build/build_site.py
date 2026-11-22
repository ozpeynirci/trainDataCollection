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

meta = {x["slug"]: {"name": x["name"], "from": x["from"], "to": x["to"]} for x in trains}
adm = open("build/admin_template.html").read().replace("__TRAINMETA__", json.dumps(meta, ensure_ascii=False))
open("site/admin.html", "w").write(adm)
print("admin.html", len(adm) // 1024, "KB")
