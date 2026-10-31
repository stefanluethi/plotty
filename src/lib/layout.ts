import { paperSize, type Settings } from './settings';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where everything sits on the sheet, and how terrain maps onto it. */
export interface Layout {
  paperW: number;
  paperH: number;
  map: Rect; // map area on paper, mm
  band: Rect | null; // title band below the map
  mPerMm: number; // terrain metres per paper millimetre
  // LV95 extent of the map area
  west: number;
  east: number;
  south: number;
  north: number;
}

export function titleBandHeight(s: Settings) {
  if (!s.title.enabled) return 0;
  const sub = s.title.subtitle.trim() ? s.title.size * 0.55 * 2.2 : 0;
  return s.title.size * 2.6 + sub;
}

export function computeLayout(s: Settings): Layout {
  const [paperW, paperH] = paperSize(s);
  const m = s.paper.margin;
  const band = titleBandHeight(s);
  const map: Rect = { x: m, y: m, w: Math.max(10, paperW - 2 * m), h: Math.max(10, paperH - 2 * m - band) };
  const mPerMm = s.area.scale / 1000;
  const halfW = (map.w / 2) * mPerMm;
  const halfH = (map.h / 2) * mPerMm;
  return {
    paperW,
    paperH,
    map,
    band: band ? { x: m, y: map.y + map.h, w: map.w, h: band } : null,
    mPerMm,
    west: s.area.e - halfW,
    east: s.area.e + halfW,
    south: s.area.n - halfH,
    north: s.area.n + halfH,
  };
}

/** LV95 → paper mm */
export function toPaper(L: Layout, e: number, n: number): [number, number] {
  return [L.map.x + (e - L.west) / L.mPerMm, L.map.y + (L.north - n) / L.mPerMm];
}
