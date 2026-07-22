# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Browser-only Canvas 2D implementations of ten classic demoscene effects. There is no framework, no server, and no runtime dependency — the build produces plain `<script>`-loadable IIFE bundles that work both over HTTP and via `file://`. ES modules live in `src/`; the generated UMD-free IIFEs in `dist/` are committed and loaded by the HTML demos.

## Commands

```sh
npm install              # install esbuild (the only dev dependency)
npm run build            # rebuild dist/demoscene.js + dist/effects/*.js via esbuild
npm test                 # build, then run the Node test runner
npm run check            # alias of npm test
```

Run a single test file or name:

```sh
node --test tests/library.test.js
node --test --test-name-pattern="standalone bundles" tests/library.test.js
```

`npm test` always builds first because the suite loads the **generated bundles** (`dist/...`) into VM sandboxes — source changes are invisible to the tests until you rebuild. There are no unit tests against `src/` directly; `library.test.js` does import a few pure helpers (e.g. `mandelbrotScale`, `copperHue`, `packRgb`) directly from source.

## Architecture

Three layers, each cleanly separated:

1. **Runtime (`src/runtime.js`)** — `mountEffect(target, rendererFactory, options)`. Owns the `EffectController` (start/stop/resize/destroy), measures and resizes the canvas, drives a **single shared `requestAnimationFrame` loop** (stored on `globalThis[Symbol.for('demoscene-classics.runtime')]`), clamps per-frame `delta` to `MAX_DELTA_SECONDS = 0.05`, and feeds each active renderer `render({ time, delta })`. It also wires up `ResizeObserver`, viewport auto-pause via `IntersectionObserver` (preview only), and pointer events. The shared scheduler is why multiple effects on a page cost only **one** rAF tick — standalone bundles must continue to merge onto the same scheduler when loaded together (this is asserted by tests).

2. **Install (`src/install.js`)** — `installEffect(name, rendererFactory)` registers `Demoscene.<name>(target, options)` on the global namespace, merging into any existing `globalThis.Demoscene` object. This merging is what lets several standalone effect scripts coexist on one page.

3. **Effects (`src/effects/*.js`)** — each exports a `normalize<Name>Config(input)` function and a `create<Name>Renderer({ canvas, config })` factory returning an object with `render({ time, delta })` and optionally `resize(w, h)`, `pointer(x, y)`, and `destroy()`. Effects are pure Canvas 2D; they never touch rAF, sizing, or the DOM directly — that is all the runtime's job.

**The renderer contract** (enforced by `mountEffect`):
- `render({ time, delta })` is required.
- `resize`, `pointer`, `destroy` are optional and only called if present. A renderer that wants pointer input exposes `pointer(x, y)` (or `pointer(null, null)` on pointer-leave) and the runtime attaches the listeners.
- All animations must be driven by `time`/`delta`, never by frame count. `time`-based determinism is asserted: the same logical frame must be produced regardless of 60 Hz vs 120 Hz refresh.

**Structured skins (API v2):** every effect receives strict JSON-compatible groups such as `runtime`, `render`, `motion`, and `appearance`, plus effect-specific groups. `render.resolution` replaces hidden quality profiles and `runtime.pauseWhenHidden` controls viewport scheduling. Unknown keys fail with their full path. Options are immutable after mounting; change a skin by destroying and remounting the effect.

**Pixel effects** (plasma, fire, metaballs, tunnel, mandelbrot, rotozoom) render into an offscreen `ImageData`/`Uint32Array` pixel buffer via the helpers in `src/effects/utils.js` (`createPixelBuffer`, `resizePixelBuffer`, `presentPixelBuffer`, `packRgb`, `hslToPacked`) and upscale to the visible canvas with `imageSmoothingEnabled = false`. `packRgb` packs little-endian RGBA into one `Uint32`. Vector effects (starfield, sine-scroller, feedback, copper-bars) draw directly on the 2D context.

## Build

`scripts/build.mjs` clears `dist/`, then runs esbuild **twice**: once with all ten effects to produce `dist/demoscene.js`, and once per effect to produce `dist/effects/<name>.js`. Both are `format: 'iife'`, `target: ['es2020']`, `legalComments: 'none'`. When adding an effect, register it in the `effects` array in `scripts/build.mjs` (entry name, factory export name, output filename) — the build derives the synthetic entry source from that table.

## Conventions worth keeping

- The `Demoscene.*` public API and the controller method set (`start`/`stop`/`resize`/`destroy`) are part of the documented contract in `README.md`; the test suite enumerates and exercises all ten by name, so renaming or removing an effect requires updating the `effects` array, the README, and the HTML demo wiring in `index.html`.
- Keep `dist/` regenerated and committed alongside HTML changes; the `html-smoke` test loads the eleven HTML files (`index.html` + `01..10-*.html`) in a VM and flushes frames, and `file://` demos depend on those bundles being present.
- No lint or formatting tool is configured.
