#!/usr/bin/env node
// maplibre-gl's tile worker (maplibre-gl-worker.mjs) is loaded as a standalone
// script, not bundled by Vite/Rollup — and it does `import ... from
// "./maplibre-gl-shared.mjs"`, a relative import to an exact, unhashed sibling
// filename baked into the prebuilt file. Vite's `?url` asset copying doesn't
// rewrite that import, so the two files have to sit side by side with their
// original names for the worker to actually load. Vendoring them into
// public/vendor/ (served at a stable, unhashed path) is the simplest way to
// satisfy that — this runs automatically before `dev` and `build` so it can
// never drift from whatever maplibre-gl version is installed.

import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'node_modules', 'maplibre-gl', 'dist');
const DEST = join(__dirname, '..', 'public', 'vendor');

const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

await mkdir(DEST, { recursive: true });
for (const f of FILES) {
  await copyFile(join(SRC, f), join(DEST, f));
}
console.log(`Vendored ${FILES.join(', ')} into public/vendor/`);
