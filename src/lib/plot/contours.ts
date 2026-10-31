// Terrain analysis and contour tracing on a regular grid.

/** Separable Gaussian blur that ignores NaN cells. */
export function blur(data: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.3) return data;
  const r = Math.ceil(sigma * 2.5);
  const k = new Float32Array(2 * r + 1);
  for (let i = -r; i <= r; i++) k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (Number.isNaN(data[row + x])) { tmp[row + x] = NaN; continue; }
      let s = 0, ws = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i;
        if (xx < 0 || xx >= w) continue;
        const v = data[row + xx];
        if (v === v) { s += v * k[i + r]; ws += k[i + r]; }
      }
      tmp[row + x] = s / ws;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (Number.isNaN(tmp[y * w + x])) { out[y * w + x] = NaN; continue; }
      let s = 0, ws = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i;
        if (yy < 0 || yy >= h) continue;
        const v = tmp[yy * w + x];
        if (v === v) { s += v * k[i + r]; ws += k[i + r]; }
      }
      out[y * w + x] = s / ws;
    }
  }
  return out;
}

/** Slope as tan(angle) per cell (rise over run). */
export function slopeGrid(data: Float32Array, w: number, h: number, cell: number): Float32Array {
  const s = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1);
      const yu = Math.max(0, y - 1), yd = Math.min(h - 1, y + 1);
      const gx = (data[y * w + xr] - data[y * w + xl]) / ((xr - xl) * cell);
      const gy = (data[yd * w + x] - data[yu * w + x]) / ((yd - yu) * cell);
      const v = Math.hypot(gx, gy);
      s[y * w + x] = v === v ? v : 0;
    }
  }
  return s;
}

export function percentile(values: Float32Array, p: number, mask?: (i: number) => boolean): number {
  const step = Math.max(1, Math.floor(values.length / 200000));
  const arr: number[] = [];
  for (let i = 0; i < values.length; i += step) if (!mask || mask(i)) arr.push(values[i]);
  if (!arr.length) return 0;
  arr.sort((a, b) => a - b);
  return arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
}

const NICE = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
export function niceInterval(v: number) {
  for (const n of NICE) if (n >= v - 1e-9) return n;
  return 1000;
}

export interface ContourLine {
  level: number;
  pts: number[]; // grid coordinates (x = column, y = row of cell centres)
  closed: boolean;
}

/**
 * Marching squares over all levels k*interval in one pass, then stitch
 * segments into polylines per level.
 */
export function traceContours(data: Float32Array, w: number, h: number, interval: number): ContourLine[] {
  const H0 = (w - 1) * h; // horizontal edges first, then vertical
  const nEdges = H0 + w * (h - 1);
  const buckets = new Map<number, number[]>(); // level index → [edgeA, edgeB, ...]
  const push = (k: number, a: number, b: number) => {
    let arr = buckets.get(k);
    if (!arr) buckets.set(k, (arr = []));
    arr.push(a, b);
  };

  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const v0 = data[j * w + i], v1 = data[j * w + i + 1], v2 = data[(j + 1) * w + i + 1], v3 = data[(j + 1) * w + i];
      if (!(v0 === v0 && v1 === v1 && v2 === v2 && v3 === v3)) continue;
      const mn = Math.min(v0, v1, v2, v3), mx = Math.max(v0, v1, v2, v3);
      const k0 = Math.floor(mn / interval) + 1, k1 = Math.floor(mx / interval);
      if (k1 < k0) continue;
      const T = j * (w - 1) + i, B = (j + 1) * (w - 1) + i;
      const L = H0 + j * w + i, R = H0 + j * w + i + 1;
      for (let k = k0; k <= k1; k++) {
        const lv = k * interval;
        const c = (v0 >= lv ? 8 : 0) | (v1 >= lv ? 4 : 0) | (v2 >= lv ? 2 : 0) | (v3 >= lv ? 1 : 0);
        switch (c) {
          case 1: case 14: push(k, L, B); break;
          case 2: case 13: push(k, B, R); break;
          case 3: case 12: push(k, L, R); break;
          case 4: case 11: push(k, T, R); break;
          case 6: case 9: push(k, T, B); break;
          case 7: case 8: push(k, T, L); break;
          case 5: {
            const centre = (v0 + v1 + v2 + v3) / 4 >= lv;
            if (centre) { push(k, T, L); push(k, B, R); } else { push(k, T, R); push(k, L, B); }
            break;
          }
          case 10: {
            const centre = (v0 + v1 + v2 + v3) / 4 >= lv;
            if (centre) { push(k, T, R); push(k, L, B); } else { push(k, T, L); push(k, B, R); }
            break;
          }
        }
      }
    }
  }

  const slotA = new Int32Array(nEdges).fill(-1);
  const slotB = new Int32Array(nEdges).fill(-1);
  const out: ContourLine[] = [];

  for (const [k, segs] of buckets) {
    const lv = k * interval;
    const nSeg = segs.length / 2;
    for (let s = 0; s < nSeg; s++) {
      for (const e of [segs[2 * s], segs[2 * s + 1]]) {
        if (slotA[e] === -1) slotA[e] = s;
        else slotB[e] = s;
      }
    }
    const used = new Uint8Array(nSeg);
    const point = (e: number, pts: number[]) => {
      if (e < H0) {
        const j = Math.floor(e / (w - 1)), i = e - j * (w - 1);
        const a = data[j * w + i], b = data[j * w + i + 1];
        pts.push(i + (lv - a) / (b - a), j);
      } else {
        const v = e - H0;
        const j = Math.floor(v / w), i = v - j * w;
        const a = data[j * w + i], b = data[(j + 1) * w + i];
        pts.push(i, j + (lv - a) / (b - a));
      }
    };
    const other = (e: number, s: number) => (slotA[e] === s ? slotB[e] : slotA[e]);
    const walk = (startSeg: number, fromEdge: number): { edges: number[]; loop: boolean } => {
      const edges: number[] = [];
      let s = startSeg, e = fromEdge;
      for (;;) {
        edges.push(e);
        const nx = other(e, s);
        if (nx === -1) return { edges, loop: false };
        if (nx === startSeg) return { edges, loop: true };
        if (used[nx]) return { edges, loop: false };
        used[nx] = 1;
        e = segs[2 * nx] === e ? segs[2 * nx + 1] : segs[2 * nx];
        s = nx;
      }
    };
    for (let s = 0; s < nSeg; s++) {
      if (used[s]) continue;
      used[s] = 1;
      const fwd = walk(s, segs[2 * s + 1]);
      let edges = fwd.edges;
      if (!fwd.loop) edges = walk(s, segs[2 * s]).edges.reverse().concat(fwd.edges);
      const pts: number[] = [];
      for (const e of edges) point(e, pts);
      if (fwd.loop) pts.push(pts[0], pts[1]);
      if (pts.length >= 4) out.push({ level: lv, pts, closed: fwd.loop });
    }
    for (let s = 0; s < nSeg; s++) {
      slotA[segs[2 * s]] = slotB[segs[2 * s]] = -1;
      slotA[segs[2 * s + 1]] = slotB[segs[2 * s + 1]] = -1;
    }
  }
  return out;
}
