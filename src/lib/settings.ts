// All user-editable settings. Units: paper in mm, terrain in metres (LV95).

export interface Pen {
  id: string;
  name: string;
  color: string;
  width: number; // nib width in mm
}

export interface Track {
  id: string;
  name: string;
  segments: number[][]; // flat [E0,N0,E1,N1,...] in LV95
  pen: string;
  passes: number; // parallel strokes to make the line heavier
  visible: boolean;
}

export type Fill = 'none' | 'hatch' | 'solid'; // solid = hatching tight enough to close up

export type HatchKind = 'lines' | 'cross' | 'dashes' | 'waves' | 'zigzag';
/** How hatched areas are drawn. Only the fields of the chosen kind are used. */
export interface HatchPattern {
  kind: HatchKind;
  cross: number; // cross: angle of the second set of lines to the first, degrees
  dash: number; // dashes: dash length, mm
  gap: number; // dashes: gap between dashes, mm
  height: number; // waves, zigzag: peak to trough, mm
  length: number; // waves, zigzag: one full wave, mm
}

export type PaperPreset = 'A5' | 'A4' | 'A3' | 'A2' | '50x70' | 'custom';
export type DemSource = 'auto' | 'alti3d' | 'regio';
export type FontName = 'HersheySans1' | 'HersheySerifMed' | 'HersheyScript1' | 'EMSReadability' | 'EMSTech';

export interface Settings {
  version: number;
  rackVersion: number; // bumped when a pen joins the default rack, so saved racks get it once
  pens: Pen[];
  area: { e: number; n: number; scale: number };
  paper: { preset: PaperPreset; w: number; h: number; landscape: boolean; margin: number };
  dem: { source: DemSource; detail: number }; // detail = grid cell size on paper, mm
  contours: {
    enabled: boolean;
    pen: string;
    auto: boolean;
    interval: number; // m, used when auto is off
    spacing: number; // auto: minimum line spacing, in pen widths
    percentile: number; // auto: share of terrain that must meet the spacing (0..100)
    smoothing: number; // terrain smoothing radius on paper, mm
    minLength: number; // drop lines/loops shorter than this, mm
    thin: boolean; // drop intermediate lines where they would crowd
    thinSpacing: number; // crowding threshold, in pen widths
    index: { enabled: boolean; every: number; pen: string; passes: number };
    ground: { enabled: boolean; icePen: string; rockPen: string }; // glacier and rock contours in their own pens
  };
  relief: {
    azimuth: number; // direction the light comes from, degrees clockwise from north
    altitude: number; // light height above the horizon, degrees
    exaggeration: number; // vertical scale applied to the terrain before shading
    smoothing: number; // terrain smoothing for hatching and hachures, mm on paper
    tanaka: { enabled: boolean; passes: number; lit: 'normal' | 'omit' | 'pen'; litPen: string };
    hatch: { enabled: boolean; pen: string; spacing: number; angle: number; tones: number; start: number; minDash: number };
    hachures: { enabled: boolean; pen: string; spacing: number; length: number; passes: number; weight: 'light' | 'slope'; minSlope: number; join: boolean };
  };
  water: { lakes: boolean; rivers: boolean; streams: boolean; pen: string; fill: Fill; spacing: number; angle: number; pattern: HatchPattern };
  roads: { enabled: boolean; pen: string; motorways: boolean; main: boolean; local: boolean; tracks: boolean; mainPasses: number };
  paths: {
    enabled: boolean;
    pen: string;
    hiking: boolean; // marked hiking network, yellow
    mountain: boolean; // white-red-white
    alpine: boolean; // white-blue-white
    unmarked: boolean;
    dashed: boolean;
    dash: number; // mm
    gap: number; // mm
  };
  rail: { enabled: boolean; pen: string; railways: boolean; lifts: boolean };
  forest: {
    enabled: boolean;
    pen: string;
    scrub: boolean; // also scrub, hedges and small woods
    outline: boolean;
    fill: 'none' | 'hatch' | 'trees';
    spacing: number; // mm between hatch lines or tree symbols
    angle: number; // hatch angle, degrees
    pattern: HatchPattern;
  };
  glaciers: { enabled: boolean; pen: string };
  buildings: { enabled: boolean; pen: string; fill: Fill; spacing: number; angle: number; pattern: HatchPattern; minSize: number };
  boundaries: {
    enabled: boolean;
    pen: string;
    country: boolean;
    canton: boolean;
    district: boolean;
    municipality: boolean;
    parks: boolean;
    dashed: boolean;
    dash: number;
    gap: number;
  };
  labels: {
    enabled: boolean;
    pen: string;
    font: FontName;
    size: number; // cap height of peak names, mm; other labels scale from it
    peaks: boolean;
    peakDetail: number; // 1 = only the most prominent summits … 5 = every named one
    heights: boolean;
    places: boolean;
    placeDetail: 'towns' | 'villages' | 'all';
    spots: boolean;
    clear: boolean; // break other lines around labels
    gap: number; // mm
  };
  tracks: Track[];
  knockout: { enabled: boolean; gap: number }; // break other lines around tracks
  frame: { enabled: boolean; pen: string; offset: number; double: boolean; gap: number };
  title: {
    enabled: boolean;
    text: string;
    subtitle: string;
    font: FontName;
    size: number; // cap height, mm
    align: 'left' | 'center' | 'right';
    pen: string;
  };
  machine: {
    bedW: number;
    bedH: number;
    x: number; // paper corner on bed
    y: number;
    rotate: boolean; // paper turned 90° on the bed
    flipY: boolean;
    zUp: number;
    zDown: number;
    feedDraw: number; // mm/min
    feedTravel: number;
    feedZ: number;
    penChange: string;
    start: string;
    end: string;
  };
  view: { mode: 'map' | 'sheet'; basemap: 'grey' | 'color' | 'aerial'; travel: boolean };
}

export const PAPER: Record<Exclude<PaperPreset, 'custom'>, [number, number]> = {
  A5: [148, 210],
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  '50x70': [500, 700],
};

export const FONTS: { id: FontName; label: string }[] = [
  { id: 'HersheySans1', label: 'Hershey Sans' },
  { id: 'HersheySerifMed', label: 'Hershey Serif' },
  { id: 'HersheyScript1', label: 'Hershey Script' },
  { id: 'EMSReadability', label: 'EMS Readability' },
  { id: 'EMSTech', label: 'EMS Tech' },
];

export const HATCH_LINES: HatchPattern = { kind: 'lines', cross: 90, dash: 1, gap: 0.5, height: 0.4, length: 2 };

const GREEN_PEN: Pen = { id: 'p4', name: 'Forest green', color: '#3a7d44', width: 0.3 };

export function defaults(): Settings {
  return {
    version: 1,
    rackVersion: 2,
    pens: [
      { id: 'p1', name: 'Fineliner', color: '#1f1d1a', width: 0.3 },
      { id: 'p2', name: 'Lake blue', color: '#2f6fb0', width: 0.4 },
      { id: 'p3', name: 'Track red', color: '#c43a2f', width: 0.5 },
      { ...GREEN_PEN },
    ],
    area: { e: 2641000, n: 1157500, scale: 50000 },
    paper: { preset: 'A3', w: 297, h: 420, landscape: false, margin: 20 },
    dem: { source: 'auto', detail: 0.3 },
    contours: {
      enabled: true,
      pen: 'p1',
      auto: true,
      interval: 20,
      spacing: 3,
      percentile: 75,
      smoothing: 0.4,
      minLength: 1.5,
      thin: true,
      thinSpacing: 2,
      index: { enabled: true, every: 5, pen: 'p1', passes: 2 },
      ground: { enabled: false, icePen: 'p2', rockPen: 'p1' },
    },
    relief: {
      azimuth: 315,
      altitude: 45,
      exaggeration: 1,
      smoothing: 0.8,
      tanaka: { enabled: false, passes: 3, lit: 'normal', litPen: 'p1' },
      hatch: { enabled: false, pen: 'p1', spacing: 1, angle: 45, tones: 3, start: 15, minDash: 0.8 },
      hachures: { enabled: false, pen: 'p1', spacing: 0.8, length: 1.5, passes: 2, weight: 'light', minSlope: 5, join: false },
    },
    water: { lakes: true, rivers: true, streams: false, pen: 'p2', fill: 'none', spacing: 0.8, angle: 0, pattern: { ...HATCH_LINES } },
    roads: { enabled: false, pen: 'p1', motorways: true, main: true, local: true, tracks: false, mainPasses: 2 },
    paths: { enabled: false, pen: 'p1', hiking: true, mountain: true, alpine: true, unmarked: false, dashed: true, dash: 1.2, gap: 0.6 },
    rail: { enabled: false, pen: 'p1', railways: true, lifts: true },
    forest: { enabled: false, pen: 'p4', scrub: false, outline: true, fill: 'none', spacing: 1, angle: -45, pattern: { ...HATCH_LINES } },
    glaciers: { enabled: false, pen: 'p2' },
    buildings: { enabled: false, pen: 'p1', fill: 'solid', spacing: 0.5, angle: 45, pattern: { ...HATCH_LINES }, minSize: 0.3 },
    boundaries: {
      enabled: false, pen: 'p1', country: true, canton: true, district: false, municipality: false, parks: false,
      dashed: true, dash: 2, gap: 0.8,
    },
    labels: {
      enabled: false, pen: 'p1', font: 'HersheySans1', size: 1.6, peaks: true, peakDetail: 3, heights: true,
      places: true, placeDetail: 'villages', spots: false, clear: true, gap: 0.4,
    },
    tracks: [],
    knockout: { enabled: true, gap: 0.8 },
    frame: { enabled: true, pen: 'p1', offset: 0, double: false, gap: 1.5 },
    title: {
      enabled: true,
      text: 'Jungfrau Region',
      subtitle: '{coords}   1:{scale}   contours {interval} m',
      font: 'HersheySans1',
      size: 6,
      align: 'left',
      pen: 'p1',
    },
    machine: {
      bedW: 590,
      bedH: 850,
      x: 100,
      y: 100,
      rotate: false,
      flipY: false,
      zUp: 5,
      zDown: 0,
      feedDraw: 3000,
      feedTravel: 6000,
      feedZ: 3750,
      penChange: 'G0 Z{up}\nM117 Insert {pen}\nPAUSE',
      start: 'G21\nG90\nG0 Z{up}',
      end: 'G0 Z{up}\nG0 X10 Y10 F{travel}',
    },
    view: { mode: 'sheet', basemap: 'grey', travel: false },
  };
}

const KEY = 'plotty.topo.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const s = JSON.parse(raw);
    if (s?.version !== 1) return defaults();
    return migrate(s);
  } catch {
    return defaults();
  }
}

/** Brings settings saved by any earlier version up to date, filling gaps from the defaults. */
export function migrate(raw: any): Settings {
  const d = defaults();
  const s = raw && typeof raw === 'object' ? { ...raw } : {};
  // Racks saved before the green pen was a default get it once; a pen removed later stays removed.
  if (!(s.rackVersion >= 2) && Array.isArray(s.pens) && !s.pens.some((p: Pen) => p?.id === GREEN_PEN.id)) s.pens = [...s.pens, { ...GREEN_PEN }];
  s.rackVersion = d.rackVersion;
  // buildings.fill used to be a yes/no switch for solid fill.
  if (typeof s.buildings?.fill === 'boolean') s.buildings = { ...s.buildings, fill: s.buildings.fill ? 'solid' : 'none' };
  const out = deepMerge(d, s) as Settings;
  out.version = d.version;
  // Lists can't be checked field by field like the rest, so drop entries that can't be drawn.
  out.pens = out.pens.filter((p) => p && typeof p.id === 'string' && typeof p.color === 'string' && p.width > 0);
  if (!out.pens.length) out.pens = d.pens;
  out.tracks = out.tracks.filter((t) => t && typeof t.id === 'string' && Array.isArray(t.segments) && t.segments.every(Array.isArray));
  for (const p of out.pens) p.name = String(p.name ?? 'Pen');
  for (const t of out.tracks) {
    t.name = String(t.name ?? 'Track');
    t.passes = t.passes >= 1 ? t.passes : 1;
    t.visible = t.visible !== false;
  }
  // Anything drawn with a pen that isn't in the rack falls back to the first pen.
  const ids = new Set(out.pens.map((p) => p.id));
  const fix = (o: any) => {
    for (const k of Object.keys(o)) {
      if (/^(pen|\w+Pen)$/.test(k) && typeof o[k] === 'string' && !ids.has(o[k])) o[k] = out.pens[0].id;
      else if (o[k] && typeof o[k] === 'object' && k !== 'segments' && k !== 'pens') fix(o[k]);
    }
  };
  fix(out);
  return out;
}

/** 'tracks': everything but the GPS tracks was saved, they are too big for browser storage. */
export function saveSettings(s: Settings): 'ok' | 'tracks' | 'failed' {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return 'ok';
  } catch {
    // Storage full or blocked. Large tracks are the usual cause, so keep the rest.
    if (!s.tracks.length) return 'failed';
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...s, tracks: [] }));
      return 'tracks';
    } catch {
      return 'failed';
    }
  }
}

function deepMerge(base: any, over: any): any {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out: any = { ...base };
    for (const k of Object.keys(base)) if (over && k in over) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  // A value of the wrong type (from a damaged or hand-edited file) keeps the default.
  return typeof over === typeof base && !(typeof over === 'number' && !isFinite(over)) ? over : base;
}

export function paperSize(s: Settings): [number, number] {
  const [w, h] = s.paper.preset === 'custom' ? [s.paper.w, s.paper.h] : PAPER[s.paper.preset];
  return s.paper.landscape ? [Math.max(w, h), Math.min(w, h)] : [Math.min(w, h), Math.max(w, h)];
}

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}
