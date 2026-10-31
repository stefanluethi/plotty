<script lang="ts">
  import { S } from '../engine.svelte';
  import { uid } from '../settings';
  import { tick } from 'svelte';
  import Field from './Field.svelte';

  let editing = $state<string | null>(null);
  let pop = $state<HTMLDivElement>();
  let nameInput = $state<HTMLInputElement>();
  let at = $state({ top: 0, left: 0 });
  const chips: Record<string, HTMLButtonElement> = {};

  // Open under its chip, kept inside the window.
  function place() {
    const chip = editing ? chips[editing] : null;
    if (!chip) return;
    const r = chip.getBoundingClientRect();
    const w = Math.min(280, window.innerWidth - 32);
    at = { top: r.bottom + 6, left: Math.max(16, Math.min(r.left, window.innerWidth - w - 16)) };
  }
  async function open(id: string) {
    editing = id;
    place();
    await tick();
    nameInput?.focus();
  }
  function close() {
    const id = editing;
    editing = null;
    if (id) chips[id]?.focus();
  }
  function onPointer(e: PointerEvent) {
    const t = e.target as Node;
    if (editing && pop && !pop.contains(t) && !Object.values(chips).some((c) => c?.contains(t))) editing = null;
  }
  const pen = $derived(S.pens.find((p) => p.id === editing));
  const idx = $derived(S.pens.findIndex((p) => p.id === editing));

  function add() {
    const p = { id: uid(), name: 'New pen', color: '#3a7d44', width: 0.4 };
    S.pens.push(p);
    open(p.id);
  }
  function move(d: number) {
    const i = idx, j = i + d;
    if (j < 0 || j >= S.pens.length) return;
    const [p] = S.pens.splice(i, 1);
    S.pens.splice(j, 0, p);
    tick().then(place);
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
    tick().then(() => chips[fallback]?.focus());
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && editing) close();
  }
</script>

<svelte:window onkeydown={onKey} onpointerdown={onPointer} onresize={place} onscroll={place} />

<div class="rack" role="group" aria-label="Pens in plotting order">
  {#each S.pens as p, i (p.id)}
    <button
      class="pen"
      class:active={editing === p.id}
      bind:this={chips[p.id]}
      onclick={() => (editing === p.id ? close() : open(p.id))}
      aria-expanded={editing === p.id}
      aria-controls={editing === p.id ? 'pen-editor' : undefined}
      aria-label="Pen {i + 1}: {p.name}, {p.width} mm"
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
    <div
      class="pop"
      id="pen-editor"
      role="dialog"
      aria-labelledby="pen-editor-title"
      bind:this={pop}
      style:top="{at.top}px"
      style:left="{at.left}px"
    >
      <div class="pop-head">
        <span class="label" id="pen-editor-title">Pen {idx + 1} of {S.pens.length}, plotted in this order</span>
        <button class="btn ghost x" onclick={close} aria-label="Close">×</button>
      </div>
      <label class="row">
        <span class="label">Name</span>
        <input class="ctl" bind:value={pen.name} bind:this={nameInput} maxlength="40" />
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
    flex: none;
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
    color: var(--ink-2);
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
    max-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .width {
    color: var(--ink-2);
    font-size: 12px;
  }
  .pop {
    position: fixed;
    z-index: 50;
    width: min(280px, calc(100vw - 32px));
    display: grid;
    gap: 8px;
    padding: 12px;
    background: var(--frame);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-pop);
  }
  .pop-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .x {
    height: 24px;
    min-width: 24px;
    justify-content: center;
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
</style>
