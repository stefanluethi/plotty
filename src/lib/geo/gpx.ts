import { toLV95 } from './lv95';

export interface ParsedGpx {
  name: string;
  segments: number[][]; // LV95 flat
}

/** Parse GPX text into LV95 polylines. Uses track segments, falling back to routes. */
export function parseGpx(text: string, fallbackName: string): ParsedGpx {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This file is not valid GPX (XML parse error).');
  const segs: number[][] = [];
  const read = (pts: HTMLCollectionOf<Element>) => {
    const flat: number[] = [];
    for (const p of Array.from(pts)) {
      const lat = parseFloat(p.getAttribute('lat') ?? '');
      const lon = parseFloat(p.getAttribute('lon') ?? '');
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const [e, n] = toLV95(lon, lat);
      flat.push(e, n);
    }
    if (flat.length >= 4) segs.push(flat);
  };
  for (const s of Array.from(doc.getElementsByTagNameNS('*', 'trkseg'))) read(s.getElementsByTagNameNS('*', 'trkpt'));
  if (!segs.length) for (const r of Array.from(doc.getElementsByTagNameNS('*', 'rte'))) read(r.getElementsByTagNameNS('*', 'rtept'));
  if (!segs.length) throw new Error('No track or route points found in this GPX file.');
  const nameEl = doc.querySelector('trk > name, rte > name, metadata > name');
  return { name: nameEl?.textContent?.trim() || fallbackName.replace(/\.gpx$/i, ''), segments: segs };
}
