<script lang="ts">
  import { tick } from 'svelte';
  import { S } from '../engine.svelte';
  import { designs, FILE_EXT, type Design } from '../designs.svelte';
  import { download } from '../export/export';
  import { swissNumber } from '../geo/lv95';
  import { paperSize } from '../settings';

  let isOpen = $state(false);
  let button = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let nameInput = $state<HTMLInputElement>();
  let fileInput = $state<HTMLInputElement>();
  let at = $state({ top: 0, left: 0 });
  let name = $state('');
  let busy = $state(false);
  // The name box follows the design being worked on (saved, opened or brought back by Undo).
  $effect(() => {
    name = designs.name ?? (S.title.text.trim() || 'Untitled');
  });

  function place() {
    if (!button || !isOpen) return;
    const r = button.getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 32);
    at = { top: r.bottom + 6, left: Math.max(16, Math.min(r.left, window.innerWidth - w - 16)) };
  }
  export async function open(focusName = true) {
    isOpen = true;
    place();
    await tick();
    if (focusName) nameInput?.select();
  }
  function close() {
    isOpen = false;
    designs.notice = null;
    button?.focus();
  }
  function onPointer(e: PointerEvent) {
    const t = e.target as Node;
    if (isOpen && pop && !pop.contains(t) && !button?.contains(t)) {
      isOpen = false;
      designs.notice = null;
    }
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && isOpen) close();
    // Ctrl+S saves the current design, or asks for a name the first time.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (designs.name != null && designs.available && !isOpen) designs.save(designs.name);
      else if (!isOpen) open();
      else save();
    }
  }

  // Saving over the design being worked on is a plain save; over another one, say so.
  const replaces = $derived.by(() => {
    const n = name.trim().toLowerCase();
    if (!n || n === designs.name?.trim().toLowerCase()) return undefined;
    return designs.find(name);
  });
  async function save() {
    if (busy || !designs.available) return;
    busy = true;
    try {
      await designs.save(name);
    } finally {
      busy = false;
    }
  }
  async function toFile() {
    busy = true;
    try {
      const f = await designs.toFile(name);
      download(f.file, f.text, 'application/json');
    } finally {
      busy = false;
    }
  }
  /** Open a design file (from the picker or dropped on the window) and show what happened. */
  export async function openFile(f: File) {
    await designs.fromFile(f);
    if (!isOpen) await open(false);
  }
  async function onPick(e: Event) {
    const inp = e.currentTarget as HTMLInputElement;
    const f = inp.files?.[0];
    inp.value = '';
    if (f) await openFile(f);
  }

  const when = (t: number) => {
    const d = new Date(t);
    const today = new Date().toDateString() === d.toDateString();
    return today
      ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  };
  const summary = (d: Design) => {
    const s = d.settings;
    const sheet = s.paper.preset === 'custom' ? `${Math.round(s.paper.w)} × ${Math.round(s.paper.h)}` : s.paper.preset === '50x70' ? '50 × 70' : s.paper.preset;
    return `1:${swissNumber(s.area.scale)}, ${sheet}`;
  };

  const label = $derived(designs.name ?? 'Designs');
</script>

<svelte:window onkeydown={onKey} onpointerdown={onPointer} onresize={place} onscroll={place} />

<button
  class="trigger"
  class:active={isOpen}
  bind:this={button}
  onclick={() => (isOpen ? close() : open())}
  aria-expanded={isOpen}
  aria-controls={isOpen ? 'design-menu' : undefined}
  aria-label="Designs{designs.name ? `: ${designs.name}${designs.dirty ? ', changed since saved' : ''}` : ''}"
  title={designs.name ? (designs.dirty ? 'Changed since saved. Ctrl+S saves.' : 'Saved') : 'Save and open designs'}
>
  <span class="name">{label}</span>
  {#if designs.flash}
    <span class="flash">{designs.flash}</span>
  {:else if designs.dirty}
    <span class="dot" aria-hidden="true"></span>
  {/if}
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
    ><path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" stroke-width="1.4" /></svg
  >
</button>
<span class="sr-only" role="status">{designs.flash ? `${designs.flash} ${designs.name ?? ''}` : ''}</span>

{#if isOpen}
  <div class="pop" id="design-menu" role="dialog" aria-labelledby="design-menu-title" bind:this={pop} style:top="{at.top}px" style:left="{at.left}px">
    <div class="pop-head">
      <span class="label" id="design-menu-title">Designs</span>
      <button class="btn ghost x" onclick={close} aria-label="Close">×</button>
    </div>

    <form
      class="save"
      onsubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input class="ctl" bind:value={name} bind:this={nameInput} maxlength="80" aria-label="Design name" placeholder="Design name" />
      <button class="btn" type="submit" disabled={busy || !designs.available}>{replaces ? 'Replace' : 'Save'}</button>
    </form>
    {#if !designs.available}
      <p class="hint warn">This browser doesn't allow keeping designs. Save them to files instead.</p>
    {:else if replaces}
      <p class="hint">Replaces the saved “{replaces.name}” from {when(replaces.saved)}.</p>
    {/if}

    {#if designs.notice}
      <div class="notice" class:error={designs.notice.tone === 'error'} role={designs.notice.tone === 'error' ? 'alert' : 'status'}>
        <span>{designs.notice.text}</span>
        {#if designs.notice.undo}<button class="btn ghost undo" onclick={designs.notice.undo}>Undo</button>{/if}
      </div>
    {/if}

    {#if designs.list.length}
      <ul class="list" aria-label="Saved in this browser">
        {#each designs.list as d (d.id)}
          <li class:current={d.name === designs.name}>
            <button class="open" onclick={() => designs.open(d)} title="Open {d.name}">
              <span class="thumb">
                {#if d.thumb}<img src={d.thumb} alt="" />{/if}
              </span>
              <span class="text">
                <span class="dname">{d.name}</span>
                <span class="detail">{summary(d)} · {when(d.saved)}</span>
              </span>
            </button>
            <button class="btn ghost x del" onclick={() => designs.remove(d)} aria-label="Delete {d.name}" title="Delete">×</button>
          </li>
        {/each}
      </ul>
    {:else if designs.available}
      <p class="hint">No designs saved in this browser yet.</p>
    {/if}

    <div class="files">
      <button class="btn" onclick={toFile} disabled={busy}>Save to file</button>
      <button class="btn" onclick={() => fileInput?.click()}>Open file…</button>
      <input type="file" accept="{FILE_EXT},.json,application/json" bind:this={fileInput} onchange={onPick} hidden />
    </div>
    <p class="hint">Machine settings stay as they are when you open a design. You can also drop a design file on the window.</p>
  </div>
{/if}

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 9px 0 10px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    color: var(--ink-2);
    font-weight: 550;
    min-width: 0;
    flex: none;
  }
  .trigger:hover {
    background: var(--frame-2);
    color: var(--ink);
  }
  .trigger.active {
    border-color: var(--lake);
    color: var(--ink);
  }
  .name {
    max-width: 18ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ink-2);
  }
  .flash {
    font-size: 12px;
    font-weight: 400;
    color: var(--lake);
  }
  .pop {
    position: fixed;
    z-index: 50;
    width: min(340px, calc(100vw - 32px));
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--rule) transparent;
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
  .save {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 6px;
  }
  .save .ctl {
    height: 28px;
  }
  .hint {
    margin: 0;
  }
  .warn {
    color: var(--warn);
  }
  .notice {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 9px;
    background: var(--frame-2);
    border: 1px solid var(--rule-soft);
    border-radius: var(--r-sm);
    font-size: 12px;
  }
  .notice span {
    flex: 1;
  }
  .notice.error {
    color: var(--danger);
  }
  .undo {
    height: 24px;
    color: var(--lake);
  }
  .list {
    list-style: none;
    margin: 0 -4px;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: var(--r-sm);
  }
  .list li:hover {
    background: var(--frame-2);
  }
  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px;
    background: none;
    border: 0;
    border-radius: var(--r-sm);
    text-align: left;
  }
  .thumb {
    flex: none;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
  }
  .thumb img {
    max-width: 40px;
    max-height: 40px;
    box-shadow: 0 0 0 1px var(--rule);
  }
  .text {
    min-width: 0;
    display: grid;
  }
  .dname {
    font-weight: 550;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .current .dname {
    color: var(--lake);
  }
  .detail {
    color: var(--ink-2);
    font-size: 11.5px;
  }
  .del {
    margin-right: 4px;
  }
  .files {
    display: flex;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--rule-soft);
  }
</style>
