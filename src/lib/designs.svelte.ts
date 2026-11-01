// Named designs: kept in the browser (IndexedDB, which has room for GPS tracks) or saved as files.
// A design is every setting except the machine and the view, so opening one never moves the sheet on the bed.

import { migrate, uid, type Settings } from './settings';
import { S, engine } from './engine.svelte';
import type { ComposeResult } from './plot/compose';

export type DesignSettings = Omit<Settings, 'machine' | 'view'>;

export interface Design {
  id: string;
  name: string;
  saved: number; // ms since epoch
  thumb: string; // small PNG data URL of the sheet, '' if there was no plot yet
  settings: DesignSettings;
}

const TOOL = 'topo';
const FORMAT = 1;
export const FILE_EXT = '.plotty.json';

export function designPart(s: Settings): DesignSettings {
  const { machine: _m, view: _v, ...rest } = s;
  return rest;
}

const fingerprint = (d: DesignSettings) => JSON.stringify(d);

// ---- IndexedDB ----

const DB = 'plotty';
const STORE = 'topo-designs';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => {
      dbp = null;
      rej(r.error);
    };
  }));
}

async function tx<T>(mode: IDBTransactionMode, run: (st: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => res(req.result);
    t.onerror = t.onabort = () => rej(t.error ?? req.error);
  });
}

// ---- Preview ----

/** The plot drawn small on white paper, for the design list. */
function thumbnail(r: ComposeResult | null, s: Settings): string {
  if (!r || !r.pens.length) return '';
  const { paperW: W, paperH: H } = r.layout;
  const k = 160 / Math.max(W, H);
  const c = document.createElement('canvas');
  c.width = Math.round(W * k);
  c.height = Math.round(H * k);
  const g = c.getContext('2d');
  if (!g) return '';
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fbfbf8';
  g.fillRect(0, 0, c.width, c.height);
  g.lineCap = g.lineJoin = 'round';
  g.scale(k, k);
  for (const pg of r.pens) {
    const pen = s.pens.find((p) => p.id === pg.penId);
    g.strokeStyle = pen?.color ?? '#1f1d1a';
    const w = pen?.width ?? 0.3;
    // Nibs thinner than a pixel at this size fade instead of vanishing, as on the sheet.
    g.lineWidth = Math.max(w, 0.5 / k);
    g.globalAlpha = Math.min(0.94, Math.max(0.35, (w * k) / 0.5));
    g.beginPath();
    for (const l of pg.lines) {
      g.moveTo(l[0], l[1]);
      for (let i = 2; i < l.length; i += 2) g.lineTo(l[i], l[i + 1]);
    }
    g.stroke();
  }
  return c.toDataURL('image/png');
}

// ---- State ----

const CURRENT_KEY = 'plotty.topo.current';

interface Notice {
  text: string;
  tone: 'info' | 'error';
  undo?: () => void;
}

class Designs {
  list = $state.raw<Design[]>([]);
  available = $state(true); // false when the browser blocks IndexedDB
  name = $state<string | null>(null); // the design being worked on, if it has been saved or opened
  dirty = $state(false);
  notice = $state<Notice | null>(null);
  flash = $state(''); // brief confirmation on the header button
  private baseline: string | null = null;
  private flashTimer: any;

  constructor() {
    try {
      const c = JSON.parse(localStorage.getItem(CURRENT_KEY) ?? 'null');
      if (c && typeof c.name === 'string') {
        this.name = c.name;
        this.baseline = typeof c.fp === 'string' ? c.fp : null;
      }
    } catch {}
    this.refresh();
  }

  private remember() {
    try {
      if (this.name == null) localStorage.removeItem(CURRENT_KEY);
      else localStorage.setItem(CURRENT_KEY, JSON.stringify({ name: this.name, fp: this.baseline }));
    } catch {}
  }

  /** Called with every settings change. Large tracks make the comparison slow, so it waits for a pause. */
  track(s: Settings) {
    clearTimeout(this.trackTimer);
    if (this.name == null) return void (this.dirty = false);
    this.trackTimer = setTimeout(() => (this.dirty = this.name != null && fingerprint(designPart(s)) !== this.baseline), 250);
  }
  private trackTimer: any;

  private settle(name: string | null, d: DesignSettings | null) {
    this.name = name;
    this.baseline = d ? fingerprint(d) : null;
    this.dirty = false;
    this.remember();
  }

  async refresh() {
    try {
      const all = await tx<Design[]>('readonly', (st) => st.getAll());
      this.list = all.sort((a, b) => b.saved - a.saved);
      this.available = true;
    } catch (e) {
      console.warn('design storage unavailable', e);
      this.available = false;
    }
  }

  find(name: string) {
    const n = name.trim().toLowerCase();
    return this.list.find((d) => d.name.trim().toLowerCase() === n);
  }

  /** Save the current settings under a name. A design with the same name is replaced. */
  async save(name: string) {
    name = name.trim() || 'Untitled';
    await engine.idle();
    const snap = $state.snapshot(S) as Settings;
    const settings = designPart(snap);
    const prev = this.find(name);
    const d: Design = { id: prev?.id ?? uid(), name, saved: Date.now(), thumb: thumbnail(engine.result, snap), settings };
    try {
      await tx('readwrite', (st) => st.put(d));
    } catch (e: any) {
      this.notice = { text: `The design could not be saved in this browser (${e?.message ?? 'storage is full or blocked'}). Save it to a file instead.`, tone: 'error' };
      return false;
    }
    await this.refresh();
    this.settle(name, settings);
    this.notice = null;
    this.blink('Saved');
    return true;
  }

  private blink(text: string) {
    clearTimeout(this.flashTimer);
    this.flash = text;
    this.flashTimer = setTimeout(() => (this.flash = ''), 1600);
  }

  /** Replace the current design, keeping machine and view. The previous one can be brought back. */
  private apply(name: string, raw: any, verb: string) {
    const before = $state.snapshot(S) as Settings;
    const was = { name: this.name, baseline: this.baseline };
    const next = migrate(raw);
    for (const k of Object.keys(next) as (keyof Settings)[]) {
      if (k !== 'machine' && k !== 'view') (S as any)[k] = next[k];
    }
    this.settle(name, designPart(next));
    engine.focusTick++;
    this.notice = {
      text: `${verb} “${name}”.`,
      tone: 'info',
      undo: () => {
        for (const k of Object.keys(before) as (keyof Settings)[]) {
          if (k !== 'machine' && k !== 'view') (S as any)[k] = before[k];
        }
        this.name = was.name;
        this.baseline = was.baseline;
        this.remember();
        this.notice = null;
        this.track($state.snapshot(S) as Settings);
        engine.focusTick++;
      },
    };
  }

  open(d: Design) {
    this.apply(d.name, d.settings, 'Opened');
  }

  async remove(d: Design) {
    try {
      await tx('readwrite', (st) => st.delete(d.id));
    } catch (e: any) {
      this.notice = { text: `“${d.name}” could not be deleted (${e?.message ?? e}).`, tone: 'error' };
      return;
    }
    await this.refresh();
    const was = this.name === d.name ? { name: this.name, baseline: this.baseline } : null;
    if (was) this.settle(null, null);
    this.notice = {
      text: `Deleted “${d.name}”.`,
      tone: 'info',
      undo: async () => {
        this.notice = null;
        try {
          await tx('readwrite', (st) => st.put(d));
          await this.refresh();
        } catch {}
        if (was && this.name == null) {
          this.name = was.name;
          this.baseline = was.baseline;
          this.remember();
          this.track($state.snapshot(S) as Settings);
        }
      },
    };
  }

  // ---- Files ----

  async toFile(name: string): Promise<{ file: string; text: string }> {
    name = name.trim() || 'Untitled';
    await engine.idle();
    const settings = designPart($state.snapshot(S) as Settings);
    const text = JSON.stringify({ app: 'plotty', tool: TOOL, format: FORMAT, name, saved: new Date().toISOString(), settings }, null, 1);
    // The file holds the design, but it isn't in the browser list: only the name and baseline move.
    this.settle(name, settings);
    this.blink('Saved');
    return { file: `${slug(name)}${FILE_EXT}`, text };
  }

  async fromFile(f: File) {
    try {
      const j = JSON.parse(await f.text());
      if (j?.app !== 'plotty' || !j.settings || typeof j.settings !== 'object') throw new Error('it is not a plotty design');
      if (j.tool !== TOOL) throw new Error(`it is a design for plotty ${String(j.tool)}, not Topo`);
      if (!(j.format <= FORMAT)) throw new Error('it was made by a newer version of plotty');
      const name = typeof j.name === 'string' && j.name.trim() ? j.name.trim() : f.name.replace(/(\.plotty)?\.json$/i, '');
      this.apply(name, j.settings, 'Opened');
    } catch (e: any) {
      this.notice = { text: `${f.name} could not be opened: ${e instanceof SyntaxError ? 'it is not valid JSON' : e?.message ?? e}.`, tone: 'error' };
    }
  }
}

export function slug(name: string) {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'topo'
  );
}

export const designs = new Designs();
