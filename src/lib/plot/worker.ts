import { compose } from './compose';
import type { DemGrid } from '../geo/dem';
import type { MapFeatures } from '../geo/features';
import type { StrokeFont } from './font';

let dem: DemGrid | null = null;
let features: MapFeatures | null = null;
const fonts: Record<string, StrokeFont> = {};

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m.type === 'dem') dem = m.dem;
  else if (m.type === 'features') features = m.features;
  else if (m.type === 'font') fonts[m.name] = m.font;
  else if (m.type === 'compose') {
    try {
      const result = compose(m.settings, dem, features, fonts);
      const transfer = result.pens.flatMap((p) => p.lines.map((l) => l.buffer));
      (self as any).postMessage({ type: 'result', id: m.id, result }, transfer);
    } catch (e) {
      console.error(e);
      (self as any).postMessage({ type: 'error', id: m.id, message: String((e as Error)?.message ?? e) });
    }
  }
};
