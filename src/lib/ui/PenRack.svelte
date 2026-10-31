<script lang="ts">
  import { S } from '../engine.svelte';
  import { uid } from '../settings';
  import Field from './Field.svelte';

  let editing = $state<string | null>(null);
  const pen = $derived(S.pens.find((p) => p.id === editing));
  const idx = $derived(S.pens.findIndex((p) => p.id === editing));

  function add() {
    const p = { id: uid(), name: 'New pen', color: '#3a7d44', width: 0.4 };
    S.pens.push(p);
    editing = p.id;
  }
  function move(d: number) {
    const i = idx, j = i + d;
    if (j < 0 || j >= S.pens.length) return;
    const [p] = S.pens.splice(i, 1);
    S.pens.splice(j, 0, p);
  }
  function remove() {
    if (S.pens.length <= 1 || !pen) return;
    const id = pen.id;
    S.pens.splice(idx, 1);
    const fallback = S.pens[0].id;
    // Reassign anything that used this pen.
    const fix = (o: any) => {
      for (const k of Object.keys(o)) {
        if (k === 'pen' && o[k] === id) o[k] = fallback;
        else if (o[k] && typeof o[k] === 'object' && k !== 'segments') fix(o[k]);
      }
    };
    fix(S);
    editing = null;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') editing = null;
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="rack" role="group" aria-label="Pens in plotting order">
  {#each S.pens as p, i (p.id)}
    <button
      class="pen"
      class:active={editing === p.id}
      onclick={() => (editing = editing === p.id ? null : p.id)}
      title="Edit pen {i + 1}"
    >
      <span class="order">{i + 1}</span>
      <span class="nib" style:background={p.color} style:--w="{Math.max(4, p.width * 14)}px"></span>
      <span class="name">{p.name}</span>
      <span class="width">{p.width}</span>
    </button>
  {/each}
  <button class="add btn ghost" onclick={add} title="Add a pen">+ Pen</button>

  {#if pen}
    <div class="pop" role="dialog" aria-label="Edit pen">
      <div class="pop-head">
        <span class="label">Pen {idx + 1} of {S.pens.length}, plotted in this order</span>
        <button class="btn ghost x" onclick={() => (editing = null)} aria-label="Close">×</button>
      </div>
      <label class="row">
        <span class="label">Name</span>
        <input class="ctl" bind:value={pen.name} />
      </label>
      <label class="row">
        <span class="label">Color</span>
        <span class="color ctl">
          <input type="color" bind:value={pen.color} />
          <span>{pen.color}</span>
        </span>
      </label>
      <Field label="Line width" bind:value={pen.width} step={0.05} min={0.05} max={3} unit="mm" />
      <div class="actions">
        <button class="btn" onclick={() => move(-1)} disabled={idx === 0}>Plot earlier</button>
        <button class="btn" onclick={() => move(1)} disabled={idx === S.pens.length - 1}>Plot later</button>
        <button class="btn ghost danger" onclick={remove} disabled={S.pens.length <= 1}>Remove</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .rack {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: 4px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .pen {
    display: grid;
    grid-template-columns: auto auto auto auto;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 10px 0 8px;
    background: var(--frame-2);
    border: 1px solid var(--rule-soft);
    border-radius: var(--r-md);
    white-space: nowrap;
  }
  .pen:hover {
    border-color: var(--rule);
  }
  .pen.active {
    border-color: var(--lake);
  }
  .order {
    color: var(--ink-3);
    font-size: 11px;
    font-stretch: 75%;
  }
  .nib {
    width: var(--w);
    height: 18px;
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
  }
  .name {
    font-weight: 550;
    font-stretch: 88%;
  }
  .width {
    color: var(--ink-2);
    font-size: 12px;
  }
  .pop {
    position: fixed;
    top: 52px;
    right: 200px;
    z-index: 50;
    width: 280px;
    display: grid;
    gap: 8px;
    padding: 12px;
    background: var(--frame);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  }
  .pop-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .x {
    height: 22px;
    padding: 0 6px;
    font-size: 16px;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 140px;
    align-items: center;
    gap: 8px;
  }
  .color {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 3px;
  }
  .color input {
    width: 22px;
    height: 18px;
    padding: 0;
    border: 0;
    background: none;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .danger {
    color: var(--danger);
    margin-left: auto;
  }
  @media (max-width: 900px) {
    .pop {
      right: 16px;
      left: 16px;
      width: auto;
    }
  }
</style>
