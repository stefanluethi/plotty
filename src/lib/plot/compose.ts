import type { Settings, Pen } from '../settings';
import { computeLayout, type Layout } from '../layout';
import type { DemGrid } from '../geo/dem';
import type { MapFeatures, WayKind } from '../geo/features';
import { blur, slopeGrid, niceInterval, traceContours, type ContourLine } from './contours';
import { clipPolyline, simplify, lineLength, passes, densify, SegmentIndex, splitWhere, rectLine, dashLine, type Line } from './geom';
import { renderText, textWidth, type StrokeFont } from './font';
import { orderLines, joinLines, travelStats } from './optimize';
import { gradients, shadeGrid, tanaka, hatch, hachures, lightVector, type GridMap } from './relief';
import { hatchPolys, treeSymbols, polySize, groundGrid, splitByGround } from './areas';
import { placeLabels, RectIndex, type LabelItem } from './labels';
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
  hachureInterval: number | null;
  demSource: string | null;
  demCell: number | null;
}

export interface ComposeResult {
  pens: PenOutput[];
  stats: ComposeStats;
  layout: Layout;
}

const SIMPLIFY = 0.03; // mm on paper

interface Terrain {
  key: string;
  data: Float32Array;
  slope: Float32Array;
  grad?: { gx: Float32Array; gy: Float32Array };
}

// Two slots: contours and relief shading usually use different smoothing.
let blurCache: Terrain[] = [];

function terrain(dem: DemGrid, sigma: number): Terrain {
  const key = `${dem.id}|${sigma.toFixed(2)}`;
  let t = blurCache.find((b) => b.key === key);
  if (!t) {
    const data = blur(dem.data, dem.w, dem.h, sigma);
    t = { key, data, slope: slopeGrid(data, dem.w, dem.h, dem.cell) };
    blurCache = [t, ...blurCache].slice(0, 2);
  } else blurCache = [t, ...blurCache.filter((b) => b !== t)];
  return t;
}

function grad(T: Terrain, dem: DemGrid) {
  return (T.grad ??= gradients(T.data, dem.w, dem.h, dem.cell));
}

let shadeCache: { key: string; shade: Float32Array } | null = null;
function shaded(T: Terrain, dem: DemGrid, az: number, alt: number, z: number) {
  const key = `${T.key}|${az}|${alt}|${z}`;
  if (shadeCache?.key !== key) {
    const g = grad(T, dem);
    shadeCache = { key, shade: shadeGrid(g.gx, g.gy, az, alt, z) };
  }
  return shadeCache.shade;
}

// Elevation range and median slope for the hachure rows.
let reliefRangeCache: { key: string; mn: number; mx: number; tanP: number } | null = null;
function reliefRange(T: Terrain, key: string, inMap: (i: number) => boolean) {
  if (reliefRangeCache?.key !== key) {
    let mn = Infinity, mx = -Infinity;
    const sample: number[] = [];
    const step = Math.max(1, Math.floor(T.slope.length / 200000));
    for (let i = 0; i < T.data.length; i++) {
      if (!inMap(i)) continue;
      const v = T.data[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      if (i % step === 0) sample.push(T.slope[i]);
    }
    sample.sort((a, b) => a - b);
    reliefRangeCache = { key, mn, mx, tanP: sample.length ? sample[Math.floor(sample.length * 0.5)] : 0 };
  }
  return reliefRangeCache;
}
let hachureTraceCache: { key: string; lines: ContourLine[] } | null = null;
let groundCache: { key: string; grid: Uint8Array } | null = null;

const PLACE_CLASSES = {
  towns: ['city', 'town'],
  villages: ['city', 'town', 'village'],
  all: ['city', 'town', 'village', 'suburb', 'hamlet', 'neighbourhood', 'isolated_dwelling'],
};
const PLACE_STYLE: Record<string, { size: number; priority: number }> = {
  city: { size: 1.8, priority: 0 },
  town: { size: 1.5, priority: 1 },
  village: { size: 1.2, priority: 3 },
  suburb: { size: 1, priority: 4 },
  hamlet: { size: 1, priority: 5 },
  neighbourhood: { size: 0.85, priority: 6 },
  isolated_dwelling: { size: 0.85, priority: 7 },
};
const PEAK_PRIORITY = [1.5, 2, 3.5, 4.5, 5.5];

// Scrubbing pens, thinning, frame or title leaves terrain, area and interval alone,
// so the two expensive terrain passes below are kept between runs.
let rangeCache: { key: string; mn: number; mx: number; slopes: Float32Array } | null = null;
let traceCache: { key: string; lines: ContourLine[] } | null = null;

/** Elevation range over the map area, and a sorted sample of its slopes. */
function terrainInMap(T: { key: string; data: Float32Array; slope: Float32Array }, key: string, inMap: (i: number) => boolean) {
  if (rangeCache?.key !== key) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < T.data.length; i++) {
      if (!inMap(i)) continue;
      const v = T.data[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const step = Math.max(1, Math.floor(T.slope.length / 200000));
    const sample: number[] = [];
    for (let i = 0; i < T.slope.length; i += step) if (inMap(i)) sample.push(T.slope[i]);
    rangeCache = { key, mn, mx, slopes: Float32Array.from(sample).sort() };
  }
  return rangeCache;
}

function traced(T: { key: string; data: Float32Array }, w: number, h: number, interval: number) {
  const key = `${T.key}|${interval}`;
  if (traceCache?.key !== key) traceCache = { key, lines: traceContours(T.data, w, h, interval) };
  return traceCache.lines;
}

/** Index of the first value above v in an ascending array. */
function upperBound(a: Float32Array, v: number) {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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

export function compose(s: Settings, dem: DemGrid | null, features: MapFeatures | null, fonts: Record<string, StrokeFont>): ComposeResult {
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
    interval: null, minElev: null, maxElev: null, crowded: null, contourLines: 0, hachureInterval: null,
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

  // Labels early too: other layers can leave room around them.
  let labelClear: RectIndex | null = null;
  const lb = s.labels;
  if (lb.enabled && features) {
    const font = fonts[lb.font] ?? Object.values(fonts)[0];
    if (font) {
      const P = (e: number, n: number) => [L.map.x + (e - L.west) / L.mPerMm, L.map.y + (L.north - n) / L.mPerMm];
      const items: LabelItem[] = [];
      if (lb.peaks)
        for (const pk of features.peaks) {
          if (pk.rank > lb.peakDetail) continue;
          const [x, y] = P(pk.e, pk.n);
          const pass = pk.cls === 'saddle' || pk.cls === 'mountain_pass';
          items.push({
            text: lb.heights && pk.ele ? `${pk.name} ${Math.round(pk.ele)}` : pk.name,
            x, y, size: lb.size * (pk.rank <= 1 ? 1.15 : 1), marker: pass ? 'none' : 'peak',
            priority: (PEAK_PRIORITY[pk.rank - 1] ?? 6) - pk.ele / 1e5,
          });
        }
      if (lb.places) {
        const allowed = PLACE_CLASSES[lb.placeDetail] ?? PLACE_CLASSES.villages;
        for (const pl of features.places) {
          if (!allowed.includes(pl.cls)) continue;
          const st = PLACE_STYLE[pl.cls];
          const [x, y] = P(pl.e, pl.n);
          items.push({ text: pl.name, x, y, size: lb.size * st.size, marker: 'none', priority: st.priority + pl.rank / 1000 });
        }
      }
      if (lb.spots)
        for (const sp of features.spots) {
          const [x, y] = P(sp.e, sp.n);
          items.push({ text: String(Math.round(sp.ele)), x, y, size: lb.size * 0.8, marker: 'spot', priority: 9 - sp.ele / 1e5 });
        }
      const r = placeLabels(items, font, L.map, Math.max(0, lb.gap));
      add(pen(lb.pen).id, r.lines);
      if (lb.clear && !r.clear.empty) labelClear = r.clear;
    }
  }

  const finish = (lines: Line[], minLen: number): Line[] => {
    let out = lines;
    if (doKnock) out = out.flatMap((l) => splitWhere(densify(l, knockR / 2), (x, y) => !knock.near(x, y, knockR)));
    if (labelClear) out = out.flatMap((l) => splitWhere(densify(l, 0.25), (x, y) => !labelClear!.hit(x, y)));
    return out.map((l) => simplify(l, SIMPLIFY)).filter((l) => lineLength(l) >= minLen);
  };
  const toPaper = (lvs: number[][]) => lvs.flatMap((lv) => clipPolyline(toPaperLine(lv), L.map));
  const dashed = (lines: Line[], on: boolean, dash: number, gap: number) =>
    on ? joinLines(orderLines(lines, 0, 0)).flatMap((l) => dashLine(l, Math.max(0.1, dash), Math.max(0.1, gap))) : lines;

  // Where the terrain grid sits on paper.
  const k = dem ? dem.cell / L.mPerMm : 0; // grid step on paper
  const ox = dem ? L.map.x + (dem.west + dem.cell / 2 - L.west) / L.mPerMm : 0;
  const oy = dem ? L.map.y + (L.north - dem.north + dem.cell / 2) / L.mPerMm : 0;
  const G: GridMap | null = dem && dem.w >= 2 && dem.h >= 2 ? { w: dem.w, h: dem.h, ox, oy, k } : null;
  const inMapOf = (data: Float32Array) => (i: number) => {
    const gx = i % dem!.w, gy = (i / dem!.w) | 0;
    const x = ox + gx * k, y = oy + gy * k;
    return x >= L.map.x && x <= L.map.x + L.map.w && y >= L.map.y && y <= L.map.y + L.map.h && data[i] === data[i];
  };
  const rl = s.relief;

  // Contours
  if (s.contours.enabled && dem && G) {
    const c = s.contours;
    const cp = pen(c.pen);
    const sigma = (c.smoothing * L.mPerMm) / dem.cell;
    const T = terrain(dem, sigma);
    const inMap = inMapOf(T.data);
    const R = terrainInMap(T, `${T.key}|${ox}|${oy}|${k}|${L.map.x}|${L.map.y}|${L.map.w}|${L.map.h}`, inMap);
    const { mn, mx, slopes } = R;
    if (mn <= mx) {
      stats.minElev = mn;
      stats.maxElev = mx;
      let interval: number;
      if (c.auto) {
        const tanP = slopes.length ? slopes[Math.min(slopes.length - 1, Math.floor((c.percentile / 100) * slopes.length))] : 0;
        interval = niceInterval(Math.max(1, c.spacing * cp.width * L.mPerMm * tanP));
      } else interval = Math.max(0.5, c.interval);
      // Never more than ~600 levels.
      while ((mx - mn) / interval > 600) interval = niceInterval(interval * 1.5);
      stats.interval = interval;

      // Share of terrain where neighbouring base lines would touch.
      const touch = (interval / (cp.width * 1.2)) / L.mPerMm; // slope above which spacing < 1.2 widths
      stats.crowded = slopes.length ? (slopes.length - upperBound(slopes, touch)) / slopes.length : 0;

      const levels = traced(T, dem.w, dem.h, interval);
      const chain = thinChain(c.index.every);
      const minGap = c.thinSpacing * cp.width;
      const regular: Line[] = [];
      const index: Line[] = [];
      for (const t of levels) {
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
      const ip = pen(c.index.pen);
      const g = rl.tanaka.enabled ? grad(T, dem) : null;
      const t = rl.tanaka;
      const litPen = pen(t.litPen);
      const draw = (lines: Line[], p: Pen, base: number) => {
        if (!lines.length) return;
        if (g) {
          // Illuminated contours: heavier where the slope turns away from the light.
          const r = tanaka(lines, g.gx, g.gy, G, {
            azimuth: rl.azimuth, max: Math.max(1, Math.round(t.passes)), base, lit: t.lit, step: p.width * 0.6, simplify: SIMPLIFY,
          });
          add(p.id, r.dark.flatMap((l) => clipPolyline(l, L.map)));
          if (r.lit.length) add(litPen.id, r.lit.flatMap((l) => clipPolyline(l, L.map)));
        } else if (base > 1) add(p.id, lines.flatMap((l) => passes(l, base, p.width * 0.6)).flatMap((l) => clipPolyline(l, L.map)));
        else add(p.id, lines);
      };
      const idxBase = Math.max(1, c.index.passes);
      if (c.ground.enabled && features) {
        // Contours on glaciers and on rock or scree in their own pens, as on Swiss maps.
        const key = `${features.key}|${dem.id}|${ox}|${oy}|${k}`;
        if (groundCache?.key !== key) {
          const tr = features.terrain;
          groundCache = { key, grid: groundGrid(G, { land: tr.land.map(toPaperLine), ice: tr.ice.map(toPaperLine), rock: tr.scree.map(toPaperLine) }, 3) };
        }
        const pens = [null, pen(c.ground.icePen), pen(c.ground.rockPen)];
        const rg = splitByGround(reg, groundCache.grid, G, 1.5);
        const ig = splitByGround(idx, groundCache.grid, G, 1.5);
        for (let gi = 0; gi < 3; gi++) {
          draw(rg[gi], pens[gi] ?? cp, 1);
          draw(ig[gi], pens[gi] ?? ip, idxBase);
        }
      } else {
        draw(reg, cp, 1);
        draw(idx, ip, idxBase);
      }
    }
  }

  // Relief shading layers
  if (dem && G && (rl.hatch.enabled || rl.hachures.enabled)) {
    const sigma = (rl.smoothing * L.mPerMm) / dem.cell;
    const T = terrain(dem, sigma);
    const z = Math.max(0.1, rl.exaggeration);
    const alt = Math.min(89, Math.max(1, rl.altitude));
    const shade = shaded(T, dem, rl.azimuth, alt, z);
    const flat = lightVector(rl.azimuth, alt).z; // shade of level ground

    if (rl.hatch.enabled) {
      const h = rl.hatch;
      const lines = hatch(shade, G, L.map, {
        angle: h.angle, spacing: Math.max(0.2, h.spacing), tones: h.tones, start: Math.min(0.95, Math.max(0, h.start / 100)),
        minDash: Math.max(0, h.minDash), flat,
      });
      add(pen(h.pen).id, finish(lines, h.minDash));
    }

    if (rl.hachures.enabled) {
      const hc = rl.hachures;
      const hp = pen(hc.pen);
      const R = reliefRange(T, `${T.key}|${ox}|${oy}|${k}|${L.map.x}|${L.map.y}|${L.map.w}|${L.map.h}`, inMapOf(T.data));
      if (R.mn <= R.mx) {
        // Rows one stroke length apart on ground of median steepness.
        let interval = niceInterval(Math.max(1, hc.length * L.mPerMm * R.tanP));
        while ((R.mx - R.mn) / interval > 600) interval = niceInterval(interval * 1.5);
        stats.hachureInterval = interval;
        const key = `${T.key}|${interval}`;
        if (hachureTraceCache?.key !== key) hachureTraceCache = { key, lines: traceContours(T.data, dem.w, dem.h, interval) };
        const g = grad(T, dem);
        const lines = hachures(hachureTraceCache.lines, T.data, g.gx, g.gy, shade, G, L.map, {
          interval, spacing: Math.max(0.2, hc.spacing), maxLength: Math.max(0.5, hc.length * 3), passes: Math.max(1, Math.round(hc.passes)),
          weight: hc.weight, minTan: Math.tan((Math.max(0, hc.minSlope) * Math.PI) / 180), flat, step: hp.width * 0.6, simplify: SIMPLIFY, join: hc.join,
        });
        add(hp.id, finish(lines, 0.3));
      }
    }
  }

  // Roads, paths, railways
  if (features) {
    const ways = (kinds: WayKind[]) => kinds.flatMap((k) => features.ways[k] ?? []).flatMap((lv) => clipPolyline(toPaperLine(lv), L.map));
    if (s.roads.enabled) {
      const r = s.roads;
      const rp = pen(r.pen);
      const main = finish(ways([...(r.motorways ? ['motorway' as const] : []), ...(r.main ? ['main' as const] : [])]), 0.3);
      add(rp.id, main.flatMap((l) => passes(l, Math.max(1, Math.round(r.mainPasses)), rp.width * 0.6)).flatMap((l) => clipPolyline(l, L.map)));
      add(rp.id, finish(ways([...(r.local ? ['local' as const] : []), ...(r.tracks ? ['track' as const] : [])]), 0.3));
    }
    if (s.paths.enabled) {
      const p = s.paths;
      const kinds: WayKind[] = [];
      if (p.hiking) kinds.push('hiking');
      if (p.mountain) kinds.push('mountain');
      if (p.alpine) kinds.push('alpine');
      if (p.unmarked) kinds.push('path');
      // Joined before dashing so the pattern runs on across tile borders.
      add(pen(p.pen).id, dashed(finish(ways(kinds), 0.3), p.dashed, p.dash, p.gap));
    }
    if (s.rail.enabled) {
      const kinds: WayKind[] = [];
      if (s.rail.railways) kinds.push('rail');
      if (s.rail.lifts) kinds.push('lift');
      add(pen(s.rail.pen).id, finish(ways(kinds), 0.3));
    }

    // Forest and glaciers
    if (s.forest.enabled) {
      const f = s.forest;
      const fp = pen(f.pen);
      const sets = f.scrub ? [features.forest, features.scrub] : [features.forest];
      if (f.outline) add(fp.id, finish(toPaper(sets.flatMap((t) => t.edges)), 0.3));
      if (f.fill !== 'none') {
        const polys = sets.flatMap((t) => t.polys).map((p) => p.map(toPaperLine));
        const sp = Math.max(0.3, f.spacing);
        const lines = f.fill === 'hatch' ? hatchPolys(polys, f.angle, sp, L.map) : treeSymbols(polys, sp, sp * 0.22, L.map);
        add(fp.id, finish(lines, 0.2));
      }
    }
    if (s.glaciers.enabled) add(pen(s.glaciers.pen).id, finish(toPaper(features.glacierEdges), 0.3));

    // Buildings
    if (s.buildings.enabled) {
      const bp = pen(s.buildings.pen);
      const polys = features.buildings.map((p) => p.map(toPaperLine)).filter((p) => polySize(p) >= s.buildings.minSize);
      add(bp.id, finish(polys.flat().flatMap((r) => clipPolyline(r, L.map)), 0));
      if (s.buildings.fill) add(bp.id, finish(hatchPolys(polys, 45, bp.width * 0.9, L.map), 0));
    }

    // Boundaries
    if (s.boundaries.enabled) {
      const b = s.boundaries;
      const lvs = [
        ...(b.country ? features.boundaries.country : []),
        ...(b.canton ? features.boundaries.canton : []),
        ...(b.district ? features.boundaries.district : []),
        ...(b.municipality ? features.boundaries.municipality : []),
        ...(b.parks ? features.parkEdges : []),
      ];
      add(pen(b.pen).id, finish(dashed(toPaper(lvs), b.dashed, b.dash, b.gap), 0.1));
    }
  }

  // Water
  if (features) {
    const water = features;
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
