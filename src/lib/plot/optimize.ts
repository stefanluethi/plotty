// Order lines to keep pen-up travel short (greedy nearest neighbour, lines may be reversed).

export function orderLines(lines: number[][], startX = 0, startY = 0): number[][] {
  const n = lines.length;
  if (n < 2) return lines;
  const CELL = 4;
  const grid = new Map<number, number[]>(); // endpoint id = line*2 + end
  const key = (x: number, y: number) => (Math.floor(x / CELL) + 32768) * 65536 + Math.floor(y / CELL) + 32768;
  const ep = (id: number): [number, number] => {
    const l = lines[id >> 1];
    return id & 1 ? [l[l.length - 2], l[l.length - 1]] : [l[0], l[1]];
  };
  for (let id = 0; id < n * 2; id++) {
    const [x, y] = ep(id);
    const k = key(x, y);
    let c = grid.get(k);
    if (!c) grid.set(k, (c = []));
    c.push(id);
  }
  const used = new Uint8Array(n);
  const out: number[][] = [];
  let cx = startX, cy = startY;
  let remaining = n;
  // Fallback cursor for when the local search finds nothing.
  let scan = 0;
  while (remaining) {
    let best = -1, bestD = Infinity;
    const gx = Math.floor(cx / CELL), gy = Math.floor(cy / CELL);
    for (let r = 0; r < 64; r++) {
      // Anything in ring r+1 is at least r*CELL away.
      if (best !== -1 && Math.sqrt(bestD) <= (r - 1) * CELL) break;
      for (let i = gx - r; i <= gx + r; i++) {
        for (let j = gy - r; j <= gy + r; j++) {
          if (Math.max(Math.abs(i - gx), Math.abs(j - gy)) !== r) continue;
          const c = grid.get((i + 32768) * 65536 + j + 32768);
          if (!c) continue;
          for (const id of c) {
            if (used[id >> 1]) continue;
            const [x, y] = ep(id);
            const d = (x - cx) ** 2 + (y - cy) ** 2;
            if (d < bestD) { bestD = d; best = id; }
          }
        }
      }
    }
    if (best === -1) {
      while (used[scan]) scan++;
      best = scan * 2;
    }
    const li = best >> 1;
    used[li] = 1;
    remaining--;
    let l = lines[li];
    if (best & 1) l = reverse(l);
    out.push(l);
    cx = l[l.length - 2];
    cy = l[l.length - 1];
  }
  return out;
}

function reverse(l: number[]) {
  const r: number[] = new Array(l.length);
  for (let i = 0; i < l.length; i += 2) {
    r[l.length - 2 - i] = l[i];
    r[l.length - 1 - i] = l[i + 1];
  }
  return r;
}

/** Merge consecutive lines whose end and start touch. */
export function joinLines(lines: number[][], eps = 0.02): number[][] {
  const out: number[][] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev[prev.length - 2] - l[0]) < eps && Math.abs(prev[prev.length - 1] - l[1]) < eps) {
      for (let i = 2; i < l.length; i++) prev.push(l[i]);
    } else out.push(l.slice());
  }
  return out;
}

export function travelStats(lines: ArrayLike<number>[], startX = 0, startY = 0) {
  let draw = 0, travel = 0, lifts = 0;
  let cx = startX, cy = startY;
  for (const l of lines) {
    const d = Math.hypot(l[0] - cx, l[1] - cy);
    if (d > 0.02) { travel += d; lifts++; }
    for (let i = 2; i < l.length; i += 2) draw += Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]);
    cx = l[l.length - 2];
    cy = l[l.length - 1];
  }
  return { draw, travel, lifts };
}

/**
 * Start every closed loop at its point nearest to where the pen comes from, so the pen
 * doesn't travel round to the loop's old start. Loops are lines whose ends meet within tol.
 */
export function reloop(lines: number[][], startX = 0, startY = 0, tol = 0.02): number[][] {
  let cx = startX, cy = startY;
  return lines.map((l) => {
    const n = l.length;
    if (n >= 8 && Math.hypot(l[0] - l[n - 2], l[1] - l[n - 1]) <= tol) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < n - 2; i += 2) {
        const d = (l[i] - cx) ** 2 + (l[i + 1] - cy) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best > 0) {
        // Rotate: best … end (dropping the repeated first point), start … best.
        const r = l.slice(best, n - 2).concat(l.slice(0, best + 2));
        l = r;
      }
    }
    cx = l[l.length - 2];
    cy = l[l.length - 1];
    return l;
  });
}
