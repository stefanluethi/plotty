<script lang="ts">
  import { untrack } from 'svelte';
  import { S, engine } from './lib/engine.svelte';
  import { toGcode, toSvg, download } from './lib/export/export';
  import type { Settings } from './lib/settings';
  import Wordmark from './lib/ui/Wordmark.svelte';
  import PenRack from './lib/ui/PenRack.svelte';
  import LeftPanel from './lib/ui/LeftPanel.svelte';
  import RightPanel from './lib/ui/RightPanel.svelte';
  import MapView from './lib/ui/MapView.svelte';
  import SheetView from './lib/ui/SheetView.svelte';
  import StatusBar from './lib/ui/StatusBar.svelte';

  let right: RightPanel;

  // Persist, fetch data and redraw whenever settings change.
  $effect(() => {
    const snap = $state.snapshot(S) as Settings;
    untrack(() => {
      engine.save(snap);
      engine.requestDem(snap);
      engine.requestWater(snap);
      engine.compose(snap);
    });
  });

  const fileBase = $derived(
    (S.title.text || 'topo')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'topo',
  );

  function exportGcode() {
    if (engine.result) download(`${fileBase}.gcode`, toGcode(S, engine.result), 'text/plain');
  }
  function exportSvg() {
    if (engine.result) download(`${fileBase}.svg`, toSvg(S, engine.result), 'image/svg+xml');
  }

  let dragging = $state(false);
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files.length) right.importFiles(e.dataTransfer.files);
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'm') S.view.mode = 'map';
    else if (e.key === 's' && !e.ctrlKey && !e.metaKey) S.view.mode = 'sheet';
  }

  const ready = $derived(!!engine.result && engine.result.pens.length > 0);
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
    <div class="views" role="tablist" aria-label="View">
      <button role="tab" aria-selected={S.view.mode === 'map'} class:on={S.view.mode === 'map'} onclick={() => (S.view.mode = 'map')}
        >Map <kbd>M</kbd></button
      >
      <button
        role="tab"
        aria-selected={S.view.mode === 'sheet'}
        class:on={S.view.mode === 'sheet'}
        onclick={() => (S.view.mode = 'sheet')}>Sheet <kbd>S</kbd></button
      >
    </div>
    <PenRack />
    <div class="export">
      <button class="btn" onclick={exportSvg} disabled={!ready}>Download SVG</button>
      <button class="btn primary" onclick={exportGcode} disabled={!ready}>Download gcode</button>
    </div>
  </header>

  <LeftPanel />
  <main class="center">
    <div class="pane" class:hidden={S.view.mode !== 'map'}><MapView visible={S.view.mode === 'map'} /></div>
    <div class="pane" class:hidden={S.view.mode !== 'sheet'}><SheetView visible={S.view.mode === 'sheet'} /></div>
    {#if dragging}
      <div class="drop">Drop GPX files to add them as tracks</div>
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
  .drop {
    position: absolute;
    inset: 12px;
    border: 2px dashed var(--lake);
    border-radius: var(--r-md);
    background: rgba(31, 35, 39, 0.75);
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
    :global(html, body) {
      overflow: auto;
    }
    .app {
      height: auto;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto 70vh auto auto auto;
      grid-template-areas: 'top' 'center' 'right' 'left' 'status';
    }
    .top {
      flex-wrap: wrap;
      padding: 8px 16px;
      gap: 10px;
    }
    .top :global(.rack) {
      order: 5;
      flex-basis: 100%;
      justify-content: flex-start;
    }
    .export {
      border: 0;
      padding: 0;
      margin-left: auto;
    }
  }
</style>
