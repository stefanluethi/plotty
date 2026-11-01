// Polyline helpers. Lines are flat arrays [x0, y0, x1, y1, ...].

export type Line = number[];
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Clip a polyline to a rectangle; returns the pieces inside. */
export function clipPolyline(line: ArrayLike<number>, r: Box): Line[] {
  const out: Line[] = [];
  const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  let cur: Line | null = null;
  for (let i = 2; i < line.length; i += 2) {
    let ax = line[i - 2], ay = line[i - 1], bx = line[i], by = line[i + 1];
    // Liang–Barsky
    const dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
    let visible = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) {
        if (q[k] < 0) { visible = false; break; }
      } else {
        const t = q[k] / p[k];
        if (p[k] < 0) { if (t > t1) { visible = false; break; } if (t > t0) t0 = t; }
        else { if (t < t0) { visible = false; break; } if (t < t1) t1 = t; }
      }
    }
    if (!visible) { if (cur) { out.push(cur); cur = null; } continue; }
    const cax = ax + t0 * dx, cay = ay + t0 * dy, cbx = ax + t1 * dx, cby = ay + t1 * dy;
    if (!cur) cur = [cax, cay];
    else if (t0 > 0) { out.push(cur); cur = [cax, cay]; }
    cur.push(cbx, cby);
    if (t1 < 1) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter((l) => l.length >= 4);
}

export function lineLength(l: ArrayLike<number>) {
  let s = 0;
  for (let i = 2; i < l.length; i += 2) s += Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]);
  return s;
}

export function isClosed(l: ArrayLike<number>, eps = 1e-6) {
  const n = l.length;
  return n >= 6 && Math.abs(l[0] - l[n - 2]) < eps && Math.abs(l[1] - l[n - 1]) < eps;
}

/** Ramer–Douglas–Peucker, iterative. */
export function simplify(l: Line, tol: number): Line {
  const n = l.length / 2;
  if (n <= 2) return l;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const tol2 = tol * tol;
  while (stack.length) {
    const b = stack.pop()!, a = stack.pop()!;
    const ax = l[a * 2], ay = l[a * 2 + 1], bx = l[b * 2], by = l[b * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = l[i * 2] - ax, py = l[i * 2 + 1] - ay;
      let d: number;
      if (len2 === 0) d = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx, ey = py - t * dy;
        d = ex * ex + ey * ey;
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2) {
      keep[idx] = 1;
      stack.push(a, idx, idx, b);
    }
  }
  const out: Line = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(l[i * 2], l[i * 2 + 1]);
  return out;
}

/** Parallel copy of a polyline at signed distance d (left of travel direction). */
export function offsetLine(l: Line, d: number): Line {
  const n = l.length / 2;
  if (n < 2 || d === 0) return l.slice();
  const closed = isClosed(l);
  const out: Line = [];
  const normal = (i: number, j: number): [number, number] => {
    const dx = l[j * 2] - l[i * 2], dy = l[j * 2 + 1] - l[i * 2 + 1];
    const len = Math.hypot(dx, dy) || 1;
    return [-dy / len, dx / len];
  };
  for (let i = 0; i < n; i++) {
    let prev = i - 1, next = i + 1;
    if (closed) {
      if (i === 0) prev = n - 2;
      if (i === n - 1) next = 1;
    }
    let nx: number, ny: number;
    if (prev < 0) [nx, ny] = normal(i, next);
    else if (next >= n) [nx, ny] = normal(prev, i);
    else {
      const [ax, ay] = normal(prev, i);
      const [bx, by] = normal(i, next);
      let mx = ax + bx, my = ay + by;
      const ml = Math.hypot(mx, my);
      if (ml < 1e-6) { mx = ax; my = ay; }
      else {
        mx /= ml; my /= ml;
        const cos = mx * ax + my * ay;
        const k = 1 / Math.max(cos, 0.5); // miter, limited
        mx *= k; my *= k;
      }
      nx = mx; ny = my;
    }
    out.push(l[i * 2] + nx * d, l[i * 2 + 1] + ny * d);
  }
  return out;
}

/** Copies of a line spread side by side to build up a heavier stroke. */
export function passes(l: Line, count: number, step: number): Line[] {
  if (count <= 1) return [l];
  const out: Line[] = [];
  for (let k = 0; k < count; k++) {
    const d = (k - (count - 1) / 2) * step;
    out.push(d === 0 ? l : offsetLine(l, d));
  }
  return out;
}

/** Insert points so no segment is longer than step. */
export function densify(l: Line, step: number): Line {
  const out: Line = [l[0], l[1]];
  for (let i = 2; i < l.length; i += 2) {
    const ax = l[i - 2], ay = l[i - 1], bx = l[i], by = l[i + 1];
    const k = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let j = 1; j <= k; j++) out.push(ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k);
  }
  return out;
}

/** Spatial hash of segments for "is this point near any of these lines?" queries. */
export class SegmentIndex {
  private cells = new Map<number, number[]>();
  private segs: number[] = [];
  constructor(private size: number) {}
  private key(cx: number, cy: number) {
    return (cx + 32768) * 65536 + (cy + 32768);
  }
  add(l: ArrayLike<number>) {
    for (let i = 2; i < l.length; i += 2) {
      const id = this.segs.length / 4;
      const ax = l[i - 2], ay = l[i - 1], bx = l[i], by = l[i + 1];
      this.segs.push(ax, ay, bx, by);
      const cx0 = Math.floor(Math.min(ax, bx) / this.size), cx1 = Math.floor(Math.max(ax, bx) / this.size);
      const cy0 = Math.floor(Math.min(ay, by) / this.size), cy1 = Math.floor(Math.max(ay, by) / this.size);
      for (let cx = cx0; cx <= cx1; cx++)
        for (let cy = cy0; cy <= cy1; cy++) {
          const k = this.key(cx, cy);
          let c = this.cells.get(k);
          if (!c) this.cells.set(k, (c = []));
          c.push(id);
        }
    }
  }
  /** true if (x, y) is within r of any segment (r must be ≤ cell size) */
  near(x: number, y: number, r: number) {
    const cx = Math.floor(x / this.size), cy = Math.floor(y / this.size);
    const r2 = r * r;
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cy - 1; j <= cy + 1; j++) {
        const c = this.cells.get(this.key(i, j));
        if (!c) continue;
        for (const id of c) {
          const ax = this.segs[id * 4], ay = this.segs[id * 4 + 1], bx = this.segs[id * 4 + 2], by = this.segs[id * 4 + 3];
          const dx = bx - ax, dy = by - ay;
          const len2 = dx * dx + dy * dy;
          const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
          const ex = x - ax - t * dx, ey = y - ay - t * dy;
          if (ex * ex + ey * ey < r2) return true;
        }
      }
    return false;
  }
}

/** Split lines into the runs whose points satisfy keep(). */
export function splitWhere(l: Line, keep: (x: number, y: number) => boolean): Line[] {
  const out: Line[] = [];
  let cur: Line = [];
  for (let i = 0; i < l.length; i += 2) {
    if (keep(l[i], l[i + 1])) cur.push(l[i], l[i + 1]);
    else if (cur.length) {
      if (cur.length >= 4) out.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 4) out.push(cur);
  return out;
}

/** Cut a line into dashes of `dash` mm with `gap` mm between them, keeping the pattern across vertices. */
export function dashLine(l: Line, dash: number, gap: number): Line[] {
  if (dash <= 0 || gap <= 0) return [l];
  const out: Line[] = [];
  let cur: Line | null = [l[0], l[1]];
  let left = dash; // mm left in the current dash or gap
  for (let i = 2; i < l.length; i += 2) {
    let ax = l[i - 2], ay = l[i - 1];
    const bx = l[i], by = l[i + 1];
    let seg = Math.hypot(bx - ax, by - ay);
    while (seg > left) {
      const t = left / seg;
      const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
      if (cur) {
        cur.push(px, py);
        out.push(cur);
        cur = null;
        left = gap;
      } else {
        cur = [px, py];
        left = dash;
      }
      seg -= Math.hypot(px - ax, py - ay);
      ax = px;
      ay = py;
    }
    left -= seg;
    if (cur) cur.push(bx, by);
  }
  if (cur && cur.length >= 4) out.push(cur);
  return out;
}

export function rectLine(x: number, y: number, w: number, h: number): Line {
  return [x, y, x + w, y, x + w, y + h, x, y + h, x, y];
}

/**
 * Gaussian smoothing along the line, sigma in mm. The line is resampled evenly first.
 * Open lines keep both end points, so lines that meet at an end still meet.
 * Lines whose ends meet within closeTol are smoothed as loops.
 */
export function smoothLine(l: Line, sigma: number, closeTol = 1e-6): Line {
  const n = l.length / 2;
  if (sigma <= 0 || n < 3) return l;
  const closed = Math.hypot(l[0] - l[l.length - 2], l[1] - l[l.length - 1]) <= closeTol;
  // Cumulative length.
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(l[2 * i] - l[2 * i - 2], l[2 * i + 1] - l[2 * i - 1]);
  const total = cum[n - 1];
  // Smoothing pulls a loop inward (a circle of radius r shrinks by exp(-σ²/2r²)). Cap it so
  // small loops such as ponds and roundabouts keep about 90% of their size instead of vanishing.
  if (closed) sigma = Math.min(sigma, (0.46 * total) / (2 * Math.PI));
  const step0 = Math.max(0.02, sigma / 2);
  if (total < step0 * 3) return l;
  const N = Math.max(3, Math.round(total / step0));
  const h = total / N;
  // Even resampling: N + 1 points from start to end (for loops the last repeats the first).
  const xs = new Float64Array(N + 1), ys = new Float64Array(N + 1);
  let j = 0;
  for (let i = 0; i <= N; i++) {
    const d = Math.min(total, i * h);
    while (j < n - 2 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j];
    const t = seg > 0 ? (d - cum[j]) / seg : 0;
    xs[i] = l[2 * j] + (l[2 * j + 2] - l[2 * j]) * t;
    ys[i] = l[2 * j + 1] + (l[2 * j + 3] - l[2 * j + 1]) * t;
  }
  const R = Math.min(Math.ceil((3 * sigma) / h), closed ? Math.floor(N / 2) : N);
  const w = new Float64Array(R + 1);
  for (let k = 0; k <= R; k++) w[k] = Math.exp(-((k * h) ** 2) / (2 * sigma * sigma));
  const out: Line = new Array(2 * (N + 1));
  for (let i = 0; i <= N; i++) {
    if (closed && i === N) {
      out[2 * i] = out[0];
      out[2 * i + 1] = out[1];
      break;
    }
    // Near the ends of an open line the window shrinks evenly, so the end point stays put.
    const r = closed ? R : Math.min(R, i, N - i);
    let sx = xs[i] * w[0], sy = ys[i] * w[0], sw = w[0];
    for (let k = 1; k <= r; k++) {
      let a = i - k, b = i + k;
      if (closed) {
        a = ((a % N) + N) % N;
        b = b % N;
      }
      sx += (xs[a] + xs[b]) * w[k];
      sy += (ys[a] + ys[b]) * w[k];
      sw += 2 * w[k];
    }
    out[2 * i] = sx / sw;
    out[2 * i + 1] = sy / sw;
  }
  return out;
}

/**
 * Join lines whose ends lie within tol of each other into longer lines, reversing
 * them where needed. With throughOnly, lines are only joined where exactly two ends
 * meet, so junctions (three or more ends) stay end points of every branch.
 */
export function mergeLines(lines: Line[], tol: number, throughOnly = false): Line[] {
  const n = lines.length;
  if (n < 2) return lines;
  const cell = Math.max(tol, 1e-3) * 2;
  const tol2 = Math.max(tol, 1e-6) ** 2;
  const grid = new Map<number, number[]>(); // end id = line * 2 + (0 start | 1 end)
  const key = (cx: number, cy: number) => (cx + 1048576) * 2097152 + (cy + 1048576);
  const ex = (id: number) => (id & 1 ? lines[id >> 1][lines[id >> 1].length - 2] : lines[id >> 1][0]);
  const ey = (id: number) => (id & 1 ? lines[id >> 1][lines[id >> 1].length - 1] : lines[id >> 1][1]);
  for (let id = 0; id < 2 * n; id++) {
    if (lines[id >> 1].length < 4) continue;
    const k = key(Math.floor(ex(id) / cell), Math.floor(ey(id) / cell));
    let c = grid.get(k);
    if (!c) grid.set(k, (c = []));
    c.push(id);
  }
  /** All ends within tol of (x, y), used or not. */
  const near = (x: number, y: number) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    const found: number[] = [];
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cy - 1; j <= cy + 1; j++) {
        const c = grid.get(key(i, j));
        if (c) for (const id of c) if ((ex(id) - x) ** 2 + (ey(id) - y) ** 2 <= tol2) found.push(id);
      }
    return found;
  };
  const used = new Uint8Array(n);
  const closedLine = (l: Line) => (l[0] - l[l.length - 2]) ** 2 + (l[1] - l[l.length - 1]) ** 2 <= tol2;
  /** The free end that continues from (x, y), or -1. */
  const next = (x: number, y: number) => {
    const ids = near(x, y);
    if (throughOnly && ids.length !== 2) return -1;
    for (const id of ids) if (!used[id >> 1]) return id;
    return -1;
  };
  const out: Line[] = [];
  for (let i = 0; i < n; i++) {
    if (used[i] || lines[i].length < 4) continue;
    used[i] = 1;
    let cur = lines[i].slice();
    if (!closedLine(cur)) {
      // Grow forward from the end, then backward from the start.
      for (let dir = 0; dir < 2; dir++) {
        for (;;) {
          if (closedLine(cur)) break;
          const id = next(cur[cur.length - 2], cur[cur.length - 1]);
          if (id < 0) break;
          used[id >> 1] = 1;
          const l = lines[id >> 1];
          if (id & 1) for (let k = l.length - 4; k >= 0; k -= 2) cur.push(l[k], l[k + 1]);
          else for (let k = 2; k < l.length; k += 2) cur.push(l[k], l[k + 1]);
        }
        cur = reversed(cur);
      }
    }
    out.push(cur);
  }
  return out;
}

export function reversed(l: Line): Line {
  const r: Line = new Array(l.length);
  for (let i = 0; i < l.length; i += 2) {
    r[l.length - 2 - i] = l[i];
    r[l.length - 1 - i] = l[i + 1];
  }
  return r;
}
