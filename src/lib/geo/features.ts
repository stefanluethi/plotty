import { PbfReader as Pbf } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { toLV95, toWGS, wgsBounds } from './lv95';
import { clipPolyline } from '../plot/geom';

// Map features from the swisstopo base map vector tiles, as LV95 polylines (flat [E,N,...]).

/** Road, path and rail classes we keep from the `transportation` layer. */
export type WayKind =
  | 'motorway' // motorway, trunk
  | 'main' // primary, secondary
  | 'local' // tertiary, minor, service
  | 'track' // farm and forest tracks
  | 'hiking' // footpaths of the marked hiking network: yellow
  | 'mountain' // white-red-white
  | 'alpine' // white-blue-white
  | 'path' // unmarked footpaths
  | 'rail'
  | 'lift'; // cable cars, gondolas, chair and drag lifts

export const WAY_KINDS: WayKind[] = ['motorway', 'main', 'local', 'track', 'hiking', 'mountain', 'alpine', 'path', 'rail', 'lift'];

export type BoundaryKind = 'country' | 'canton' | 'district' | 'municipality';
const ADMIN: Record<number, BoundaryKind> = { 2: 'country', 4: 'canton', 6: 'district', 8: 'municipality' };

/** A polygon as closed rings (outer and holes together; fill with the even-odd rule). */
export type Polygon = number[][];

export interface Peak { name: string; ele: number; cls: string; rank: number; e: number; n: number }
export interface Place { name: string; cls: string; rank: number; e: number; n: number }
export interface Spot { ele: number; e: number; n: number }

export interface MapFeatures {
  key: string;
  lakes: number[][];
  rivers: number[][];
  streams: number[][];
  ways: Record<WayKind, number[][]>;
  /** Areas: `polys` for fills (clipped to their tile), `edges` for outlines (tile seams removed). */
  forest: { polys: Polygon[]; edges: number[][] };
  scrub: { polys: Polygon[]; edges: number[][] }; // scrub, hedges and small woods
  glacierEdges: number[][];
  buildings: Polygon[];
  boundaries: Record<BoundaryKind, number[][]>;
  parkEdges: number[][];
  /** swisstopo's own contours, by the ground they cross; used to tell glacier and rock apart from land. */
  terrain: { land: number[][]; ice: number[][]; scree: number[][] };
  peaks: Peak[];
  places: Place[];
  spots: Spot[];
}

const TILE_URL = (z: number, x: number, y: number) =>
  `https://vectortiles${(x + y) % 5}.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/${z}/${x}/${y}.pbf`;

const cache = new Map<string, MapFeatures>();
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

export function tileZoom(mPerMm: number, lat: number) {
  // Aim for one vector tile ≈ 80 mm of paper.
  const tileM = 80 * mPerMm;
  const z = Math.round(Math.log2((40075016 * Math.cos((lat * Math.PI) / 180)) / tileM));
  return Math.max(9, Math.min(14, z));
}

export async function loadFeatures(
  west: number,
  south: number,
  east: number,
  north: number,
  mPerMm: number,
  signal: AbortSignal,
): Promise<MapFeatures> {
  const b = wgsBounds(west, south, east, north);
  const z = tileZoom(mPerMm, (b.minLat + b.maxLat) / 2);
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
  const ways = Object.fromEntries(WAY_KINDS.map((k) => [k, []])) as unknown as Record<WayKind, number[][]>;
  const out: MapFeatures = {
    key, lakes: [], rivers: [], streams: [], ways,
    forest: { polys: [], edges: [] }, scrub: { polys: [], edges: [] }, glacierEdges: [], buildings: [],
    boundaries: { country: [], canton: [], district: [], municipality: [] }, parkEdges: [],
    terrain: { land: [], ice: [], scree: [] }, peaks: [], places: [], spots: [],
  };
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

function decodeTile(bytes: Uint8Array, z: number, x: number, y: number, out: MapFeatures) {
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
  const tr = tile.layers.transportation;
  if (tr) {
    for (let i = 0; i < tr.length; i++) {
      const f = tr.feature(i);
      if (f.type !== 2 || f.properties.brunnel === 'tunnel') continue;
      const kind = wayKind(f.properties);
      if (!kind) continue;
      for (const line of f.loadGeometry()) emit(line, tr.extent, out.ways[kind], false);
    }
  }

  /** Polygon rings clipped to the tile, in LV95. */
  const polygon = (rings: { x: number; y: number }[][], ext: number): Polygon => {
    const conv = toLv(ext);
    const outRings: Polygon = [];
    for (const r of rings) {
      const c = clipRing(r, ext);
      if (c.length < 8) continue;
      const lv: number[] = [];
      for (let i = 0; i < c.length; i += 2) lv.push(...conv(c[i], c[i + 1]));
      outRings.push(lv);
    }
    return outRings;
  };

  const lc = tile.layers.landcover;
  if (lc) {
    for (let i = 0; i < lc.length; i++) {
      const f = lc.feature(i);
      if (f.type !== 3) continue;
      const { class: cls, subclass: sub } = f.properties;
      const rings = f.loadGeometry();
      if (cls === 'ice') {
        for (const r of rings) emit(r, lc.extent, out.glacierEdges, true);
      } else if (cls === 'wood') {
        const t = sub === 'forest' || sub === 'loose_forest' ? out.forest : out.scrub;
        const p = polygon(rings, lc.extent);
        if (p.length) t.polys.push(p);
        for (const r of rings) emit(r, lc.extent, t.edges, true);
      }
    }
  }

  const bl = tile.layers.building;
  if (bl) {
    for (let i = 0; i < bl.length; i++) {
      const f = bl.feature(i);
      if (f.type !== 3 || f.properties.class === 'underground') continue;
      const p = polygon(f.loadGeometry(), bl.extent);
      if (p.length) out.buildings.push(p);
    }
  }

  const bd = tile.layers.boundary;
  if (bd) {
    for (let i = 0; i < bd.length; i++) {
      const f = bd.feature(i);
      const kind = ADMIN[Number(f.properties.admin_level)];
      if (!kind || f.type !== 2 || f.properties.maritime === 1) continue;
      for (const line of f.loadGeometry()) emit(line, bd.extent, out.boundaries[kind], false);
    }
  }

  const pk = tile.layers.park;
  if (pk) {
    for (let i = 0; i < pk.length; i++) {
      const f = pk.feature(i);
      if (f.type !== 3) continue;
      for (const r of f.loadGeometry()) emit(r, pk.extent, out.parkEdges, true);
    }
  }

  const cl = tile.layers.contour_line;
  if (cl) {
    for (let i = 0; i < cl.length; i++) {
      const f = cl.feature(i);
      const cls = f.properties.class;
      const t = cls === 'ice' ? out.terrain.ice : cls === 'scree' ? out.terrain.scree : cls === 'land' ? out.terrain.land : null;
      if (!t || f.type !== 2) continue;
      for (const line of f.loadGeometry()) emit(line, cl.extent, t, false);
    }
  }

  // Points. Tiles repeat points near their edges, so keep only those inside this tile.
  const points = (layer: string, fn: (p: Record<string, unknown>, e: number, n: number) => void) => {
    const L = tile.layers[layer];
    if (!L) return;
    const conv = toLv(L.extent);
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i);
      if (f.type !== 1) continue;
      const g = f.loadGeometry()[0]?.[0];
      if (!g || g.x < 0 || g.y < 0 || g.x >= L.extent || g.y >= L.extent) continue;
      const [e, nn] = conv(g.x, g.y);
      fn(f.properties, e, nn);
    }
  };
  points('mountain_peak', (p, e, n) => {
    if (p.name) out.peaks.push({ name: String(p.name), ele: Number(p.ele) || 0, cls: String(p.class), rank: Number(p.rank) || 5, e, n });
  });
  points('place', (p, e, n) => {
    if (p.name) out.places.push({ name: String(p.name), cls: String(p.class), rank: Number(p.rank) || 99, e, n });
  });
  points('spot_elevation', (p, e, n) => {
    if (p.ele != null) out.spots.push({ ele: Number(p.ele), e, n });
  });
}

/** Sutherland–Hodgman clip of a ring to the tile square; returns a closed flat ring. */
function clipRing(ring: { x: number; y: number }[], ext: number): number[] {
  let pts = ring.map((p) => [p.x, p.y]);
  const edges: [(p: number[]) => boolean, (a: number[], b: number[]) => number[]][] = [
    [(p) => p[0] >= 0, (a, b) => [0, a[1] + ((b[1] - a[1]) * (0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= ext, (a, b) => [ext, a[1] + ((b[1] - a[1]) * (ext - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= 0, (a, b) => [a[0] + ((b[0] - a[0]) * (0 - a[1])) / (b[1] - a[1]), 0]],
    [(p) => p[1] <= ext, (a, b) => [a[0] + ((b[0] - a[0]) * (ext - a[1])) / (b[1] - a[1]), ext]],
  ];
  for (const [inside, cut] of edges) {
    if (!pts.length) break;
    const next: number[][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ia = inside(a), ib = inside(b);
      if (ia) next.push(a);
      if (ia !== ib) next.push(cut(a, b));
    }
    pts = next;
  }
  if (pts.length < 3) return [];
  const flat = pts.flat();
  flat.push(pts[0][0], pts[0][1]);
  return flat;
}

const SAC: Record<string, WayKind> = { hiking: 'hiking', mountain_hiking: 'mountain', alpine_hiking: 'alpine' };

function wayKind(p: Record<string, unknown>): WayKind | null {
  switch (p.class) {
    case 'motorway': case 'trunk': return 'motorway';
    case 'primary': case 'secondary': return 'main';
    case 'tertiary': case 'minor': case 'service': return 'local';
    case 'track': return 'track';
    case 'footway': case 'path': case 'trail': case 'via_ferrata':
      return SAC[String(p.sac_scale)] ?? 'path';
    case 'rail': case 'transit': return 'rail';
    case 'cable_car': case 'gondola': case 'chair_lift': case 'drag_lift': case 'aerialway': return 'lift';
    default: return null; // includes mask_terrain, which only masks the terrain under paths
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
