import { loadSettings, saveSettings, type Settings } from './settings';
import { computeLayout } from './layout';
import { loadDem, resolveSource, expectedRes, type DemGrid, type DemRequest } from './geo/dem';
import { loadFeatures, type MapFeatures } from './geo/features';
import { parseFont, type StrokeFont } from './plot/font';
import type { ComposeResult } from './plot/compose';
import { FONTS } from './settings';
import PlotWorker from './plot/worker?worker';

export const S: Settings = $state(loadSettings());

class Engine {
  result = $state.raw<ComposeResult | null>(null);
  dem = $state.raw<DemGrid | null>(null);
  demLoading = $state<{ done: number; total: number; label: string } | null>(null);
  featuresLoading = $state(false);
  composing = $state(false);
  error = $state('');
  warning = $state(''); // problems that don't stop the plot (storage, fonts)
  fonts = $state.raw<Record<string, StrokeFont>>({});
  cursor = $state<[number, number] | null>(null); // machine mm under the pointer
  focusTick = $state(0); // bump to bring the selection into view on the map

  private worker = new PlotWorker();
  private reqId = 0;
  private pending: Settings | null = null;
  private busy = false;
  private demAbort: AbortController | null = null;
  private featuresAbort: AbortController | null = null;
  private demTimer: any;
  private featuresTimer: any;
  private composeTimer: any;
  private saveTimer: any;
  private featuresKey = '';
  private demKey = '';
  private idleWaiters: (() => void)[] = [];

  constructor() {
    this.worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.id !== this.reqId) return this.next();
      if (m.type === 'result') {
        this.result = m.result;
        if (this.error.startsWith('Rendering')) this.error = '';
      } else this.error = `Rendering failed: ${m.message}`;
      this.next();
    };
    // An uncaught crash in the worker sends no reply, so don't wait for one.
    this.worker.onerror = (ev) => {
      ev.preventDefault();
      this.error = `Rendering failed: ${ev.message || 'the drawing worker crashed'}. Change a setting to retry.`;
      this.next();
    };
    this.ensureFonts(['HersheyScript1']); // the wordmark
  }

  private fontJobs = new Map<string, Promise<void>>();
  private fontFailed = new Set<string>();

  /** Fetch fonts not loaded yet and hand them to the drawing worker. Fonts load only once they are used. */
  ensureFonts(names: string[]): Promise<void> {
    const base = import.meta.env.BASE_URL;
    const jobs = [...new Set(names)].map((name) => {
      let job = this.fontJobs.get(name);
      if (!job) {
        job = (async () => {
          try {
            const r = await fetch(`${base}fonts/${name}.svg`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const font = parseFont(await r.text());
            this.worker.postMessage({ type: 'font', name, font });
            this.fonts = { ...this.fonts, [name]: font };
            this.fontFailed.delete(name);
          } catch (e) {
            console.warn('font failed', name, e);
            this.fontFailed.add(name);
            this.fontJobs.delete(name); // try again next time it's needed
          }
          const missing = FONTS.filter((f) => this.fontFailed.has(f.id)).map((f) => f.label);
          if (missing.length) this.warning = `Font${missing.length > 1 ? 's' : ''} ${missing.join(', ')} could not be loaded. Text in ${missing.length > 1 ? 'them' : 'it'} uses another font.`;
          else if (this.warning.startsWith('Font')) this.warning = '';
        })();
        this.fontJobs.set(name, job);
      }
      return job;
    });
    return Promise.all(jobs).then(() => {});
  }

  save(s: Settings) {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const r = saveSettings(s);
      const prev = this.warning.startsWith('Settings') || this.warning.startsWith('GPS tracks');
      if (r === 'tracks') this.warning = 'GPS tracks are too large to keep in the browser. Everything else is saved; re-import the tracks after a reload.';
      else if (r === 'failed') this.warning = 'Settings cannot be saved in this browser (storage is full or blocked).';
      else if (prev) this.warning = '';
    }, 300);
  }

  /** Resolves once the plot reflects the latest settings. */
  idle(): Promise<void> {
    if (!this.busy && !this.pending && !this.composeQueued) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }
  private composeQueued = false;

  compose(s: Settings) {
    clearTimeout(this.composeTimer);
    this.composeQueued = true;
    const timer = (this.composeTimer = setTimeout(async () => {
      // Draw only once the fonts in use are here, so text (and exports) never fall back to another font.
      const wanted = [s.labels.enabled && s.labels.font, s.title.enabled && s.title.font].filter(Boolean) as string[];
      if (wanted.some((f) => !this.fonts[f])) {
        await this.ensureFonts(wanted);
        if (this.composeTimer !== timer) return; // newer settings arrived meanwhile
      }
      this.composeQueued = false;
      this.pending = s;
      if (!this.busy) this.next();
    }, 60));
  }

  private next() {
    this.busy = false;
    if (!this.pending) {
      this.composing = false;
      if (!this.composeQueued) for (const r of this.idleWaiters.splice(0)) r();
      return;
    }
    const s = this.pending;
    this.pending = null;
    this.busy = true;
    this.composing = true;
    this.worker.postMessage({ type: 'compose', id: ++this.reqId, settings: s });
  }

  /** Fetch elevation for the current area unless what we have already covers it. */
  requestDem(s: Settings) {
    const L = computeLayout(s);
    const cell = s.dem.detail * L.mPerMm;
    const pad = (L.east - L.west) * 0.05 + cell * 6;
    const req: DemRequest = { west: L.west - pad, south: L.south - pad, east: L.east + pad, north: L.north + pad, cell, source: s.dem.source };
    const src = resolveSource(req);
    const d = this.dem;
    const m = cell * 3;
    if (
      d && d.source === src && Math.abs(d.cell / expectedRes(req) - 1) < 0.01 &&
      d.west <= L.west - m && d.north >= L.north + m &&
      d.west + d.w * d.cell >= L.east + m && d.north - d.h * d.cell <= L.south - m &&
      d.w * d.cell < (L.east - L.west) * 1.6
    ) return;
    const key = [src, req.west, req.north, req.east, req.south, cell].map((v) => (typeof v === 'number' ? Math.round(v / 50) : v)).join('|');
    if (key === this.demKey) return;
    clearTimeout(this.demTimer);
    this.demTimer = setTimeout(async () => {
      this.demKey = key;
      this.demAbort?.abort();
      const ac = (this.demAbort = new AbortController());
      this.demLoading = { done: 0, total: 1, label: src };
      try {
        const dem = await loadDem(req, (done, total, label) => { if (!ac.signal.aborted) this.demLoading = { done, total, label }; }, ac.signal);
        if (ac.signal.aborted) return;
        this.dem = dem;
        this.worker.postMessage({ type: 'dem', dem });
        if (this.error.startsWith('Elevation')) this.error = '';
        this.compose($state.snapshot(S) as Settings);
      } catch (e: any) {
        if (e?.name === 'AbortError' || ac.signal.aborted) return;
        console.error(e);
        this.demKey = '';
        this.error = `Elevation data could not be loaded (${e?.message ?? e}). Check the connection and move the area to retry.`;
      } finally {
        if (this.demAbort === ac) this.demLoading = null;
      }
    }, 350);
  }

  /** Lakes, rivers, roads, paths and railways from the base map tiles, when any of them is drawn. */
  requestFeatures(s: Settings) {
    const wanted =
      s.water.lakes || s.water.rivers || s.water.streams || s.roads.enabled || s.paths.enabled || s.rail.enabled ||
      s.forest.enabled || s.glaciers.enabled || s.buildings.enabled || s.boundaries.enabled || s.labels.enabled ||
      (s.contours.enabled && s.contours.ground.enabled);
    if (!wanted) return;
    const L = computeLayout(s);
    const pad = (L.east - L.west) * 0.05;
    const key = [L.west - pad, L.south - pad, L.east + pad, L.north + pad, L.mPerMm].map((v) => Math.round(v / 100)).join('|');
    if (key === this.featuresKey) return;
    clearTimeout(this.featuresTimer);
    this.featuresTimer = setTimeout(async () => {
      this.featuresKey = key;
      this.featuresAbort?.abort();
      const ac = (this.featuresAbort = new AbortController());
      this.featuresLoading = true;
      try {
        const f: MapFeatures = await loadFeatures(L.west - pad, L.south - pad, L.east + pad, L.north + pad, L.mPerMm, ac.signal);
        if (ac.signal.aborted) return;
        this.worker.postMessage({ type: 'features', features: f });
        if (this.error.startsWith('Map features')) this.error = '';
        this.compose($state.snapshot(S) as Settings);
      } catch (e: any) {
        if (e?.name === 'AbortError' || ac.signal.aborted) return;
        this.featuresKey = '';
        this.error = `Map features (lakes, roads, labels and more) could not be loaded (${e?.message ?? e}).`;
      } finally {
        if (this.featuresAbort === ac) this.featuresLoading = false;
      }
    }, 450);
  }
}

export const engine = new Engine();
