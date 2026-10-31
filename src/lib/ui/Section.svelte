<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    title,
    open = $bindable(true),
    enabled = $bindable(undefined),
    meta = '',
    children,
  }: { title: string; open?: boolean; enabled?: boolean; meta?: string; children: Snippet } = $props();
  const id = `sec${Math.random().toString(36).slice(2, 8)}`;
</script>

<section class:off={enabled === false}>
  <header>
    <button class="head" aria-expanded={open} aria-controls={id} onclick={() => (open = !open)}>
      <svg class="chev" class:open width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
        ><path d="M3 2 L7 5 L3 8" fill="none" stroke="currentColor" stroke-width="1.4" /></svg
      >
      <span class="title">{title}</span>
      {#if meta}<span class="meta">{meta}</span>{/if}
    </button>
    {#if enabled !== undefined}
      <label class="en" title={enabled ? `Hide ${title.toLowerCase()}` : `Show ${title.toLowerCase()}`}>
        <input type="checkbox" bind:checked={enabled} aria-label="Draw {title.toLowerCase()}" />
        <span class="box" aria-hidden="true"></span>
      </label>
    {/if}
  </header>
  {#if open}
    <div class="body" {id}>
      {@render children()}
    </div>
  {/if}
</section>

<style>
  section {
    border-bottom: 1px solid var(--rule-soft);
  }
  header {
    display: flex;
    align-items: center;
    padding-right: 12px;
  }
  .head {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: 0;
    padding: 11px 12px;
    text-align: left;
  }
  .chev {
    color: var(--ink-3);
    transition: transform 0.12s;
  }
  .chev.open {
    transform: rotate(90deg);
  }
  .title {
    font-weight: 620;
    font-stretch: 92%;
    font-size: 13.5px;
  }
  .meta {
    margin-left: auto;
    color: var(--ink-3);
    font-size: 12px;
  }
  .off .title {
    color: var(--ink-3);
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 7px;
    padding: 0 12px 14px 30px;
  }
  .off .body {
    opacity: 0.55;
  }
  .en {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    margin-right: -5px;
    cursor: pointer;
  }
  .en input {
    position: absolute;
    opacity: 0;
    inset: 0;
    cursor: pointer;
  }
  .box {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1.5px solid var(--ink-3);
  }
  .en input:checked + .box {
    background: var(--lake);
    border-color: var(--lake);
    box-shadow: inset 0 0 0 2px var(--frame);
  }
  .en input:focus-visible + .box {
    outline: 2px solid var(--lake);
    outline-offset: 2px;
  }
</style>
