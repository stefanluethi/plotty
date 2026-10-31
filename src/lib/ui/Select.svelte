<script lang="ts" generics="T extends string | number">
  let {
    label,
    value = $bindable(),
    options,
  }: { label: string; value: T; options: { value: T; label: string }[] } = $props();
  const id = `s${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="row">
  <label for={id} class="label">{label}</label>
  <select {id} class="ctl" bind:value>
    {#each options as o (o.value)}
      <option value={o.value}>{o.label}</option>
    {/each}
  </select>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 1fr minmax(0, 140px);
    align-items: center;
    gap: 8px;
  }
  select {
    width: 100%;
  }
</style>
