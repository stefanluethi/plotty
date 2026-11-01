<script lang="ts">
  import { untrack } from 'svelte';
  import { S, engine } from './lib/engine.svelte';
  import { toGcode, toSvg, download, sheetOnBed } from './lib/export/export';
  import type { Settings } from './lib/settings';
  import Wordmark from './lib/ui/Wordmark.svelte';
  import PenRack from './lib/ui/PenRack.svelte';
  import LeftPanel from './lib/ui/LeftPanel.svelte';
  import RightPanel from './lib/ui/RightPanel.svelte';
  import SheetView from './lib/ui/SheetView.svelte';
  import StatusBar from './lib/ui/StatusBar.svelte';
  import DesignMenu from './lib/ui/DesignMenu.svelte';
  import { designs, slug } from './lib/designs.svelte';

  let right: RightPanel;
  let designMenu: DesignMenu;

  // MapLibre is about half the app's code; fetch it only once the map is wanted.
  let mapView: Promise<typeof import('./lib/ui/MapView.svelte')> | null = $state(null);
  const loadMap = () => (mapView ??= import('./lib/ui/MapView.svelte'));
  // Hovering the Map button only fetches the code; the map itself starts on first show and then stays.
  let mapMounted = $state(false);
  $effect(() => {
    if (S.view.mode === 'map') {
      loadMap();
      mapMounted = true;
    }
  });

  // Persist, fetch data and redraw whenever settings change.
  $effect(() => {
    const snap = $state.snapshot(S) as Settings;
    untrack(() => {
      engine.save(snap);
      designs.track(snap);
      engine.requestDem(snap);
      engine.requestFeatures(snap);
      engine.compose(snap);
    });
  });

  const fileBase = $derived(slug(designs.name || S.title.text || 'topo'));

  // Export what the settings say now, not a plot that is still being redrawn.
  let exporting = $state(false);
  async function exportAs(kind: 'gcode' | 'svg') {
    exporting = true;
    try {
      await engine.idle();
      const r = engine.result;
      if (!r || !r.pens.length) return;
      if (kind === 'gcode') download(`${fileBase}.gcode`, toGcode(S, r), 'text/plain');
      else download(`${fileBase}.svg`, toSvg(S, r), 'image/svg+xml');
    } finally {
      exporting = false;
    }
  }

  let dragging = $state(false);
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const files = Array.from(e.dataTransfer?.files ?? []);
    const design = files.find((f) => /\.json$/i.test(f.name));
    if (design) designMenu.openFile(design);
    const rest = files.filter((f) => f !== design);
    if (rest.length) right.importFiles(rest);
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (t.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
    if (e.key === 'm') S.view.mode = 'map';
    else if (e.key === 's') S.view.mode = 'sheet';
  }

  const ready = $derived(!!engine.result && engine.result.pens.length > 0 && !exporting);
  const onBed = $derived(sheetOnBed(S));
</script>

<svelte:window
  onkeydown={onKey}
  ondragover={(e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      dragging = true;
    }
  }}
  ondragleave={(e) => {
    if (!e.relatedTarget) dragging = false;
  }}
  ondrop={onDrop}
/>

<div class="app">
  <header class="top">
    <div class="brand">
      <Wordmark />
      <span class="tool">Topo</span>
    </div>
    <DesignMenu bind:this={designMenu} />
    <div class="views" role="group" aria-label="View">
      <button
        aria-pressed={S.view.mode === 'map'}
        aria-keyshortcuts="M"
        class:on={S.view.mode === 'map'}
        onpointerenter={loadMap}
        onfocus={loadMap}
        onclick={() => (S.view.mode = 'map')}>Map <kbd aria-hidden="true">M</kbd></button
      >
      <button
        aria-pressed={S.view.mode === 'sheet'}
        aria-keyshortcuts="S"
        class:on={S.view.mode === 'sheet'}
        onclick={() => (S.view.mode = 'sheet')}>Sheet <kbd aria-hidden="true">S</kbd></button
      >
    </div>
    <PenRack />
    <div class="export">
      <button class="btn" onclick={() => exportAs('svg')} disabled={!ready}>Download SVG</button>
      <button
        class="btn primary"
        onclick={() => exportAs('gcode')}
        disabled={!ready || !onBed}
        aria-describedby={onBed ? undefined : 'off-bed'}
        title={onBed ? undefined : 'The sheet extends past the bed. Fix its position under Machine first.'}>Download gcode</button
      >
    </div>
  </header>

  <LeftPanel />
  <main class="center">
    <div class="pane" class:hidden={S.view.mode !== 'map'}>
      {#if mapMounted}
        {#await mapView! then { default: MapView }}
          <MapView visible={S.view.mode === 'map'} />
        {:catch}
          <p class="map-failed">The map could not be loaded. Check the connection and reload the page.</p>
        {/await}
      {/if}
    </div>
    <div class="pane" class:hidden={S.view.mode !== 'sheet'}><SheetView visible={S.view.mode === 'sheet'} /></div>
    {#if dragging}
      <div class="drop">Drop GPX files to add them as tracks, or a design file to open it</div>
    {/if}
  </main>
  <RightPanel bind:this={right} />
  <StatusBar />
</div>

<style>
  .app {
    height: 100%;
    display: grid;
    grid-template-columns: 272px minmax(0, 1fr) 300px;
    grid-template-rows: 52px minmax(0, 1fr) auto;
    grid-template-areas:
      'top top top'
      'left center right'
      'status status status';
  }
  .top {
    grid-area: top;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 12px 0 16px;
    background: var(--frame);
    border-bottom: 1px solid var(--rule);
    min-width: 0;
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex: none;
  }
  .tool {
    color: var(--ink-2);
    font-stretch: 80%;
    font-weight: 500;
    padding-left: 10px;
    border-left: 1px solid var(--rule);
  }
  .views {
    display: flex;
    background: var(--well);
    border: 1px solid var(--rule-soft);
    border-radius: var(--r-md);
    padding: 2px;
    flex: none;
  }
  .views button {
    background: none;
    border: 0;
    height: 28px;
    padding: 0 12px;
    border-radius: 4px;
    color: var(--ink-2);
    font-weight: 550;
    display: inline-flex;
    gap: 8px;
    align-items: center;
  }
  .views button.on {
    background: var(--frame-2);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--rule);
  }
  kbd {
    font: inherit;
    font-size: 10.5px;
    color: var(--ink-3);
    border: 1px solid var(--rule);
    border-radius: 3px;
    padding: 0 4px;
    line-height: 15px;
  }
  .top :global(.rack) {
    flex: 1;
    justify-content: flex-end;
  }
  .export {
    display: flex;
    gap: 6px;
    flex: none;
    padding-left: 12px;
    border-left: 1px solid var(--rule);
  }
  .app > :global(aside:first-of-type) {
    grid-area: left;
  }
  .app > :global(aside:last-of-type) {
    grid-area: right;
  }
  .app > :global(footer) {
    grid-area: status;
  }
  .center {
    grid-area: center;
    position: relative;
    background: var(--well);
    min-height: 0;
  }
  .pane {
    position: absolute;
    inset: 0;
  }
  .pane.hidden,
  .pane.hidden :global(*) {
    visibility: hidden !important;
    pointer-events: none;
  }
  .map-failed {
    margin: 0;
    padding: 24px;
    color: var(--danger);
  }
  .drop {
    position: absolute;
    inset: 12px;
    border: 2px dashed var(--lake);
    border-radius: var(--r-md);
    background: var(--scrim);
    display: grid;
    place-items: center;
    font-size: 15px;
    color: var(--lake);
    pointer-events: none;
  }

  @media (max-width: 1100px) {
    .app {
      grid-template-columns: 240px minmax(0, 1fr) 270px;
    }
    kbd {
      display: none;
    }
  }
  @media (max-width: 900px) {
    /* Let the window scroll, not body (fixed popovers follow window scrolling). */
    :global(html),
    :global(body),
    :global(#app) {
      height: auto;
      overflow: visible;
    }
    .app {
      height: auto;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto 70vh auto auto auto;
      grid-template-areas: 'top' 'center' 'left' 'right' 'status';
    }
    .top {
      flex-wrap: wrap;
      padding: 8px 16px;
      gap: 10px;
    }
    .top :global(.rack) {
      order: 5;
      flex-basis: 100%;
      flex-wrap: wrap;
      justify-content: flex-start;
      overflow: visible;
    }
    .export {
      border: 0;
      padding: 0;
      margin-left: auto;
    }
  }
</style>
