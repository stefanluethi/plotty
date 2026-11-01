<script lang="ts">
  import type { HatchPattern, HatchKind } from '../settings';
  import Field from './Field.svelte';
  import Select from './Select.svelte';

  // Pattern, spacing and angle for a hatched area, shared by lakes, forest and buildings.
  let {
    pattern = $bindable(),
    spacing = $bindable(),
    angle = $bindable(),
    minSpacing = 0.2,
    maxSpacing = 10,
  }: { pattern: HatchPattern; spacing: number; angle: number; minSpacing?: number; maxSpacing?: number } = $props();

  const KINDS: { value: HatchKind; label: string }[] = [
    { value: 'lines', label: 'Lines' },
    { value: 'cross', label: 'Cross-hatch' },
    { value: 'dashes', label: 'Dashes' },
    { value: 'waves', label: 'Waves' },
    { value: 'zigzag', label: 'Zigzag' },
  ];
</script>

<Select label="Pattern" bind:value={pattern.kind} options={KINDS} />
<Field label="Spacing" bind:value={spacing} step={0.1} min={minSpacing} max={maxSpacing} unit="mm" />
<Field label="Angle" bind:value={angle} step={15} min={-180} max={180} unit="°" />
{#if pattern.kind === 'cross'}
  <Field label="Cross at" bind:value={pattern.cross} step={15} min={5} max={90} unit="°" />
{:else if pattern.kind === 'dashes'}
  <Field label="Dash" bind:value={pattern.dash} step={0.1} min={0.1} max={10} unit="mm" />
  <Field label="Gap" bind:value={pattern.gap} step={0.1} min={0.1} max={10} unit="mm" />
  <p class="hint">Every other row is shifted by half, like brickwork. Every dash is a pen lift.</p>
{:else if pattern.kind === 'waves' || pattern.kind === 'zigzag'}
  <Field label="Wave height" bind:value={pattern.height} step={0.1} min={0} max={10} unit="mm" wide />
  <Field label="Wavelength" bind:value={pattern.length} step={0.25} min={0.25} max={50} unit="mm" wide />
{/if}
