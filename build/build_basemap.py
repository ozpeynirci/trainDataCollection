"""Build an inline SVG basemap + rail-snapped route for the Konya Mavi tracker."""
import json, math, sys
from shapely.geometry import shape, box, mapping, LineString, Point
from shapely.ops import unary_union
import networkx as nx

GEO = sys.argv[1]
OUT = sys.argv[2]

LON0, LON1, LAT0, LAT1 = 25.4, 45.2, 35.6, 42.4
KX = math.cos(math.radians(38.4))
W = 2400
SC = W / ((LON1 - LON0) * KX)
H = round((LAT1 - LAT0) * SC)
BB = box(LON0 - 0.3, LAT0 - 0.3, LON1 + 0.3, LAT1 + 0.3)

def P(lon, lat):
    return ((lon - LON0) * KX * SC, (LAT1 - lat) * SC)

def ring_d(coords, close=True):
    pts = [P(x, y) for x, y in coords]
    out, last = [], None
    for x, y in pts:
        s = f"{x:.1f} {y:.1f}"
        if s != last:
            out.append(s); last = s
    if len(out) < 2:
        return ""
    return "M" + "L".join(out) + ("Z" if close else "")

def geom_d(g, close):
    if g.is_empty:
        return ""
    t = g.geom_type
    if t == "Polygon":
        return ring_d(g.exterior.coords) + "".join(ring_d(i.coords) for i in g.interiors)
    if t == "LineString":
        return ring_d(g.coords, False)
    if hasattr(g, "geoms"):
        return "".join(geom_d(x, close) for x in g.geoms)
    return ""

def load(name, simplify, close=True, filt=None):
    d = json.load(open(f"{GEO}/{name}"))
    parts = []
    for f in d["features"]:
        if filt and not filt(f):
            continue
        g = shape(f["geometry"])
        if not g.intersects(BB):
            continue
        g = g.intersection(BB).simplify(simplify, preserve_topology=True)
        parts.append(geom_d(g, close))
    return "".join(parts)

land = load("ne_10m_land.geojson", 0.004)
lakes = load("ne_10m_lakes.geojson", 0.003)
rivers = load("ne_10m_rivers_lake_centerlines.geojson", 0.004, close=False)

# provinces: borders + labels
prov = json.load(open(f"{GEO}/tr.json"))
prov_d, labels = [], []
for f in prov["features"]:
    g = shape(f["geometry"])
    if not g.intersects(BB):
        continue
    gi = g.intersection(BB).simplify(0.004, preserve_topology=True)
    prov_d.append(geom_d(gi, True))
    c = g.representative_point()
    if LON0 + 0.15 < c.x < LON1 - 0.15 and LAT0 + 0.08 < c.y < LAT1 - 0.05:
        x, y = P(c.x, c.y)
        labels.append([f["properties"]["name"], round(x, 1), round(y, 1)])

# railroads -> graph
rr = json.load(open(f"{GEO}/ne_10m_railroads.geojson"))
lines = []
for f in rr["features"]:
    g = shape(f["geometry"])
    if g.intersects(BB):
        g = g.intersection(BB)
        lines += list(g.geoms) if hasattr(g, "geoms") else [g]
lines = [l for l in lines if l.geom_type == "LineString"]
rail_d = "".join(ring_d(l.simplify(0.002).coords, False) for l in lines)
RB = box(26.0, 37.0, 33.5, 39.8)
lines = [l for l in lines if l.intersects(RB)]

G = nx.Graph()
def key(p): return (round(p[0], 4), round(p[1], 4))
def dist(a, b):
    return math.hypot((a[0] - b[0]) * KX, a[1] - b[1]) * 111.0
for l in lines:
    cs = [key(c) for c in l.coords]
    for a, b in zip(cs, cs[1:]):
        if a != b:
            G.add_edge(a, b, w=dist(a, b))
# stitch near-touching endpoints (NE data has small gaps)
nodes = list(G.nodes)
deg1 = [n for n in nodes if G.degree(n) == 1]
for a in deg1:
    best, bd = None, 1e9
    for b in nodes:
        if b == a or G.has_edge(a, b):
            continue
        d = dist(a, b)
        if d < bd:
            best, bd = b, d
    if best and bd < 1.5:
        G.add_edge(a, best, w=bd)

segs, report = [], []
stations = json.load(open(sys.argv[3]))  # [[name, lat, lon], ...]
from shapely.ops import unary_union
RU = unary_union(lines)
def near_rail_km(lat, lon): return RU.distance(Point(lon, lat)) * 111
def nearest(lat, lon):
    return min(G.nodes, key=lambda n: dist(n, (lon, lat)))
anchors = [i for i, (n, la, lo) in enumerate(stations) if near_rail_km(la, lo) < 2.0 or i in (0, len(stations) - 1)]
route = []
for i, j in zip(anchors, anchors[1:]):
    (n1, la1, lo1), (n2, la2, lo2) = stations[i], stations[j]
    a, b = nearest(la1, lo1), nearest(la2, lo2)
    try:
        path = nx.shortest_path(G, a, b, weight="w")
        pl = sum(dist(p, q) for p, q in zip(path, path[1:]))
        st = dist((lo1, la1), (lo2, la2))
        ok = pl < 2.2 * st + 8
    except nx.NetworkXNoPath:
        path, ok = None, False
    seg = list(path) if ok else [(lo1, la1), (lo2, la2)]
    report.append(f"{n1}->{n2}: {'rail' if ok else 'STRAIGHT'}")
    if route and route[-1] == seg[0]:
        seg = seg[1:]
    route += seg
RL = LineString(route)
# station positions along the route (km-ish units in degrees), monotonic
pos = []
for i, (n, la, lo) in enumerate(stations):
    d = RL.project(Point(lon if False else lo, la))
    pos.append(d)
pos[0], pos[-1] = 0.0, RL.length
for i in range(1, len(pos)):
    if pos[i] < pos[i - 1]:
        pos[i] = pos[i - 1]
st_pts = [RL.interpolate(d) for d in pos]
RLs = RL.simplify(0.0012)
segs = [[round(x, 1), round(y, 1)] for x, y in (P(*c) for c in RLs.coords)]
# station positions in px & their arc-length along the px polyline
def proj_px(pt):
    return P(pt.x, pt.y)
st_px_pts = [proj_px(p) for p in st_pts]
from shapely.geometry import LineString as LS
PL = LS(segs)
st_s = [round(PL.project(Point(*xy)), 2) for xy in st_px_pts]
for i in range(1, len(st_s)):
    st_s[i] = max(st_s[i], st_s[i - 1])
st_px = [[round(x, 1), round(y, 1)] for x, y in st_px_pts]
json.dump({"W": W, "H": H, "land": land, "lakes": lakes, "rivers": rivers,
           "prov": "".join(prov_d), "rail": rail_d, "labels": labels,
           "route": segs, "st": st_px, "st_s": st_s}, open(OUT, "w"), ensure_ascii=False)
print("\n".join(report))
print("H", H, "sizes", {k: len(v) for k, v in [("land", land), ("lakes", lakes), ("rivers", rivers), ("prov", "".join(prov_d)), ("rail", rail_d)]})
