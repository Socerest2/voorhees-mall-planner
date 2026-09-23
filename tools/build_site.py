#!/usr/bin/env python3
"""Build the Voorhees Mall base map from OpenStreetMap.

Fetches raw OSM geometry via Overpass, projects it to a local grid in FEET
centered on the Voorhees Mall lawn, and writes data/voorhees-mall.json.

Everything downstream is 1:1 — one unit in the JSON is one real-world foot.

Usage:  python3 tools/build_site.py [--refetch]
"""
import json, math, os, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(HERE, "osm_raw.json")
TREES = os.path.join(HERE, "trees_raw.json")
LIDAR = os.path.join(HERE, "lidar_trees.json")
OUT = os.path.join(ROOT, "data", "voorhees-mall.json")

BBOX = "40.4985,-74.4505,40.5030,-74.4440"   # generous box around the mall
QUERY = f"""
[out:json][timeout:120];
(
  way["building"]({BBOX});
  way["leisure"]({BBOX});
  way["landuse"]({BBOX});
  way["highway"]({BBOX});
  way["amenity"="parking"]({BBOX});
  way["natural"]({BBOX});
  node["natural"="tree"]({BBOX});
);
out body geom;
"""

M_PER_FT = 0.3048
FT = 1 / M_PER_FT

# Roads we care about naming; everything else stays generic.
ROAD_KINDS = {"residential", "tertiary", "secondary", "primary", "service", "unclassified"}
PATH_KINDS = {"footway", "path", "pedestrian", "steps", "cycleway"}

# Default painted widths (feet) when OSM has no width tag.
DEFAULT_WIDTH = {
    "footway": 8, "path": 8, "pedestrian": 20, "steps": 8, "cycleway": 8,
    "service": 16, "residential": 30, "tertiary": 36, "secondary": 40,
    "primary": 44, "unclassified": 28,
}


ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
]


def fetch():
    """Overpass is free and often busy — retry, then try a mirror."""
    data = urllib.parse.urlencode({"data": QUERY}).encode()
    last = None
    for url in ENDPOINTS:
        for attempt in range(3):
            try:
                print(f"fetching {url} (try {attempt + 1})…", file=sys.stderr)
                req = urllib.request.Request(url, data=data, headers={
                    "User-Agent": "voorhees-mall-planner/1.0"})
                with urllib.request.urlopen(req, timeout=240) as r:
                    blob = r.read()
                with open(RAW, "wb") as f:
                    f.write(blob)
                return json.loads(blob)
            except Exception as e:
                last = e
                print(f"  {e}", file=sys.stderr)
                time.sleep(10 * (attempt + 1))
    raise SystemExit(f"every Overpass endpoint failed; last error: {last}")


def load():
    if not os.path.exists(RAW) or "--refetch" in sys.argv:
        return fetch()
    return json.load(open(RAW))



def point_in(poly, x, y):
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xi:
                inside = not inside
    return inside


def ray_len(poly, x, y, dx, dy, cap=400.0):
    """Distance from (x,y) to the polygon boundary along (dx,dy)."""
    best = cap
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        ex, ey = x2 - x1, y2 - y1
        den = dx * ey - dy * ex
        if abs(den) < 1e-9:
            continue
        t = ((x1 - x) * ey - (y1 - y) * ex) / den      # along the ray
        u = ((x1 - x) * dy - (y1 - y) * dx) / den      # along the edge
        if t > 1e-6 and -1e-9 <= u <= 1 + 1e-9:
            best = min(best, t)
    return best


def gen_trees(lawn, buildings, inset=26.0, spacing=55.0, clear=24.0, min_width=70.0):
    """Approximate the tree allee that lines the mall.

    OSM maps no trees here, so we walk the lawn boundary and drop a tree every
    `spacing` feet, set `inset` feet in from the edge. A candidate is dropped if
    the lawn is narrower than `min_width` across at that point (keeps trees out
    of the thin connector arms), if it crowds a building, or if it crowds a tree
    already placed. Marked src:"approx" -- drag them in the app to correct.
    """
    walls = [b["ring"] for b in buildings]
    out, carry = [], 0.0
    n = len(lawn)
    for i in range(n):
        (x1, y1), (x2, y2) = lawn[i], lawn[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy)
        if L < 25:                       # short jog: no room for a row
            carry = max(0.0, carry - L)
            continue
        ux, uy = dx / L, dy / L
        nx, ny = -uy, ux
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        if not point_in(lawn, mx + nx * 3, my + ny * 3):
            nx, ny = -nx, -ny            # normal must point into the lawn
        d = carry
        while d < L:
            tx = x1 + ux * d + nx * inset
            ty = y1 + uy * d + ny * inset
            d += spacing
            if not point_in(lawn, tx, ty):
                continue
            if ray_len(lawn, tx, ty, nx, ny) + inset < min_width:
                continue
            if any(min(math.hypot(tx - px, ty - py) for px, py in ring) < clear
                   for ring in walls):
                continue
            if any(math.hypot(tx - t["p"][0], ty - t["p"][1]) < spacing * 0.85
                   for t in out):
                continue
            h = (int(abs(tx) * 7) + int(abs(ty) * 13)) % 100   # deterministic jitter
            out.append({"p": [round(tx, 1), round(ty, 1)],
                        "r": round(17 + h % 6, 1), "src": "approx"})
        carry = d - L
    return out

def load_lidar():
    """lat/lon -> measured height and crown base, where the point cloud had enough."""
    if not os.path.exists(LIDAR):
        return {}
    doc = json.load(open(LIDAR))
    return {(t["lat"], t["lon"]): t for t in doc["trees"] if "height_ft" in t}


def load_inventory(proj, near):
    """Real trees from Rutgers' TreePlotter inventory, if fetch_trees.py has run."""
    if not os.path.exists(TREES):
        return []
    doc = json.load(open(TREES))
    measured = load_lidar()
    out = []
    n_meas = 0
    for t in doc["trees"]:
        st = t.get("status") or ""
        if st in ("Removed",) or st.startswith("Proposed"):
            continue                      # not a thing you have to plan around
        p = proj({"lat": t["lat"], "lon": t["lon"]})
        if not near([p]):
            continue
        crown = t.get("crown_ft")
        r = round(crown / 2, 1) if crown else 8.0
        rec = {"p": p, "r": max(4.0, min(45.0, r)), "src": "rutgers",
               "sp": t.get("species") or "", "dbh": t.get("dbh_in"),
               "cond": t.get("condition") or "",
               # h = total height, clr = height to the lowest limbs -- clr is
               # what decides what fits underneath. Measured off the LiDAR
               # where the cloud was dense enough, inferred from DBH otherwise.
               "h": t.get("height_ft"), "clr": t.get("clear_ft"),
               "hab": t.get("habit"), "hsrc": "dbh"}
        m = measured.get((t["lat"], t["lon"]))
        if m:
            rec["h"] = m["height_ft"]
            rec["clr"] = m["clear_ft"]
            rec["hsrc"] = "lidar"
            rec["npts"] = m["n"]
            n_meas += 1
        # a dead tree or a stump casts no shade -- flag it so the app can say so
        if st in ("Dead", "Stump") or rec["cond"] == "Dead":
            rec["gone"] = st or "Dead"
        out.append(rec)
    print(f"{n_meas} of {len(out)} trees have LiDAR-measured height", file=sys.stderr)
    return out


def main():
    osm = load()
    els = osm["elements"]

    mall = next(e for e in els if e.get("tags", {}).get("name") == "Voorhees Mall")

    # Local tangent-plane projection, origin = mall centroid, units = feet.
    g = mall["geometry"]
    lat0 = sum(p["lat"] for p in g) / len(g)
    lon0 = sum(p["lon"] for p in g) / len(g)
    # WGS84 local scale at this latitude (good to a few cm over the site)
    phi = math.radians(lat0)
    m_lat = (111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
             - 0.0023 * math.cos(6 * phi))
    m_lon = (111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
             + 0.118 * math.cos(5 * phi))
    kx = m_lon * FT                                      # ft per degree lon
    ky = m_lat * FT                                      # ft per degree lat

    def proj(pt):
        return [round((pt["lon"] - lon0) * kx, 2), round((pt["lat"] - lat0) * ky, 2)]

    def ring(e):
        return [proj(p) for p in e["geometry"]]

    lawn = ring(mall)

    # ---- principal axis of the lawn, so the app can lay it out landscape ----
    cx = sum(p[0] for p in lawn) / len(lawn)
    cy = sum(p[1] for p in lawn) / len(lawn)
    sxx = sum((p[0] - cx) ** 2 for p in lawn)
    syy = sum((p[1] - cy) ** 2 for p in lawn)
    sxy = sum((p[0] - cx) * (p[1] - cy) for p in lawn)
    axis_deg = math.degrees(0.5 * math.atan2(2 * sxy, sxx - syy))

    def bbox(ring_):
        xs = [p[0] for p in ring_]; ys = [p[1] for p in ring_]
        return min(xs), min(ys), max(xs), max(ys)

    lx0, ly0, lx1, ly1 = bbox(lawn)
    # Just the mall. Enough to carry the buildings that front it, the streets
    # that bound it and Lot 9 off the south end -- nothing beyond that.
    PAD = 150.0

    def near(ring_):
        x0, y0, x1, y1 = bbox(ring_)
        return not (x1 < lx0 - PAD or x0 > lx1 + PAD or y1 < ly0 - PAD or y0 > ly1 + PAD)

    # buildings/paths are collected before the inventory is read, so hold onto
    # the projection and the window test for load_inventory below

    buildings, paths, roads, greens, trees, parking = [], [], [], [], [], []
    for e in els:
        t = e.get("tags", {})
        if e["type"] == "node":
            if t.get("natural") == "tree":
                trees.append({"p": proj(e), "src": "osm",
                              "r": float(t.get("diameter_crown", 26)) / 2})
            continue
        if not e.get("geometry"):
            continue
        pts = ring(e)
        if not near(pts):
            continue
        name = t.get("name", "")
        if t.get("building"):
            buildings.append({"id": e["id"], "name": name, "ring": pts,
                              "kind": t.get("building")})
        elif t.get("highway") in PATH_KINDS:
            w = t.get("width")
            paths.append({"id": e["id"], "name": name, "kind": t["highway"],
                          "line": pts,
                          "w": round(float(w) * FT, 1) if w and w.replace('.', '').isdigit()
                               else DEFAULT_WIDTH[t["highway"]]})
        elif t.get("highway") in ROAD_KINDS:
            roads.append({"id": e["id"], "name": name, "kind": t["highway"],
                          "line": pts, "w": DEFAULT_WIDTH[t["highway"]]})
        elif t.get("amenity") == "parking":
            parking.append({"id": e["id"], "name": name, "ring": pts,
                            "access": t.get("access", ""),
                            "op": t.get("operator", "")})
        elif e["id"] != mall["id"] and (
                t.get("leisure") in {"park", "village_green", "garden", "pitch"}
                or t.get("landuse") == "grass"):
            greens.append({"id": e["id"], "name": name, "ring": pts,
                           "kind": t.get("leisure") or t.get("landuse")})

    inv = load_inventory(proj, near)
    if inv:
        trees = inv                      # real survey beats anything generated
    elif not trees:
        trees = gen_trees(lawn, buildings)

    out = {
        "meta": {
            "name": "Voorhees Mall, Rutgers–New Brunswick",
            "units": "feet",
            "origin": {"lat": lat0, "lon": lon0,
                       "note": "grid origin = centroid of the OSM Voorhees Mall polygon; "
                               "+x = east, +y = north"},
            "ft_per_deg": {"lon": kx, "lat": ky},
            "lawn_axis_deg": round(axis_deg, 2),
            "source": "OpenStreetMap contributors, ODbL 1.0",
            "tree_source": ("Rutgers TreePlotter Community Engagement Map "
                            "(PlanIT Geo). Species, DBH, condition and status "
                            "are surveyed; crown spread is estimated from DBH. "
                            "Height and clearance are measured from NJ 2014 "
                            "LiDAR where the point cloud allowed, else "
                            "estimated from DBH"),
            "generated_by": "tools/build_site.py",
        },
        "lawn": lawn,
        "greens": greens,
        "parking": sorted(parking, key=lambda p: p["name"] or "zz"),
        "buildings": sorted(buildings, key=lambda b: -abs(b["ring"][0][0])),
        "paths": paths,
        "roads": roads,
        "trees": trees,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))

    span = math.hypot(lx1 - lx0, ly1 - ly0)
    print(f"lawn bbox {lx1-lx0:.0f} x {ly1-ly0:.0f} ft (diag {span:.0f} ft), axis {axis_deg:.1f}°")
    print(f"{len(buildings)} buildings, {len(paths)} paths, {len(roads)} roads, "
          f"{len(greens)} other green, {len(parking)} parking, {len(trees)} trees "
          f"({sum(1 for t in trees if t['src'] == 'rutgers')} from the Rutgers "
          f"inventory, {sum(1 for t in trees if t['src'] == 'approx')} approximated)")
    print(f"wrote {OUT} ({os.path.getsize(OUT)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
