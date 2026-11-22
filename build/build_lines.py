"""Hatlar için raya oturtulmuş güzergah ve istasyon konumları üretir.

Girdi : data_src/tcdd_raw.json (TCDD sefer detayları), aşağıdaki ANCHORS (bilinen yaklaşık koordinatlar)
Çıktı : build/lines.json  -> { lineId: { route:[[x,y]...], stations:{NAME:{xy:[x,y], s:float}} } }
Koordinatlar build_basemap.py ile aynı projeksiyondadır (W=2400, lon 25.4–45.2, lat 35.6–42.4).
Çapası olmayan istasyonlar, komşu çapalar arasındaki ray yolu üzerinde tarifedeki süre oranına göre yerleştirilir.
"""
import json, math, sys
from shapely.geometry import shape, box, LineString, Point
from shapely.ops import unary_union
import networkx as nx
from scipy.spatial import cKDTree

GEO = sys.argv[1] if len(sys.argv) > 1 else "/tmp/geo"
LON0, LON1, LAT0, LAT1 = 25.4, 45.2, 35.6, 42.4
KX = math.cos(math.radians(38.4)); W = 2400; SC = W / ((LON1 - LON0) * KX)
def P(lon, lat): return ((lon - LON0) * KX * SC, (LAT1 - lat) * SC)
def km(a, b): return math.hypot((a[0] - b[0]) * KX, a[1] - b[1]) * 111.0

ANCHORS = {  # (lat, lon) yaklaşık
  "İZMİR (BASMANE)": (38.4223, 27.1446), "ÇİĞLİ": (38.4950, 27.0720), "MENEMEN": (38.6050, 27.0690),
  "EMİRALEM": (38.6350, 27.1350), "MURADİYE": (38.6510, 27.3500), "MANİSA": (38.6160, 27.4290),
  "TURGUTLU": (38.4990, 27.7030), "AHMETLİ": (38.5190, 27.9380), "SALİHLİ": (38.4830, 28.1350),
  "ALAŞEHİR": (38.3500, 28.5170), "EŞME": (38.4000, 28.9700), "UŞAK": (38.6800, 29.4060),
  "BANAZ": (38.7370, 29.7520), "DUMLUPINAR": (38.8550, 30.0010), "AFYON A.ÇETİNKAYA": (38.7580, 30.5390),
  "ÇAVUŞCUGÖL": (38.3500, 31.7800), "ILGIN": (38.2790, 31.9140), "SARAYÖNÜ": (38.2630, 32.4060),
  "KONYA": (37.8650, 32.4650), "AKŞEHİR": (38.3570, 31.4160), "ÇAY": (38.5920, 31.0270),
  # İzmir – Balıkesir – Kütahya – Eskişehir – Ankara
  "SARUHANLI": (38.7330, 27.5660), "AKHİSAR": (38.9190, 27.8380), "KIRKAĞAÇ": (39.1060, 27.6720),
  "SOMA": (39.1860, 27.6090), "SAVAŞTEPE": (39.3830, 27.6560), "BALIKESİR": (39.6500, 27.8900),
  "DURSUNBEY": (39.5870, 28.6260), "TAVŞANLI": (39.5460, 29.4950), "KÜTAHYA": (39.4200, 29.9850),
  "ESKİŞEHİR": (39.7760, 30.5200), "ALPU": (39.7670, 30.9500), "BEYLİKOVA": (39.6900, 31.2100),
  "POLATLI": (39.5840, 32.1470), "SİNCAN": (39.9700, 32.5800), "ANKARA GAR": (39.9364, 32.8438),
  # Ankara – Kayseri – Sivas – Erzincan – Erzurum – Kars
  "KAYAŞ": (39.9200, 32.9300), "ELMADAĞ": (39.9200, 33.2300), "KIRIKKALE": (39.8450, 33.5150),
  "YERKÖY": (39.6380, 34.4700), "ŞEFAATLİ": (39.5000, 34.7500), "YENİFAKILI": (39.2100, 35.0000),
  "KAYSERİ": (38.7300, 35.4900), "ŞARKIŞLA": (39.3500, 36.4100), "SİVAS": (39.7500, 37.0200),
  "ÇETİNKAYA": (39.2500, 37.6200), "DİVRİĞİ": (39.3700, 38.1100), "İLİÇ": (39.4500, 38.5600),
  "KEMAH": (39.6000, 39.0300), "ERZİNCAN": (39.7400, 39.4900), "AŞKALE": (39.9200, 40.6900),
  "ILICA": (39.9500, 41.1000), "ERZURUM": (39.9100, 41.2700), "HASANKALE": (39.9800, 41.6800),
  "KÖPRÜKÖY": (39.9700, 41.8700), "HORASAN": (40.0400, 42.1700), "SARIKAMIŞ": (40.3300, 42.5900),
  "KARS": (40.6100, 43.1000),
}

LINES = {  # hat -> (ileri yön treni, geri yön treni)
  "konya-mavi": ("32007", "72008"),
  "izmir-mavi": ("32005", "22006"),
  "dogu": ("22010", "92009"),
}

def is_km(n): return n.startswith("KM.")
raw = json.load(open("data_src/tcdd_raw.json"))
def parse(no):
    out = []
    for row in raw[no]:
        n, a, d = row.split(",")
        if is_km(n): continue
        out.append((n, a or None, d or None))
    return out

# --- ray grafiği ---
BB = box(LON0, LAT0, LON1, LAT1)
lines = []
for f in json.load(open(f"{GEO}/ne_10m_railroads.geojson"))["features"]:
    g = shape(f["geometry"])
    if g.intersects(BB):
        g = g.intersection(BB)
        lines += [x for x in (g.geoms if hasattr(g, "geoms") else [g]) if x.geom_type == "LineString"]
G = nx.Graph()
key = lambda p: (round(p[0], 4), round(p[1], 4))
for l in lines:
    cs = [key(c) for c in l.coords]
    for a, b in zip(cs, cs[1:]):
        if a != b: G.add_edge(a, b, w=km(a, b))
nodes = list(G.nodes); arr = [(n[0] * KX, n[1]) for n in nodes]; tree = cKDTree(arr)
for i, n in enumerate(nodes):          # küçük boşlukları birleştir
    if G.degree(n) != 1: continue
    for j in tree.query_ball_point(arr[i], 1.5 / 111.0):
        m = nodes[j]
        if m != n and not G.has_edge(n, m): G.add_edge(n, m, w=km(n, m))
RU = unary_union(lines)
def nearest_node(lat, lon):
    d, i = tree.query((lon * KX, lat)); return nodes[i]

def tmin(s):
    h, m = map(int, s.split(":")); return h * 60 + m

def build_line(fwd_no, back_no):
    fwd = parse(fwd_no); back = parse(back_no)
    order = [n for n, _, _ in fwd]
    # geri yöndeki ekstra istasyonları (ileri yönde yoksa) sıraya yerleştir
    bnames = [n for n, _, _ in back][::-1]
    for i, n in enumerate(bnames):
        if n not in order:
            prev = next((bnames[j] for j in range(i - 1, -1, -1) if bnames[j] in order), None)
            order.insert(order.index(prev) + 1 if prev else 0, n)
    # ileri yön zamanları (dk, kümülatif); yoksa geri yönden ters
    def times(seq):
        t, prev, res = {}, None, {}
        base = None
        for n, a, d in seq:
            v = tmin(d or a)
            if base is None: base = v; prev = v
            while v < prev: v += 1440
            prev = v; res[n] = v - base
        return res
    tf = times(fwd); tb = times(back); tbmax = max(tb.values())
    T = {}
    for n in order:
        if n in tf: T[n] = tf[n]
    # eksikleri komşulardan doğrusal
    known = [n for n in order if n in T]
    for i, n in enumerate(order):
        if n in T: continue
        p = next(order[j] for j in range(i - 1, -1, -1) if order[j] in T)
        q = next(order[j] for j in range(i + 1, len(order)) if order[j] in T)
        # geri yön sürelerinden oran
        if n in tb and p in tb and q in tb and tb[p] != tb[q]:
            f = (tb[p] - tb[n]) / (tb[p] - tb[q])
        else: f = 0.5
        T[n] = T[p] + (T[q] - T[p]) * f
    # çapalar
    anchors = [n for n in order if n in ANCHORS and RU.distance(Point(ANCHORS[n][1], ANCHORS[n][0])) * 111 < 4.0]
    if order[0] not in anchors: anchors.insert(0, order[0])
    if order[-1] not in anchors: anchors.append(order[-1])
    route, anchor_pos, report = [], {}, []
    for a, b in zip(anchors, anchors[1:]):
        la1, lo1 = ANCHORS[a]; la2, lo2 = ANCHORS[b]
        na, nb = nearest_node(la1, lo1), nearest_node(la2, lo2)
        try:
            path = nx.shortest_path(G, na, nb, weight="w")
            pl = sum(km(p, q) for p, q in zip(path, path[1:]))
            ok = pl < 2.0 * km((lo1, la1), (lo2, la2)) + 10
        except nx.NetworkXNoPath:
            ok = False
        seg = [(lo1, la1)] + (list(path) if ok else []) + [(lo2, la2)]
        report.append(f"{a}->{b}: {'ray' if ok else 'DÜZ'}")
        if route and route[-1] == seg[0]: seg = seg[1:]
        route += seg
    RL = LineString(route)
    pos = {n: RL.project(Point(ANCHORS[n][1], ANCHORS[n][0])) for n in anchors}
    pos[anchors[0]] = 0.0; pos[anchors[-1]] = RL.length
    for i in range(1, len(anchors)):        # monoton
        pos[anchors[i]] = max(pos[anchors[i]], pos[anchors[i - 1]])
    for i, n in enumerate(order):           # çapasızlar: süre oranıyla
        if n in pos: continue
        p = next(order[j] for j in range(i - 1, -1, -1) if order[j] in pos)
        q = next(order[j] for j in range(i + 1, len(order)) if order[j] in pos)
        f = (T[n] - T[p]) / (T[q] - T[p]) if T[q] != T[p] else 0.5
        pos[n] = pos[p] + (pos[q] - pos[p]) * f
    RLs = RL.simplify(0.0012)
    route_px = [[round(x, 1), round(y, 1)] for x, y in (P(*c) for c in RLs.coords)]
    PL = LineString(route_px)
    stations = {}
    for n in order:
        pt = RL.interpolate(pos[n]); x, y = P(pt.x, pt.y)
        stations[n] = {"xy": [round(x, 1), round(y, 1)], "s": round(PL.project(Point(x, y)), 2)}
    return {"order": order, "route": route_px, "stations": stations}, report

out = {}
for lid, (f, b) in LINES.items():
    out[lid], rep = build_line(f, b)
    print(lid, len(out[lid]["order"]), "istasyon,", len(out[lid]["route"]), "nokta")
    print("  ", " | ".join(rep))
json.dump(out, open("build/lines.json", "w"), ensure_ascii=False)
