// Area fills (hatching, tree symbols) and a ground-type grid for colouring contours.
// Polygons are lists of closed rings in paper mm, filled with the even-odd rule.

import { clipPolyline, type Box, type Line } from './geom';
import type { GridMap } from './relief';
import type { HatchPattern } from '../settings';

export type Ring = Line;
export type Poly = Ring[];

function bbox(p: Poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of p)
    for (let i = 0; i < r.length; i += 2) {
      if (r[i] < x0) x0 = r[i];
      if (r[i] > x1) x1 = r[i];
      if (r[i + 1] < y0) y0 = r[i + 1];
      if (r[i + 1] > y1) y1 = r[i + 1];
    }
  return { x0, y0, x1, y1 };
}

export function polySize(p: Poly) {
  const b = bbox(p);
  return Math.max(b.x1 - b.x0, b.y1 - b.y0);
}

export type HatchStyle = HatchPattern;

/**
 * Hatching inside polygons: parallel lines, cross-hatching, dashes, waves or zigzags.
 * Lines sit on one grid across the whole sheet (dashes and waves too), so pieces
 * from neighbouring tiles meet and the optimizer joins them.
 */
export function hatchPolys(polys: Poly[], angle: number, spacing: number, box: Box, style?: HatchStyle): Line[] {
  if (style?.kind === 'cross') return [...hatchSet(polys, angle, spacing, box), ...hatchSet(polys, angle + style.cross, spacing, box)];
  return hatchSet(polys, angle, spacing, box, style);
}

/** Triangle wave through 0 at t = 0, peaking at ±1 at t = ¼ and ¾. */
function tri(t: number) {
  const x = (((t - 0.25) % 1) + 1) % 1;
  return 1 - 4 * Math.min(x, 1 - x);
}

function hatchSet(polys: Poly[], angle: number, spacing: number, box: Box, style?: HatchStyle): Line[] {
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  // Rotate into (u, v) where hatch lines are v = const; paper y points down.
  const toU = (x: number, y: number) => x * c - y * s;
  const toV = (x: number, y: number) => x * s + y * c;

  const kind = style?.kind ?? 'lines';
  const wavy = kind === 'waves' || kind === 'zigzag';
  const amp = wavy ? Math.max(0, style!.height) / 2 : 0;
  const len = wavy ? Math.max(0.2, style!.length) : 1;
  const wave = kind === 'zigzag' ? (u: number) => amp * tri(u / len) : (u: number) => amp * Math.sin((2 * Math.PI * u) / len);
  // A wavy line v = k·spacing + wave(u) is a straight scanline in (u, w = v − wave(u)).
  // Edges are split finely along u first, so they stay close to straight in w.
  const step = len / 16;
  // A wavy row lying exactly on a straight edge would cross it only at rounding noise and
  // could pick the outer half-waves. Shifting the rows off the round grid avoids that tie.
  const shift = amp ? spacing * 1e-6 : 0;
  const dash = kind === 'dashes' ? Math.max(0.05, style!.dash) : 0;
  const period = dash + (kind === 'dashes' ? Math.max(0.05, style!.gap) : 0);

  const out: Line[] = [];
  const emit = (u0: number, u1: number, v: number) => {
    const pts: number[] = [];
    const put = (u: number) => {
      const vv = v + (amp ? wave(u) : 0);
      pts.push(u * c + vv * s, -u * s + vv * c);
    };
    put(u0);
    if (amp && kind === 'zigzag') {
      // Corners at every quarter and three-quarter wave.
      for (let n = Math.ceil((u0 / len - 0.25) * 2); (n / 2 + 0.25) * len < u1; n++) put((n / 2 + 0.25) * len);
    } else if (amp) {
      for (let u = (Math.floor(u0 / step) + 1) * step; u < u1; u += step) put(u);
    }
    put(u1);
    out.push(...clipPolyline(pts, box));
  };

  for (const p of polys) {
    let w0 = Infinity, w1 = -Infinity;
    const edges: number[] = []; // u1, w1, u2, w2
    for (const r of p)
      for (let i = 2; i < r.length; i += 2) {
        const ua = toU(r[i - 2], r[i - 1]), va = toV(r[i - 2], r[i - 1]);
        const ub = toU(r[i], r[i + 1]), vb = toV(r[i], r[i + 1]);
        const m = amp ? Math.max(1, Math.ceil(Math.abs(ub - ua) / step)) : 1;
        let pu = ua, pw = va - (amp ? wave(ua) : 0);
        for (let j = 1; j <= m; j++) {
          const u = ua + ((ub - ua) * j) / m;
          const w = va + ((vb - va) * j) / m - (amp ? wave(u) : 0);
          edges.push(pu, pw, u, w);
          if (pw < w0) w0 = pw;
          if (pw > w1) w1 = pw;
          pu = u;
          pw = w;
        }
        if (pw < w0) w0 = pw;
        if (pw > w1) w1 = pw;
      }
    const xs: number[] = [];
    for (let k = Math.ceil((w0 - shift) / spacing); k * spacing + shift <= w1; k++) {
      const v = k * spacing + shift;
      xs.length = 0;
      for (let i = 0; i < edges.length; i += 4) {
        const wa = edges[i + 1], wb = edges[i + 3];
        if ((wa <= v && v < wb) || (wb <= v && v < wa)) xs.push(edges[i] + ((edges[i + 2] - edges[i]) * (v - wa)) / (wb - wa));
      }
      xs.sort((m, n) => m - n);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const u0 = xs[i], u1 = xs[i + 1];
        if (u1 - u0 < 0.05) continue;
        if (!dash) {
          emit(u0, u1, v);
          continue;
        }
        // Dashes on a sheet-wide grid, every other row shifted by half, like brickwork.
        const off = k & 1 ? period / 2 : 0;
        for (let j = Math.floor((u0 - off) / period); j * period + off < u1; j++) {
          const d0 = Math.max(u0, j * period + off), d1 = Math.min(u1, j * period + off + dash);
          if (d1 - d0 >= 0.05) emit(d0, d1, v);
        }
      }
    }
  }
  return out;
}

function inside(p: Poly, x: number, y: number) {
  let hit = false;
  for (const r of p)
    for (let i = 2; i < r.length; i += 2) {
      const ax = r[i - 2], ay = r[i - 1], bx = r[i], by = r[i + 1];
      if (ay > y !== by > y && x < ax + ((bx - ax) * (y - ay)) / (by - ay)) hit = !hit;
    }
  return hit;
}

/** Small circles on a staggered sheet-wide grid, like the tree symbols on topographic maps. */
export function treeSymbols(polys: Poly[], spacing: number, radius: number, box: Box): Line[] {
  const out: Line[] = [];
  const rowH = spacing * 0.866;
  const n = Math.max(6, Math.round((2 * Math.PI * radius) / 0.15));
  const circle = (cx: number, cy: number) => {
    const l: Line = [];
    for (let i = 0; i <= n; i++) l.push(cx + radius * Math.cos((i / n) * 2 * Math.PI), cy + radius * Math.sin((i / n) * 2 * Math.PI));
    return l;
  };
  for (const p of polys) {
    const b = bbox(p);
    for (let j = Math.ceil(b.y0 / rowH); j * rowH <= b.y1; j++) {
      const y = j * rowH;
      const off = j % 2 ? spacing / 2 : 0;
      for (let i = Math.ceil((b.x0 - off) / spacing); i * spacing + off <= b.x1; i++) {
        const x = i * spacing + off;
        if (x - radius < box.x || x + radius > box.x + box.w || y - radius < box.y || y + radius > box.y + box.h) continue;
        if (inside(p, x, y)) out.push(circle(x, y));
      }
    }
  }
  return out;
}

/** Ground types for contour colouring. */
export const LAND = 0, ICE = 1, ROCK = 2;

/**
 * Ground type per terrain cell, from swisstopo's own contours (tagged land, ice or
 * scree): every cell takes the type of the nearest such line, up to `radius` mm away.
 */
export function groundGrid(G: GridMap, lines: { land: Line[]; ice: Line[]; rock: Line[] }, radius: number): Uint8Array {
  const n = G.w * G.h;
  const cls = new Uint8Array(n);
  const dist = new Int16Array(n).fill(-1);
  const queue = new Int32Array(n);
  let qe = 0;
  const step = G.k / 2;
  const seed = (ls: Line[], c: number) => {
    for (const l of ls)
      for (let i = 2; i < l.length; i += 2) {
        const ax = l[i - 2], ay = l[i - 1], bx = l[i], by = l[i + 1];
        const m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
        for (let j = 0; j <= m; j++) {
          const gx = Math.round((ax + ((bx - ax) * j) / m - G.ox) / G.k);
          const gy = Math.round((ay + ((by - ay) * j) / m - G.oy) / G.k);
          if (gx < 0 || gy < 0 || gx >= G.w || gy >= G.h) continue;
          const idx = gy * G.w + gx;
          if (dist[idx] === 0) continue;
          dist[idx] = 0;
          cls[idx] = c;
          queue[qe++] = idx;
        }
      }
  };
  seed(lines.ice, ICE);
  seed(lines.rock, ROCK);
  seed(lines.land, LAND);
  const maxD = Math.max(1, Math.ceil(radius / G.k));
  for (let qs = 0; qs < qe; qs++) {
    const idx = queue[qs];
    const d = dist[idx];
    if (d >= maxD) continue;
    const x = idx % G.w;
    const nb = [x > 0 ? idx - 1 : -1, x < G.w - 1 ? idx + 1 : -1, idx - G.w, idx + G.w];
    for (const j of nb) {
      if (j < 0 || j >= n || dist[j] !== -1) continue;
      dist[j] = d + 1;
      cls[j] = cls[idx];
      queue[qe++] = j;
    }
  }
  return cls;
}

/** Split lines into runs by ground type; runs shorter than minRun mm join their neighbour. */
export function splitByGround(lines: Line[], ground: Uint8Array, G: GridMap, minRun: number): Line[][] {
  const out: Line[][] = [[], [], []];
  for (const l of lines) {
    const n = l.length / 2;
    const c = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const gx = Math.min(G.w - 1, Math.max(0, Math.round((l[2 * i] - G.ox) / G.k)));
      const gy = Math.min(G.h - 1, Math.max(0, Math.round((l[2 * i + 1] - G.oy) / G.k)));
      c[i] = ground[gy * G.w + gx];
    }
    // Absorb short runs so lines don't flicker between pens.
    let i = 0;
    while (i < n) {
      let j = i, len = 0;
      while (j + 1 < n && c[j + 1] === c[i]) {
        len += Math.hypot(l[2 * j + 2] - l[2 * j], l[2 * j + 3] - l[2 * j + 1]);
        j++;
      }
      if (len < minRun && (i > 0 || j < n - 1)) {
        const into = i > 0 ? c[i - 1] : c[j + 1];
        for (let m = i; m <= j; m++) c[m] = into;
      }
      i = j + 1;
    }
    let start = 0;
    for (let k = 1; k <= n; k++) {
      if (k < n && c[k] === c[start]) continue;
      const run = l.slice(2 * start, 2 * Math.min(n, k + 1)); // share the boundary point
      if (run.length >= 4) out[c[start]].push(run);
      start = k;
    }
  }
  return out;
}
