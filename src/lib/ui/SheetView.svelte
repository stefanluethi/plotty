<script lang="ts">
  import { onMount } from 'svelte';
  import { S, engine } from '../engine.svelte';
  import { paperToMachine, footprint } from '../export/export';
  import { paperSize } from '../settings';

  let { visible }: { visible: boolean } = $props();

  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let size = $state({ w: 800, h: 600 });
  // View: screen = (ox + X*k, oy - Y*k), machine mm with Y up.
  let view = $state({ k: 1, ox: 0, oy: 0 });
  let auto = $state<'sheet' | 'bed' | null>('sheet');

  const result = $derived(engine.result);

  const paths = $derived.by(() => {
    const r = result;
    if (!r) return { pens: [] as { color: string; width: number; path: Path2D }[], travel: null as Path2D | null };
    const pens = r.pens.map((pg) => {
      const pen = S.pens.find((p) => p.id === pg.penId);
      const path = new Path2D();
      for (const l of pg.lines) {
        path.moveTo(l[0], l[1]);
        for (let i = 2; i < l.length; i += 2) path.lineTo(l[i], l[i + 1]);
      }
      return { color: pen?.color ?? '#000', width: pen?.width ?? 0.3, path };
    });
    const travel = new Path2D();
    let cx = 0, cy = 0;
    for (const pg of r.pens)
      for (const l of pg.lines) {
        if (Math.hypot(l[0] - cx, l[1] - cy) > 0.02) {
          travel.moveTo(cx, cy);
          travel.lineTo(l[0], l[1]);
        }
        cx = l[l.length - 2];
        cy = l[l.length - 1];
      }
    return { pens, travel };
  });

  const sheet = $derived.by(() => {
    const [pw, ph] = paperSize(S);
    const fp = footprint(S, pw, ph);
    return { pw, ph, ...fp, x: S.machine.x, y: S.machine.y };
  });

  function fitTo(kind: 'sheet' | 'bed') {
    const pad = 48;
    const r =
      kind === 'bed'
        ? { x: -20, y: -20, w: S.machine.bedW + 40, h: S.machine.bedH + 40 }
        : { x: sheet.x - 12, y: sheet.y - 12, w: sheet.w + 24, h: sheet.h + 24 };
    const k = Math.min((size.w - pad * 2) / r.w, (size.h - pad * 2) / r.h);
    view = {
      k,
      ox: size.w / 2 - (r.x + r.w / 2) * k,
      oy: size.h / 2 + (r.y + r.h / 2) * k,
    };
    auto = kind;
  }

  $effect(() => {
    // Refit when the container or sheet changes, unless the user has panned/zoomed.
    size.w; size.h; sheet.w; sheet.h; sheet.x; sheet.y; S.machine.bedW; S.machine.bedH;
    if (auto) fitTo(auto);
  });

  onMount(() => {
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) size = { w: r.width, h: r.height };
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  });

  let raf = 0;
  $effect(() => {
    // Track everything draw() reads.
    paths; view; size; sheet; S.view.travel; S.machine.rotate; S.machine.flipY; S.machine.bedW; S.machine.bedH; visible;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  });

  function niceStep(k: number) {
    for (const s of [10, 20, 50, 100, 200]) if (s * k >= 60) return s;
    return 500;
  }

  function draw() {
    if (!canvas || !visible) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const css = getComputedStyle(wrap);
    const col = (n: string) => css.getPropertyValue(n).trim();
    const { k, ox, oy } = view;
    const m = S.machine;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = col('--well');
    ctx.fillRect(0, 0, size.w, size.h);

    const sx = (X: number) => ox + X * k;
    const sy = (Y: number) => oy - Y * k;

    // Bed plate
    ctx.fillStyle = col('--bed');
    ctx.fillRect(sx(0), sy(m.bedH), m.bedW * k, m.bedH * k);
    // Grid
    const minor = k * 10 >= 7;
    ctx.lineWidth = 1;
    for (let X = 0; X <= m.bedW; X += 10) {
      const major = X % 50 === 0;
      if (!major && !minor) continue;
      ctx.strokeStyle = major ? col('--bed-grid-major') : col('--bed-grid');
      ctx.beginPath();
      ctx.moveTo(Math.round(sx(X)) + 0.5, sy(0));
      ctx.lineTo(Math.round(sx(X)) + 0.5, sy(m.bedH));
      ctx.stroke();
    }
    for (let Y = 0; Y <= m.bedH; Y += 10) {
      const major = Y % 50 === 0;
      if (!major && !minor) continue;
      ctx.strokeStyle = major ? col('--bed-grid-major') : col('--bed-grid');
      ctx.beginPath();
      ctx.moveTo(sx(0), Math.round(sy(Y)) + 0.5);
      ctx.lineTo(sx(m.bedW), Math.round(sy(Y)) + 0.5);
      ctx.stroke();
    }
    // Rulers
    const step = niceStep(k);
    ctx.fillStyle = col('--ink-3');
    ctx.font = `500 11px ${col('--font')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let X = 0; X <= m.bedW; X += step) ctx.fillText(String(X), sx(X), sy(0) + 6);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let Y = step; Y <= m.bedH; Y += step) ctx.fillText(String(Y), sx(0) - 6, sy(Y));
    // Origin
    ctx.strokeStyle = col('--lake');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx(0), sy(0) - 14);
    ctx.lineTo(sx(0), sy(0));
    ctx.lineTo(sx(0) + 14, sy(0));
    ctx.stroke();

    // Sheet
    const px = sx(sheet.x), py = sy(sheet.y + sheet.h);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = col('--paper');
    ctx.fillRect(px, py, sheet.w * k, sheet.h * k);
    ctx.restore();
    // Sheet label
    ctx.fillStyle = col('--ink-2');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${sheet.pw} × ${sheet.ph} mm at X${sheet.x} Y${sheet.y}`, px, py - 6);

    // Lines, drawn in paper coordinates
    const tf = paperToMachine(S, sheet.pw, sheet.ph);
    const p0 = tf(0, 0), pxv = tf(1, 0), pyv = tf(0, 1);
    const a = (pxv[0] - p0[0]) * k, b = -(pxv[1] - p0[1]) * k;
    const c = (pyv[0] - p0[0]) * k, d = -(pyv[1] - p0[1]) * k;
    const e = sx(p0[0]), f = sy(p0[1]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, sheet.w * k, sheet.h * k);
    ctx.clip();
    ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const p of paths.pens) {
      ctx.strokeStyle = p.color;
      // Keep sub-pixel nibs visible when zoomed far out.
      ctx.lineWidth = Math.max(p.width, 0.6 / k);
      ctx.globalAlpha = p.width * k < 0.6 ? Math.max(0.35, (p.width * k) / 0.6) : 0.94;
      ctx.stroke(p.path);
    }
    ctx.globalAlpha = 1;
    if (S.view.travel && paths.travel) {
      ctx.strokeStyle = '#d0428a';
      ctx.lineWidth = 1 / k;
      ctx.setLineDash([4 / k, 3 / k]);
      ctx.stroke(paths.travel);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // Pan and zoom
  let pan: { x: number; y: number; ox: number; oy: number } | null = null;
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    const k = Math.min(200, Math.max(0.2, view.k * f));
    const X = (mx - view.ox) / view.k, Y = (view.oy - my) / view.k;
    view = { k, ox: mx - X * k, oy: my + Y * k };
    auto = null;
  }
  function down(e: PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    pan = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy };
    canvas.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    engine.cursor = [(e.clientX - r.left - view.ox) / view.k, (view.oy - (e.clientY - r.top)) / view.k];
    if (!pan) return;
    view = { ...view, ox: pan.ox + e.clientX - pan.x, oy: pan.oy + e.clientY - pan.y };
    auto = null;
  }
  function key(e: KeyboardEvent) {
    const d = 40;
    if (e.key === '+' || e.key === '=') view = { ...view, k: view.k * 1.25 };
    else if (e.key === '-') view = { ...view, k: view.k / 1.25 };
    else if (e.key === 'ArrowLeft') view = { ...view, ox: view.ox + d };
    else if (e.key === 'ArrowRight') view = { ...view, ox: view.ox - d };
    else if (e.key === 'ArrowUp') view = { ...view, oy: view.oy + d };
    else if (e.key === 'ArrowDown') view = { ...view, oy: view.oy - d };
    else return;
    e.preventDefault();
    auto = null;
  }

  const loading = $derived(engine.demLoading);
  const empty = $derived(result && !result.pens.length && !loading);
</script>

<div class="sheet" bind:this={wrap}>
  <canvas
    bind:this={canvas}
    style:width="{size.w}px"
    style:height="{size.h}px"
    onwheel={wheel}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={() => (pan = null)}
    onpointerleave={() => (engine.cursor = null)}
    ondblclick={() => fitTo('sheet')}
    onkeydown={key}
    tabindex="0"
    aria-label="Plot preview on the plotter bed. Scroll to zoom, drag to pan, double-click to fit."
  ></canvas>

  <div class="tools">
    <button class="btn" class:on={auto === 'sheet'} onclick={() => fitTo('sheet')}>Fit sheet</button>
    <button class="btn" class:on={auto === 'bed'} onclick={() => fitTo('bed')}>Fit bed</button>
    <label class="btn check">
      <input type="checkbox" bind:checked={S.view.travel} />
      Pen-up moves
    </label>
  </div>

  {#if loading}
    <div class="note" role="status">
      Loading {loading.label}{loading.total > 1 ? `, ${loading.done} of ${loading.total} tiles` : ''}
      <span class="bar"><span style:width="{(loading.done / Math.max(1, loading.total)) * 100}%"></span></span>
    </div>
  {:else if empty}
    <div class="note">Nothing to draw yet. Turn on a layer on the right, or move the area on the map to where there is terrain.</div>
  {/if}
</div>

<style>
  .sheet {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  canvas {
    display: block;
    cursor: grab;
    touch-action: none;
  }
  canvas:active {
    cursor: grabbing;
  }
  canvas:focus-visible {
    outline: 2px solid var(--lake);
    outline-offset: -2px;
  }
  .tools {
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .tools .btn {
    height: 26px;
    background: var(--frame);
    font-weight: 500;
  }
  .tools .btn.on {
    border-color: var(--lake);
    color: var(--lake);
  }
  .check {
    cursor: pointer;
  }
  .check input {
    accent-color: var(--lake);
    margin: 0;
  }
  .note {
    position: absolute;
    left: 50%;
    bottom: 18px;
    transform: translateX(-50%);
    max-width: min(440px, calc(100% - 32px));
    background: var(--frame);
    border: 1px solid var(--rule);
    border-radius: var(--r-md);
    padding: 10px 14px;
    color: var(--ink);
    display: grid;
    gap: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .bar {
    display: block;
    height: 3px;
    background: var(--frame-3);
    border-radius: 2px;
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--lake);
    transition: width 0.2s;
  }
</style>
