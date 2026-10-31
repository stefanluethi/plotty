<script lang="ts">
  import { S, engine } from '../engine.svelte';
  import { estimateMinutes, sheetOnBed } from '../export/export';
  import { swissNumber } from '../geo/lv95';

  const r = $derived(engine.result);
  const est = $derived(r ? estimateMinutes(S, r) : null);
  const st = $derived(r?.stats);
  const onBed = $derived(sheetOnBed(S));
  const time = $derived.by(() => {
    if (!est) return '–';
    const m = Math.round(est.minutes);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  });
</script>

<!-- Not a live region: these numbers change on every scrub step and pointer move. -->
<footer class="status">
  {#if engine.error}
    <span class="cell err" role="alert" title={engine.error}>{engine.error}</span>
  {:else if !onBed}
    <span class="cell warn" id="off-bed" role="alert">The sheet extends past the bed. Gcode export is off until it fits (Machine).</span>
  {:else if engine.warning}
    <span class="cell warn" role="status" title={engine.warning}>{engine.warning}</span>
  {:else}
    <span class="cell">
      <span class="k">Terrain</span>
      {#if st?.minElev != null}
        {swissNumber(st.minElev)}–{swissNumber(st.maxElev ?? 0)} m
      {:else}–{/if}
    </span>
    <span class="cell"><span class="k">Interval</span> {st?.interval ?? '–'} m</span>
    <span class="cell"><span class="k">Source</span> {st?.demSource ?? '–'}{st?.demCell ? `, ${Math.round(st.demCell)} m` : ''}</span>
  {/if}
  <span class="spacer"></span>
  {#if engine.composing}<span class="cell busy">Drawing</span>{/if}
  <span class="cell"><span class="k">Ink</span> {est ? (est.draw / 1000).toFixed(1) : '–'} m</span>
  <span class="cell"><span class="k">Pen-up</span> {est ? (est.travel / 1000).toFixed(1) : '–'} m, {est ? swissNumber(est.lifts) : '–'} lifts</span>
  <span class="cell"><span class="k">Plot time</span> {time}</span>
  <span class="cell coords" aria-hidden="true">
    {#if engine.cursor && S.view.mode === 'sheet'}X {engine.cursor[0].toFixed(1)} Y {engine.cursor[1].toFixed(1)}{/if}
  </span>
</footer>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 0;
    height: 28px;
    padding: 0 6px;
    background: var(--frame);
    border-top: 1px solid var(--rule);
    font-size: 12px;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
  }
  .cell {
    padding: 0 10px;
    border-right: 1px solid var(--rule-soft);
  }
  .cell:last-child {
    border-right: 0;
  }
  .k {
    color: var(--ink-3);
    font-stretch: 78%;
    margin-right: 3px;
  }
  .spacer {
    flex: 1;
  }
  .err,
  .warn {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .err {
    color: var(--danger);
  }
  .warn {
    color: var(--warn);
  }
  .busy {
    color: var(--lake);
  }
  .coords {
    min-width: 120px;
    color: var(--ink-2);
  }
  @media (max-width: 900px) {
    .status {
      overflow-x: auto;
    }
  }
</style>
