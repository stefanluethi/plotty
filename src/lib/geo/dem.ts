import { fromCustomClient, BaseClient, BaseResponse, type GeoTIFF } from 'geotiff';
import { wgsBounds } from './lv95';
import type { DemSource } from '../settings';

/** Elevation grid. Cell (i, j) centre: E = west + (i + .5) * cell, N = north - (j + .5) * cell */
export interface DemGrid {
  id: string;
  w: number;
  h: number;
  west: number;
  north: number;
  cell: number;
  data: Float32Array; // NaN where unknown
  source: 'swissALTI3D' | 'swissALTIRegio';
}

export interface DemRequest {
  west: number;
  south: number;
  east: number;
  north: number;
  cell: number; // wanted cell size in m
  source: DemSource;
}

export type Progress = (done: number, total: number, label: string) => void;

const REGIO_URL = 'https://data.geo.admin.ch/ch.swisstopo.swissaltiregio/swissaltiregio/swissaltiregio_2056_5728.tif';
const REGIO_WEST = 2385000;
const REGIO_NORTH = 1404000;
const STAC = 'https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items';
const MAX_ALTI_TILES = 300;
const MAX_CELLS = 6_000_000;

/**
 * swisstopo does not expose Content-Range to browsers (CORS), so geotiff never
 * learns the file size and reads past the end of the file. This client gets the
 * size once via HEAD and reports it in a synthesized Content-Range.
 */
class SizedResponse extends BaseResponse {
  constructor(private res: Response, private range: string) {
    super();
  }
  get status() {
    return this.res.status;
  }
  getHeader(name: string) {
    return name.toLowerCase() === 'content-range' ? this.range : (this.res.headers.get(name) ?? undefined);
  }
  async getData() {
    return this.res.arrayBuffer();
  }
}
class SizedClient extends BaseClient {
  private size: Promise<number> | null = null;
  async request(opts: { headers?: Record<string, string>; signal?: AbortSignal } = {}) {
    this.size ??= fetch(this.url, { method: 'HEAD' }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Number(r.headers.get('content-length'));
    });
    const total = await this.size;
    const m = /bytes=(\d+)-(\d+)/.exec(opts.headers?.Range ?? '');
    const start = m ? +m[1] : 0;
    const end = Math.min(m ? +m[2] : total - 1, total - 1);
    const res = await fetch(this.url, { headers: { Range: `bytes=${start}-${end}` }, signal: opts.signal });
    return new SizedResponse(res, `bytes ${start}-${end}/${total}`);
  }
}

const tiffCache = new Map<string, Promise<GeoTIFF>>();
function tiff(url: string) {
  let t = tiffCache.get(url);
  if (!t) {
    t = fromCustomClient(new SizedClient(url) as any, { allowFullFile: false });
    t.catch(() => tiffCache.delete(url));
    tiffCache.set(url, t);
  }
  return t;
}

const gridCache = new Map<string, DemGrid>();

export function altiTileCount(r: DemRequest) {
  const nx = Math.floor((r.east - 1) / 1000) - Math.floor(r.west / 1000) + 1;
  const ny = Math.floor((r.north - 1) / 1000) - Math.floor(r.south / 1000) + 1;
  return nx * ny;
}

/** Pick the source the request will actually use. */
export function resolveSource(r: DemRequest): 'swissALTI3D' | 'swissALTIRegio' {
  if (r.source === 'regio') return 'swissALTIRegio';
  if (r.source === 'alti3d') return altiTileCount(r) <= MAX_ALTI_TILES ? 'swissALTI3D' : 'swissALTIRegio';
  return r.cell < 10 && altiTileCount(r) <= MAX_ALTI_TILES ? 'swissALTI3D' : 'swissALTIRegio';
}

/** Grid resolution loadDem will deliver for a request. */
export function expectedRes(r: DemRequest) {
  const area = (r.east - r.west) * (r.north - r.south);
  const cell = Math.max(r.cell, Math.sqrt(area / MAX_CELLS));
  if (resolveSource(r) === 'swissALTI3D') return cell >= 4 ? 4 : 2;
  let res = 10;
  for (const c of [40, 80, 160, 320, 640]) if (c <= cell * 1.01) res = c;
  return res;
}

export async function loadDem(req: DemRequest, onProgress: Progress, signal: AbortSignal): Promise<DemGrid> {
  const source = resolveSource(req);
  // Keep the grid size sane on very large areas.
  const area = (req.east - req.west) * (req.north - req.south);
  const cell = Math.max(req.cell, Math.sqrt(area / MAX_CELLS));
  const key = [source, req.west, req.south, req.east, req.north, cell].map((v) => (typeof v === 'number' ? Math.round(v) : v)).join('|');
  const hit = gridCache.get(key);
  if (hit) return hit;
  const grid = source === 'swissALTIRegio' ? await loadRegio(req, cell, onProgress, signal) : await loadAlti3d(req, cell, onProgress, signal);
  grid.id = key;
  gridCache.set(key, grid);
  if (gridCache.size > 6) gridCache.delete(gridCache.keys().next().value!);
  return grid;
}

function snapGrid(req: DemRequest, res: number, originE: number, originN: number) {
  const pad = 4 * res;
  const x0 = Math.floor((req.west - pad - originE) / res);
  const x1 = Math.ceil((req.east + pad - originE) / res);
  const y0 = Math.floor((originN - (req.north + pad)) / res);
  const y1 = Math.ceil((originN - (req.south - pad)) / res);
  return { x0, y0, w: x1 - x0, h: y1 - y0, west: originE + x0 * res, north: originN - y0 * res };
}

async function loadRegio(req: DemRequest, cell: number, onProgress: Progress, signal: AbortSignal): Promise<DemGrid> {
  onProgress(0, 1, 'swissALTIRegio');
  const t = await tiff(REGIO_URL);
  const n = await t.getImageCount();
  const base = await t.getImage(0);
  // Pick the coarsest overview that is still at least as fine as the wanted cell.
  let level = 0;
  let res = 10;
  for (let i = 0; i < n; i++) {
    const im = await t.getImage(i);
    const r = (10 * base.getWidth()) / im.getWidth();
    if (r <= cell * 1.01) {
      level = i;
      res = r;
    }
  }
  const im = await t.getImage(level);
  const g = snapGrid(req, res, REGIO_WEST, REGIO_NORTH);
  const data = new Float32Array(g.w * g.h).fill(NaN);
  // Clamp read window to the image.
  const rx0 = Math.max(0, g.x0), ry0 = Math.max(0, g.y0);
  const rx1 = Math.min(im.getWidth(), g.x0 + g.w), ry1 = Math.min(im.getHeight(), g.y0 + g.h);
  if (rx1 > rx0 && ry1 > ry0) {
    const r = (await im.readRasters({ window: [rx0, ry0, rx1, ry1], samples: [0] })) as any;
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const src = r[0] as Float32Array;
    const rw = rx1 - rx0;
    for (let y = ry0; y < ry1; y++) {
      for (let x = rx0; x < rx1; x++) {
        const v = src[(y - ry0) * rw + (x - rx0)];
        data[(y - g.y0) * g.w + (x - g.x0)] = v > 1e30 || v < -1000 ? NaN : v;
      }
    }
  }
  onProgress(1, 1, 'swissALTIRegio');
  return { id: '', w: g.w, h: g.h, west: g.west, north: g.north, cell: res, data, source: 'swissALTIRegio' };
}

interface AltiTile {
  key: string; // "2641-1155"
  year: number;
  url: string;
}

async function stacTiles(req: DemRequest, signal: AbortSignal): Promise<AltiTile[]> {
  const b = wgsBounds(req.west, req.south, req.east, req.north);
  let url: string | null = `${STAC}?bbox=${b.minLon},${b.minLat},${b.maxLon},${b.maxLat}&limit=100`;
  const best = new Map<string, AltiTile>();
  while (url) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`swisstopo STAC answered ${res.status}`);
    const j = await res.json();
    for (const f of j.features ?? []) {
      const m = /swissalti3d_(\d{4})_(\d{4}-\d{4})/.exec(f.id);
      if (!m) continue;
      const asset = Object.values<any>(f.assets).find((a) => /_2_2056_5728\.tif$/.test(a.href));
      if (!asset) continue;
      const t = { key: m[2], year: +m[1], url: asset.href };
      const prev = best.get(t.key);
      if (!prev || prev.year < t.year) best.set(t.key, t);
    }
    url = j.links?.find((l: any) => l.rel === 'next')?.href ?? null;
  }
  return [...best.values()];
}

async function loadAlti3d(req: DemRequest, cell: number, onProgress: Progress, signal: AbortSignal): Promise<DemGrid> {
  onProgress(0, 1, 'swissALTI3D tile index');
  const res = cell >= 4 ? 4 : 2;
  const level = res === 4 ? 1 : 0;
  const g = snapGrid(req, res, 0, 0);
  const data = new Float32Array(g.w * g.h).fill(NaN);
  const tiles = (await stacTiles(req, signal)).filter((t) => {
    const [ke, kn] = t.key.split('-').map(Number);
    const e0 = ke * 1000, n0 = kn * 1000;
    return e0 < g.west + g.w * res && e0 + 1000 > g.west && n0 < g.north && n0 + 1000 > g.north - g.h * res;
  });
  let done = 0, failed = 0;
  onProgress(0, tiles.length, 'swissALTI3D');
  const queue = tiles.slice();
  const worker = async () => {
    while (queue.length) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const t = queue.shift()!;
      const [ke, kn] = t.key.split('-').map(Number);
      const tileW = ke * 1000, tileN = (kn + 1) * 1000;
      const size = 1000 / res;
      // Tile pixel window overlapping the grid
      const gx0 = Math.round((tileW - g.west) / res); // grid x of tile pixel 0
      const gy0 = Math.round((g.north - tileN) / res);
      const px0 = Math.max(0, -gx0), py0 = Math.max(0, -gy0);
      const px1 = Math.min(size, g.w - gx0), py1 = Math.min(size, g.h - gy0);
      if (px1 > px0 && py1 > py0) {
        let src: Float32Array | null = null, scale = 1;
        for (let attempt = 0; attempt < 2 && !src; attempt++) {
          try {
            // Fresh reader on retry: a failed read can leave bad blocks in geotiff's cache.
            if (attempt) tiffCache.delete(t.url);
            const tf = await tiff(t.url);
            const im = await tf.getImage(Math.min(level, (await tf.getImageCount()) - 1));
            scale = size / im.getWidth(); // 1 unless the overview is missing
            const r = (await im.readRasters({
              window: [Math.floor(px0 / scale), Math.floor(py0 / scale), Math.ceil(px1 / scale), Math.ceil(py1 / scale)],
              samples: [0],
            })) as any;
            src = r[0] as Float32Array;
          } catch (e) {
            if (attempt) console.warn('swissALTI3D tile failed', t.key, e);
          }
        }
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');
        if (src) {
          const rw = Math.ceil(px1 / scale) - Math.floor(px0 / scale);
          for (let py = py0; py < py1; py++) {
            const sy = Math.floor(py / scale) - Math.floor(py0 / scale);
            for (let px = px0; px < px1; px++) {
              const sx = Math.floor(px / scale) - Math.floor(px0 / scale);
              const v = src[sy * rw + sx];
              data[(gy0 + py) * g.w + gx0 + px] = v < -1000 || v > 1e30 ? NaN : v;
            }
          }
        } else failed++;
      }
      onProgress(++done, tiles.length, 'swissALTI3D');
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (failed > tiles.length / 2) throw new Error(`${failed} of ${tiles.length} swissALTI3D tiles failed`);
  return { id: '', w: g.w, h: g.h, west: g.west, north: g.north, cell: res, data, source: 'swissALTI3D' };
}
