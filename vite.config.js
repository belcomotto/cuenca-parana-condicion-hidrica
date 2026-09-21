import { defineConfig } from 'vite';

export default defineConfig({
  // maplibre-gl loads its tile-parsing worker via `new Worker(new URL(...))`.
  // Vite's dev-time dependency pre-bundler mangles that URL, so the worker
  // 404s and no vector tiles (or our GeoJSON source) ever render. Excluding
  // the package from pre-bundling lets it load straight from node_modules,
  // where the worker URL resolves correctly.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
});
