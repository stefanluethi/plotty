<script lang="ts">
  import { S, engine } from '../engine.svelte';
  import { FONTS, uid } from '../settings';
  import { parseGpx } from '../geo/gpx';
  import { computeLayout } from '../layout';
  import Section from './Section.svelte';
  import Field from './Field.svelte';
  import Select from './Select.svelte';
  import Toggle from './Toggle.svelte';
  import PenPick from './PenPick.svelte';

  const stats = $derived(engine.result?.stats);
  const contourPen = $derived(S.pens.find((p) => p.id === S.contours.pen) ?? S.pens[0]);

  let gpxError = $state('');
  let fileInput: HTMLInputElement;

  export async function importFiles(files: FileList | File[]) {
    gpxError = '';
    for (const f of Array.from(files)) {
      if (!/\.gpx$/i.test(f.name)) {
        gpxError = `${f.name} is not a .gpx file.`;
        continue;
      }
      try {
        const g = parseGpx(await f.text(), f.name);
        const trackPen = S.pens.find((p) => /red|track/i.test(p.name)) ?? S.pens[S.pens.length - 1];
        S.tracks.push({ id: uid(), name: g.name, segments: g.segments, pen: trackPen.id, passes: 2, visible: true });
      } catch (e: any) {
        gpxError = `${f.name}: ${e.message}`;
      }
    }
  }

  function fitTracks() {
    let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
    for (const t of S.tracks)
      if (t.visible)
        for (const seg of t.segments)
          for (let i = 0; i < seg.length; i += 2) {
            w = Math.min(w, seg[i]); e = Math.max(e, seg[i]);
            s = Math.min(s, seg[i + 1]); n = Math.max(n, seg[i + 1]);
          }
    if (!isFinite(w)) return;
    S.area.e = Math.round((w + e) / 2);
    S.area.n = Math.round((s + n) / 2);
    const L = computeLayout(S);
    const need = Math.max(((e - w) * 1.15) / L.map.w, ((n - s) * 1.15) / L.map.h) * 1000;
    const nice = need < 20000 ? 500 : need < 100000 ? 1000 : 5000;
    S.area.scale = Math.max(2000, Math.ceil(need / nice) * nice);
    engine.focusTick++;
  }

  const waterOn = () => S.water.lakes || S.water.rivers || S.water.streams;
  const setWater = (on: boolean) => {
    S.water.lakes = on;
    S.water.rivers = on;
    if (!on) S.water.streams = false;
  };

  const tokens = '{coords} {lv95} {scale} {interval} {date}';

  const landOn = () => S.forest.enabled || S.glaciers.enabled;
  const setLand = (on: boolean) => {
    if (on) S.forest.enabled = S.glaciers.enabled = true;
    else S.forest.enabled = S.glaciers.enabled = false;
  };
  const landMeta = $derived([S.forest.enabled && 'Forest', S.glaciers.enabled && 'Glaciers'].filter(Boolean).join(', '));

  const R = $derived(S.relief);
  const reliefOn = () => R.tanaka.enabled || R.hatch.enabled || R.hachures.enabled;
  const setRelief = (on: boolean) => {
    if (on) R.tanaka.enabled = true;
    else R.tanaka.enabled = R.hatch.enabled = R.hachures.enabled = false;
  };
  const reliefMeta = $derived(
    [R.tanaka.enabled && 'Tanaka', R.hatch.enabled && 'Hatching', R.hachures.enabled && 'Hachures'].filter(Boolean).join(', '),
  );
  const lightFrom = $derived(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((R.azimuth % 360) + 360) % 360) / 45) % 8]);

</script>

<aside class="panel" aria-label="Layers">
  <Section title="Contours" bind:enabled={S.contours.enabled} meta={stats?.interval ? `${stats.interval} m` : ''}>
    <PenPick bind:value={S.contours.pen} />
    <Toggle label="Pick interval for me" bind:checked={S.contours.auto} />
    {#if S.contours.auto}
      <Field label="Line spacing" bind:value={S.contours.spacing} step={0.5} min={1} max={30} unit="widths" wide />
      <Field label="Terrain covered" bind:value={S.contours.percentile} step={5} min={10} max={100} unit="%" />
      <p class="hint">
        Uses the smallest round interval that keeps lines at least {S.contours.spacing} pen widths
        ({(S.contours.spacing * contourPen.width).toFixed(2)} mm) apart on {S.contours.percentile}% of the terrain.
      </p>
    {:else}
      <Field label="Interval" bind:value={S.contours.interval} step={5} min={1} max={1000} unit="m" />
    {/if}
    {#if stats?.crowded != null}
      <p class="hint" class:warn={stats.crowded > 0.08}>
        Lines would touch on {(stats.crowded * 100).toFixed(stats.crowded < 0.1 ? 1 : 0)}% of the area{S.contours.thin && stats.crowded >= 0.001
          ? ', thinned there'
          : ''}.
      </p>
    {/if}
    <Field label="Smoothing" bind:value={S.contours.smoothing} step={0.1} min={0} max={5} unit="mm" />
    <Toggle label="Thin out in steep terrain" bind:checked={S.contours.thin} />
    {#if S.contours.thin}
      <Field label="Thin below" bind:value={S.contours.thinSpacing} step={0.25} min={1} max={10} unit="widths" wide />
    {/if}
    <Field label="Shortest line" bind:value={S.contours.minLength} step={0.5} min={0} max={50} unit="mm" />

    <div class="sub">
      <Toggle label="Heavier index lines" bind:checked={S.contours.index.enabled} />
      {#if S.contours.index.enabled}
        <Field label="Every" bind:value={S.contours.index.every} step={1} min={2} max={20} unit="lines" />
        <PenPick label="Index pen" bind:value={S.contours.index.pen} />
        <Field label="Passes" bind:value={S.contours.index.passes} step={1} min={1} max={5} unit="×" />
      {/if}
    </div>

    <div class="sub">
      <Toggle label="Glacier and rock contours" bind:checked={S.contours.ground.enabled} />
      {#if S.contours.ground.enabled}
        <PenPick label="On glaciers" bind:value={S.contours.ground.icePen} />
        <PenPick label="On rock, scree" bind:value={S.contours.ground.rockPen} />
        <p class="hint">
          As on Swiss maps: blue on ice, black on rock, the contour pen (brown, say) elsewhere. Ground types come from
          swisstopo's own contour data.
        </p>
      {/if}
    </div>
  </Section>

  <Section title="Relief" bind:enabled={reliefOn, setRelief} meta={reliefMeta}>
    <Field label="Light from" bind:value={R.azimuth} step={15} min={0} max={360} unit="°" />
    <p class="hint">
      Light from {lightFrom}{lightFrom === 'NW' ? ', the map standard' : ''}. Lit from the bottom, valleys can read as ridges.
    </p>
    <Field label="Light height" bind:value={R.altitude} step={5} min={5} max={85} unit="°" />
    <Field label="Exaggeration" bind:value={R.exaggeration} step={0.25} min={0.25} max={10} unit="×" />
    <Field label="Smoothing" bind:value={R.smoothing} step={0.1} min={0} max={5} unit="mm" />

    <div class="sub">
      <Toggle label="Illuminated contours" bind:checked={R.tanaka.enabled} />
      {#if R.tanaka.enabled}
        <Field label="Shaded side" bind:value={R.tanaka.passes} step={1} min={1} max={5} unit="×" />
        <Select
          label="Lit side"
          bind:value={R.tanaka.lit}
          options={[
            { value: 'normal', label: 'Thin line' },
            { value: 'omit', label: 'Leave out' },
            { value: 'pen', label: 'Other pen' },
          ]}
        />
        {#if R.tanaka.lit === 'pen'}<PenPick label="Lit pen" bind:value={R.tanaka.litPen} />{/if}
        <p class="hint" class:warn={!S.contours.enabled}>
          {S.contours.enabled
            ? R.tanaka.lit === 'pen'
              ? 'Classic Tanaka: a white pen on the lit side and a dark one on the shaded side, on grey or tinted paper.'
              : 'Contours get extra passes where the slope turns away from the light. Uses the contour smoothing.'
            : 'Turn on Contours to see this.'}
        </p>
      {/if}
    </div>

    <div class="sub">
      <Toggle label="Shadow hatching" bind:checked={R.hatch.enabled} />
      {#if R.hatch.enabled}
        <PenPick bind:value={R.hatch.pen} />
        <Field label="Line spacing" bind:value={R.hatch.spacing} step={0.1} min={0.2} max={10} unit="mm" />
        <Field label="Angle" bind:value={R.hatch.angle} step={15} min={-180} max={180} unit="°" />
        <Field label="Tones" bind:value={R.hatch.tones} step={1} min={1} max={4} unit="" />
        <Field label="Starts at" bind:value={R.hatch.start} step={5} min={0} max={95} unit="%" />
        <Field label="Shortest dash" bind:value={R.hatch.minDash} step={0.1} min={0} max={10} unit="mm" />
        <p class="hint">
          Hatches ground that is darker than flat ground. Each tone adds lines in between, tones 3 and 4 cross-hatch. A fine
          light grey pen early in the rack works best.
        </p>
      {/if}
    </div>

    <div class="sub">
      <Toggle label="Hachures" bind:checked={R.hachures.enabled} />
      {#if R.hachures.enabled}
        <PenPick bind:value={R.hachures.pen} />
        <Field label="Stroke spacing" bind:value={R.hachures.spacing} step={0.05} min={0.2} max={5} unit="mm" />
        <Field label="Stroke length" bind:value={R.hachures.length} step={0.25} min={0.5} max={10} unit="mm" />
        <Field label="Heaviest" bind:value={R.hachures.passes} step={1} min={1} max={5} unit="×" />
        <Select
          label="Heavier where"
          bind:value={R.hachures.weight}
          options={[
            { value: 'light', label: 'In shade' },
            { value: 'slope', label: 'Steep' },
          ]}
        />
        <Field label="Flatter than" bind:value={R.hachures.minSlope} step={1} min={0} max={45} unit="°" />
        <Toggle label="Join strokes in a row" bind:checked={R.hachures.join} />
        <p class="hint">
          Strokes run downhill in rows{stats?.hachureInterval ? ` ${stats.hachureInterval} m apart` : ''}, as on the old Dufour and
          Siegfried maps. Ground flatter than {R.hachures.minSlope}° stays blank. Often looks best with contours off.
          {R.hachures.join
            ? 'Strokes are linked along the row, which shows as a fine edge but needs far fewer pen lifts.'
            : 'Every stroke is a pen lift; join strokes to cut plot time.'}
        </p>
      {/if}
    </div>
  </Section>

  <Section title="Lakes and rivers" bind:enabled={waterOn, setWater} meta={engine.featuresLoading && waterOn() ? 'Loading' : ''}>
    <PenPick bind:value={S.water.pen} />
    <Toggle label="Lake shores" bind:checked={S.water.lakes} />
    <Toggle label="Rivers" bind:checked={S.water.rivers} />
    <Toggle label="Streams" bind:checked={S.water.streams} />
    <p class="hint">From swisstopo base map vector data. Streams get busy at scales above 1:50k.</p>
  </Section>

  <Section title="Roads" bind:enabled={S.roads.enabled} meta={engine.featuresLoading && S.roads.enabled ? 'Loading' : ''}>
    <PenPick bind:value={S.roads.pen} />
    <Toggle label="Motorways" bind:checked={S.roads.motorways} />
    <Toggle label="Main roads" bind:checked={S.roads.main} />
    <Field label="Passes, main roads" bind:value={S.roads.mainPasses} step={1} min={1} max={5} unit="×" wide />
    <Toggle label="Local roads" bind:checked={S.roads.local} />
    <Toggle label="Farm and forest tracks" bind:checked={S.roads.tracks} />
    <p class="hint">Tunnels are left out. Local roads and tracks get dense around villages at 1:100k and above.</p>
  </Section>

  <Section title="Paths and trails" bind:enabled={S.paths.enabled} meta={engine.featuresLoading && S.paths.enabled ? 'Loading' : ''}>
    <PenPick bind:value={S.paths.pen} />
    <Toggle label="Hiking trails (yellow)" bind:checked={S.paths.hiking} />
    <Toggle label="Mountain trails (white-red-white)" bind:checked={S.paths.mountain} />
    <Toggle label="Alpine routes (white-blue-white)" bind:checked={S.paths.alpine} />
    <Toggle label="Unmarked paths" bind:checked={S.paths.unmarked} />
    <Toggle label="Dashed" bind:checked={S.paths.dashed} />
    {#if S.paths.dashed}
      <Field label="Dash" bind:value={S.paths.dash} step={0.1} min={0.2} max={10} unit="mm" />
      <Field label="Gap" bind:value={S.paths.gap} step={0.1} min={0.2} max={10} unit="mm" />
      <p class="hint">Every dash is a pen lift, so dashes add plot time.</p>
    {/if}
    <p class="hint">Footpaths by their signposted grade. Hiking routes that follow roads or tracks are drawn with those.</p>
  </Section>

  <Section title="Railways and lifts" bind:enabled={S.rail.enabled} meta={engine.featuresLoading && S.rail.enabled ? 'Loading' : ''}>
    <PenPick bind:value={S.rail.pen} />
    <Toggle label="Railways and trams" bind:checked={S.rail.railways} />
    <Toggle label="Cable cars and lifts" bind:checked={S.rail.lifts} />
  </Section>

  <Section title="Forest and glaciers" open={false} bind:enabled={landOn, setLand} meta={landMeta}>
    <div class="sub first">
      <Toggle label="Forest" bind:checked={S.forest.enabled} />
      {#if S.forest.enabled}
        <PenPick bind:value={S.forest.pen} />
        <Toggle label="Edges" bind:checked={S.forest.outline} />
        <Select
          label="Fill"
          bind:value={S.forest.fill}
          options={[
            { value: 'none', label: 'None' },
            { value: 'hatch', label: 'Hatching' },
            { value: 'trees', label: 'Tree symbols' },
          ]}
        />
        {#if S.forest.fill !== 'none'}
          <Field label="Spacing" bind:value={S.forest.spacing} step={0.1} min={0.3} max={10} unit="mm" />
        {/if}
        {#if S.forest.fill === 'hatch'}
          <Field label="Angle" bind:value={S.forest.angle} step={15} min={-180} max={180} unit="°" />
        {/if}
        {#if S.forest.fill === 'trees'}<p class="hint">Every tree symbol is a pen lift.</p>{/if}
        <Toggle label="Also scrub and small woods" bind:checked={S.forest.scrub} />
      {/if}
    </div>
    <div class="sub">
      <Toggle label="Glacier edges" bind:checked={S.glaciers.enabled} />
      {#if S.glaciers.enabled}<PenPick bind:value={S.glaciers.pen} />{/if}
    </div>
  </Section>

  <Section title="Buildings" open={false} bind:enabled={S.buildings.enabled}>
    <PenPick bind:value={S.buildings.pen} />
    <Toggle label="Fill solid" bind:checked={S.buildings.fill} />
    <Field label="Smallest" bind:value={S.buildings.minSize} step={0.1} min={0} max={10} unit="mm" />
    <p class="hint">Buildings come in from 1:100k down. Smaller ones than this on paper are left out.</p>
  </Section>

  <Section title="Boundaries" open={false} bind:enabled={S.boundaries.enabled}>
    <PenPick bind:value={S.boundaries.pen} />
    <Toggle label="National border" bind:checked={S.boundaries.country} />
    <Toggle label="Cantons" bind:checked={S.boundaries.canton} />
    <Toggle label="Districts" bind:checked={S.boundaries.district} />
    <Toggle label="Municipalities" bind:checked={S.boundaries.municipality} />
    <Toggle label="Parks and UNESCO sites" bind:checked={S.boundaries.parks} />
    <Toggle label="Dashed" bind:checked={S.boundaries.dashed} />
    {#if S.boundaries.dashed}
      <Field label="Dash" bind:value={S.boundaries.dash} step={0.1} min={0.2} max={10} unit="mm" />
      <Field label="Gap" bind:value={S.boundaries.gap} step={0.1} min={0.2} max={10} unit="mm" />
    {/if}
  </Section>

  <Section title="Labels" open={false} bind:enabled={S.labels.enabled}>
    <PenPick bind:value={S.labels.pen} />
    <Select label="Font" bind:value={S.labels.font} options={FONTS.map((f) => ({ value: f.id, label: f.label }))} />
    <Field label="Letter height" bind:value={S.labels.size} step={0.1} min={0.8} max={10} unit="mm" />
    <Toggle label="Peaks" bind:checked={S.labels.peaks} />
    {#if S.labels.peaks}
      <Field label="Peak detail" bind:value={S.labels.peakDetail} step={1} min={1} max={5} unit="of 5" wide />
      <Toggle label="With heights" bind:checked={S.labels.heights} />
    {/if}
    <Toggle label="Places" bind:checked={S.labels.places} />
    {#if S.labels.places}
      <Select
        label="Which places"
        bind:value={S.labels.placeDetail}
        options={[
          { value: 'towns', label: 'Towns and cities' },
          { value: 'villages', label: 'Villages too' },
          { value: 'all', label: 'Hamlets and farms too' },
        ]}
      />
    {/if}
    <Toggle label="Spot heights" bind:checked={S.labels.spots} />
    <Toggle label="Break lines around labels" bind:checked={S.labels.clear} />
    {#if S.labels.clear}
      <Field label="Clearance" bind:value={S.labels.gap} step={0.1} min={0} max={3} unit="mm" />
    {/if}
    <p class="hint">Labels that would overlap are left out, the least important first.</p>
  </Section>

  <Section title="GPS tracks" meta={S.tracks.length ? String(S.tracks.length) : ''}>
    <div class="row-btns">
      <button class="btn" onclick={() => fileInput.click()}>Import GPX</button>
      {#if S.tracks.length}<button class="btn ghost" onclick={fitTracks}>Fit area to tracks</button>{/if}
    </div>
    <input
      bind:this={fileInput}
      type="file"
      accept=".gpx,application/gpx+xml"
      multiple
      hidden
      onchange={(e) => {
        const f = (e.currentTarget as HTMLInputElement).files;
        if (f) importFiles(f);
        (e.currentTarget as HTMLInputElement).value = '';
      }}
    />
    {#if gpxError}<p class="hint err">{gpxError}</p>{/if}
    {#if !S.tracks.length}
      <p class="hint">Import a .gpx file or drop one anywhere on the window.</p>
    {/if}
    {#each S.tracks as t (t.id)}
      <div class="track">
        <div class="track-head">
          <input class="ctl name" bind:value={t.name} aria-label="Track name" />
          <label class="vis" title={t.visible ? 'Hide track' : 'Show track'}>
            <input type="checkbox" bind:checked={t.visible} aria-label="Draw {t.name || 'track'}" />
          </label>
          <button class="btn ghost rm" onclick={() => S.tracks.splice(S.tracks.indexOf(t), 1)} aria-label="Remove {t.name || 'track'}"
            >×</button
          >
        </div>
        <PenPick bind:value={t.pen} />
        <Field label="Passes" bind:value={t.passes} step={1} min={1} max={6} unit="×" />
      </div>
    {/each}
    {#if S.tracks.length}
      <Toggle label="Break lines around tracks" bind:checked={S.knockout.enabled} />
      {#if S.knockout.enabled}
        <Field label="Clearance" bind:value={S.knockout.gap} step={0.1} min={0} max={4} unit="mm" />
      {/if}
    {/if}
  </Section>

  <Section title="Frame" bind:enabled={S.frame.enabled}>
    <PenPick bind:value={S.frame.pen} />
    <Field label="Offset" bind:value={S.frame.offset} step={0.5} min={0} max={30} unit="mm" />
    <Toggle label="Double line" bind:checked={S.frame.double} />
    {#if S.frame.double}
      <Field label="Gap" bind:value={S.frame.gap} step={0.25} min={0.25} max={10} unit="mm" />
    {/if}
  </Section>

  <Section title="Title" bind:enabled={S.title.enabled}>
    <label class="text">
      <span class="label">Title</span>
      <input class="ctl" bind:value={S.title.text} />
    </label>
    <label class="text">
      <span class="label">Second line</span>
      <input class="ctl" bind:value={S.title.subtitle} />
    </label>
    <p class="hint">Fill-ins: {tokens}</p>
    <Select label="Font" bind:value={S.title.font} options={FONTS.map((f) => ({ value: f.id, label: f.label }))} />
    <Field label="Letter height" bind:value={S.title.size} step={0.5} min={2} max={40} unit="mm" />
    <Select
      label="Align"
      bind:value={S.title.align}
      options={[
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Centre' },
        { value: 'right', label: 'Right' },
      ]}
    />
    <PenPick bind:value={S.title.pen} />
  </Section>
</aside>

<style>
  .panel {
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: var(--rule) transparent;
    background: var(--frame);
    border-left: 1px solid var(--rule);
  }
  .sub {
    display: grid;
    gap: 7px;
    margin-top: 6px;
    padding-top: 10px;
    border-top: 1px dashed var(--rule-soft);
  }
  .sub.first {
    margin-top: 0;
    padding-top: 0;
    border-top: 0;
  }
  .warn {
    color: var(--warn);
  }
  .err {
    color: var(--danger);
  }
  .row-btns {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .track {
    display: grid;
    gap: 6px;
    padding: 8px;
    background: var(--well);
    border: 1px solid var(--rule-soft);
    border-radius: var(--r-sm);
  }
  .track-head {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .name {
    flex: 1;
  }
  .vis {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    cursor: pointer;
  }
  .vis input {
    accent-color: var(--lake);
    margin: 0;
    cursor: pointer;
  }
  .rm {
    height: 24px;
    min-width: 24px;
    justify-content: center;
    padding: 0 7px;
    font-size: 15px;
  }
  .text {
    display: grid;
    gap: 4px;
  }
</style>
