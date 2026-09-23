# Voorhees Mall Planner

**Live: https://socerest2.github.io/voorhees-mall-planner/**

A true-to-scale site plan of Voorhees Mall (Rutgers–New Brunswick) in the browser.
Everything on screen is drawn in real feet — a 6-foot table is six feet against
the lawn, at every zoom level.

```bash
python3 -m http.server 5173 --directory /Users/vince/bus/dm-planner
```

Then open http://localhost:5173. No build step, no dependencies.

## What's on the map

| Layer | Source |
|---|---|
| Mall lawn, other green | OSM `leisure=park` / `village_green` / `landuse=grass` |
| Buildings | OSM building footprints (54 of them, named where OSM names them) |
| Walkways | OSM `footway` / `path` / `pedestrian` / `steps`, drawn at real width |
| Streets | OSM `highway`, drawn at typical paved width |
| Trees | Rutgers' own TreePlotter inventory — species, trunk diameter, condition |

The lawn measures **839 ft** across its longest span, inside a 667 × 796 ft
bounding box.

### Accuracy

Lat/lon is projected onto a local tangent plane in feet, using the WGS84
per-degree scale at 40.5004° N. Checked against geodesic distances across the
site, the planar grid agrees to better than **0.2%** — under a foot over the
length of the mall.

The real limit on accuracy is the source: OSM footprints are traced from aerial
imagery and typically sit within a few feet of truth. Good for laying out an
event; not a substitute for a survey if something has to fit to the inch.

### Trees

Real survey data, not guesses. Rutgers publishes its tree inventory as a
[TreePlotter Community Engagement Map](https://cem.pg-cloud.com/Rutgers)
(PlanIT Geo — 7,752 trees campus-wide). That map draws from vector tiles at
`cem.pg-cloud.com/customers/Rutgers/trees/{z}/{x}/{y}.pbf`, so
`tools/fetch_trees.py` reads the same tiles, decodes them with the small MVT
reader in `tools/mvt.py`, and keeps the ones near the mall.

839 trees in the window. Records marked *Removed* or *Proposed Site* are
dropped as not physically there, leaving **427** on the plan. Each carries:

- **species** and **trunk diameter (DBH, inches)** — surveyed, click any tree
- **condition** — Excellent / Good / Fair / Poor / Dead
- **status** — dead trees and stumps draw with a dashed outline and no canopy
  fill, since they're still an obstruction but cast no shade

Most common around the mall: elm (86), Kousa dogwood (79), Japanese zelkova
(52), honeylocust (47). Largest: a 54-inch elm.

**Canopy width is the one estimated number.** The inventory records trunk
diameter but not crown spread, so `fetch_trees.py` derives it as
`crown_ft = DBH_in × ratio`, with the ratio set by growth habit — 1.3 for
conifers, 2.0 for small ornamentals, 2.2 for large hardwoods, 1.9 otherwise —
then clamps the radius to 45 ft. Position and trunk are survey-accurate;
treat the green circle as an approximation of shade, and measure on site if a
tent has to thread between two crowns.

Tile positions are good to roughly 0.75 ft (zoom 15, 4096-unit extent), well
under the GPS error in the survey itself.

### Clearance — what fits underneath

The question that actually matters when siting a tent is not how wide a tree is
but **how high its lowest limbs are**. A 54-inch elm limbed up to 25 ft is a
roof; a Kousa dogwood branching at 3 ft is a wall. The mall has 77 of the
former and 69 of the latter.

Height and crown base are now **measured from LiDAR** where the point cloud
allows — see below. The DBH model still fills the gaps, and it works like this:

| Habit | Examples | Height | Crown base |
|---|---|---|---|
| `shade` | oak, elm, zelkova, honeylocust, linden | 4.5 + 2.3 × DBH, cap 85 ft | 35% of height |
| `conifer_open` | pine, larch, cedar | 4.5 + 2.8 × DBH, cap 90 ft | 35% |
| `conifer_dense` | spruce, fir, holly, arborvitae | 4.5 + 2.6 × DBH, cap 70 ft | 5% — skirted to the ground |
| `ornamental` | dogwood, cherry, magnolia, redbud | 4.5 + 1.6 × DBH, cap 32 ft | 20% |

Crown base is also capped at 25 ft (nobody prunes a park tree higher) and held
at least 6 ft below the top (a tree needs a crown). The result for the 427
trees on the plan:

- **211 block everything** — under 8 ft of clearance
- **87 people only** — 8 to 14 ft
- **46 take a pop-up tent** — 14 to 20 ft
- **78 take a truck or a frame tent** — 20 ft and over

Set **Fits under** to the height you care about and the canopies recolour.
Every catalog item carries a real height — a 20 × 40 frame tent is 18 ft to the
peak, a box truck 13 ft 6 in, a banquet table 2 ft 6 in — so placing one
immediately reports which trees it fouls, and the item draws dashed until it
clears.

### Height from LiDAR

`tools/lidar_heights.py` replaces the inference with a measurement. New Jersey
publishes statewide LiDAR on an open S3 bucket needing no credentials:

```bash
mkdir -p tools/lidar
B=https://njogis-elevation.s3.us-west-2.amazonaws.com/NortheastNJPostSandy_2014_QL2/LAS_1.2_Classified
curl -o tools/lidar/18TWK460820.las $B/18TWK460820.las
curl -o tools/lidar/18TWK460835.las $B/18TWK460835.las
python3 tools/lidar_heights.py
```

Those two tiles straddle the mall at about 3.4 points/m², flown 21 October
2014. The LAS is parsed directly with numpy — no PDAL, no laspy.

Two things make it awkward. The tiles carry **no vegetation class at all**:
2 and 18 are ground, 1 and 17 are everything else — canopy *and* rooftops. So
buildings are masked out using the OSM footprints, by true polygon test, not
bounding box; a box round an L-shaped hall swallows the courtyard and every
tree beside it. And there is no single "height" in a point cloud, so:

- **total height** = 98th percentile of returns within 40% of the estimated
  crown radius, above a 2 m ground raster
- **crown base** = the lowest 1 m bin where two consecutive bins each hold 15%
  of the peak count — where returns stop being stray understory and become a
  crown

**224 of the 294 trees on the plan are measured this way.** The rest had too
few returns and keep the DBH estimate; the tree panel says which you are
looking at, and how many returns backed it.

It was worth doing. Against the DBH model, across 395 live trees measured both
ways, **62% landed in a different clearance band** — the estimates were
misleading for most of the mall. Heights ran about 4 ft lower than modelled
(the 85 ft cap was too generous; real tops are 52–81 ft), and the conifers I
had assumed were skirted to the ground turned out to be limbed up by a median
of 13 ft.

**Still not survey data.** The flight is 12 years old and late-October
leaf-off, which helps for crown base and ground but understates crown spread.
Tree positions come from the inventory's GPS, so a tree recorded a few metres
off samples its neighbour's crown. Use this to narrow down where a tent can
go, then measure the two or three candidate spots on site.

### Extent, and Lot 9

The map is cropped to the mall itself — 150 ft of context past the lawn, which
carries the buildings that front it and the streets that bound it, and nothing
further. That is 31 buildings and 294 trees, down from 54 and 427.

Parking is included as its own layer. **Lot 9** sits directly off the south tip
of the mall (centre E −2, N −344 on the plan grid; about 10,300 sq ft, call it
34 spaces) and draws with a dashed edge, since it is the one flagged for event
use — staging, load-in or accessible parking.

### Tilt

The **Tilt** slider lays the ground plane back to 60°. Trunks rise to their
first limb, crowns sit at their real heights, and placed items extrude to
theirs, painted far-to-near so a tent under a canopy looks like it is under it.
It only foreshortens the y axis, so hit-testing still lands on the ground plane
and the plan stays measurable along x.

Tilt is a screen affordance only — **the printed sheet is always a true plan**,
whatever the screen is doing, so drawings stay measurable with a scale rule.

## Using it

- **Scroll** to zoom (the point under the cursor stays put), **drag** to pan
- **Fit mall** reframes; **North up** toggles between true north and the mall's
  long axis laid horizontal
- **M** or **Measure** — click two points for a distance in feet and inches
- **Click any tree** for species, trunk diameter and condition
- **Tree canopy** draws each crown at its estimated diameter; **Trunks** draws
  them at true trunk diameter. Either can be off
- Click a palette item, then click the plan to drop it. Hold **Shift** while
  placing to keep placing the same thing.
- Drag to move (snaps to 6 in; hold **Alt** for free placement), **[** / **]**
  to rotate 5° (**Shift** for 45°), arrow keys to nudge 1 ft (**Shift** for 1 in),
  **D** to duplicate, **⌫** to delete
- Placed items autosave to localStorage. **Export plan** writes a JSON file;
  **Import** reads one back. **PNG** exports the current view.

## Printing

**Print / PDF…** opens sheet setup. The preview is the same element that goes
to the printer, so what you approve is what comes out.

- **Sheet size** — Letter through ARCH D, portrait or landscape. The page box
  is set from this (`@page { size: … }`), so the paper matches the drawing.
- **Scale** — a real engineer's scale, 1″ = 10′ through 1″ = 200′. *Fit to
  sheet* picks the tightest standard scale that still fits rather than an
  arbitrary ratio, because a plan you can measure with a scale rule beats one
  that happens to fill the page. Choosing a scale too small to fit says so and
  crops rather than silently rescaling.
- **Show** — the whole mall plus everything placed, or just what's on screen.
- **Include** — legend, item schedule, 50 ft grid, building names, trees.

The sheet carries a title block: title, scale (written and as a graphic bar
that survives photocopying), north arrow, legend, item schedule with counts and
sizes, date, drawn-by and sheet number.

Fills are forced to print (`print-color-adjust: exact`) so the drawing doesn't
come out blank when "background graphics" is off. ⌘P from the drawing prints
the same sheet at its last settings.



```bash
python3 tools/fetch_trees.py && python3 tools/build_site.py --refetch
```

`fetch_trees.py` pulls the tree inventory to `tools/trees_raw.json`;
`build_site.py` re-queries Overpass and combines both into
`data/voorhees-mall.json`. Without `--refetch` it reuses the cached
`tools/osm_raw.json`, which is the fast path when you're only changing what
gets included or how it's shaped.

If `tools/trees_raw.json` is missing, `build_site.py` falls back to placing
trees procedurally around the lawn edge (`gen_trees`) and marks them
`src:"approx"` — a stand-in, kept only so the build still works offline.

Map data © OpenStreetMap contributors, ODbL 1.0. Tree data from the Rutgers
TreePlotter Community Engagement Map.

## Layout of the data

`data/voorhees-mall.json` — all coordinates in feet, `+x` east, `+y` north,
origin at the centroid of the lawn polygon:

```jsonc
{
  "meta":   { "origin": {"lat","lon"}, "ft_per_deg": {...}, "lawn_axis_deg": -68.8 },
  "lawn":   [[x,y], ...],
  "greens": [{ "name", "ring": [[x,y],...] }],
  "buildings": [{ "id", "name", "ring": [[x,y],...] }],
  "paths":  [{ "kind", "w", "line": [[x,y],...] }],
  "roads":  [{ "name", "kind", "w", "line": [[x,y],...] }],
  "trees":  [{ "p": [x,y], "r", "src": "rutgers",
               "sp": "Elm", "dbh": 41, "cond": "Excellent", "gone": "Dead"? }]
}
```

`meta.origin` plus `meta.ft_per_deg` converts any plan coordinate back to
lat/lon, so a layout built here can be handed to anything that speaks GPS.

## Running it locally

No build step and no dependencies — it is three static files plus a JSON base
map. Any static server works:

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173. Opening `index.html` straight off disk will
not work: the page fetches `data/voorhees-mall.json`, which `file://` blocks.

Deployed from `main` at the repository root via GitHub Pages.
