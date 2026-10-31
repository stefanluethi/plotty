import type { Settings } from '../settings';
import { computeLayout, type Layout } from '../layout';
import type { DemGrid } from '../geo/dem';
import type { WaterData } from '../geo/water';
import { blur, slopeGrid, percentile, niceInterval, traceContours } from './contours';
import { clipPolyline, simplify, lineLength, passes, densify, SegmentIndex, splitWhere, rectLine, type Line } from './geom';
import { renderText, textWidth, type StrokeFont } from './font';
import { orderLines, joinLines, travelStats } from './optimize';
import { formatCoords, swissNumber } from '../geo/lv95';

export interface PenOutput {
  penId: string;
  lines: Float32Array[];
  draw: number;
  travel: number;
  lifts: number;
}

export interface ComposeStats {
  interval: number | null;
  minElev: number | null;
  maxElev: number | null;
  crowded: number | null; // share of map area where base contours would touch
  contourLines: number;
  demSource: string | null;
  demCell: number | null;
}

export interface ComposeResult {
  pens: PenOutput[];
  stats: ComposeStats;
  layout: Layout;
}

const SIMPLIFY = 0.03; // mm on paper

let blurCache: { key: string; data: Float32Array; slope: Float32Array } | null = null;

function terrain(dem: DemGrid, sigma: number) {
  const key = `${dem.id}|${sigma.toFixed(2)}`;
  if (blurCache?.key !== key) {
    const data = blur(dem.data, dem.w, dem.h, sigma);
    blurCache = { key, data, slope: slopeGrid(data, dem.w, dem.h, dem.cell) };
  }
  return blurCache;
}

/** Chain of nested multiples below the index step, e.g. every=10 → [1, 5]. */
function thinChain(every: number) {
  const chain: number[] = [];
  let m = every;
  while (m > 1) {
    let d = m - 1;
    while (d > 1 && m % d) d--;
    chain.unshift(d);
    m = d;
  }
  return chain.length ? chain : [1];
}

export function compose(s: Settings, dem: DemGrid | null, water: WaterData | null, fonts: Record<string, StrokeFont>): ComposeResult {
  const L = computeLayout(s);
  const pen = (id: string) => s.pens.find((p) => p.id === id) ?? s.pens[0];
  const byPen = new Map<string, Line[]>();
  const add = (penId: string, lines: Line[]) => {
    if (!s.pens.some((p) => p.id === penId)) penId = s.pens[0]?.id;
    if (!penId) return;
    let arr = byPen.get(penId);
    if (!arr) byPen.set(penId, (arr = []));
    for (const l of lines) arr.push(l);
  };
  const stats: ComposeStats = {
    interval: null, minElev: null, maxElev: null, crowded: null, contourLines: 0,
    demSource: dem?.source ?? null, demCell: dem?.cell ?? null,
  };
  const toPaperLine = (lv: ArrayLike<number>): Line => {
    const out: Line = new Array(lv.length);
    for (let i = 0; i < lv.length; i += 2) {
      out[i] = L.map.x + (lv[i] - L.west) / L.mPerMm;
      out[i + 1] = L.map.y + (L.north - lv[i + 1]) / L.mPerMm;
    }
    return out;
  };

  // Tracks first: other layers may break around them.
  const trackLines: { penId: string; lines: Line[] }[] = [];
  const knock = new SegmentIndex(4);
  let knockR = 0;
  for (const t of s.tracks) {
    if (!t.visible) continue;
    const p = pen(t.pen);
    const lines: Line[] = [];
    for (const seg of t.segments) {
      for (const piece of clipPolyline(toPaperLine(seg), L.map)) {
        const simple = simplify(piece, SIMPLIFY);
        knock.add(simple);
        lines.push(...passes(simple, t.passes, p.width * 0.6).flatMap((l) => clipPolyline(l, L.map)));
      }
    }
    const halfW = (p.width * (1 + 0.6 * (t.passes - 1))) / 2;
    knockR = Math.max(knockR, halfW + s.knockout.gap);
    trackLines.push({ penId: p.id, lines });
  }
  const doKnock = s.knockout.enabled && trackLines.some((t) => t.lines.length) && knockR > 0;
  knockR = Math.min(knockR, 4);
  const finish = (lines: Line[], minLen: number): Line[] => {
    let out = lines;
    if (doKnock) out = out.flatMap((l) => splitWhere(densify(l, knockR / 2), (x, y) => !knock.near(x, y, knockR)));
    return out.map((l) => simplify(l, SIMPLIFY)).filter((l) => lineLength(l) >= minLen);
  };

  // Contours
  if (s.contours.enabled && dem) {
    const c = s.contours;
    const cp = pen(c.pen);
    const sigma = (c.smoothing * L.mPerMm) / dem.cell;
    const T = terrain(dem, sigma);
    const k = dem.cell / L.mPerMm; // grid step on paper
    const ox = L.map.x + (dem.west + dem.cell / 2 - L.west) / L.mPerMm;
    const oy = L.map.y + (L.north - dem.north + dem.cell / 2) / L.mPerMm;
    const inMap = (i: number) => {
      const gx = i % dem.w, gy = (i / dem.w) | 0;
      const x = ox + gx * k, y = oy + gy * k;
      return x >= L.map.x && x <= L.map.x + L.map.w && y >= L.map.y && y <= L.map.y + L.map.h && T.data[i] === T.data[i];
    };
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < T.data.length; i++) {
      if (!inMap(i)) continue;
      const v = T.data[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mn <= mx) {
      stats.minElev = mn;
      stats.maxElev = mx;
      let interval: number;
      if (c.auto) {
        const tanP = percentile(T.slope, c.percentile, inMap);
        interval = niceInterval(Math.max(1, c.spacing * cp.width * L.mPerMm * tanP));
      } else interval = Math.max(0.5, c.interval);
      // Never more than ~600 levels.
      while ((mx - mn) / interval > 600) interval = niceInterval(interval * 1.5);
      stats.interval = interval;

      // Share of terrain where neighbouring base lines would touch.
      const touch = (interval / (cp.width * 1.2)) / L.mPerMm; // slope above which spacing < 1.2 widths
      let crowd = 0, cnt = 0;
      const step = Math.max(1, Math.floor(T.slope.length / 200000));
      for (let i = 0; i < T.slope.length; i += step) if (inMap(i)) { cnt++; if (T.slope[i] > touch) crowd++; }
      stats.crowded = cnt ? crowd / cnt : 0;

      const traced = traceContours(T.data, dem.w, dem.h, interval);
      const chain = thinChain(c.index.every);
      const minGap = c.thinSpacing * cp.width;
      const regular: Line[] = [];
      const index: Line[] = [];
      for (const t of traced) {
        const kIdx = Math.round(t.level / interval);
        const isIndex = c.index.enabled && kIdx % c.index.every === 0;
        let lines: Line[];
        const pts = t.pts;
        const paper: Line = new Array(pts.length);
        for (let i = 0; i < pts.length; i += 2) {
          paper[i] = ox + pts[i] * k;
          paper[i + 1] = oy + pts[i + 1] * k;
        }
        if (c.thin && !isIndex) {
          let mult = 1;
          for (const m of chain) if (kIdx % m === 0) mult = m;
          const n = pts.length / 2;
          const keep = new Uint8Array(n);
          for (let i = 0; i < n; i++) {
            const gx = Math.min(dem.w - 1, Math.max(0, Math.round(pts[2 * i])));
            const gy = Math.min(dem.h - 1, Math.max(0, Math.round(pts[2 * i + 1])));
            const sl = T.slope[gy * dem.w + gx];
            const spacing = sl > 0 ? interval / (sl * L.mPerMm) : Infinity;
            keep[i] = spacing * mult >= minGap ? 1 : 0;
          }
          // Close short gaps so lines don't flicker on and off.
          fillShortRuns(keep, 0, paper, 1.0);
          fillShortRuns(keep, 1, paper, 0.6);
          lines = [];
          let cur: Line = [];
          for (let i = 0; i < n; i++) {
            if (keep[i]) cur.push(paper[2 * i], paper[2 * i + 1]);
            else if (cur.length) { if (cur.length >= 4) lines.push(cur); cur = []; }
          }
          if (cur.length >= 4) lines.push(cur);
        } else lines = [paper];
        const clipped = lines.flatMap((l) => clipPolyline(l, L.map));
        (isIndex ? index : regular).push(...clipped);
      }
      const reg = finish(regular, c.minLength);
      const idx = finish(index, c.minLength);
      stats.contourLines = reg.length + idx.length;
      add(cp.id, reg);
      if (idx.length) {
        const ip = pen(c.index.pen);
        add(ip.id, idx.flatMap((l) => passes(l, c.index.passes, ip.width * 0.6)).flatMap((l) => clipPolyline(l, L.map)));
      }
    }
  }

  // Water
  if (water) {
    const wp = pen(s.water.pen);
    const sets: number[][][] = [];
    if (s.water.lakes) sets.push(water.lakes);
    if (s.water.rivers) sets.push(water.rivers);
    if (s.water.streams) sets.push(water.streams);
    const lines = sets.flat().flatMap((lv) => clipPolyline(toPaperLine(lv), L.map));
    add(wp.id, finish(lines, 0.5));
  }

  // Frame
  if (s.frame.enabled) {
    const f = s.frame;
    const r = (o: number) => rectLine(L.map.x - o, L.map.y - o, L.map.w + 2 * o, L.map.h + 2 * o);
    const lines = [r(f.offset)];
    if (f.double) lines.push(r(f.offset + f.gap));
    add(pen(f.pen).id, lines);
  }

  // Title
  if (s.title.enabled && L.band) {
    const font = fonts[s.title.font] ?? Object.values(fonts)[0];
    if (font) {
      const fill = (t: string) =>
        t
          .replace(/\{coords\}/g, formatCoords(s.area.e, s.area.n))
          .replace(/\{scale\}/g, swissNumber(s.area.scale))
          .replace(/\{interval\}/g, stats.interval != null ? String(stats.interval) : '–')
          .replace(/\{lv95\}/g, `${swissNumber(s.area.e)} / ${swissNumber(s.area.n)}`)
          .replace(/\{date\}/g, new Date().toLocaleDateString('de-CH'));
      const lines: Line[] = [];
      const place = (text: string, size: number, baseline: number) => {
        const w = textWidth(font, text, size);
        const x = s.title.align === 'left' ? L.map.x : s.title.align === 'right' ? L.map.x + L.map.w - w : L.map.x + (L.map.w - w) / 2;
        lines.push(...renderText(font, text, size, x, baseline));
      };
      const size = s.title.size;
      const top = L.band.y + (s.frame.enabled ? s.frame.offset + (s.frame.double ? s.frame.gap : 0) : 0);
      const b1 = top + size * 2;
      if (s.title.text.trim()) place(fill(s.title.text), size, b1);
      if (s.title.subtitle.trim()) place(fill(s.title.subtitle), size * 0.55, b1 + size * 1.25);
      add(pen(s.title.pen).id, lines);
    }
  }

  for (const t of trackLines) add(t.penId, t.lines);

  // Order per pen, in rack order.
  const pens: PenOutput[] = [];
  let cx = 0, cy = 0;
  for (const p of s.pens) {
    const lines = byPen.get(p.id);
    if (!lines?.length) continue;
    const ordered = joinLines(orderLines(lines, cx, cy));
    const st = travelStats(ordered, cx, cy);
    const last = ordered[ordered.length - 1];
    cx = last[last.length - 2];
    cy = last[last.length - 1];
    pens.push({ penId: p.id, lines: ordered.map((l) => Float32Array.from(l)), ...st });
  }
  return { pens, stats, layout: L };
}

/** Flip runs of `value` shorter than maxLen (mm along the line) to the opposite value. */
function fillShortRuns(flags: Uint8Array, value: number, paper: Line, maxLen: number) {
  const n = flags.length;
  let i = 0;
  while (i < n) {
    if (flags[i] !== value) { i++; continue; }
    let j = i, len = 0;
    while (j + 1 < n && flags[j + 1] === value) {
      len += Math.hypot(paper[2 * j + 2] - paper[2 * j], paper[2 * j + 3] - paper[2 * j + 1]);
      j++;
    }
    // Only fill interior runs; a run touching the line end stays as is.
    if (len < maxLen && i > 0 && j < n - 1) for (let m = i; m <= j; m++) flags[m] = 1 - value;
    i = j + 1;
  }
}
