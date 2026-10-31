<script lang="ts">
  import { S, engine } from '../engine.svelte';
  import { PAPER, paperSize, type PaperPreset } from '../settings';
  import { computeLayout } from '../layout';
  import { toLV95, swissNumber } from '../geo/lv95';
  import { resolveSource, expectedRes } from '../geo/dem';
  import Section from './Section.svelte';
  import Field from './Field.svelte';
  import Select from './Select.svelte';
  import Toggle from './Toggle.svelte';

  const L = $derived(computeLayout(S));

  // Place search (geo.admin.ch)
  let q = $state('');
  let results = $state<{ label: string; detail: string; e: number; n: number }[]>([]);
  let searchErr = $state('');
  let timer: any;
  function search() {
    clearTimeout(timer);
    const text = q.trim();
    if (text.length < 2) {
      results = [];
      return;
    }
    timer = setTimeout(async () => {
      try {
        const url = `https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=${encodeURIComponent(text)}&type=locations&limit=8`;
        const j = await (await fetch(url)).json();
        results = (j.results ?? []).map((r: any) => {
          const [e, n] = toLV95(r.attrs.lon, r.attrs.lat);
          const html = String(r.attrs.label);
          const strip = (x: string) => x.replace(/<[^>]+>/g, '').trim();
          const name = strip(/<b>(.*?)<\/b>/.exec(html)?.[1] ?? html);
          const kind = strip(/<i>(.*?)<\/i>/.exec(html)?.[1] ?? '');
          const where = strip(html.replace(/<i>.*?<\/i>|<b>.*?<\/b>/g, '')).replace(/\(\s*\)/g, '').replace(/^[-\s]+|[-\s]+$/g, '');
          return { label: name, detail: [kind, where].filter(Boolean).join(', '), e, n };
        });
        searchErr = results.length ? '' : 'No place found with that name.';
      } catch {
        searchErr = 'Search is unavailable right now. Enter coordinates instead.';
      }
    }, 250);
  }
  function pick(r: { label: string; e: number; n: number }) {
    S.area.e = Math.round(r.e);
    S.area.n = Math.round(r.n);
    S.title.text = r.label.split(' (')[0];
    results = [];
    q = '';
    engine.focusTick++;
  }

  const presets: { value: PaperPreset; label: string }[] = [
    ...Object.keys(PAPER).map((k) => ({ value: k as PaperPreset, label: k === '50x70' ? '50 × 70 cm' : k })),
    { value: 'custom', label: 'Custom' },
  ];
  $effect(() => {
    // Switching to custom starts from the current size.
    if (S.paper.preset === 'custom' && (!S.paper.w || !S.paper.h)) [S.paper.w, S.paper.h] = paperSize(S);
  });

  const scales = [10000, 25000, 50000, 100000, 200000];

  const demInfo = $derived.by(() => {
    const cell = S.dem.detail * L.mPerMm;
    const req = { west: L.west, south: L.south, east: L.east, north: L.north, cell, source: S.dem.source };
    const src = resolveSource(req);
    const res = expectedRes(req);
    return `${src}, ${res >= 100 ? Math.round(res) : res} m grid${S.dem.source === 'alti3d' && src !== 'swissALTI3D' ? ' (area too large for swissALTI3D)' : ''}`;
  });

  const sheetFits = $derived.by(() => {
    const [w, h] = paperSize(S);
    const fw = S.machine.rotate ? h : w, fh = S.machine.rotate ? w : h;
    return S.machine.x >= 0 && S.machine.y >= 0 && S.machine.x + fw <= S.machine.bedW && S.machine.y + fh <= S.machine.bedH;
  });
</script>

<aside class="panel" aria-label="Area, sheet and machine">
  <Section title="Place">
    <div class="search">
      <input
        class="ctl"
        type="search"
        placeholder="Search a place, peak or pass"
        bind:value={q}
        oninput={search}
        aria-label="Search a place"
      />
      {#if results.length}
        <ul class="results">
          {#each results as r (r.label + r.e)}
            <li><button onclick={() => pick(r)}>{r.label}<span class="detail">{r.detail}</span></button></li>
          {/each}
        </ul>
      {:else if searchErr && q.trim().length >= 2}
        <p class="hint">{searchErr}</p>
      {/if}
    </div>
    <Field label="East" bind:value={S.area.e} step={100} unit="m" wide />
    <Field label="North" bind:value={S.area.n} step={100} unit="m" wide />
    <p class="hint">Swiss LV95 coordinates. You can also drag the frame on the map.</p>
  </Section>

  <Section title="Scale" meta="1:{swissNumber(S.area.scale)}">
    <Field label="Scale 1 :" bind:value={S.area.scale} step={500} min={2000} max={1000000} wide />
    <div class="chips" role="group" aria-label="Common scales">
      {#each scales as sc (sc)}
        <button class="chip" class:on={S.area.scale === sc} onclick={() => (S.area.scale = sc)}>{sc / 1000}k</button>
      {/each}
    </div>
    <p class="hint">
      Map area {((L.east - L.west) / 1000).toFixed(1)} × {((L.north - L.south) / 1000).toFixed(1)} km on paper of
      {L.map.w.toFixed(0)} × {L.map.h.toFixed(0)} mm. 1 mm on paper is {L.mPerMm.toFixed(L.mPerMm < 10 ? 1 : 0)} m.
    </p>
  </Section>

  <Section title="Sheet" meta="{paperSize(S)[0]} × {paperSize(S)[1]}">
    <Select label="Paper" bind:value={S.paper.preset} options={presets} />
    {#if S.paper.preset === 'custom'}
      <Field label="Width" bind:value={S.paper.w} step={1} min={50} max={1200} unit="mm" />
      <Field label="Height" bind:value={S.paper.h} step={1} min={50} max={1200} unit="mm" />
    {/if}
    <Toggle label="Landscape" bind:checked={S.paper.landscape} />
    <Field label="Margin" bind:value={S.paper.margin} step={1} min={0} max={100} unit="mm" />
  </Section>

  <Section title="Elevation data" open={false} meta={S.dem.source === 'auto' ? 'Auto' : ''}>
    <Select
      label="Source"
      bind:value={S.dem.source}
      options={[
        { value: 'auto', label: 'Auto' },
        { value: 'alti3d', label: 'swissALTI3D, 2 m' },
        { value: 'regio', label: 'swissALTIRegio, 10 m' },
      ]}
    />
    <Field label="Detail on paper" bind:value={S.dem.detail} step={0.05} min={0.1} max={2} unit="mm" />
    <p class="hint">Using {demInfo}. Smaller detail loads more data; 0.3 mm is plenty for most pens.</p>
  </Section>

  <Section title="Machine" open={false} meta="{S.machine.bedW} × {S.machine.bedH}">
    <Field label="Bed width" bind:value={S.machine.bedW} step={10} min={50} unit="mm" />
    <Field label="Bed height" bind:value={S.machine.bedH} step={10} min={50} unit="mm" />
    <Field label="Sheet corner X" bind:value={S.machine.x} step={5} unit="mm" />
    <Field label="Sheet corner Y" bind:value={S.machine.y} step={5} unit="mm" />
    {#if !sheetFits}<p class="hint warn">The sheet extends past the bed. Move it or pick a smaller paper.</p>{/if}
    <Toggle label="Turn sheet 90°" bind:checked={S.machine.rotate} />
    <Toggle label="Y axis points toward me" bind:checked={S.machine.flipY} />
    <Field label="Pen up Z" bind:value={S.machine.zUp} step={0.5} unit="" />
    <Field label="Pen down Z" bind:value={S.machine.zDown} step={0.5} unit="" />
    <Field label="Drawing speed" bind:value={S.machine.feedDraw} step={100} min={100} unit="mm/min" wide />
    <Field label="Travel speed" bind:value={S.machine.feedTravel} step={100} min={100} unit="mm/min" wide />
    <Field label="Pen lift speed" bind:value={S.machine.feedZ} step={100} min={100} unit="mm/min" wide />
    <label class="code">
      <span class="label">Pen change</span>
      <textarea class="ctl" rows="3" bind:value={S.machine.penChange} spellcheck="false"></textarea>
    </label>
    <label class="code">
      <span class="label">Start gcode</span>
      <textarea class="ctl" rows="3" bind:value={S.machine.start} spellcheck="false"></textarea>
    </label>
    <label class="code">
      <span class="label">End gcode</span>
      <textarea class="ctl" rows="2" bind:value={S.machine.end} spellcheck="false"></textarea>
    </label>
    <p class="hint">Placeholders: {'{pen}'}, {'{up}'}, {'{down}'}, {'{travel}'}, {'{draw}'}.</p>
  </Section>
</aside>

<style>
  .panel {
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: var(--rule) transparent;
    background: var(--frame);
    border-right: 1px solid var(--rule);
  }
  .search {
    position: relative;
    display: grid;
    gap: 6px;
  }
  .search input {
    width: 100%;
    height: 30px;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 4px;
    background: var(--frame-2);
    border: 1px solid var(--rule);
    border-radius: var(--r-sm);
  }
  .results button {
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    padding: 6px 8px;
    border-radius: 2px;
  }
  .detail {
    display: block;
    color: var(--ink-3);
    font-size: 11.5px;
  }
  .results button:hover {
    background: var(--frame-3);
  }
  .chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .chip {
    height: 24px;
    padding: 0 9px;
    background: var(--frame-2);
    border: 1px solid var(--rule-soft);
    border-radius: 12px;
    font-size: 12px;
    color: var(--ink-2);
  }
  .chip.on {
    border-color: var(--lake);
    color: var(--lake);
  }
  .code {
    display: grid;
    gap: 4px;
  }
  textarea {
    height: auto;
    padding: 6px 7px;
    resize: vertical;
    font-size: 12px;
    font-family: ui-monospace, 'JetBrains Mono', monospace;
  }
  .warn {
    color: var(--warn);
  }
</style>
