// Area fills (hatching, tree symbols) and a ground-type grid for colouring contours.
// Polygons are lists of closed rings in paper mm, filled with the even-odd rule.

import { clipPolyline, type Box, type Line } from './geom';
import type { GridMap } from './relief';

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

/**
 * Parallel hatch lines inside polygons. Lines sit on one grid across the whole
 * sheet, so pieces from neighbouring tiles meet and the optimizer joins them.
 */
export function hatchPolys(polys: Poly[], angle: number, spacing: number, box: Box): Line[] {
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  // Rotate into (u, v) where hatch lines are v = const; paper y points down.
  const toU = (x: number, y: number) => x * c - y * s;
  const toV = (x: number, y: number) => x * s + y * c;
  const out: Line[] = [];
  for (const p of polys) {
    let v0 = Infinity, v1 = -Infinity;
    const edges: number[] = []; // u1, v1, u2, v2
    for (const r of p)
      for (let i = 2; i < r.length; i += 2) {
        const ua = toU(r[i - 2], r[i - 1]), va = toV(r[i - 2], r[i - 1]);
        const ub = toU(r[i], r[i + 1]), vb = toV(r[i], r[i + 1]);
        edges.push(ua, va, ub, vb);
        v0 = Math.min(v0, va, vb);
        v1 = Math.max(v1, va, vb);
      }
    const xs: number[] = [];
    for (let k = Math.ceil(v0 / spacing); k * spacing <= v1; k++) {
      const v = k * spacing;
      xs.length = 0;
      for (let i = 0; i < edges.length; i += 4) {
        const va = edges[i + 1], vb = edges[i + 3];
        if ((va <= v && v < vb) || (vb <= v && v < va)) xs.push(edges[i] + ((edges[i + 2] - edges[i]) * (v - va)) / (vb - va));
      }
      xs.sort((m, n) => m - n);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        if (xs[i + 1] - xs[i] < 0.05) continue;
        // Back from (u, v) to paper.
        const seg = [xs[i] * c + v * s, -xs[i] * s + v * c, xs[i + 1] * c + v * s, -xs[i + 1] * s + v * c];
        out.push(...clipPolyline(seg, box));
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
