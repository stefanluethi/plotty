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

export type PaperPreset = 'A5' | 'A4' | 'A3' | 'A2' | '50x70' | 'custom';
export type DemSource = 'auto' | 'alti3d' | 'regio';
export type FontName = 'HersheySans1' | 'HersheySerifMed' | 'HersheyScript1' | 'EMSReadability' | 'EMSTech';

export interface Settings {
  version: number;
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
  };
  water: { lakes: boolean; rivers: boolean; streams: boolean; pen: string };
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

export function defaults(): Settings {
  return {
    version: 1,
    pens: [
      { id: 'p1', name: 'Fineliner', color: '#1f1d1a', width: 0.3 },
      { id: 'p2', name: 'Lake blue', color: '#2f6fb0', width: 0.4 },
      { id: 'p3', name: 'Track red', color: '#c43a2f', width: 0.5 },
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
    },
    water: { lakes: true, rivers: true, streams: false, pen: 'p2' },
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
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    if (s?.version !== d.version) return d;
    return deepMerge(d, s) as Settings;
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage full or blocked: settings simply won't persist.
  }
}

function deepMerge(base: any, over: any): any {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out: any = { ...base };
    for (const k of Object.keys(base)) if (over && k in over) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over ?? base;
}

export function paperSize(s: Settings): [number, number] {
  const [w, h] = s.paper.preset === 'custom' ? [s.paper.w, s.paper.h] : PAPER[s.paper.preset];
  return s.paper.landscape ? [Math.max(w, h), Math.min(w, h)] : [Math.min(w, h), Math.max(w, h)];
}

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}
