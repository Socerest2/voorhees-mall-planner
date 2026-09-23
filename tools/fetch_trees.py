#!/usr/bin/env python3
"""Pull the real trees from Rutgers' TreePlotter inventory.

Source: https://cem.pg-cloud.com/Rutgers — the university's public Community
Engagement Map (TreePlotter by PlanIT Geo, 7,752 trees campus-wide). Its map
draws from vector tiles at

    https://cem.pg-cloud.com/customers/Rutgers/trees/{z}/{x}/{y}.pbf

so we read the same tiles, keep the ones covering the mall, and write
tools/trees_raw.json. build_site.py picks that up and prefers it over the
procedurally generated stand-in.

Each tree carries species, exact DBH in inches, and a condition rating. Crown
spread is NOT in the inventory — canopy radius here is estimated from DBH.

Usage:  python3 tools/fetch_trees.py [--zoom 15]
"""
import gzip, json, math, os, sys, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mvt

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "trees_raw.json")

BASE = "https://cem.pg-cloud.com"
TILES = BASE + "/customers/Rutgers/trees/{z}/{x}/{y}.pbf"
CONFIG = BASE + "/customers/Rutgers/tree_map_config.json"

# Same window build_site.py pulls from OSM, plus a little slack.
BBOX = (40.4980, -74.4512, 40.5036, -74.4432)      # s, w, n, e
ZOOM = 15                                          # tileset maxzoom

# Nothing but trunk diameter is surveyed, so canopy spread, total height and
# height to the lowest branch are all DERIVED from DBH by growth habit. Height
# uses H = base + ratio x DBH, capped, because the linear form badly
# under-predicts saplings. CROWN_BASE is the fraction of total height below the
# lowest limbs -- the number that decides whether anything fits underneath.
#
#   (spread per in, height per in, height cap ft, crown-base fraction)
HABIT = {
    # limbed-up park and street trees: the ones you can walk or drive under
    "shade": (2.2, 2.3, 85, 0.35),
    # pines, larch, cedar -- self-pruning, open beneath when mature
    "conifer_open": (1.3, 2.8, 90, 0.35),
    # spruce, fir, holly, arborvitae -- skirted to the ground, never passable
    "conifer_dense": (1.2, 2.6, 70, 0.05),
    # small flowering trees that branch low and stay low
    "ornamental": (2.0, 1.6, 32, 0.20),
    "default": (1.9, 2.0, 60, 0.28),
}
HABIT_WORDS = [
    ("conifer_dense", ("spruce", "fir", "arborvitae", "juniper", "cypress",
                       "hemlock", "holly", "yew", "cryptomeria", "boxwood")),
    ("conifer_open", ("pine", "larch", "cedar")),
    ("ornamental", ("dogwood", "cherry", "crabapple", "apple", "magnolia",
                    "redbud", "serviceberry", "hawthorn", "lilac", "witchhazel",
                    "viburnum", "chokeberry", "plum", "pear", "star ")),
    ("shade", ("oak", "maple", "elm", "zelkova", "honeylocust", "linden",
               "beech", "ash", "hickory", "walnut", "sycamore", "planetree",
               "tuliptree", "scholar", "ginkgo", "katsura", "basswood",
               "hackberry", "corktree", "locust", "sweetgum", "birch")),
]
HEIGHT_BASE = 4.5          # ft of stem before the ratio takes over
MAX_LIMBED = 25.0          # nobody prunes a park tree higher than this


def habit(species):
    s = (species or "").lower()
    for name, words in HABIT_WORDS:
        if any(w in s for w in words):
            return name
    return "default"


def dimensions(species, dbh):
    """-> (crown_ft, height_ft, clear_ft) from trunk diameter and growth habit."""
    spread, hr, cap, base = HABIT[habit(species)]
    if not dbh:
        return None, None, None
    crown = dbh * spread
    height = min(cap, HEIGHT_BASE + hr * dbh)
    # leave a real crown on the tree, and don't claim a limbed-up height
    # that no one would prune to
    clear = min(height * base, MAX_LIMBED, max(0.0, height - 6))
    return round(crown, 1), round(height, 1), round(clear, 1)


def get(url, binary=False):
    req = urllib.request.Request(url, headers={
        "User-Agent": "voorhees-mall-planner/1.0 (campus event planning)",
        "Referer": BASE + "/Rutgers",
        "Accept-Encoding": "gzip",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
    if r.headers.get("Content-Encoding") == "gzip":
        raw = gzip.decompress(raw)
    return raw if binary else json.loads(raw)


def lookups():
    """Field code -> label, from the map's own config."""
    cfg = get(CONFIG)
    out = {}
    for f in cfg.get("fields", []):
        vals = f.get("values")
        if vals:
            out[f["name"]] = {v["value"]: (v.get("alias") or "").strip()
                              for v in vals}
    return out


def main():
    zoom = ZOOM
    if "--zoom" in sys.argv:
        zoom = int(sys.argv[sys.argv.index("--zoom") + 1])

    codes = lookups()
    species = codes.get("species_common", {})
    condition = codes.get("condition", {})
    status = codes.get("status", {})

    s, w, n, e = BBOX
    x0, y0 = mvt.tile_xy(zoom, n, w)
    x1, y1 = mvt.tile_xy(zoom, s, e)

    trees, seen = [], set()
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            url = TILES.format(z=zoom, x=tx, y=ty)
            print(f"  {url}", file=sys.stderr)
            data = get(url, binary=True)
            for f in mvt.decode(data):
                if f["layer"] != "trees":
                    continue
                a = f["attrs"]
                for px, py in f["points"]:
                    lon, lat = mvt.tile_to_lonlat(zoom, tx, ty, px, py, f["extent"])
                    if not (s <= lat <= n and w <= lon <= e):
                        continue
                    key = (round(lat, 7), round(lon, 7))
                    if key in seen:              # tiles carry a buffer; dedupe
                        continue
                    seen.add(key)
                    sp = species.get(a.get("species_common"), "")
                    dbh = a.get("dbh_exact")
                    dbh = float(dbh) if isinstance(dbh, (int, float)) else None
                    crown, height, clear = dimensions(sp, dbh)
                    trees.append({
                        "lat": round(lat, 7), "lon": round(lon, 7),
                        "species": sp,
                        "dbh_in": dbh,
                        "condition": condition.get(a.get("condition"), ""),
                        "status": status.get(a.get("status"), ""),
                        "habit": habit(sp),
                        "crown_ft": crown,
                        "height_ft": height,
                        "clear_ft": clear,
                    })

    with open(OUT, "w") as fh:
        json.dump({
            "source": "Rutgers TreePlotter Community Engagement Map "
                      "(PlanIT Geo) — cem.pg-cloud.com/Rutgers",
            "tiles": TILES, "zoom": zoom, "bbox": list(BBOX),
            "note": "dbh_in, species, condition and status are surveyed; "
                    "crown_ft, height_ft and clear_ft are ESTIMATED from dbh "
                    "by growth habit -- screening figures, not survey data",
            "trees": trees,
        }, fh, indent=1)

    withd = [t for t in trees if t["dbh_in"]]
    print(f"{len(trees)} trees in the window, {len(withd)} with a measured DBH")
    if withd:
        big = sorted(withd, key=lambda t: -t["dbh_in"])[:5]
        print("largest: " + ", ".join(f"{t['species']} {t['dbh_in']:.0f}\"" for t in big))
    top = {}
    for t in trees:
        top[t["species"]] = top.get(t["species"], 0) + 1
    st = {}
    for t in trees:
        st[t["status"]] = st.get(t["status"], 0) + 1
    print("status: " + ", ".join(f"{k or '?'} ({v})" for k, v in
                                 sorted(st.items(), key=lambda kv: -kv[1])))
    print("most common: " + ", ".join(
        f"{k} ({v})" for k, v in sorted(top.items(), key=lambda kv: -kv[1])[:6]))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
