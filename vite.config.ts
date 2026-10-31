import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves project sites under /<repo>/; the workflow passes that in.
  base: process.env.BASE_PATH ?? '/',
  plugins: [svelte()],
  // MapLibre loads its worker relative to its own module; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  worker: { format: 'es' },
});
