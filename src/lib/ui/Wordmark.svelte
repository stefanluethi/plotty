<script lang="ts">
  // "plotty" drawn with the same single-stroke font the plotter writes titles in.
  import { engine } from '../engine.svelte';
  import { renderText, textWidth } from '../plot/font';

  const font = $derived(engine.fonts['HersheyScript1']);
  const size = 10;
  const d = $derived.by(() => {
    if (!font) return '';
    return renderText(font, 'plotty', size, 1, size + 3)
      .map((l) => 'M' + l.map((v, i) => (i % 2 ? ',' : i ? 'L' : '') + v.toFixed(2)).join(''))
      .join('');
  });
  const w = $derived(font ? textWidth(font, 'plotty', size) + 3 : 40);
</script>

<span class="mark" aria-label="plotty">
  {#if d}
    <svg viewBox="0 0 {w} 19" height="30" aria-hidden="true">
      <path {d} fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  {:else}
    <span class="fallback">plotty</span>
  {/if}
</span>

<style>
  .mark {
    display: inline-flex;
    color: var(--ink);
  }
  svg {
    display: block;
    overflow: visible;
  }
  .fallback {
    font-size: 18px;
    font-weight: 300;
  }
</style>
