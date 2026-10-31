import { paperSize, type Settings } from '../settings';
import type { ComposeResult } from '../plot/compose';

/** Paper mm → machine mm, honouring placement, rotation and Y direction. */
export function paperToMachine(s: Settings, paperW: number, paperH: number) {
  const m = s.machine;
  // Footprint of the sheet on the bed.
  const fh = m.rotate ? paperW : paperH;
  return (x: number, y: number): [number, number] => {
    // Sheet coordinates seen from above with Y up (sheet top = high Y).
    let X: number, Y: number;
    if (!m.rotate) { X = x; Y = paperH - y; }
    else { X = y; Y = x; } // turned a quarter: sheet top runs along the left edge
    if (m.flipY) Y = fh - Y;
    return [m.x + X, m.y + Y];
  };
}

export function footprint(s: Settings, paperW: number, paperH: number) {
  return s.machine.rotate ? { w: paperH, h: paperW } : { w: paperW, h: paperH };
}

/** Whether the sheet, placed as set under Machine, lies fully on the bed. */
export function sheetOnBed(s: Settings) {
  const [w, h] = paperSize(s);
  const fp = footprint(s, w, h);
  const m = s.machine;
  return m.x >= 0 && m.y >= 0 && m.x + fp.w <= m.bedW && m.y + fp.h <= m.bedH;
}

/** A pen as gcode sees it. Falls back if the pen was removed after the plot was drawn. */
function penOf(s: Settings, id: string) {
  return s.pens.find((p) => p.id === id) ?? { name: 'Pen', width: 0.3, color: '#000000' };
}

/** Text that goes into a gcode line: no line breaks, and no ';', which would start a comment. */
const gcodeText = (t: string) => t.replace(/[\r\n;]+/g, ' ').trim();

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();

function fill(tpl: string, s: Settings, extra: Record<string, string> = {}) {
  const vars: Record<string, string> = {
    up: String(s.machine.zUp),
    down: String(s.machine.zDown),
    travel: String(s.machine.feedTravel),
    draw: String(s.machine.feedDraw),
    ...extra,
  };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

export function toGcode(s: Settings, r: ComposeResult): string {
  const m = s.machine;
  const tf = paperToMachine(s, r.layout.paperW, r.layout.paperH);
  const out: string[] = [];
  out.push(`; plotty topo — ${new Date().toISOString()}`);
  out.push(`; sheet ${r.layout.paperW}x${r.layout.paperH} mm at X${m.x} Y${m.y}${m.rotate ? ' (turned)' : ''}`);
  out.push(`; pens: ${r.pens.map((p) => gcodeText(penOf(s, p.penId).name)).join(', ')}`);
  out.push(fill(m.start, s));
  r.pens.forEach((pg, gi) => {
    const pen = penOf(s, pg.penId);
    const label = gcodeText(`${pen.name} ${pen.width} mm`);
    out.push(`; ---- pen ${gi + 1}: ${label}`);
    if (gi > 0) out.push(fill(m.penChange, s, { pen: label }));
    else out.push(`M117 Pen: ${label}`);
    let cx = NaN, cy = NaN;
    let down = false;
    for (const l of pg.lines) {
      const [sx, sy] = tf(l[0], l[1]);
      if (!(Math.abs(sx - cx) < 0.02 && Math.abs(sy - cy) < 0.02)) {
        if (down) out.push(`G0 Z${m.zUp}`);
        out.push(`G0 X${f3(sx)} Y${f3(sy)} F${m.feedTravel}`);
        out.push(`G1 Z${m.zDown} F${m.feedZ}`);
        down = true;
      }
      for (let i = 2; i < l.length; i += 2) {
        const [x, y] = tf(l[i], l[i + 1]);
        out.push(`G1 X${f3(x)} Y${f3(y)} F${m.feedDraw}`);
        cx = x;
        cy = y;
      }
    }
    out.push(`G0 Z${m.zUp}`);
  });
  out.push(fill(m.end, s));
  return out.join('\n') + '\n';
}

export function toSvg(s: Settings, r: ComposeResult): string {
  const { paperW: W, paperH: H } = r.layout;
  const parts: string[] = [];
  parts.push(
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`,
  );
  r.pens.forEach((pg, gi) => {
    const pen = penOf(s, pg.penId);
    parts.push(
      `<g inkscape:groupmode="layer" inkscape:label="${gi + 1} ${escapeXml(pen.name)}" fill="none" stroke="${pen.color}" stroke-width="${pen.width}" stroke-linecap="round" stroke-linejoin="round">`,
    );
    let d: string[] = [];
    const flush = () => {
      if (d.length) parts.push(`<path d="${d.join('')}"/>`);
      d = [];
    };
    for (const l of pg.lines) {
      let seg = `M${f3(l[0])} ${f3(l[1])}`;
      for (let i = 2; i < l.length; i += 2) seg += `L${f3(l[i])} ${f3(l[i + 1])}`;
      d.push(seg);
      if (d.length >= 400) flush();
    }
    flush();
    parts.push('</g>');
  });
  parts.push('</svg>');
  return parts.join('\n');
}

function escapeXml(s: string) {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
}

export function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function estimateMinutes(s: Settings, r: ComposeResult) {
  let draw = 0, travel = 0, lifts = 0;
  for (const p of r.pens) { draw += p.draw; travel += p.travel; lifts += p.lifts; }
  const t = (draw / s.machine.feedDraw + travel / s.machine.feedTravel) + (lifts * 0.35) / 60 + Math.max(0, r.pens.length - 1) * 0.5;
  return { draw, travel, lifts, minutes: t };
}
