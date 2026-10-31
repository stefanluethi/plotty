<script lang="ts">
  // Numeric field. Drag the label sideways to scrub the value.
  let {
    label,
    value = $bindable(),
    step = 1,
    min = -Infinity,
    max = Infinity,
    unit = '',
    digits = undefined as number | undefined,
    wide = false,
  }: {
    label: string;
    value: number;
    step?: number;
    min?: number;
    max?: number;
    unit?: string;
    digits?: number;
    wide?: boolean;
  } = $props();

  const id = `f${Math.random().toString(36).slice(2, 8)}`;
  const dec = $derived(digits ?? (step < 1 ? Math.min(3, Math.ceil(-Math.log10(step))) : 0));
  let text = $state('');
  let editing = $state(false);
  $effect(() => {
    if (!editing) text = Number.isFinite(value) ? value.toFixed(dec) : '';
  });

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  function commit() {
    const v = parseFloat(text.replace(',', '.').replace(/[’']/g, ''));
    if (Number.isFinite(v)) value = clamp(v);
    editing = false;
  }

  let scrub: { x: number; v: number } | null = null;
  function down(e: PointerEvent) {
    scrub = { x: e.clientX, v: value };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!scrub) return;
    const dx = e.clientX - scrub.x;
    const steps = Math.round(dx / (e.shiftKey ? 2 : 6));
    value = clamp(+(scrub.v + steps * step * (e.shiftKey ? 10 : 1)).toFixed(dec + 2));
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
      value = clamp(+(value + d).toFixed(dec + 2));
      editing = false;
    } else if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  }
</script>

<div class="field" class:wide>
  <label
    for={id}
    class="label scrub"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={() => (scrub = null)}
    title="Drag sideways to adjust">{label}</label
  >
  <div class="box ctl">
    <input
      {id}
      inputmode="decimal"
      bind:value={text}
      onfocus={() => (editing = true)}
      onblur={commit}
      onkeydown={key}
    />
    {#if unit}<span class="unit">{unit}</span>{/if}
  </div>
</div>

<style>
  .field {
    display: grid;
    grid-template-columns: 1fr 92px;
    align-items: center;
    gap: 8px;
  }
  .field.wide {
    grid-template-columns: 1fr 120px;
  }
  .scrub {
    cursor: ew-resize;
    user-select: none;
    touch-action: none;
  }
  .box {
    display: flex;
    align-items: center;
    padding-right: 6px;
  }
  input {
    width: 100%;
    min-width: 0;
    background: none;
    border: 0;
    outline: none;
    text-align: right;
    padding: 0;
  }
  .unit {
    white-space: nowrap;
    color: var(--ink-3);
    padding-left: 4px;
    font-size: 12px;
  }
  .box:focus-within {
    border-color: var(--lake);
    box-shadow: 0 0 0 1px var(--lake);
  }
</style>
