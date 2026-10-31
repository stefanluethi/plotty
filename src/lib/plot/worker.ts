import { compose } from './compose';
import type { DemGrid } from '../geo/dem';
import type { WaterData } from '../geo/water';
import type { StrokeFont } from './font';

let dem: DemGrid | null = null;
let water: WaterData | null = null;
const fonts: Record<string, StrokeFont> = {};

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m.type === 'dem') dem = m.dem;
  else if (m.type === 'water') water = m.water;
  else if (m.type === 'font') fonts[m.name] = m.font;
  else if (m.type === 'compose') {
    try {
      const result = compose(m.settings, dem, water, fonts);
      const transfer = result.pens.flatMap((p) => p.lines.map((l) => l.buffer));
      (self as any).postMessage({ type: 'result', id: m.id, result }, transfer);
    } catch (e) {
      console.error(e);
      (self as any).postMessage({ type: 'error', id: m.id, message: String((e as Error)?.message ?? e) });
    }
  }
};
