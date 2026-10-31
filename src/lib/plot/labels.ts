// Map labels: peaks, places and spot heights in a stroke font, placed without overlaps.

import { renderText, textWidth, type StrokeFont } from './font';
import type { Box, Line } from './geom';

export interface LabelItem {
  text: string;
  x: number; // anchor on paper, mm
  y: number;
  size: number; // cap height, mm
  marker: 'peak' | 'spot' | 'none';
  priority: number; // lower is placed first
}

export interface Rect { x0: number; y0: number; x1: number; y1: number }

/** Grid of rectangles for overlap and point-in-rectangle tests. */
export class RectIndex {
  private cells = new Map<number, Rect[]>();
  constructor(private size = 5) {}
  private key(cx: number, cy: number) {
    return (cx + 32768) * 65536 + (cy + 32768);
  }
  add(r: Rect) {
    for (let cx = Math.floor(r.x0 / this.size); cx <= Math.floor(r.x1 / this.size); cx++)
      for (let cy = Math.floor(r.y0 / this.size); cy <= Math.floor(r.y1 / this.size); cy++) {
        const k = this.key(cx, cy);
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(r);
      }
  }
  overlaps(r: Rect) {
    for (let cx = Math.floor(r.x0 / this.size); cx <= Math.floor(r.x1 / this.size); cx++)
      for (let cy = Math.floor(r.y0 / this.size); cy <= Math.floor(r.y1 / this.size); cy++)
        for (const o of this.cells.get(this.key(cx, cy)) ?? [])
          if (r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0) return true;
    return false;
  }
  hit(x: number, y: number) {
    for (const o of this.cells.get(this.key(Math.floor(x / this.size), Math.floor(y / this.size))) ?? [])
      if (x > o.x0 && x < o.x1 && y > o.y0 && y < o.y1) return true;
    return false;
  }
  get empty() {
    return this.cells.size === 0;
  }
}

/**
 * Place labels in priority order. Each label tries a few spots around its anchor
 * and is dropped if none is free. Returns the strokes and the area they cover
 * (padded by `gap`) so other layers can leave it clear.
 */
export function placeLabels(items: LabelItem[], font: StrokeFont, box: Box, gap: number, blocked?: (r: Rect) => boolean) {
  const lines: Line[] = [];
  const taken = new RectIndex(5);
  const clear = new RectIndex(5);
  const inBox = (r: Rect) => r.x0 >= box.x && r.y0 >= box.y && r.x1 <= box.x + box.w && r.y1 <= box.y + box.h;
  const sorted = [...items].sort((a, b) => a.priority - b.priority);
  for (const it of sorted) {
    const s = it.size;
    // Measure the real strokes: accented capitals rise above the cap height and
    // descenders differ a lot between fonts.
    const strokes = renderText(font, it.text, s, 0, 0);
    if (!strokes.length) continue;
    const b = bounds(strokes, textWidth(font, it.text, s));
    const m = it.marker === 'peak' ? s * 0.5 : it.marker === 'spot' ? s * 0.18 : 0; // marker half size
    const mk: Rect | null = m ? { x0: it.x - m, y0: it.y - m, x1: it.x + m, y1: it.y + m } : null;
    if (mk && (!inBox(mk) || taken.overlaps(mk))) continue; // a marker may sit on a track: tracks often end on summits
    // Candidate text origins (x, baseline y). Beside a marker the capitals are centred on it.
    const d = m + gap;
    const midX = it.x - (b.x0 + b.x1) / 2;
    const cands: [number, number][] = m
      ? [
          [it.x + d - b.x0, it.y + s / 2],
          [it.x - d - b.x1, it.y + s / 2],
          [midX, it.y - d - b.y1],
          [midX, it.y + d - b.y0],
        ]
      : [[midX, it.y + s / 2], [midX, it.y - s / 2 - gap - b.y1], [midX, it.y + s / 2 + gap - b.y0]];
    for (const [x, y] of cands) {
      const r: Rect = { x0: x + b.x0 - gap * 0.5, y0: y + b.y0 - gap * 0.5, x1: x + b.x1 + gap * 0.5, y1: y + b.y1 + gap * 0.5 };
      if (!inBox(r) || taken.overlaps(r) || (mk && rectsOverlap(r, mk)) || blocked?.(r)) continue;
      taken.add(r);
      clear.add({ x0: r.x0 - gap * 0.5, y0: r.y0 - gap * 0.5, x1: r.x1 + gap * 0.5, y1: r.y1 + gap * 0.5 });
      if (mk) {
        taken.add(mk);
        clear.add({ x0: mk.x0 - gap, y0: mk.y0 - gap, x1: mk.x1 + gap, y1: mk.y1 + gap });
        lines.push(marker(it.marker, it.x, it.y, m));
      }
      for (const st of strokes) lines.push(st.map((v, i) => v + (i % 2 ? y : x)));
      break;
    }
  }
  return { lines, clear };
}

/** Extent of strokes drawn at origin (0, 0); y grows downward. */
function bounds(strokes: Line[], width: number): Rect {
  let x0 = 0, x1 = width, y0 = Infinity, y1 = -Infinity;
  for (const st of strokes)
    for (let i = 0; i < st.length; i += 2) {
      x0 = Math.min(x0, st[i]);
      x1 = Math.max(x1, st[i]);
      y0 = Math.min(y0, st[i + 1]);
      y1 = Math.max(y1, st[i + 1]);
    }
  return { x0, y0, x1, y1 };
}

function rectsOverlap(a: Rect, b: Rect) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

function marker(kind: 'peak' | 'spot' | 'none', x: number, y: number, m: number): Line {
  if (kind === 'peak') {
    const h = m * 1.6; // equilateral-ish triangle, centred on the summit
    return [x - m, y + h / 3, x + m, y + h / 3, x, y - (2 * h) / 3, x - m, y + h / 3];
  }
  const l: Line = [];
  for (let i = 0; i <= 12; i++) l.push(x + m * Math.cos((i / 12) * 2 * Math.PI), y + m * Math.sin((i / 12) * 2 * Math.PI));
  return l;
}
