<script lang="ts">
  import * as maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import { onMount, untrack } from 'svelte';
  import { S, engine } from '../engine.svelte';
  import { computeLayout } from '../layout';
  import { toWGS, toLV95, swissNumber } from '../geo/lv95';

  let { visible }: { visible: boolean } = $props();

  let el: HTMLDivElement;
  let map: maplibregl.Map | null = $state(null);
  let tick = $state(0);

  const BASEMAPS = {
    grey: { layer: 'ch.swisstopo.pixelkarte-grau', ext: 'jpeg', label: 'Grey map' },
    color: { layer: 'ch.swisstopo.pixelkarte-farbe', ext: 'jpeg', label: 'Colour map' },
    aerial: { layer: 'ch.swisstopo.swissimage', ext: 'jpeg', label: 'Aerial' },
  } as const;
  const tiles = (k: keyof typeof BASEMAPS) =>
    `https://wmts.geo.admin.ch/1.0.0/${BASEMAPS[k].layer}/default/current/3857/{z}/{x}/{y}.${BASEMAPS[k].ext}`;

  const L = $derived(computeLayout(S));

  function project(e: number, n: number): [number, number] {
    const [lon, lat] = toWGS(e, n);
    const p = map!.project([lon, lat]);
    return [p.x, p.y];
  }

  const frame = $derived.by(() => {
    tick;
    if (!map) return null;
    const c = [
      project(L.west, L.north),
      project(L.east, L.north),
      project(L.east, L.south),
      project(L.west, L.south),
    ];
    return { c, d: `M${c.map((p) => p.join(',')).join('L')}Z` };
  });

  const tracks = $derived.by(() => {
    tick;
    if (!map) return [];
    return S.tracks
      .filter((t) => t.visible)
      .map((t) => {
        const color = S.pens.find((p) => p.id === t.pen)?.color ?? '#c43a2f';
        const d = t.segments
          .map((seg) => {
            const step = Math.max(2, Math.floor(seg.length / 2 / 1500) * 2);
            let s = '';
            for (let i = 0; i < seg.length; i += step) {
              const [x, y] = project(seg[i], seg[i + 1]);
              s += (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
            }
            return s;
          })
          .join('');
        return { id: t.id, d, color };
      });
  });

  function fit(animate = true) {
    if (!map) return;
    const pad = (L.east - L.west) * 0.35;
    const sw = toWGS(L.west - pad, L.south - pad);
    const ne = toWGS(L.east + pad, L.north + pad);
    map.fitBounds([sw, ne], { animate, duration: animate ? 600 : 0 });
  }

  // MapLibre looks for its worker next to its own module, which doesn't survive bundling.
  {
    const u = new URL(workerUrl, location.href);
    u.searchParams.set('v', maplibregl.getVersion());
    maplibregl.setWorkerUrl(u.href);
  }

  onMount(() => {
    map = new maplibregl.Map({
      container: el,
      style: {
        version: 8,
        sources: {
          base: {
            type: 'raster',
            tiles: [tiles(S.view.basemap)],
            tileSize: 256,
            maxzoom: 18,
            attribution: '© <a href="https://www.swisstopo.admin.ch" target="_blank" rel="noopener">swisstopo</a>',
          },
        },
        layers: [{ id: 'base', type: 'raster', source: 'base' }],
      },
      center: toWGS(S.area.e, S.area.n),
      zoom: 10,
      minZoom: 6,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
      maxBounds: [
        [4.5, 45.3],
        [11.8, 48.3],
      ],
    });
    map.touchZoomRotate.disableRotation();
    map.on('move', () => tick++);
    map.on('load', () => {
      fit(false);
      tick++;
    });
    return () => map?.remove();
  });

  // Basemap switch
  $effect(() => {
    const k = S.view.basemap;
    const m = untrack(() => map);
    if (!m || !m.isStyleLoaded()) return;
    (m.getSource('base') as maplibregl.RasterTileSource).setTiles([tiles(k)]);
  });

  $effect(() => {
    if (visible && map) {
      requestAnimationFrame(() => {
        map!.resize();
        tick++;
      });
    }
  });

  $effect(() => {
    if (engine.focusTick) untrack(() => fit(true));
  });

  // Dragging the frame moves the area; dragging a corner changes the scale.
  let drag: { kind: 'move' | 'scale'; e0: number; n0: number; ae: number; an: number } | null = null;
  function pointerLV(ev: PointerEvent): [number, number] {
    const r = el.getBoundingClientRect();
    const ll = map!.unproject([ev.clientX - r.left, ev.clientY - r.top]);
    return toLV95(ll.lng, ll.lat);
  }
  function start(ev: PointerEvent, kind: 'move' | 'scale') {
    if (!map || ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const [e, n] = pointerLV(ev);
    drag = { kind, e0: e, n0: n, ae: S.area.e, an: S.area.n };
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
  }
  function moveDrag(ev: PointerEvent) {
    if (!drag) return;
    const [e, n] = pointerLV(ev);
    if (drag.kind === 'move') {
      S.area.e = Math.round(drag.ae + (e - drag.e0));
      S.area.n = Math.round(drag.an + (n - drag.n0));
    } else {
      const sx = (Math.abs(e - S.area.e) * 2) / L.map.w;
      const sy = (Math.abs(n - S.area.n) * 2) / L.map.h;
      const scale = Math.max(sx, sy) * 1000;
      const nice = scale < 20000 ? 500 : scale < 100000 ? 1000 : 5000;
      S.area.scale = Math.min(1_000_000, Math.max(2000, Math.round(scale / nice) * nice));
    }
  }
  function end() {
    drag = null;
  }

  // The frame sits above the map to be draggable, so it would swallow the scroll
  // wheel. Hand wheel events on to the map so zooming works over the selection too.
  function forwardWheel(ev: WheelEvent) {
    if (!map) return;
    ev.preventDefault();
    map.getCanvas().dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: ev.deltaX, deltaY: ev.deltaY, deltaZ: ev.deltaZ, deltaMode: ev.deltaMode,
        clientX: ev.clientX, clientY: ev.clientY, screenX: ev.screenX, screenY: ev.screenY,
        ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey, altKey: ev.altKey, metaKey: ev.metaKey,
        bubbles: true, cancelable: true,
      }),
    );
  }

  const sizeLabel = $derived(
    `1:${swissNumber(S.area.scale)}, ${((L.east - L.west) / 1000).toFixed(1)} × ${((L.north - L.south) / 1000).toFixed(1)} km`,
  );
</script>

<div class="wrap" class:grey={S.view.basemap === 'grey'}>
  <div class="map" bind:this={el}></div>

  {#if frame}
    <svg class="overlay" aria-hidden="true">
      <defs>
        <mask id="outside">
          <rect width="100%" height="100%" fill="white" />
          <path d={frame.d} fill="black" />
        </mask>
      </defs>
      <rect class="dim" width="100%" height="100%" mask="url(#outside)" />
      {#each tracks as t (t.id)}
        <path d={t.d} fill="none" stroke={t.color} stroke-width="2.5" stroke-linejoin="round" />
      {/each}
      <path
        class="frame"
        d={frame.d}
        onpointerdown={(e) => start(e, 'move')}
        onpointermove={moveDrag}
        onpointerup={end}
        onwheel={forwardWheel}
        role="presentation"
      />
      {#each frame.c as [x, y], i (i)}
        <rect
          class="handle"
          x={x - 6}
          y={y - 6}
          width="12"
          height="12"
          onpointerdown={(e) => start(e, 'scale')}
          onpointermove={moveDrag}
          onpointerup={end}
          onwheel={forwardWheel}
          role="presentation"
        />
      {/each}
      <text x={frame.c[0][0]} y={frame.c[0][1] - 9} class="tag">{sizeLabel}</text>
    </svg>
  {/if}

  <div class="tools">
    <div class="seg" role="radiogroup" aria-label="Basemap">
      {#each Object.entries(BASEMAPS) as [k, b] (k)}
        <button
          role="radio"
          aria-checked={S.view.basemap === k}
          class:on={S.view.basemap === k}
          onclick={() => (S.view.basemap = k as any)}>{b.label}</button
        >
      {/each}
    </div>
    <button class="btn" onclick={() => fit(true)}>Show selection</button>
  </div>
  <p class="help">Drag the frame to move it, drag a corner to change the scale.</p>
</div>

<style>
  .wrap {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .map {
    position: absolute;
    inset: 0;
  }
  .wrap.grey :global(.maplibregl-canvas) {
    filter: invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.82) saturate(0.6);
  }
  .wrap:not(.grey) :global(.maplibregl-canvas) {
    filter: brightness(0.82) saturate(0.85);
  }
  .wrap :global(.maplibregl-ctrl-attrib) {
    background: var(--scrim);
    color: var(--ink-2);
  }
  .wrap :global(.maplibregl-ctrl-attrib a) {
    color: var(--ink-2);
  }
  .overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .dim {
    fill: var(--dim);
  }
  .frame {
    fill: var(--lake-wash);
    stroke: var(--lake);
    stroke-width: 1.5;
    pointer-events: all;
    cursor: move;
    touch-action: none;
  }
  .handle {
    fill: var(--well);
    stroke: var(--lake);
    stroke-width: 1.5;
    pointer-events: all;
    cursor: nwse-resize;
    touch-action: none;
  }
  .tag {
    fill: var(--lake);
    font-size: 12px;
    font-weight: 560;
    paint-order: stroke;
    stroke: var(--well);
    stroke-width: 3px;
  }
  .tools {
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .seg {
    display: flex;
    background: var(--frame);
    border: 1px solid var(--rule);
    border-radius: var(--r-sm);
    padding: 2px;
  }
  .seg button {
    background: none;
    border: 0;
    height: 22px;
    padding: 0 9px;
    border-radius: 2px;
    color: var(--ink-2);
  }
  .seg button.on {
    background: var(--frame-3);
    color: var(--ink);
  }
  .help {
    position: absolute;
    left: 12px;
    bottom: 6px;
    margin: 0;
    color: var(--ink-2);
    font-size: 12px;
    background: var(--scrim);
    padding: 3px 8px;
    border-radius: var(--r-sm);
    pointer-events: none;
  }
</style>
