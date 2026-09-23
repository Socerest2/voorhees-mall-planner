"""Minimal Mapbox Vector Tile reader — enough of protobuf to read points.

MVT is a small, stable schema, so decoding it directly beats pulling in a
protobuf dependency:

    Tile    { repeated Layer layers = 3 }
    Layer   { string name=1; repeated Feature features=2; repeated string keys=3;
              repeated Value values=4; uint32 extent=5 (default 4096) }
    Feature { uint64 id=1; packed uint32 tags=2; GeomType type=3;
              packed uint32 geometry=4 }
    Value   { string=1; float=2; double=3; int64=4; uint64=5; sint64=6; bool=7 }
"""
import math, struct


def _varint(b, i):
    r = s = 0
    while True:
        x = b[i]; i += 1
        r |= (x & 0x7F) << s
        if not x & 0x80:
            return r, i
        s += 7


def _fields(b, start=0, end=None):
    """Yield (field_number, wire_type, payload) for one protobuf message."""
    i, end = start, len(b) if end is None else end
    while i < end:
        key, i = _varint(b, i)
        fn, wt = key >> 3, key & 7
        if wt == 0:
            v, i = _varint(b, i); yield fn, wt, v
        elif wt == 2:
            n, i = _varint(b, i); yield fn, wt, b[i:i + n]; i += n
        elif wt == 5:
            yield fn, wt, b[i:i + 4]; i += 4
        elif wt == 1:
            yield fn, wt, b[i:i + 8]; i += 8
        else:
            raise ValueError(f"wire type {wt}")


def _packed(buf):
    out, i = [], 0
    while i < len(buf):
        v, i = _varint(buf, i)
        out.append(v)
    return out


def _value(buf):
    for fn, wt, v in _fields(buf):
        if fn == 1: return v.decode('utf8', 'replace')
        if fn == 2: return struct.unpack('<f', v)[0]
        if fn == 3: return struct.unpack('<d', v)[0]
        if fn == 4: return v
        if fn == 5: return v
        if fn == 6: return (v >> 1) ^ -(v & 1)      # zigzag
        if fn == 7: return bool(v)
    return None


def _points(geom):
    """Decode geometry commands, keeping MoveTo targets (i.e. point features)."""
    out, i, x, y = [], 0, 0, 0
    while i < len(geom):
        cmd = geom[i]; i += 1
        op, count = cmd & 7, cmd >> 3
        if op in (1, 2):
            for _ in range(count):
                dx, dy = geom[i], geom[i + 1]; i += 2
                x += (dx >> 1) ^ -(dx & 1)
                y += (dy >> 1) ^ -(dy & 1)
                if op == 1:
                    out.append((x, y))
        else:
            break
    return out


def decode(data):
    """-> [{layer, extent, attrs, points:[(tx,ty)]}] for every feature in the tile."""
    feats = []
    for fn, _, layer in _fields(data):
        if fn != 3:
            continue
        name, extent, keys, values, raw = '', 4096, [], [], []
        for lf, _, v in _fields(layer):
            if lf == 1: name = v.decode('utf8', 'replace')
            elif lf == 2: raw.append(v)
            elif lf == 3: keys.append(v.decode('utf8', 'replace'))
            elif lf == 4: values.append(_value(v))
            elif lf == 5: extent = v
        for f in raw:
            tags, geom = [], []
            for ff, _, v in _fields(f):
                if ff == 2: tags = _packed(v)
                elif ff == 4: geom = _packed(v)
            attrs = {keys[tags[i]]: values[tags[i + 1]]
                     for i in range(0, len(tags) - 1, 2)
                     if tags[i] < len(keys) and tags[i + 1] < len(values)}
            feats.append({'layer': name, 'extent': extent,
                          'attrs': attrs, 'points': _points(geom)})
    return feats


def tile_to_lonlat(z, tx, ty, px, py, extent):
    """Tile-local coordinates -> WGS84."""
    n = 2 ** z
    lon = (tx + px / extent) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + py / extent) / n))))
    return lon, lat


def tile_xy(z, lat, lon):
    n = 2 ** z
    return (int((lon + 180) / 360 * n),
            int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))
