/* Voorhees Mall — site plan drawn 1:1.
   World coords: +x = east, +y = north, origin = centroid of the mall lawn.
   Nothing here is in pixels-as-units: every number is feet until it hits a
   transform, which is what lets the same geometry print at a stated scale. */

const $ = s => document.querySelector(s);
const svg = $('#svg'), stage = $('#stage'), world = $('#world'), overlay = $('#overlay');
const SVGNS = 'http://www.w3.org/2000/svg';
const PPI = 96;                                     // CSS px per inch, print and screen

const el = (tag, attrs = {}, parent = null) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};

const INK = '#23211d', INK2 = '#6a655c', INK3 = '#948d80';
const MARK = '#9e2233', PAPER = '#f2f0ea';

/* ------------------------------------------------------------------ view */

const view = { cx: 0, cy: 0, zoom: 0.55, rot: 0 };   // zoom = px per foot
let W = 0, H = 0, lastPtr = [0, 0];
let autoSide = () => {};

// Until you pan, zoom or place something, the view stays framed on the lawn
// through any layout change -- the panel opening, the window resizing.
let touched = false;
function resize() {
  W = stage.clientWidth; H = stage.clientHeight;
  if (!touched && DATA && W > 40 && H > 40) { fit(DATA.lawn); return; }
  apply();
}

function toScreen(x, y) {
  const r = view.rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = x - view.cx, dy = y - view.cy;
  return [W / 2 + view.zoom * (dx * c - dy * s), H / 2 - view.zoom * (dx * s + dy * c)];
}
function toWorld(sx, sy) {
  const r = view.rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const px = (sx - W / 2) / view.zoom, py = (sy - H / 2) / view.zoom;
  return [view.cx + px * c - py * s, view.cy - (px * s + py * c)];
}

// The one transform that puts feet on a surface, screen or sheet alike.
function worldTransform(cx, cy, zoom, rot, ox, oy) {
  return `translate(${ox} ${oy}) scale(${zoom}) rotate(${-rot}) scale(1 -1) ` +
         `translate(${-cx} ${-cy})`;
}

function apply() {
  world.setAttribute('transform', worldTransform(view.cx, view.cy, view.zoom, view.rot, W / 2, H / 2));
  $('#needle').setAttribute('transform', `rotate(${-view.rot})`);
  drawScalebar();
  drawOverlay();
  readout(...toWorld(lastPtr[0], lastPtr[1]));
  $('#tb-scale').textContent = `1″ = ${fmtScale(PPI / view.zoom)}`;
  $('#tb-north').textContent = view.rot ? `${(((-view.rot) % 360) + 360) % 360}° from up` : 'Up';
}

// Rotated bounding box of a set of world points, in view-aligned axes.
function boundsIn(pts, rot) {
  const r = rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [x, y] of pts) {
    const a = x * c - y * s, b = x * s + y * c;
    x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b);
  }
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return { w: x1 - x0, h: y1 - y0,
           cx: mx * c + my * s, cy: -mx * s + my * c };   // centre back in world coords
}

function fit(pts, pad = 1.1) {
  const b = boundsIn(pts, view.rot);
  view.cx = b.cx; view.cy = b.cy;
  view.zoom = Math.min(W / (b.w * pad), H / (b.h * pad));
  apply();
}

/* -------------------------------------------------------------- base map */

const LAYERS = [
  ['grid',      'Grid, 50 ft',   '#cdc7b9', false],
  ['roads',     'Streets',       '#dcd7cc', true],
  ['green',     'Other green',   '#dde5d0', true],
  ['lawn',      'Mall lawn',     '#d3ddc0', true],
  ['paths',     'Walkways',      '#eceadf', true],
  ['buildings', 'Buildings',     '#ddd6c6', true],
  ['canopy',    'Tree canopy',   '#c3d3ab', true],
  ['trees',     'Trunks',        '#4d6135', true],
  ['labels',    'Names',         '#948d80', true],
  ['objects',   'Placed items',  '#9e2233', true],
];
const on = {}; LAYERS.forEach(l => on[l[0]] = l[3]);

let DATA = null;

function buildBase(d) {
  const ptsAttr = r => r.map(p => p.join(',')).join(' ');
  const hair = { 'vector-effect': 'non-scaling-stroke' };

  const G = $('#l-grid'), lim = 1400;
  for (let v = -lim; v <= lim; v += 50) {
    const major = v % 250 === 0;
    for (const ln of [[-lim, v, lim, v], [v, -lim, v, lim]])
      el('line', { x1: ln[0], y1: ln[1], x2: ln[2], y2: ln[3], stroke: '#cdc7b9',
        'stroke-width': major ? 1 : .6, opacity: major ? .85 : .45, ...hair }, G);
  }

  for (const r of d.roads)
    el('polyline', { points: ptsAttr(r.line), fill: 'none', stroke: '#dcd7cc',
      'stroke-width': r.w, 'stroke-linecap': 'butt', 'stroke-linejoin': 'round' }, $('#l-roads'));

  for (const g of d.greens)
    el('polygon', { points: ptsAttr(g.ring), fill: '#dde5d0' }, $('#l-green'));

  el('polygon', { points: ptsAttr(d.lawn), fill: '#d3ddc0', stroke: '#a9bb8c',
    'stroke-width': 1, ...hair }, $('#l-lawn'));

  for (const p of d.paths)
    el('polyline', { points: ptsAttr(p.line), fill: 'none', stroke: '#eceadf',
      'stroke-width': p.w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, $('#l-paths'));

  for (const b of d.buildings)
    el('polygon', { points: ptsAttr(b.ring), fill: '#ddd6c6', stroke: '#a49a86',
      'stroke-width': 1, ...hair }, $('#l-buildings'));

  // Crowns and trunks are separate layers: 400-odd overlapping canopies hide
  // the lawn, but you still need to know where the shade and the trunks are.
  const C = $('#l-canopy'), T = $('#l-trees');
  d.trees.forEach((t, i) => {
    // a dead tree or a stump is still an obstruction, but it casts no shade
    el('circle', { cx: t.p[0], cy: t.p[1], r: t.r,
      fill: t.gone ? 'none' : '#a8c187', 'fill-opacity': .30,
      stroke: t.gone ? '#a8917a' : '#8aa76a', 'stroke-width': .7,
      'stroke-dasharray': t.gone ? '4 4' : null, 'data-tree': i, ...hair }, C);
    const rt = t.dbh ? Math.max(0.6, t.dbh / 24) : 0.8;   // trunk at true diameter
    el('circle', { cx: t.p[0], cy: t.p[1], r: rt,
      fill: t.gone ? '#8a7458' : '#4d6135',
      'data-tree': i, style: 'cursor:pointer' }, T);
  });

  d.buildings.forEach(b => b.c = centroid(b.ring));     // for name placement
  syncLayers();
}

function centroid(ring) {
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    const f = x1 * y2 - x2 * y1;
    a += f; x += (x1 + x2) * f; y += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9)
    return [ring.reduce((s, p) => s + p[0], 0) / ring.length,
            ring.reduce((s, p) => s + p[1], 0) / ring.length];
  return [x / (3 * a), y / (3 * a)];
}

function syncLayers() {
  for (const [k] of LAYERS) {
    const g = $('#l-' + k);
    if (g) g.style.display = on[k] ? '' : 'none';
  }
  [...$('#layers').children].forEach(r =>
    r.classList.toggle('off', !on[r.querySelector('input').dataset.k]));
  drawOverlay();
}

/* --------------------------------------------------------- placed items */

const CATALOG = [
  { t: '6 ft table',  w: 6,   h: 2.5, shape: 'rect',   note: '72 × 30″' },
  { t: '8 ft table',  w: 8,   h: 2.5, shape: 'rect',   note: '96 × 30″' },
  { t: '60″ round',   w: 5,   h: 5,   shape: 'circle', note: 'seats 8' },
  { t: '72″ round',   w: 6,   h: 6,   shape: 'circle', note: 'seats 10' },
  { t: 'Highboy',     w: 2.5, h: 2.5, shape: 'circle', note: '30″ dia' },
  { t: 'Chair',       w: 1.5, h: 1.5, shape: 'rect',   note: '18 × 18″' },
  { t: '10 × 10 tent', w: 10, h: 10,  shape: 'rect',   note: 'pop-up' },
  { t: '20 × 20 tent', w: 20, h: 20,  shape: 'rect',   note: 'frame' },
  { t: '20 × 40 tent', w: 20, h: 40,  shape: 'rect',   note: 'frame' },
  { t: 'Stage',       w: 24,  h: 16,  shape: 'rect',   note: '24 × 16′' },
  { t: 'Dance floor', w: 30,  h: 30,  shape: 'rect',   note: '900 sf' },
  { t: 'Barricade',   w: 8,   h: 1.5, shape: 'rect',   note: '8′ bike rack' },
  { t: 'Porta-john',  w: 4,   h: 4,   shape: 'rect',   note: '4 × 4′' },
  { t: 'Box truck',   w: 26,  h: 8.5, shape: 'rect',   note: '26′ load-in' },
  { t: 'Dumpster',    w: 8,   h: 6,   shape: 'rect',   note: '6 yd' },
  { t: 'Custom…',     w: 10,  h: 10,  shape: 'rect',   note: 'any size' },
];

let items = [], nextId = 1, selected = null, pending = null;

function addItem(spec, x, y) {
  const it = { id: nextId++, t: spec.t, w: spec.w, h: spec.h, shape: spec.shape,
               x: +x.toFixed(2), y: +y.toFixed(2), rot: -view.rot };
  items.push(it); selected = it.id; touched = true; drawItems(); save(); return it;
}

function corners(it) {
  const r = it.rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const hw = it.w / 2, hh = it.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
    .map(([a, b]) => [it.x + a * c - b * s, it.y + a * s + b * c]);
}

function drawItemShapes(target, sel) {
  target.textContent = '';
  for (const it of items) {
    const isSel = it.id === sel;
    const g = el('g', { 'data-id': it.id, style: 'cursor:move' }, target);
    const style = { fill: MARK, 'fill-opacity': isSel ? .26 : .13,
      stroke: MARK, 'stroke-width': isSel ? 2 : 1.1,
      'vector-effect': 'non-scaling-stroke' };
    if (it.shape === 'circle') {
      el('circle', { cx: it.x, cy: it.y, r: it.w / 2, ...style }, g);
    } else {
      const cs = corners(it);
      el('polygon', { points: cs.map(p => p.join(',')).join(' '), ...style }, g);
      // heavier front edge, so which way it faces reads at a glance
      el('line', { x1: cs[0][0], y1: cs[0][1], x2: cs[1][0], y2: cs[1][1],
        stroke: MARK, 'stroke-width': isSel ? 3.5 : 2.5,
        'vector-effect': 'non-scaling-stroke' }, g);
    }
  }
}

function drawItems() { drawItemShapes($('#l-objects'), selected); tally(); drawOverlay(); }

function itemCounts() {
  const c = new Map();
  for (const it of items) {
    const k = it.t;
    if (!c.has(k)) c.set(k, { n: 0, w: it.w, h: it.h, shape: it.shape });
    c.get(k).n++;
  }
  return [...c.entries()].sort((a, b) => b[1].n - a[1].n);
}

function tally() {
  const rows = itemCounts().map(([k, v]) => `<tr><td>${k}</td><td>${v.n}</td></tr>`).join('');
  $('#tally').innerHTML = rows
    ? rows + `<tr class="total"><td>Total</td><td>${items.length}</td></tr>`
    : `<tr><td class="empty">Nothing placed yet</td></tr>`;
}

let selTree = null;

function selectTree(i) {
  selTree = selTree === i ? null : i;
  const box = $('#treebox');
  if (selTree === null) { box.hidden = true; drawOverlay(); return; }
  const t = DATA.trees[i];
  box.hidden = false;
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
  $('#treeinfo').innerHTML =
    `<b>${t.sp || 'Unidentified'}</b><dl>` +
    row('Trunk', t.dbh ? `${trim(t.dbh)}″ DBH` : '') +
    row('Canopy', `${trim(+(t.r * 2).toFixed(1))} ft`) +
    row('Condition', t.gone ? `${t.gone}, no canopy` : t.cond) +
    row('At', `E ${t.p[0].toFixed(0)}′ N ${t.p[1].toFixed(0)}′`) +
    `</dl><em>Trunk and species are surveyed; canopy is estimated from DBH.</em>`;
  drawOverlay();
}

/* ---------------------------------------------------------- annotation
   Names and item tags are laid out in surface coordinates, not world ones,
   so they stay upright and legible. Screen and sheet both call this.        */

function annotate(target, P, zoom, opts = {}) {
  const taken = [];
  const clear = (x, y, w, h) => {
    const b = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
    if (taken.some(t => !(b[2] < t[0] || b[0] > t[2] || b[3] < t[1] || b[1] > t[3]))) return false;
    taken.push(b); return true;
  };
  const txt = (x, y, s, o = {}) => {
    const t = el('text', { x, y, 'text-anchor': o.anchor || 'middle',
      'font-size': o.size || 11, 'font-weight': o.weight || 400,
      fill: o.fill || INK2, stroke: o.halo === 0 ? null : (opts.paper || PAPER),
      'stroke-width': o.halo == null ? 3.5 : o.halo,
      'paint-order': 'stroke', 'stroke-linejoin': 'round' }, target);
    t.textContent = s;
    if (o.track) t.setAttribute('letter-spacing', o.track);
    return t;
  };

  if (opts.names !== false && DATA) {
    const [lx, ly] = P(0, 0);
    if (zoom < 1.2 && opts.inside(lx, ly) && clear(lx, ly, 190, 26))
      txt(lx, ly, 'VOORHEES MALL', { size: 14, weight: 600, fill: '#7d8c62', track: 3 });
    for (const b of DATA.buildings) {
      if (!b.name) continue;
      const [sx, sy] = P(b.c[0], b.c[1]);
      if (!opts.inside(sx, sy)) continue;
      const d0 = b.ring[0];
      const far = b.ring.reduce((m, p) => Math.max(m, Math.hypot(p[0] - d0[0], p[1] - d0[1])), 0);
      if (far * zoom < 46) continue;           // too small on this surface to name
      if (!clear(sx, sy, b.name.length * 5.6 + 8, 14)) continue;
      txt(sx, sy, b.name, { size: 10, fill: '#6b6459' });
    }
  }

  if (opts.items !== false) {
    for (const it of items) {
      const [sx, sy] = P(it.x, it.y);
      if (!opts.inside(sx, sy)) continue;
      const big = Math.max(it.w, it.h) * zoom;
      const isSel = it.id === opts.selected;
      if (!isSel && big < 34) continue;
      const lines = isSel
        ? [it.t, `${trim(it.w)}′ × ${trim(it.h)}′ · ${Math.round(((it.rot % 360) + 360) % 360)}°`]
        : [it.t];
      lines.forEach((s, i) =>
        txt(sx, sy + (i - (lines.length - 1) / 2) * 12, s,
          { size: 9.5, weight: i ? 400 : 600, fill: i ? '#8a5560' : MARK }));
    }
  }
  return txt;
}

/* ------------------------------------------------------------- overlay */

let measure = null;

function fmtFt(f) {
  const sign = f < 0 ? '-' : ''; f = Math.abs(f);
  const ft = Math.floor(f), inch = Math.round((f - ft) * 12);
  return inch === 12 ? `${sign}${ft + 1}′ 0″` : `${sign}${ft}′ ${inch}″`;
}
const trim = n => (+n).toFixed(2).replace(/\.?0+$/, '');
const fmtScale = ft => (ft < 10 ? ft.toFixed(1) : Math.round(ft)) + '′';

function drawOverlay() {
  overlay.textContent = '';
  const txt = annotate(overlay, toScreen, view.zoom, {
    names: on.labels, items: on.objects, selected,
    inside: (x, y) => x > -60 && y > -20 && x < W + 60 && y < H + 20,
  });

  if (selTree !== null && DATA && (on.trees || on.canopy)) {
    const t = DATA.trees[selTree];
    const [sx, sy] = toScreen(t.p[0], t.p[1]);
    el('circle', { cx: sx, cy: sy, r: Math.max(7, t.r * view.zoom), fill: 'none',
      stroke: MARK, 'stroke-width': 1.5 }, overlay);
    txt(sx, sy - Math.max(12, t.r * view.zoom) - 6,
      t.sp + (t.dbh ? ` · ${trim(t.dbh)}″` : ''), { size: 10.5, weight: 600, fill: '#3f5a2a' });
  }

  if (measure) {
    const [ax, ay] = toScreen(...measure.a);
    const b = measure.b || measure.hover;
    if (b) {
      const [bx, by] = toScreen(...b);
      el('line', { x1: ax, y1: ay, x2: bx, y2: by, stroke: MARK,
        'stroke-width': 1.2, 'stroke-dasharray': '5 3' }, overlay);
      for (const [px, py] of [[ax, ay], [bx, by]])
        el('circle', { cx: px, cy: py, r: 2.5, fill: MARK }, overlay);
      const d = Math.hypot(b[0] - measure.a[0], b[1] - measure.a[1]);
      txt((ax + bx) / 2, (ay + by) / 2 - 9, `${fmtFt(d)}`,
        { size: 11, weight: 600, fill: MARK });
    }
  }
}

function drawScalebar() {
  const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  const target = 150 / view.zoom;
  const ft = nice.reduce((p, c) => Math.abs(c - target) < Math.abs(p - target) ? c : p);
  $('#sb-bar').style.width = (ft * view.zoom) + 'px';
  $('#sb-max').textContent = ft >= 1 ? ft + ' ft' : fmtFt(ft);
}

function readout(wx, wy) {
  const ns = (v, pos, neg) => `${v < 0 ? neg : pos} ${Math.abs(v).toFixed(0)}′`;
  $('#readout').innerHTML =
    `<b>${ns(wx, 'E', 'W')} &nbsp; ${ns(wy, 'N', 'S')}</b><br>` +
    `1″ = ${fmtScale(PPI / view.zoom)}`;
}

/* -------------------------------------------------------- interaction */

let drag = null, measureMode = false;

/* e.offsetX is relative to whatever child element was hit (an SVG circle,
   say), so pointer position always comes from the stage rect instead. */
function local(e) {
  const r = stage.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

stage.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const [sx0, sy0] = local(e);
  const [wx, wy] = toWorld(sx0, sy0);

  if (pending) {
    let spec = pending;
    if (spec.t === 'Custom…') {
      const s = prompt('Size in feet — width × depth', '12 x 4');
      if (!s) { setPending(null); return; }
      const m = s.match(/([\d.]+)\s*[x×by ]+\s*([\d.]+)/i);
      if (!m) { setPending(null); return; }
      spec = { t: `${trim(m[1])} × ${trim(m[2])}′`, w: +m[1], h: +m[2], shape: 'rect' };
    }
    addItem(spec, wx, wy);
    if (!e.shiftKey) setPending(null);
    return;
  }

  if (measureMode) {
    if (!measure || measure.b) measure = { a: [wx, wy], b: null, hover: [wx, wy] };
    else { measure.b = [wx, wy]; measureMode = false; syncTools(); }
    drawOverlay(); return;
  }

  const tre = e.target.getAttribute && e.target.getAttribute('data-tree');
  if (tre !== null && tre !== undefined) { selectTree(+tre); return; }

  const hit = e.target.closest('#l-objects > g');
  if (hit && on.objects) {
    selected = +hit.dataset.id;
    const it = items.find(i => i.id === selected);
    drag = { kind: 'item', it, ox: wx - it.x, oy: wy - it.y };
    drawItems();
  } else {
    if (selected !== null) { selected = null; drawItems(); }
    touched = true;
    drag = { kind: 'pan', sx: sx0, sy: sy0, cx: view.cx, cy: view.cy };
    stage.classList.add('panning');
  }
  try { stage.setPointerCapture(e.pointerId); } catch {}
});

stage.addEventListener('pointermove', e => {
  const [sx, sy] = local(e);
  lastPtr = [sx, sy];
  const [wx, wy] = toWorld(sx, sy);
  readout(wx, wy);
  if (measure && !measure.b && measureMode) { measure.hover = [wx, wy]; drawOverlay(); }

  if (!drag) return;
  if (drag.kind === 'pan') {
    const r = view.rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const px = (sx - drag.sx) / view.zoom, py = (sy - drag.sy) / view.zoom;
    view.cx = drag.cx - (px * c - py * s);
    view.cy = drag.cy + (px * s + py * c);
    apply();
  } else {
    const snap = e.altKey ? 0.01 : 0.5;              // 6 in, or free with Alt
    drag.it.x = Math.round((wx - drag.ox) / snap) * snap;
    drag.it.y = Math.round((wy - drag.oy) / snap) * snap;
    drawItems();
  }
});

stage.addEventListener('pointerup', e => {
  if (drag && drag.kind === 'item') save();
  drag = null; stage.classList.remove('panning');
  try { stage.releasePointerCapture(e.pointerId); } catch {}
});

stage.addEventListener('wheel', e => {
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const [wx, wy] = toWorld(sx, sy);
  touched = true;
  view.zoom = Math.min(24, Math.max(0.06, view.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
  const [nx, ny] = toWorld(sx, sy);                  // pin the point under the cursor
  view.cx += wx - nx; view.cy += wy - ny;
  apply();
}, { passive: false });

addEventListener('keydown', e => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (!$('#dlg').hidden) { if (e.key === 'Escape') closePrint(); return; }
  const it = items.find(i => i.id === selected);
  const k = e.key;
  if (k === 'Escape') {
    setPending(null); measureMode = false; measure = null; selected = null;
    if (selTree !== null) selectTree(selTree);
    syncTools(); drawItems();
  } else if (k === 'm' || k === 'M') {
    measureMode = !measureMode; measure = null; syncTools(); drawOverlay();
  } else if (it && (k === 'Backspace' || k === 'Delete')) {
    items = items.filter(i => i.id !== it.id); selected = null; drawItems(); save();
  } else if (it && (k === 'd' || k === 'D')) {
    const c = { ...it, id: nextId++, x: it.x + 4, y: it.y - 4 };
    items.push(c); selected = c.id; drawItems(); save();
  } else if (it && (k === '[' || k === ']')) {
    it.rot += (k === '[' ? -1 : 1) * (e.shiftKey ? 45 : 5); drawItems(); save();
  } else if (it && k.startsWith('Arrow')) {
    e.preventDefault();
    const step = e.shiftKey ? 1 / 12 : 1;            // 1 inch, or 1 foot
    const r = view.rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const dx = { ArrowLeft: -1, ArrowRight: 1 }[k] || 0;
    const dy = { ArrowUp: 1, ArrowDown: -1 }[k] || 0;
    it.x += (dx * c + dy * s) * step;
    it.y += (-dx * s + dy * c) * step;
    drawItems(); save();
  }
});

/* ------------------------------------------------------------ printing
   The sheet is a real drawing sheet: fixed paper size, a stated scale, a
   title block, and a border. It previews as the same element that prints,
   so what you approve is what comes out.                                    */

const SHEETS = [
  ['Letter, 8½ × 11', 8.5, 11], ['Legal, 8½ × 14', 8.5, 14],
  ['Tabloid, 11 × 17', 11, 17], ['ARCH B, 12 × 18', 12, 18],
  ['ARCH C, 18 × 24', 18, 24], ['ARCH D, 24 × 36', 24, 36],
];
const SCALES = [10, 20, 30, 40, 50, 60, 80, 100, 200];   // 1 inch = N feet
const MARGIN = 0.3, COL = 2.45, PAD = 0.14;              // inches

function sheetSpec() {
  const [, pw, ph] = SHEETS[+$('#p-size').value];
  const land = $('#p-orient').value === 'land';
  return { w: land ? ph : pw, h: land ? pw : ph };
}

function printExtent() {
  if ($('#p-extent').value === 'view')
    return [toWorld(0, 0), toWorld(W, 0), toWorld(W, H), toWorld(0, H)];
  const pts = DATA.lawn.slice();
  for (const it of items) pts.push(...corners(it));
  return pts;
}

function renderSheet() {
  const sp = sheetSpec();
  const sheet = $('#sheet');
  sheet.style.width = sp.w + 'in';
  sheet.style.height = sp.h + 'in';
  $('#pagesize').textContent = `@page{size:${sp.w}in ${sp.h}in;margin:0}`;

  const Wp = sp.w * PPI, Hp = sp.h * PPI;
  const dx = MARGIN * PPI, dy = MARGIN * PPI;
  const dw = (sp.w - MARGIN * 2 - COL - PAD) * PPI;
  const dh = (sp.h - MARGIN * 2) * PPI;

  // choose the scale
  const b = boundsIn(printExtent(), view.rot);
  const needed = Math.max(b.w / (dw / PPI), b.h / (dh / PPI));   // feet per inch
  let ftPerIn, note = '';
  if ($('#p-scale').value === 'fit') {
    ftPerIn = SCALES.find(s => s >= needed * 1.02) || Math.ceil(needed * 1.02 / 100) * 100;
  } else {
    ftPerIn = +$('#p-scale').value;
    if (ftPerIn < needed) note = `At 1″ = ${ftPerIn}′ the plan is wider than the sheet — it will be cropped.`;
  }
  const zoom = PPI / ftPerIn;

  const old = sheet.querySelector('svg');
  if (old) old.remove();
  const s = el('svg', { viewBox: `0 0 ${Wp} ${Hp}`, width: Wp, height: Hp }, sheet);
  const st = el('style', {}, s);
  st.textContent = 'text{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}';
  el('rect', { width: Wp, height: Hp, fill: '#fff' }, s);

  // drawing area, clipped to its frame
  const clip = el('clipPath', { id: 'sheetclip' }, s);
  el('rect', { x: dx, y: dy, width: dw, height: dh }, clip);
  const area = el('g', { 'clip-path': 'url(#sheetclip)' }, s);
  el('rect', { x: dx, y: dy, width: dw, height: dh, fill: '#fff' }, area);

  const plan = world.cloneNode(true);
  // the sheet's own include list overrides the screen's layer switches
  const show = (id, yes) => {
    const g = plan.querySelector('#' + id);
    if (g) g.style.display = yes ? '' : 'none';
  };
  show('l-grid', $('#p-grid').checked);
  show('l-canopy', $('#p-trees').checked && on.canopy);
  show('l-trees', $('#p-trees').checked && on.trees);
  // strip every id: two copies of the drawing must not share them
  plan.removeAttribute('id');
  plan.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  plan.setAttribute('transform',
    worldTransform(b.cx, b.cy, zoom, view.rot, dx + dw / 2, dy + dh / 2));
  area.appendChild(plan);

  // names and item tags, in sheet coordinates
  const P = (x, y) => {
    const r = view.rot * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
    const ax = x - b.cx, ay = y - b.cy;
    return [dx + dw / 2 + zoom * (ax * c - ay * sn),
            dy + dh / 2 - zoom * (ax * sn + ay * c)];
  };
  annotate(area, P, zoom, {
    names: $('#p-labels').checked, items: true, selected: null, paper: '#fff',
    inside: (x, y) => x > dx && y > dy && x < dx + dw && y < dy + dh,
  });
  el('rect', { x: dx, y: dy, width: dw, height: dh, fill: 'none',
    stroke: INK, 'stroke-width': 1 }, s);

  sheetColumn(s, sp, ftPerIn);
  el('rect', { x: MARGIN * PPI / 2, y: MARGIN * PPI / 2,
    width: Wp - MARGIN * PPI, height: Hp - MARGIN * PPI,
    fill: 'none', stroke: INK, 'stroke-width': 1.4 }, s);

  $('#p-msg').textContent = note ||
    `1″ = ${ftPerIn}′ · ${SHEETS[+$('#p-size').value][0]} · ` +
    `${Math.round(b.w)} × ${Math.round(b.h)} ft of ground`;
  $('#p-msg').style.color = note ? MARK : INK2;

  // preview scaling only — print resets this
  const box = $('#dlgprev').getBoundingClientRect();
  const k = Math.min((box.width - 36) / Wp, (box.height - 36) / Hp, 1);
  sheet.style.transform = `scale(${k})`;
  sheet.style.margin = `${(Hp * k - Hp) / 2}px ${(Wp * k - Wp) / 2}px`;
}

function sheetColumn(s, sp, ftPerIn) {
  const x = (sp.w - MARGIN - COL) * PPI, w = COL * PPI;
  let y = MARGIN * PPI;
  const bottom = (sp.h - MARGIN) * PPI;
  const line = (yy) => el('line', { x1: x, y1: yy, x2: x + w, y2: yy,
    stroke: INK, 'stroke-width': .8 }, s);
  const T = (tx, ty, str, o = {}) => {
    const t = el('text', { x: tx, y: ty, 'font-size': o.size || 9,
      'font-weight': o.weight || 400, fill: o.fill || INK,
      'text-anchor': o.anchor || 'start' }, s);
    if (o.track) t.setAttribute('letter-spacing', o.track);
    t.textContent = str; return t;
  };
  const cap = (tx, ty, str) =>
    T(tx, ty, str.toUpperCase(), { size: 6.5, fill: INK3, weight: 600, track: 1 });

  el('rect', { x, y, width: w, height: bottom - y, fill: 'none',
    stroke: INK, 'stroke-width': 1 }, s);

  // ---- title
  y += 16;
  T(x + 9, y, ($('#p-title').value || 'Site Plan'), { size: 13, weight: 600 });
  y += 14; T(x + 9, y, 'Voorhees Mall', { size: 9.5, fill: INK2 });
  y += 11; T(x + 9, y, 'Rutgers–New Brunswick', { size: 9.5, fill: INK2 });
  y += 10; line(y);

  // ---- scale, with a graphic bar that survives photocopying
  y += 13; cap(x + 9, y, 'Scale');
  y += 13; T(x + 9, y, `1″ = ${ftPerIn}′-0″`, { size: 12, weight: 600 });
  y += 10;
  const unit = ftPerIn <= 20 ? 10 : ftPerIn <= 50 ? 20 : ftPerIn <= 100 ? 50 : 100;
  const upx = unit * PPI / ftPerIn;
  const n = Math.max(2, Math.min(4, Math.floor((w - 24) / upx)));
  const bx = x + 9, by = y + 4;
  for (let i = 0; i < n; i++)
    el('rect', { x: bx + i * upx, y: by, width: upx, height: 5,
      fill: i % 2 ? '#fff' : INK, stroke: INK, 'stroke-width': .7 }, s);
  for (let i = 0; i <= n; i++)
    T(bx + i * upx, by + 15, String(i * unit), { size: 7, anchor: 'middle', fill: INK2 });
  T(bx + n * upx + 16, by + 15, 'ft', { size: 7, fill: INK2 });
  y = by + 22; line(y);

  // ---- north
  y += 13; cap(x + 9, y, 'North');
  const nx = x + w - 30, ny = y + 14;
  const g = el('g', { transform: `translate(${nx} ${ny}) rotate(${-view.rot}) scale(.62)` }, s);
  el('path', { d: 'M0,-21 L5.5,7 L0,1.5 L-5.5,7 Z', fill: INK }, g);
  el('path', { d: 'M0,-21 L0,1.5 L-5.5,7 Z', fill: INK2 }, g);
  const nt = el('text', { x: nx, y: ny + 22, 'text-anchor': 'middle',
    'font-size': 8, 'font-weight': 600, fill: INK }, s);
  nt.textContent = 'N';
  y = ny + 28; line(y);

  // ---- legend
  if ($('#p-legend').checked) {
    y += 13; cap(x + 9, y, 'Legend');
    const rows = [
      ['#d3ddc0', '#a9bb8c', 'Lawn'],
      ['#eceadf', '#d7d2c4', 'Walkway'],
      ['#ddd6c6', '#a49a86', 'Building'],
    ];
    if ($('#p-trees').checked && on.canopy) rows.push(['#c3d3ab', '#8aa76a', 'Tree canopy']);
    if (items.length) rows.push([MARK + '26', MARK, 'Placed item']);
    for (const [f, st2, label] of rows) {
      y += 13;
      el('rect', { x: x + 9, y: y - 7, width: 15, height: 8,
        fill: f, stroke: st2, 'stroke-width': .8 }, s);
      T(x + 30, y, label, { size: 8.5, fill: INK2 });
    }
    y += 9; line(y);
  }

  // ---- item schedule
  if ($('#p-sched').checked) {
    y += 13; cap(x + 9, y, 'Schedule');
    y += 4;
    const counts = itemCounts();
    if (!counts.length) {
      y += 11; T(x + 9, y, 'No items placed', { size: 8.5, fill: INK3 });
    } else {
      for (const [k, v] of counts) {
        if (y > bottom - 62) { y += 11; T(x + 9, y, '…', { size: 8.5, fill: INK3 }); break; }
        y += 11;
        T(x + 9, y, k, { size: 8.5, fill: INK2 });
        T(x + w - 34, y, `${trim(v.w)}×${trim(v.h)}′`, { size: 7.5, fill: INK3, anchor: 'end' });
        T(x + w - 9, y, String(v.n), { size: 8.5, weight: 600, anchor: 'end' });
      }
      y += 12;
      el('line', { x1: x + 9, y1: y - 8, x2: x + w - 9, y2: y - 8,
        stroke: INK3, 'stroke-width': .6 }, s);
      T(x + 9, y, 'Total', { size: 8.5, weight: 600 });
      T(x + w - 9, y, String(items.length), { size: 8.5, weight: 600, anchor: 'end' });
    }
    y += 9; line(y);
  }

  // ---- issue block, pinned to the bottom
  let iy = bottom - 44;
  line(iy);
  iy += 13; cap(x + 9, iy, 'Date');
  T(x + w - 9, iy, new Date().toLocaleDateString('en-US',
    { year: 'numeric', month: 'short', day: 'numeric' }), { size: 8.5, anchor: 'end' });
  iy += 14; cap(x + 9, iy, 'Drawn');
  T(x + w - 9, iy, $('#p-by').value || '—', { size: 8.5, anchor: 'end' });
  iy += 14; cap(x + 9, iy, 'Sheet');
  T(x + w - 9, iy, 'SP-1', { size: 8.5, weight: 600, anchor: 'end' });
}

function openPrint() {
  $('#dlg').hidden = false;
  renderSheet();
}
function closePrint() { $('#dlg').hidden = true; $('#pagesize').textContent = ''; }

/* -------------------------------------------------------------- chrome */

function setPending(spec) {
  pending = spec;
  stage.classList.toggle('placing', !!spec);
  [...$('#palette').rows].forEach(r =>
    r.classList.toggle('on', !!spec && r.dataset.t === spec.t));
}
function syncTools() {
  $('#t-measure').classList.toggle('on', measureMode);
  stage.classList.toggle('measuring', measureMode);
}

function buildChrome() {
  $('#layers').innerHTML = LAYERS.map(([k, name, color]) =>
    `<label class="lyr"><input type="checkbox" data-k="${k}" ${on[k] ? 'checked' : ''}>` +
    `<span class="sw" style="background:${color}"></span>${name}</label>`).join('');
  $('#layers').onchange = e => { on[e.target.dataset.k] = e.target.checked; syncLayers(); };

  $('#palette').innerHTML = CATALOG.map(c =>
    `<tr data-t="${c.t}"><td>${c.t}</td><td class="dim">${c.note}</td></tr>`).join('');
  $('#palette').onclick = e => {
    const r = e.target.closest('tr'); if (!r) return;
    const c = CATALOG.find(x => x.t === r.dataset.t);
    setPending(pending && pending.t === c.t ? null : c);
  };

  $('#t-measure').onclick = () => { measureMode = !measureMode; measure = null; syncTools(); drawOverlay(); };
  $('#t-north').onclick = () => {
    view.rot = view.rot ? 0 : -DATA.meta.lawn_axis_deg;
    northBtn();
    touched ? apply() : fit(DATA.lawn);
  };
  $('#t-fit').onclick = () => { touched = false; fit(DATA.lawn); };
  $('#t-clear').onclick = () => {
    if (items.length && confirm(`Remove all ${items.length} placed items?`)) {
      items = []; selected = null; drawItems(); save();
    }
  };
  $('#t-save').onclick = () => {
    const blob = new Blob([JSON.stringify({ v: 1, site: 'voorhees-mall', items }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'voorhees-plan.json'; a.click();
    say('Plan saved');
  };
  $('#t-load').onclick = () => $('#file').click();
  $('#file').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => {
      const d = JSON.parse(t);
      items = d.items || []; nextId = Math.max(0, ...items.map(i => i.id)) + 1;
      selected = null; drawItems(); save(); say(`Opened ${items.length} items`);
    }).catch(() => say('Could not read that file'));
    e.target.value = '';
  };
  $('#t-png').onclick = exportPNG;

  // print dialog
  $('#p-size').innerHTML = SHEETS.map(([n], i) =>
    `<option value="${i}"${i === 2 ? ' selected' : ''}>${n}</option>`).join('');
  $('#p-scale').innerHTML = '<option value="fit">Fit to sheet</option>' +
    SCALES.map(s => `<option value="${s}">1″ = ${s}′</option>`).join('');
  $('#t-print').onclick = openPrint;
  $('#p-cancel').onclick = closePrint;
  $('#p-go').onclick = () => { renderSheet(); setTimeout(() => window.print(), 30); };
  $('#dlgform').oninput = renderSheet;
  $('#dlg').onclick = e => { if (e.target.id === 'dlg') closePrint(); };

  const side = $('#side'), hamb = $('#hamb');
  const toggleSide = show => {
    side.classList.toggle('hide', !show);
    hamb.hidden = show;
    setTimeout(resize, 210);
  };
  let byHand = false;                 // the panel follows the window until you don't want it to
  $('#collapse').onclick = () => { byHand = true; toggleSide(false); };
  hamb.onclick = () => { byHand = true; toggleSide(true); };
  autoSide = () => { if (!byHand) toggleSide(innerWidth >= 760); };
  autoSide();
  northBtn();
  window.__vm = { view, get items() { return items; }, DATA: () => DATA, fit, renderSheet };
}
function northBtn() { $('#t-north').textContent = view.rot ? 'North up' : 'Align mall'; }

let sayT;
function say(s) {
  const t = $('#status'); t.textContent = s; t.classList.add('show');
  clearTimeout(sayT); sayT = setTimeout(() => t.classList.remove('show'), 2000);
}

function exportPNG() {
  const scale = 2, c = svg.cloneNode(true);
  c.setAttribute('width', W * scale); c.setAttribute('height', H * scale);
  c.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const st = document.createElementNS(SVGNS, 'style');
  st.textContent = 'text{font:11px ui-sans-serif,system-ui,sans-serif}';
  c.insertBefore(st, c.firstChild);
  const bg = document.createElementNS(SVGNS, 'rect');
  bg.setAttribute('width', W); bg.setAttribute('height', H); bg.setAttribute('fill', PAPER);
  c.insertBefore(bg, st.nextSibling);
  const url = 'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(new XMLSerializer().serializeToString(c));
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = W * scale; cv.height = H * scale;
    cv.getContext('2d').drawImage(img, 0, 0);
    cv.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'voorhees-mall.png'; a.click();
      say('PNG saved');
    });
  };
  img.onerror = () => say('PNG export failed');
  img.src = url;
}

/* ----------------------------------------------------------- persistence */

const KEY = 'voorhees-plan-v1';
function save() { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} }
function restore() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(d) && d.length) {
      items = d; nextId = Math.max(0, ...items.map(i => i.id)) + 1;
    }
  } catch {}
}

/* ------------------------------------------------------------------ boot */

fetch('data/voorhees-mall.json').then(r => r.json()).then(d => {
  DATA = d;
  view.rot = -d.meta.lawn_axis_deg;
  buildChrome();
  buildBase(d);
  restore(); drawItems();
  lastPtr = [stage.clientWidth / 2, stage.clientHeight / 2];
  resize();
  const real = d.trees.filter(t => t.src === 'rutgers').length;
  $('#credit').innerHTML =
    `Footprints, walks and streets © OpenStreetMap contributors (ODbL). ` +
    (real ? `${real} trees from the Rutgers <a href="https://cem.pg-cloud.com/Rutgers" ` +
            `target="_blank" rel="noopener">TreePlotter inventory</a> — species and trunk ` +
            `diameter surveyed, canopy width estimated from DBH. `
          : `${d.trees.length} trees, positions approximated. `) +
    `Lawn ${Math.round(span(d.lawn))} ft on its long axis, ${d.buildings.length} buildings.`;
}).catch(e => { $('#credit').textContent = 'Failed to load base map: ' + e; });

function span(ring) {
  let m = 0;
  for (const a of ring) for (const b of ring) m = Math.max(m, Math.hypot(a[0] - b[0], a[1] - b[1]));
  return m;
}

addEventListener('resize', () => { autoSide(); resize(); });
// Cmd-P straight from the drawing prints the sheet too, at its last settings
addEventListener('beforeprint', () => { if (DATA) renderSheet(); });
