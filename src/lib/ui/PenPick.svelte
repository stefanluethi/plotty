<script lang="ts">
  import { S } from '../engine.svelte';
  let { label = 'Pen', value = $bindable() }: { label?: string; value: string } = $props();
  const id = `p${Math.random().toString(36).slice(2, 8)}`;
  const pen = $derived(S.pens.find((p) => p.id === value) ?? S.pens[0]);
</script>

<div class="row">
  <label for={id} class="label">{label}</label>
  <div class="pick ctl">
    <span class="dot" style:background={pen?.color} style:--w="{Math.max(6, (pen?.width ?? 0.3) * 18)}px"></span>
    <select {id} bind:value>
      {#each S.pens as p, i (p.id)}
        <option value={p.id}>{i + 1}. {p.name} {p.width}</option>
      {/each}
    </select>
  </div>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 1fr minmax(0, 140px);
    align-items: center;
    gap: 8px;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 8px;
  }
  .dot {
    flex: none;
    width: var(--w);
    height: var(--w);
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25);
  }
  select {
    flex: 1;
    min-width: 0;
    background: none;
    border: 0;
    outline: none;
    height: 100%;
  }
  .pick:focus-within {
    border-color: var(--lake);
    box-shadow: 0 0 0 1px var(--lake);
  }
</style>
