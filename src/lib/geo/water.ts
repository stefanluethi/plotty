import { PbfReader as Pbf } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { toLV95, toWGS, wgsBounds } from './lv95';
import { clipPolyline } from '../plot/geom';

/** Water features as LV95 polylines (flat [E,N,...]). */
export interface WaterData {
  key: string;
  lakes: number[][];
  rivers: number[][];
  streams: number[][];
}

const TILE_URL = (z: number, x: number, y: number) =>
  `https://vectortiles${(x + y) % 5}.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/${z}/${x}/${y}.pbf`;

const cache = new Map<string, WaterData>();
const tileCache = new Map<string, Promise<ArrayBuffer | null>>();

function fetchTile(z: number, x: number, y: number, signal: AbortSignal) {
  const k = `${z}/${x}/${y}`;
  let p = tileCache.get(k);
  if (!p) {
    p = fetch(TILE_URL(z, x, y), { signal }).then((r) => (r.ok ? r.arrayBuffer() : null));
    p.catch(() => tileCache.delete(k));
    tileCache.set(k, p);
  }
  return p;
}

export function waterZoom(mPerMm: number, lat: number) {
  // Aim for one vector tile ≈ 80 mm of paper.
  const tileM = 80 * mPerMm;
  const z = Math.round(Math.log2((40075016 * Math.cos((lat * Math.PI) / 180)) / tileM));
  return Math.max(9, Math.min(14, z));
}

export async function loadWater(
  west: number,
  south: number,
  east: number,
  north: number,
  mPerMm: number,
  signal: AbortSignal,
): Promise<WaterData> {
  const b = wgsBounds(west, south, east, north);
  const z = waterZoom(mPerMm, (b.minLat + b.maxLat) / 2);
  const key = [z, west, south, east, north].map(Math.round).join('|');
  const hit = cache.get(key);
  if (hit) return hit;

  const n = 2 ** z;
  const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n);
  const ty = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  const x0 = tx(b.minLon), x1 = tx(b.maxLon), y0 = ty(b.maxLat), y1 = ty(b.minLat);
  const out: WaterData = { key, lakes: [], rivers: [], streams: [] };
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return out; // too large an area for vector detail

  const jobs: Promise<void>[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      jobs.push(
        fetchTile(z, x, y, signal).then((buf) => {
          if (buf) decodeTile(new Uint8Array(buf), z, x, y, out);
        }),
      );
    }
  }
  await Promise.all(jobs);
  cache.set(key, out);
  return out;
}

function decodeTile(bytes: Uint8Array, z: number, x: number, y: number, out: WaterData) {
  const tile = new VectorTile(new Pbf(bytes));
  const n = 2 ** z;
  const toLv = (ext: number) => (px: number, py: number): [number, number] => {
    const lon = ((x + px / ext) / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / ext)) / n))) * 180) / Math.PI;
    return toLV95(lon, lat);
  };

  const emit = (ring: { x: number; y: number }[], ext: number, target: number[][], closed: boolean) => {
    const flat: number[] = [];
    for (const p of ring) flat.push(p.x, p.y);
    if (closed && ring.length && (ring[0].x !== ring[ring.length - 1].x || ring[0].y !== ring[ring.length - 1].y))
      flat.push(ring[0].x, ring[0].y);
    // Keep only the part inside this tile; drop pieces running along the tile border
    // (polygon edges created by tile clipping, not real shores).
    const pieces = clipPolyline(flat, { x: 0, y: 0, w: ext, h: ext });
    const conv = toLv(ext);
    for (const piece of pieces) {
      const cleaned = closed ? dropBorderRuns(piece, ext) : [piece];
      for (const c of cleaned) {
        if (c.length < 4) continue;
        const lv: number[] = [];
        for (let i = 0; i < c.length; i += 2) {
          const [e, nn] = conv(c[i], c[i + 1]);
          lv.push(e, nn);
        }
        target.push(lv);
      }
    }
  };

  const water = tile.layers.water;
  if (water) {
    for (let i = 0; i < water.length; i++) {
      const f = water.feature(i);
      const cls = f.properties.class;
      if (cls !== 'lake' && cls !== 'river') continue;
      for (const ring of f.loadGeometry()) emit(ring, water.extent, out.lakes, true);
    }
  }
  const ww = tile.layers.waterway;
  if (ww) {
    for (let i = 0; i < ww.length; i++) {
      const f = ww.feature(i);
      const cls = f.properties.class;
      const target = cls === 'river' ? out.rivers : cls === 'stream' ? out.streams : null;
      if (!target || f.properties.brunnel === 'tunnel') continue;
      for (const line of f.loadGeometry()) emit(line, ww.extent, target, false);
    }
  }
}

/** Split a polyline wherever a segment lies on the tile border. */
function dropBorderRuns(line: number[], ext: number): number[][] {
  const onEdge = (ax: number, ay: number, bx: number, by: number) =>
    (Math.abs(ax) < 0.01 && Math.abs(bx) < 0.01) ||
    (Math.abs(ax - ext) < 0.01 && Math.abs(bx - ext) < 0.01) ||
    (Math.abs(ay) < 0.01 && Math.abs(by) < 0.01) ||
    (Math.abs(ay - ext) < 0.01 && Math.abs(by - ext) < 0.01);
  const out: number[][] = [];
  let cur: number[] = [line[0], line[1]];
  for (let i = 2; i < line.length; i += 2) {
    const ax = line[i - 2], ay = line[i - 1], bx = line[i], by = line[i + 1];
    if (onEdge(ax, ay, bx, by)) {
      if (cur.length >= 4) out.push(cur);
      cur = [bx, by];
    } else cur.push(bx, by);
  }
  if (cur.length >= 4) out.push(cur);
  return out;
}

export { toWGS };
