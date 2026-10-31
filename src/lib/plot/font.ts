// Single-stroke SVG fonts (Hershey / EMS), parsed without a DOM so it runs in a worker.

export interface StrokeFont {
  capHeight: number;
  defaultAdv: number;
  glyphs: Record<string, { adv: number; strokes: number[][] }>;
}

function decodeEntities(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string) {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

/** Parse an SVG path made of M/L/C/Z commands into polylines (y up, font units). */
function parsePath(d: string): number[][] {
  const tok = d.match(/[MmLlCcZzHhVv]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: number[][] = [];
  let cur: number[] | null = null;
  let x = 0, y = 0, sx = 0, sy = 0, cmd = 'M', i = 0;
  const num = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        const nx = num() + (rel ? x : 0), ny = num() + (rel ? y : 0);
        x = nx; y = ny; sx = x; sy = y;
        cur = [x, y];
        out.push(cur);
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': x = num() + (rel ? x : 0); y = num() + (rel ? y : 0); cur!.push(x, y); break;
      case 'H': x = num() + (rel ? x : 0); cur!.push(x, y); break;
      case 'V': y = num() + (rel ? y : 0); cur!.push(x, y); break;
      case 'C': {
        const ox = rel ? x : 0, oy = rel ? y : 0;
        const x1 = num() + ox, y1 = num() + oy, x2 = num() + ox, y2 = num() + oy, x3 = num() + ox, y3 = num() + oy;
        for (let t = 1; t <= 8; t++) {
          const u = t / 8, m = 1 - u;
          cur!.push(
            m * m * m * x + 3 * m * m * u * x1 + 3 * m * u * u * x2 + u * u * u * x3,
            m * m * m * y + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u * u * u * y3,
          );
        }
        x = x3; y = y3;
        break;
      }
      case 'Z': x = sx; y = sy; cur?.push(x, y); break;
      default: i++;
    }
  }
  return out.filter((s) => s.length >= 4);
}

export function parseFont(svg: string): StrokeFont {
  const face = /<font-face[^>]*>/.exec(svg)?.[0] ?? '';
  const fontTag = /<font\s[^>]*>/.exec(svg)?.[0] ?? '';
  const capHeight = parseFloat(attr(face, 'cap-height') ?? '500') || 500;
  const defaultAdv = parseFloat(attr(fontTag, 'horiz-adv-x') ?? '378');
  const glyphs: StrokeFont['glyphs'] = {};
  for (const m of svg.matchAll(/<glyph\s[^>]*>/g)) {
    const tag = m[0];
    const u = attr(tag, 'unicode');
    if (u == null) continue;
    const ch = decodeEntities(u);
    const adv = parseFloat(attr(tag, 'horiz-adv-x') ?? '') || defaultAdv;
    const d = attr(tag, 'd');
    glyphs[ch] = { adv, strokes: d ? parsePath(d) : [] };
  }
  return { capHeight, defaultAdv, glyphs };
}

// Typographic characters the stroke fonts lack, mapped to plain ones they have.
const SUBST: Record<string, string> = {
  '\u2019': "'", '\u2018': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-', '\u00d7': 'x', '\u2009': ' ', '\u00a0': ' ',
};
function glyph(f: StrokeFont, ch: string) {
  return f.glyphs[ch] ?? f.glyphs[SUBST[ch]] ?? f.glyphs[ch.normalize('NFD')[0]] ?? f.glyphs['?'];
}

export function textWidth(f: StrokeFont, text: string, size: number) {
  const s = size / f.capHeight;
  let w = 0;
  for (const ch of text) w += (glyph(f, ch)?.adv ?? f.defaultAdv) * s;
  return w;
}

/** Text as polylines in paper mm. size = cap height in mm, (x, y) = baseline start. */
export function renderText(f: StrokeFont, text: string, size: number, x: number, y: number): number[][] {
  const s = size / f.capHeight;
  const out: number[][] = [];
  let pen = x;
  for (const ch of text) {
    const g = glyph(f, ch);
    if (g) {
      for (const st of g.strokes) {
        const l: number[] = [];
        for (let i = 0; i < st.length; i += 2) l.push(pen + st[i] * s, y - st[i + 1] * s);
        out.push(l);
      }
    }
    pen += (g?.adv ?? f.defaultAdv) * s;
  }
  return out;
}
