# Authoring skins, profiles, and effects (API v3)

This guide is for contributors. It documents the **per-effect folder contract**,
the boundaries between renderer / config / skins / profiles, and how to add a
new effect that fits the API v3 architecture.

Read [`docs/api-v3.md`](api-v3.md) first for the public descriptor, the merge
contract, and the four profile slots — this guide builds on it.

## The per-effect folder contract

Every effect owns an isolated package under `src/effects/<name>/`:

```text
src/effects/<name>/
  index.js        # effect definition consumed by the shared installer
  renderer.js     # the algorithm — Canvas 2D only; never touches rAF/DOM/sizing
  config.js       # defaults + validation (algorithmic identity)
  skins.js        # named visual presets ('classic')
  profiles.js     # four (surface × device) profile slots (budgets)
```

Some effects add an internal helper module (`fire/sim.js`,
`mandelbrot/mandelbrot-core.js`, `mandelbrot/mandelbrot-webgl.js`). Those are
private to the effect and never imported across effects.

### `index.js` — the effect definition

Exports a single definition object consumed by the shared installer
(`src/install.js`). The shape is enforced by `tests/library.test.js`:

```js
import { createFireRenderer } from './renderer.js';
import { FIRE_DEFAULTS, validateFire } from './config.js';
import { FIRE_SKINS } from './skins.js';
import { FIRE_PROFILES } from './profiles.js';

export const fireDefinition = {
  name: 'fire',                 // public function name: Demoscene.fire
  rendererFactory: createFireRenderer,
  configDefaults: FIRE_DEFAULTS, // plain object (cloned+frozen by the resolver)
  validate: validateFire,        // (config) => void; throws on bad resolved config
  skins: FIRE_SKINS,             // { classic: { ... } }
  profiles: FIRE_PROFILES,       // buildProfiles({ 'fullscreen.desktop': {...}, ... })
  capabilities: {
    // Groups a skin is allowed to touch. Every shipped effect uses exactly
    // these four. Algorithmic groups are deliberately excluded.
    skinAllow: new Set(['runtime', 'render', 'motion', 'appearance'])
  }
};
```

Required keys: `name`, `rendererFactory`, `configDefaults`, `validate`, `skins`
(must include `'classic'`), `profiles` (must expose `surfaces`, `devices`,
`slots`), and `capabilities.skinAllow` (a `Set` containing at least
`runtime`, `render`, `motion`, `appearance`).

Optional: `validateInput(name, explicit)` — a pre-merge hook that runs on the
**raw caller `config` object** before any merge, for constraints that cannot be
checked on the merged result (e.g. mutually-exclusive options).

### `renderer.js` — algorithm only

The renderer factory receives `{ canvas, config }` (config already resolved and
frozen) and returns an object with the runtime contract:

```js
export function createFireRenderer({ canvas, config }) {
  return {
    render({ time, delta }) { /* required: draw one frame */ },
    resize(w, h) { /* optional: backing store reallocated */ },
    pointer(x, y) { /* optional: pointer input (null,null on leave) */ },
    destroy() { /* optional: free GL/buffer resources */ },
    getStats() { /* optional: { backend, ... } for controller.getStats() */ },
    isAvailable() { /* optional: false ⇒ controller pauses this effect */ },
    setWake(fn) { /* optional: register a scheduler wake callback */ }
  };
}
```

**Forbidden in the renderer:**

- Do **not** call `requestAnimationFrame`/`cancelAnimationFrame` — the runtime
  owns the single shared loop.
- Do **not** size the canvas, read layout, or attach DOM listeners — that is the
  runtime's job (`mountEffect` handles `ResizeObserver`, `IntersectionObserver`,
  pointer events, and pixel-ratio sizing).
- Do **not** mutate `config` — it is frozen. Read values off it each frame.
- Do **not** branch on frame count — drive everything from `time`/`delta`
  (`delta` is clamped to `0.05` s). Time-based determinism is asserted: the same
  logical frame is produced at 60 Hz and 120 Hz.

Pixel effects (plasma, fire, metaballs, tunnel, mandelbrot, rotozoom) render
into an offscreen `ImageData`/`Uint32Array` via the helpers in
`src/effects/utils.js` and upscale with `imageSmoothingEnabled = false`. Vector
effects (starfield, sine-scroller, feedback, copper-bars) draw directly on the
2D context.

### `config.js` — defaults and validation

Owns the effect's **algorithmic identity**: seed, geometry, physics, camera,
iteration ceilings — everything that defines *what* is computed. Defaults are
built with `createEffectDefaults(...)`, which layers the four shared groups on
top of `COMMON_DEFAULTS`:

```js
import { assertNumber, createEffectDefaults } from '../../config.js';

export const FIRE_DEFAULTS = createEffectDefaults({
  render: { resolution: 0.25, smoothing: false },
  motion: { speed: 1 },
  appearance: { palette: ['#000000', '#ff7a00'], colorCount: 256, backgroundColor: '#000000' },
  simulation: {                      // effect-specific, algorithmic group
    seed: 1993, stepHz: 60,
    sourceWidthFrac: 0.8, sourceDepthFrac: 0.06, sourceIntensity: 1.0,
    cooling: 0.25, riseFrac: 1.0, maxCatchUpSteps: 3
  }
});

export function validateFire(config) {
  const sim = config.simulation;
  assertNumber(sim.seed, 'fire.simulation.seed', { min: 0, max: 0xffffffff, integer: true });
  assertNumber(sim.cooling, 'fire.simulation.cooling', { min: 0, max: 1 });
  // …
}
```

Helpers exported from `src/config.js`: `assertNumber`, `assertBoolean`,
`assertString`, `assertPalette`, `assertKnownKeys`, `mergeValue`, `cloneValue`,
`freezeValue`, `createEffectDefaults`, `COMMON_DEFAULTS`.

**Resolution-independence rule.** Geometry must be expressed in **normalized**
units (fractions of the viewport, cycles per viewport-height, world units),
never in render-buffer pixels. A different `render.resolution` must change only
the **sampling cost** (number of cells/iterations), never the apparent
composition. The shared groups `validateCommonConfig` runs on every effect; the
effect's `validate` runs after it and adds effect-specific range checks.

### `skins.js` — named visual presets

Owns **presentation only**: palette, color count, background, glow, and the
appearance-only continuous-coloring knobs (mandelbrot). Algorithmic identity
stays in `config.js` and is overridden through `config`.

```js
export const FIRE_SKINS = Object.freeze({
  classic: Object.freeze({
    appearance: Object.freeze({
      palette: Object.freeze(['#000000', '#2b0000', …, '#fffff0']),
      colorCount: 256
    })
  })
});
```

Every effect must ship a `'classic'` skin (asserted). A skin may only contain
groups listed in `capabilities.skinAllow` — the resolver rejects any other group
with `skin … is out of scope at '<group>'`. The four shared groups
(`runtime`, `render`, `motion`, `appearance`) are always allowed; never put
`simulation`, `field`, `camera`, `geometry`, etc. in a skin.

### `profiles.js` — four budget slots

Owns **execution and composition budgets** per `(surface × device)` pair. Built
with the shared `buildProfiles(...)` helper from `src/effects/profiles.js`,
which requires exactly the four slot keys and deep-clones + deep-freezes them:

```js
import { buildProfiles } from '../profiles.js';

const RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_FULLSCREEN_MOBILE  = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_DESKTOP    = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_MOBILE     = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };

export const FIRE_PROFILES = buildProfiles({
  'fullscreen.desktop': { ...RUNTIME_FULLSCREEN_DESKTOP, render: { resolution: 0.25 } },
  'fullscreen.mobile':  { ...RUNTIME_FULLSCREEN_MOBILE,  render: { resolution: 0.20 } },
  'preview.desktop':    { ...RUNTIME_PREVIEW_DESKTOP,    render: { resolution: 0.20 } },
  'preview.mobile':     { ...RUNTIME_PREVIEW_MOBILE,     render: { resolution: 0.15 } }
});
```

**Required budgets** (asserted for every effect):

| Slot                | `maxFps` |
|---------------------|----------|
| `fullscreen.desktop`| 60       |
| `fullscreen.mobile` | 30       |
| `preview.desktop`   | 30       |
| `preview.mobile`    | 24       |

All slots start `pixelRatio: 1` and `pauseWhenHidden: true`. Beyond `maxFps`, a
slot typically lowers `render.resolution` for preview/mobile (the sampling
budget) and, for particle effects, the particle/point budget (starfield,
metaballs, sine-scroller). Mandelbrot additionally carries **camera framing**
per orientation (landscape vs portrait) in its slots — same algorithmic centre,
different zoom window.

A slot must never carry palette/skin data (that belongs in `skins.js`). An effect
may factor a shared budget into a local `const` and spread it into multiple
slots; `buildProfiles` deep-clones so the slots stay independent and immutable.

## The resolver pipeline (reference)

For a descriptor `{ skin, surface, device, config }`, `resolveDescriptor`
(`src/resolver.js`) does, in order:

1. **Legacy guard.** Reject v2 flat groups at the root with a migration hint.
   Reject unknown descriptor fields.
2. **Resolve skin** → `{ requested, presetName, overrides }`. Validate the
   preset exists; validate `overrides` is a plain object.
3. **Resolve surface** (`'fullscreen'`/`'preview'`).
4. **Resolve device** (`'auto'` → `desktop`/`mobile` via `matchMedia`).
5. **Pick the matched slot** `profiles.slots['<surface>.<resolvedDevice>']`.
   A missing slot fails loud (no silent empty-overlay fallback).
6. **Allow-list skin paths** — both the preset and the overrides must stay
   inside `capabilities.skinAllow`.
7. **Key-check + pre-merge validate** the explicit `config`.
8. **Merge** in order: defaults → preset → overrides → slot → explicit config.
9. **Validate** the merged config (`validateCommonConfig` + effect `validate`).
10. **Deep-freeze.** Return `{ config, selection }`.

`selection` is the frozen snapshot returned by `getSelection()`.

## Adding a new effect

1. **Create the package** under `src/effects/<name>/` with `index.js`,
   `renderer.js`, `config.js`, `skins.js`, `profiles.js` (see the contract
   above).
2. **Ship a `classic` skin.** At minimum, an `appearance` palette.
3. **Declare all four profile slots** with the required `maxFps` budgets
   (60/30/30/24) and a `render.resolution` that lowers for preview/mobile.
4. **Keep geometry normalized and seeds deterministic.** No render-buffer-pixel
   geometry; every random source uses `createSeededRandom(seed)` so frames are
   reproducible. Drive motion from `time`/`delta`, never frame count.
5. **Register in the build.** Add a row to the `effects` array in
   [`scripts/build.mjs`](../scripts/build.mjs):
   `['publicName', '<name>/index.js', '<name>Definition', '<name>.js']`.
6. **Wire the demo.** Add an HTML page (`NN-<name>.html`) that loads
   `dist/effects/<name>.js` and calls `Demoscene.<publicName>('#c')` with no
   descriptor (fullscreen default). Add a card to `index.html`.
7. **Update the README.** Add the effect to the function list and the
   effect-specific groups table.
8. **Add tests.** Effect-specific behaviour in `tests/<name>.test.js`; the
   shared `tests/library.test.js` enumerates all effects, so it picks up the
   new one automatically once it is in the build `effects` array.
9. **Rebuild and commit `dist/`.** Run `npm run build`; never hand-edit
   `dist/`. Commit the regenerated `dist/demoscene.js`, `dist/effects/<name>.js`,
   and `dist/manifest.json` (now listing the new effect).
10. **Baselines.** Capture the four-profile × three-timestamp matrix and commit
    the baselines + contact sheets (`npm run visual:update` after review).

After step 5 the new effect is part of the public contract: the bundle
filename, the named `Demoscene.<publicName>()` function, and its entry in
`dist/manifest.json` (`apiVersion: 3`) all derive from the build table.

## The shared scheduler

All effects on a page share **one** `requestAnimationFrame` loop, stored on
`globalThis[Symbol.for('demoscene-classics.runtime')]`. The runtime adds/removes
controllers and ticks only the runnable ones each frame. This is why standalone
bundles must continue to merge onto the same scheduler when loaded together —
asserted by `tests/library.test.js`. Effects never schedule frames themselves.
