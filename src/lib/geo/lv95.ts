import proj4 from 'proj4';

proj4.defs(
  'EPSG:2056',
  '+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs',
);

const conv = proj4('EPSG:4326', 'EPSG:2056');

/** WGS84 lon/lat → LV95 E/N */
export function toLV95(lon: number, lat: number): [number, number] {
  const [e, n] = conv.forward([lon, lat]);
  return [e, n];
}

/** LV95 E/N → WGS84 lon/lat */
export function toWGS(e: number, n: number): [number, number] {
  const [lon, lat] = conv.inverse([e, n]);
  return [lon, lat];
}

/** WGS84 bounding box of an LV95 rectangle */
export function wgsBounds(west: number, south: number, east: number, north: number) {
  const pts = [
    toWGS(west, south),
    toWGS(east, south),
    toWGS(east, north),
    toWGS(west, north),
  ];
  return {
    minLon: Math.min(...pts.map((p) => p[0])),
    maxLon: Math.max(...pts.map((p) => p[0])),
    minLat: Math.min(...pts.map((p) => p[1])),
    maxLat: Math.max(...pts.map((p) => p[1])),
  };
}

export function formatCoords(e: number, n: number) {
  const [lon, lat] = toWGS(e, n);
  return `${lat.toFixed(3)}° N  ${lon.toFixed(3)}° E`;
}

export function swissNumber(v: number) {
  return Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '’');
}
