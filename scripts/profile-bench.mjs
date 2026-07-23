// Per-profile benchmark for issue #3. Resolves every effect × every
// (surface × device) profile and reports the resolved render resolution and
// the configured frame-rate budget (runtime.maxFps). This is the data recorded
// in the PR: composition is unchanged across profiles, while the responsive
// budgets (maxFps + render resolution) shift per the four-slot table.
//
// Runs against source definitions (no browser code executes at import time).
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const EFFECTS = [
  ['plasma', 'plasma/index.js', 'plasmaDefinition'],
  ['fire', 'fire/index.js', 'fireDefinition'],
  ['starfield', 'starfield/index.js', 'starfieldDefinition'],
  ['metaballs', 'metaballs/index.js', 'metaballsDefinition'],
  ['tunnel', 'tunnel/index.js', 'tunnelDefinition'],
  ['mandelbrot', 'mandelbrot/index.js', 'mandelbrotDefinition'],
  ['sineScroller', 'sine-scroller/index.js', 'sineScrollerDefinition'],
  ['rotozoom', 'rotozoom/index.js', 'rotozoomDefinition'],
  ['feedback', 'feedback/index.js', 'feedbackDefinition'],
  ['copperBars', 'copper-bars/index.js', 'copperBarsDefinition']
];

// Minimal mock so resolveDescriptor's device auto-detection works without a
// browser: resolveDevice falls back to desktop when matchMedia is unavailable.
globalThis.matchMedia = undefined;

const PROFILES = ['fullscreen.desktop', 'fullscreen.mobile', 'preview.desktop', 'preview.mobile'];
const rows = [];
for (const [name, module, exported] of EFFECTS) {
  const url = pathToFileURL(join(root, 'src', 'effects', module)).href;
  const definition = (await import(url))[exported];
  // Reach the resolver directly so we do not need a canvas/RAF environment.
  const { resolveDescriptor } = await import(pathToFileURL(join(root, 'src', 'resolver.js')).href);
  for (const slotKey of PROFILES) {
    const [surface, device] = slotKey.split('.');
    const { config } = resolveDescriptor(definition,
      { surface, device, config: { runtime: { autoStart: false } } });
    rows.push({
      effect: name,
      profile: slotKey,
      maxFps: config.runtime.maxFps,
      resolution: config.render.resolution
    });
  }
}

const header = '| effect | profile | maxFps | render.resolution |';
const sep = '|---|---|---:|---:|';
console.log(header);
console.log(sep);
for (const row of rows) {
  console.log(`| ${row.effect} | ${row.profile} | ${row.maxFps} | ${row.resolution} |`);
}
