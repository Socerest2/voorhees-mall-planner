#!/usr/bin/env python3
"""Measure tree height and crown base from LiDAR, instead of guessing from DBH.

The Rutgers inventory records trunk diameter and no height at all, so
fetch_trees.py has to infer both. This reads the actual point cloud and
replaces the inference with a measurement.

Source: New Jersey statewide LiDAR, open on S3 with no credentials --
  s3://njogis-elevation/NortheastNJPostSandy_2014_QL2/LAS_1.2_Classified/
Tiles 18TWK460820 and 18TWK460835 cover Voorhees Mall at ~3.4 pts/m2, flown
21 October 2014. Download them into tools/lidar/ first:

  B=https://njogis-elevation.s3.us-west-2.amazonaws.com/NortheastNJPostSandy_2014_QL2/LAS_1.2_Classified
  curl -o tools/lidar/18TWK460820.las $B/18TWK460820.las
  curl -o tools/lidar/18TWK460835.las $B/18TWK460835.las

Classification in these tiles is sparse -- there is no vegetation class at all:
  2, 18 = ground (18 is flightline overlap)
  1, 17 = everything else, so canopy AND rooftops (17 is overlap)
Buildings are therefore masked out using the OSM footprints we already have,
or every tree beside a hall would report a roof as its crown.

Usage:  python3 tools/lidar_heights.py
"""
import json, math, os, struct, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TILES = os.path.join(HERE, "lidar")
TREES = os.path.join(HERE, "trees_raw.json")
OSM = os.path.join(HERE, "osm_raw.json")
OUT = os.path.join(HERE, "lidar_trees.json")

M_FT = 3.280839895
GROUND_CLS = (2, 18)
CANOPY_CLS = (1, 17)

CELL = 2.0          # m, ground raster
MIN_PTS = 8         # canopy returns needed before we trust a tree
BIN = 1.0           # m, vertical histogram for finding the crown base
CROWN_FRAC = 0.15   # a bin this full of the peak counts as "in the crown"

PT = np.dtype([('X', '<i4'), ('Y', '<i4'), ('Z', '<i4'), ('int', '<u2'),
               ('bits', 'u1'), ('cls', 'u1'), ('ang', 'i1'), ('user', 'u1'),
               ('src', '<u2'), ('t', '<f8')])


def utm18(lat, lon):
    k0, a, f = 0.9996, 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f); ep2 = e2 / (1 - e2)
    lon0 = math.radians(-75.0)
    p, l = math.radians(lat), math.radians(lon)
    N = a / math.sqrt(1 - e2 * math.sin(p) ** 2)
    T = math.tan(p) ** 2; C = ep2 * math.cos(p) ** 2
    A = (l - lon0) * math.cos(p)
    M = a * ((1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256) * p
             - (3 * e2 / 8 + 3 * e2**2 / 32 + 45 * e2**3 / 1024) * math.sin(2 * p)
             + (15 * e2**2 / 256 + 45 * e2**3 / 1024) * math.sin(4 * p)
             - (35 * e2**3 / 3072) * math.sin(6 * p))
    E = k0 * N * (A + (1 - T + C) * A**3 / 6
                  + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A**5 / 120) + 500000
    Nn = k0 * (M + N * math.tan(p) * (A * A / 2
               + (5 - T + 9 * C + 4 * C * C) * A**4 / 24
               + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A**6 / 720))
    return E, Nn


def read_las(path, box):
    """Points inside `box`, as (x, y, z, classification)."""
    with open(path, 'rb') as f:
        h = f.read(227)
        if h[:4] != b'LASF':
            raise ValueError(f"{path} is not a LAS file")
        off = struct.unpack('<I', h[96:100])[0]
        fmt, rec = h[104], struct.unpack('<H', h[105:107])[0]
        n = struct.unpack('<I', h[107:111])[0]
        sx, sy, sz = struct.unpack('<ddd', h[131:155])
        ox, oy, oz = struct.unpack('<ddd', h[155:179])
        maxx, minx, maxy, miny = struct.unpack('<dddd', h[179:211])
        if (maxx < box[0] or minx > box[2] or maxy < box[1] or miny > box[3]):
            return None                      # tile misses the site entirely
        if fmt != 1 or rec != 28:
            raise ValueError(f"{path}: expected point format 1 / 28 bytes, got {fmt}/{rec}")
        f.seek(off)
        a = np.frombuffer(f.read(n * rec), dtype=PT, count=n)
    x = a['X'] * sx + ox; y = a['Y'] * sy + oy; z = a['Z'] * sz + oz
    m = (x >= box[0]) & (x <= box[2]) & (y >= box[1]) & (y <= box[3])
    return x[m], y[m], z[m], a['cls'][m]


def raster(x, y, val, box, cell, how='mean'):
    """Bin values onto a grid; returns (grid, width, height)."""
    W = int((box[2] - box[0]) // cell) + 1
    H = int((box[3] - box[1]) // cell) + 1
    i = np.clip(((x - box[0]) // cell).astype(int), 0, W - 1)
    j = np.clip(((y - box[1]) // cell).astype(int), 0, H - 1)
    flat = i * H + j
    if how == 'any':
        g = np.zeros(W * H, bool); g[flat] = True
        return g.reshape(W, H), W, H
    s = np.zeros(W * H); c = np.zeros(W * H)
    np.add.at(s, flat, val); np.add.at(c, flat, 1)
    g = np.where(c > 0, s / np.maximum(c, 1), np.nan)
    return g.reshape(W, H), W, H


def fill(grid):
    """Fill gaps in the ground raster from the nearest filled cell."""
    out = grid.copy()
    bad = ~np.isfinite(out)
    if not bad.any():
        return out
    idx = np.argwhere(np.isfinite(out))
    vals = out[np.isfinite(out)]
    for i, j in np.argwhere(bad):
        d = (idx[:, 0] - i) ** 2 + (idx[:, 1] - j) ** 2
        out[i, j] = vals[d.argmin()]
    return out


def crown_base(h, top):
    """Lowest height at which returns become a sustained crown, in metres."""
    if top < 2.0:
        return 0.0
    edges = np.arange(0.5, top + BIN, BIN)
    cnt, _ = np.histogram(h, bins=edges)
    if cnt.sum() == 0:
        return 0.0
    peak = cnt.max()
    need = max(2, CROWN_FRAC * peak)
    for k in range(len(cnt) - 1):
        if cnt[k] >= need and cnt[k + 1] >= need:
            return float(edges[k])
    return float(edges[int(np.argmax(cnt))])      # single dense layer


def main():
    doc = json.load(open(TREES))
    trees = doc["trees"]
    pos = [utm18(t["lat"], t["lon"]) for t in trees]
    ex = [p[0] for p in pos]; ny = [p[1] for p in pos]
    pad = 25.0
    box = (min(ex) - pad, min(ny) - pad, max(ex) + pad, max(ny) + pad)
    print(f"site window {box[2]-box[0]:.0f} x {box[3]-box[1]:.0f} m", file=sys.stderr)

    chunks = []
    for name in sorted(os.listdir(TILES)):
        if not name.endswith(".las"):
            continue
        got = read_las(os.path.join(TILES, name), box)
        if got is None:
            print(f"  {name}: outside the site", file=sys.stderr)
            continue
        print(f"  {name}: {len(got[0]):,} points", file=sys.stderr)
        chunks.append(got)
    if not chunks:
        sys.exit("no LAS tiles cover the site — see the header of this file")
    X = np.concatenate([c[0] for c in chunks])
    Y = np.concatenate([c[1] for c in chunks])
    Z = np.concatenate([c[2] for c in chunks])
    C = np.concatenate([c[3] for c in chunks])
    del chunks

    g = np.isin(C, GROUND_CLS)
    ground, GW, GH = raster(X[g], Y[g], Z[g], box, CELL)
    print(f"ground raster {100*np.isfinite(ground).mean():.0f}% filled from "
          f"{g.sum():,} returns", file=sys.stderr)
    ground = fill(ground)

    # Rooftops are unclassified here, so mask them with the OSM footprints.
    # The mask has to follow the actual polygon: a bounding box round an
    # L-shaped hall swallows the courtyard, and with it every tree beside it.
    mask = np.zeros((GW, GH), bool)
    if os.path.exists(OSM):
        osm = json.load(open(OSM))
        gx = box[0] + (np.arange(GW) + 0.5) * CELL
        gy = box[1] + (np.arange(GH) + 0.5) * CELL
        nb = 0
        for e in osm["elements"]:
            if not e.get("tags", {}).get("building") or not e.get("geometry"):
                continue
            ring = [utm18(p["lat"], p["lon"]) for p in e["geometry"]]
            xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
            if max(xs) < box[0] or min(xs) > box[2]: continue
            if max(ys) < box[1] or min(ys) > box[3]: continue
            i0 = max(0, int((min(xs) - box[0]) // CELL))
            i1 = min(GW, int((max(xs) - box[0]) // CELL) + 2)
            j0 = max(0, int((min(ys) - box[1]) // CELL))
            j1 = min(GH, int((max(ys) - box[1]) // CELL) + 2)
            if i1 <= i0 or j1 <= j0: continue
            px, py = np.meshgrid(gx[i0:i1], gy[j0:j1], indexing='ij')
            inside = np.zeros(px.shape, bool)
            n = len(ring)
            for k in range(n):                       # ray cast, vectorised
                x1, y1 = ring[k]; x2, y2 = ring[(k + 1) % n]
                if y1 == y2: continue
                hit = ((y1 > py) != (y2 > py))
                xint = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
                inside ^= hit & (px < xint)
            mask[i0:i1, j0:j1] |= inside
            nb += 1
        print(f"masked {mask.sum()} cells across {nb} footprints", file=sys.stderr)

    can = np.isin(C, CANOPY_CLS)
    cx, cy, cz = X[can], Y[can], Z[can]
    ci = np.clip(((cx - box[0]) // CELL).astype(int), 0, GW - 1)
    cj = np.clip(((cy - box[1]) // CELL).astype(int), 0, GH - 1)
    ch = cz - ground[ci, cj]
    keep = (~mask[ci, cj]) & (ch > 0.4) & (ch < 45)
    cx, cy, ch = cx[keep], cy[keep], ch[keep]
    print(f"{len(ch):,} canopy returns after masking", file=sys.stderr)

    out, measured = [], 0
    for t, (ex1, ny1) in zip(trees, pos):
        crown_m = (t.get("crown_ft") or 20) / M_FT
        r = min(7.0, max(2.0, crown_m * 0.40))
        near = (np.abs(cx - ex1) < r) & (np.abs(cy - ny1) < r)
        h = ch[near]
        h = h[(cx[near] - ex1) ** 2 + (cy[near] - ny1) ** 2 < r * r]
        rec = {"lat": t["lat"], "lon": t["lon"], "n": int(len(h))}
        if len(h) >= MIN_PTS:
            top = float(np.percentile(h, 98))
            base = crown_base(h, top)
            rec["height_ft"] = round(top * M_FT, 1)
            rec["clear_ft"] = round(min(base, max(0.0, top - 2.0)) * M_FT, 1)
            rec["radius_m"] = round(r, 1)
            measured += 1
        out.append(rec)

    json.dump({
        "source": "NJ statewide LiDAR, NortheastNJPostSandy_2014_QL2, "
                  "flown 2014-10-21, ~3.4 pts/m2 (s3://njogis-elevation)",
        "method": "height = 98th percentile of returns within 40% of the "
                  "estimated crown radius, above a 2 m ground raster; "
                  "crown base = lowest 1 m bin where two consecutive bins hold "
                  "15% of the peak count. Rooftops masked with OSM footprints.",
        "caveat": "flown leaf-off in late October and 12 years old; positions "
                  "come from the inventory's GPS, so a misplaced tree samples "
                  "the wrong crown",
        "measured": measured, "total": len(out), "trees": out,
    }, open(OUT, "w"), indent=1)
    print(f"measured {measured} of {len(out)} trees -> {OUT}")


if __name__ == "__main__":
    main()
