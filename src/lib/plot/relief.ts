// Relief shading with pens: illuminated (Tanaka) contours, shadow hatching and hachures.
// All three use the same light model as a hillshade: a sun at an azimuth and height,
// and Lambert shading of the terrain surface.

import type { ContourLine } from './contours';
import { clipPolyline, densify, offsetLine, passes, simplify, type Box, type Line } from './geom';

/** Where a terrain grid sits on paper: cell (0, 0) centre at (ox, oy), k mm per cell. */
export interface GridMap {
  w: number;
  h: number;
  ox: number;
  oy: number;
  k: number;
}

/** Elevation gradient per cell, in metres per metre, toward east (gx) and south (gy). */
export function gradients(data: Float32Array, w: number, h: number, cell: number) {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1);
      const yu = Math.max(0, y - 1), yd = Math.min(h - 1, y + 1);
      gx[y * w + x] = (data[y * w + xr] - data[y * w + xl]) / ((xr - xl) * cell);
      gy[y * w + x] = (data[yd * w + x] - data[yu * w + x]) / ((yd - yu) * cell);
    }
  }
  return { gx, gy };
}

/** Unit vector toward the light. x = east, y = south (paper axes), z = up. */
export function lightVector(azimuth: number, altitude: number) {
  const az = (azimuth * Math.PI) / 180, alt = (altitude * Math.PI) / 180;
  return { x: Math.sin(az) * Math.cos(alt), y: -Math.cos(az) * Math.cos(alt), z: Math.sin(alt) };
}

/** Lambert shade per cell: 1 = facing the light, 0 = turned away or in shadow. */
export function shadeGrid(gx: Float32Array, gy: Float32Array, azimuth: number, altitude: number, exaggeration: number) {
  const L = lightVector(azimuth, altitude);
  const out = new Float32Array(gx.length);
  for (let i = 0; i < gx.length; i++) {
    const nx = -gx[i] * exaggeration, ny = -gy[i] * exaggeration;
    out[i] = Math.max(0, (nx * L.x + ny * L.y + L.z) / Math.hypot(nx, ny, 1));
  }
  return out;
}

/** Bilinear sample of a grid at a paper position; NaN outside the grid or where data is missing. */
export function sample(a: Float32Array, G: GridMap, x: number, y: number): number {
  const fx = (x - G.ox) / G.k, fy = (y - G.oy) / G.k;
  if (!(fx >= 0 && fy >= 0 && fx <= G.w - 1 && fy <= G.h - 1)) return NaN;
  const i = Math.min(G.w - 2, fx | 0), j = Math.min(G.h - 2, fy | 0);
  const tx = fx - i, ty = fy - j;
  const r = j * G.w + i;
  return (a[r] * (1 - tx) + a[r + 1] * tx) * (1 - ty) + (a[r + G.w] * (1 - tx) + a[r + G.w + 1] * tx) * ty;
}

/** Copies of a line that keep the centre stroke in place: offsets 0, +s, −s, +2s, … */
function stack(l: Line, count: number, step: number): Line[] {
  const out: Line[] = [l];
  for (let k = 1; k < count; k++) out.push(offsetLine(l, (k % 2 ? 1 : -1) * Math.ceil(k / 2) * step));
  return out;
}

/** Chain copies of a line into one back-and-forth stroke, so the pen stays down. */
function serpentine(copies: Line[]): Line {
  const out: Line = copies[0].slice();
  for (let c = 1; c < copies.length; c++) {
    const l = copies[c];
    if (c % 2) for (let i = l.length - 2; i >= 0; i -= 2) out.push(l[i], l[i + 1]);
    else for (let i = 0; i < l.length; i++) out.push(l[i]);
  }
  return out;
}

/** Merge runs shorter than minLen (mm along the line) into the run before them. */
function mergeShortRuns(cls: Int8Array, pts: Line, minLen: number) {
  const n = cls.length;
  let i = 0;
  while (i < n) {
    let j = i, len = 0;
    while (j + 1 < n && cls[j + 1] === cls[i]) {
      len += Math.hypot(pts[2 * j + 2] - pts[2 * j], pts[2 * j + 3] - pts[2 * j + 1]);
      j++;
    }
    if (len < minLen) {
      const into = i > 0 ? cls[i - 1] : j + 1 < n ? cls[j + 1] : cls[i];
      for (let m = i; m <= j; m++) cls[m] = into;
    }
    i = j + 1;
  }
}

export interface TanakaOptions {
  azimuth: number;
  max: number; // passes on the side turned fully away from the light
  base: number; // passes the line gets anyway (index lines are heavier)
  lit: 'normal' | 'omit' | 'pen';
  step: number; // distance between passes, mm
  simplify: number;
}

/**
 * Illuminated contours. Where the slope faces away from the light the line gets
 * more passes; where it faces the light it stays thin, is left out, or goes to a
 * second pen (a white pen on toned paper is the classic Tanaka look).
 */
export function tanaka(lines: Line[], gx: Float32Array, gy: Float32Array, G: GridMap, o: TanakaOptions) {
  const L = lightVector(o.azimuth, 0);
  const dark: Line[] = [];
  const lit: Line[] = [];
  const litBelow = o.lit === 'pen' ? 0 : o.lit === 'omit' ? 0.35 : Infinity; // facing value above which a point counts as lit
  for (const l0 of lines) {
    const l = densify(l0, 0.5);
    const n = l.length / 2;
    if (n < 2) continue;
    const cls = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      const x = l[2 * i], y = l[2 * i + 1];
      const ex = sample(gx, G, x, y), ey = sample(gy, G, x, y);
      const m = Math.hypot(ex, ey);
      // Facing: +1 when the downhill direction points at the light, −1 when away.
      const f = m > 1e-6 ? (-ex * L.x - ey * L.y) / Math.hypot(L.x, L.y) / m : 0;
      cls[i] = f > litBelow ? 0 : 1 + Math.round((o.max - 1) * Math.min(1, Math.max(0, -f)));
    }
    mergeShortRuns(cls, l, 1.2);
    let start = 0;
    for (let i = 1; i <= n; i++) {
      if (i < n && cls[i] === cls[start]) continue;
      // Runs share their boundary point so the centre stroke has no gaps.
      const run = simplify(l.slice(2 * start, 2 * Math.min(n, i + 1)), o.simplify);
      const c = cls[start];
      if (run.length >= 4) {
        if (c === 0) {
          if (o.lit === 'pen') lit.push(serpentine(stack(run, o.base, o.step)));
        } else dark.push(serpentine(stack(run, o.base + c - 1, o.step)));
      }
      start = i;
    }
  }
  return { dark, lit };
}

export interface HatchOptions {
  angle: number; // degrees, counter-clockwise from the paper's x axis
  spacing: number; // mm between lines of the lightest tone
  tones: number; // 1–4; each tone adds a set of lines
  start: number; // darkness (0..1) where hatching begins
  minDash: number; // mm; shorter dashes are dropped
  flat: number; // shade of flat ground; only darker ground is hatched
}

/**
 * Shadow hatching. Darkness = how much darker than flat ground a point is. Tone 1
 * is lines at `angle`, tone 2 adds lines halfway between them, tones 3 and 4 do the
 * same across at angle + 90°.
 */
export function hatch(shade: Float32Array, G: GridMap, box: Box, o: HatchOptions): Line[] {
  const out: Line[] = [];
  const st = Math.min(0.25, G.k / 2);
  const gapN = Math.max(1, Math.round(0.5 / st)); // close gaps up to 0.5 mm
  const dashN = Math.max(1, Math.round(o.minDash / st));
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const R = Math.hypot(box.w, box.h) / 2;
  const tones = Math.max(1, Math.min(4, Math.round(o.tones)));
  for (let j = 0; j < tones; j++) {
    const thr = o.start + ((1 - o.start) * j) / tones;
    const a = ((o.angle + (j >= 2 ? 90 : 0)) * Math.PI) / 180;
    const dx = Math.cos(a), dy = -Math.sin(a); // along the line (paper y points down)
    const nx = -dy, ny = dx; // across
    const off = j % 2 ? o.spacing / 2 : 0;
    const count = Math.ceil(R / o.spacing) + 1;
    for (let i = -count; i <= count; i++) {
      const p = i * o.spacing + off;
      const bx = cx + nx * p, by = cy + ny * p;
      const nS = Math.ceil((2 * R) / st);
      const flags = new Uint8Array(nS + 1);
      for (let s = 0; s <= nS; s++) {
        const t = -R + s * st;
        const x = bx + dx * t, y = by + dy * t;
        if (x < box.x || x > box.x + box.w || y < box.y || y > box.y + box.h) continue;
        const v = sample(shade, G, x, y);
        flags[s] = (o.flat - v) / o.flat >= thr ? 1 : 0;
      }
      // Close short gaps, then drop short dashes.
      let s = 0;
      while (s <= nS) {
        if (flags[s]) { s++; continue; }
        let e = s;
        while (e + 1 <= nS && !flags[e + 1]) e++;
        if (s > 0 && e < nS && e - s + 1 <= gapN) for (let m = s; m <= e; m++) flags[m] = 1;
        s = e + 1;
      }
      s = 0;
      while (s <= nS) {
        if (!flags[s]) { s++; continue; }
        let e = s;
        while (e + 1 <= nS && flags[e + 1]) e++;
        if (e - s >= dashN) {
          const t0 = -R + s * st, t1 = -R + e * st;
          out.push(...clipPolyline([bx + dx * t0, by + dy * t0, bx + dx * t1, by + dy * t1], box));
        }
        s = e + 1;
      }
    }
  }
  return out;
}

export interface HachureOptions {
  interval: number; // m between the rows of strokes
  spacing: number; // mm between strokes along a row
  maxLength: number; // mm; strokes stop here in gentle terrain, leaving a gap to the next row
  passes: number; // passes of the heaviest stroke
  weight: 'light' | 'slope';
  minTan: number; // flatter ground gets no strokes
  flat: number;
  step: number; // distance between passes, mm
  simplify: number;
  join: boolean; // link neighbouring strokes of a row into one zig-zag line
}

/**
 * Hachures: short strokes down the fall line, one row per elevation band. Rows
 * start on the band's upper contour and end on the next one down; alternate rows
 * are staggered by half a stroke spacing. Heavier strokes mark shaded ground
 * (Dufour) or steep ground (Lehmann). With `join`, each stroke is linked to its
 * neighbour along the row, so a row is drawn with one pen lift instead of one per stroke.
 */
export function hachures(
  levels: ContourLine[], data: Float32Array, gx: Float32Array, gy: Float32Array, shade: Float32Array,
  G: GridMap, box: Box, o: HachureOptions,
): Line[] {
  const out: Line[] = [];
  const st = Math.min(0.15, G.k / 2);
  const maxSteps = Math.ceil(o.maxLength / st);
  const inBox = (x: number, y: number) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  const joinGap = 2 * o.spacing;
  let row: Line | null = null;
  const flush = () => {
    if (row) out.push(...clipPolyline(row, box));
    row = null;
  };
  const emit = (l: Line) => {
    if (!o.join) return out.push(...clipPolyline(l, box));
    if (row) {
      const ex = row[row.length - 2], ey = row[row.length - 1];
      const n = l.length;
      const dF = Math.hypot(l[0] - ex, l[1] - ey), dR = Math.hypot(l[n - 2] - ex, l[n - 1] - ey);
      if (Math.min(dF, dR) <= joinGap) {
        if (dF <= dR) for (let i = 0; i < n; i++) row.push(l[i]);
        else for (let i = n - 2; i >= 0; i -= 2) row.push(l[i], l[i + 1]);
        return;
      }
      flush();
    }
    row = l;
  };
  const stroke = (sx: number, sy: number, target: number) => {
    const g0 = Math.hypot(sample(gx, G, sx, sy), sample(gy, G, sx, sy));
    if (!(g0 >= o.minTan)) return;
    const pts: Line = [sx, sy];
    let x = sx, y = sy;
    for (let s = 0; s < maxSteps; s++) {
      const ex = sample(gx, G, x, y), ey = sample(gy, G, x, y);
      const m = Math.hypot(ex, ey);
      if (!(m >= o.minTan * 0.5)) break;
      x -= (ex / m) * st;
      y -= (ey / m) * st;
      if (!inBox(x, y)) break;
      pts.push(x, y);
      if (!(sample(data, G, x, y) > target)) break;
    }
    if (pts.length < 6) return;
    const mid = (pts.length / 4) | 0;
    const mx = pts[2 * mid], my = pts[2 * mid + 1];
    let w: number;
    if (o.weight === 'slope') {
      const t = Math.hypot(sample(gx, G, mx, my), sample(gy, G, mx, my));
      w = Math.atan(t) / (Math.PI / 4);
    } else w = (o.flat - sample(shade, G, mx, my)) / o.flat;
    if (!(w === w)) w = 0;
    const count = 1 + Math.round((o.passes - 1) * Math.min(1, Math.max(0, w)));
    const l = simplify(pts, o.simplify);
    emit(serpentine(passes(l, count, o.step)));
  };
  for (const lv of levels) {
    const k = Math.round(lv.level / o.interval);
    let next = k % 2 ? o.spacing / 2 : 0; // distance along the row to the next stroke
    let walked = 0;
    const pts = lv.pts;
    let px = G.ox + pts[0] * G.k, py = G.oy + pts[1] * G.k;
    for (let i = 2; i < pts.length; i += 2) {
      const qx = G.ox + pts[i] * G.k, qy = G.oy + pts[i + 1] * G.k;
      const seg = Math.hypot(qx - px, qy - py);
      while (next <= walked + seg) {
        const t = seg > 0 ? (next - walked) / seg : 0;
        const sx = px + (qx - px) * t, sy = py + (qy - py) * t;
        if (inBox(sx, sy)) stroke(sx, sy, lv.level - o.interval);
        next += o.spacing;
      }
      walked += seg;
      px = qx;
      py = qy;
    }
    flush();
  }
  return out;
}
