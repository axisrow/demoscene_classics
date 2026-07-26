# Demoscene Classics

🌍 **Live demo:** https://axisrow.github.io/demoscene_classics/

Ten configurable demoscene effects distributed as ordinary browser scripts —
no framework, no server, no runtime dependency. The build produces plain
`<script>`-loadable IIFE bundles that work over HTTP and via `file://`.

> **API v3** is the current public API. It is a clean break from the flat
> v2 options object. v2 calls fail fast with a migration hint — see
> [`docs/api-v3.md`](docs/api-v3.md) for the full migration guide and reference.

## Quick start

Load the complete bundle, then call an effect on a `<canvas>`:

```html
<canvas id="proof" style="width:100vw;height:100vh"></canvas>
<script src="dist/demoscene.js"></script>
<script>
  // Standalone pages use the fullscreen default surface.
  Demoscene.fire('#proof');
</script>
```

The ten available functions are `plasma`, `fire`, `starfield`, `metaballs`,
`tunnel`, `mandelbrot`, `sineScroller`, `rotozoom`, `feedback`, and
`copperBars`. Each standalone effect script also remains available under
`dist/effects/<name>.js`.

## The API v3 descriptor

Every effect accepts the same descriptor. Nothing is flat any more:

```js
Demoscene.fire(canvas, {
  skin: 'classic',       // named visual preset, or { preset, overrides }
  surface: 'fullscreen', // 'fullscreen' (standalone) or 'preview' (gallery card)
  device: 'auto',        // 'auto' | 'desktop' | 'mobile'
  config: {              // expert escape hatch — algorithmic overrides only
    simulation: { cooling: 0.4 }
  }
});
```

**Defaults**

| Field    | Default      | Meaning                                                     |
|----------|--------------|-------------------------------------------------------------|
| `skin`   | `'classic'`  | The named visual preset shipped by every effect.            |
| `surface`| `'fullscreen'` | `'fullscreen'` for standalone pages, `'preview'` for cards.|
| `device` | `'auto'`     | Resolved once at mount from `matchMedia` (see below).       |
| `config` | `{}`         | Algorithm/geometry/camera overrides; validated with paths.  |

A bare `Demoscene.fire(canvas)` therefore resolves to
`classic` / `fullscreen` / `desktop` (`device:'auto'` resolves to `desktop`
in a non-mobile environment).

### Custom skins

A skin carries **visual choices only** (palette, brightness, glow). Use the
object form to layer appearance overrides on top of the `classic` preset:

```js
Demoscene.fire(canvas, {
  skin: {
    preset: 'classic',
    overrides: { appearance: { backgroundColor: '#050102' } }
  }
});
```

Skins may only touch the visual groups (`runtime`, `render`, `motion`,
`appearance`). Algorithmic groups (`simulation`, `field`, `camera`, `geometry`,
…) are out of scope for a skin and are rejected — pass those under `config`
instead. See [Authoring skins & profiles](docs/skin-and-profile-authoring.md).

### Resolution and merge contract

Configuration is resolved in a fixed order, then deeply frozen:

1. effect defaults
2. selected skin **preset**
3. custom skin **overrides**
4. matched **profile slot** (`surface` × resolved `device`)
5. resolved **device** (already folded into the slot above)
6. explicit **`config`** (the expert escape hatch — always wins)

Each step is a recursive deep merge where input leaves replace default leaves;
arrays replace wholesale. Neither caller input nor exported presets are mutated.
The final object is `Object.freeze`-d recursively; to change anything, destroy
and remount.

`device:'auto'` resolves **exactly once at mount** using:

```js
matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse)')
```

If `matchMedia` is unavailable it resolves to `desktop`. An explicit
`device:'desktop'`/`'mobile'` always wins. A matchMedia change, resize, or
orientation change after mount **does not** recreate the renderer or change the
resolved profile.

### Inspecting a mounted effect

```js
const fire = Demoscene.fire(canvas, { surface: 'preview', device: 'auto' });

fire.getConfig();    // → a fresh, deeply frozen clone of the final config
fire.getSelection(); // → { requestedSkin, preset, surface, requestedDevice, resolvedDevice }
```

`getSelection().requestedDevice` echoes what you passed (`'auto'`);
`resolvedDevice` is what `auto` actually resolved to (`'desktop'` or `'mobile'`).

### Controller lifecycle

Every effect returns the same controller:

```js
fire.stop();          // pause the shared rAF tick for this effect
fire.start();         // resume
fire.resize();        // re-measure the canvas (also automatic via ResizeObserver)
fire.renderOnce(0);   // render a single static frame at time t (seconds)
fire.getConfig();     // frozen final config (clone)
fire.getSelection();  // frozen { requestedSkin, preset, surface, requestedDevice, resolvedDevice }
fire.getStats();      // { backend, renderedFrames, lastFrameMs, averageFrameMs }
fire.destroy();       // stop, detach observers/listeners, release the renderer
```

`autoStart` defaults to `true`; set `config.runtime.autoStart = false` to mount
paused. Multiple effects on one page share a **single** `requestAnimationFrame`
loop, so ten cards cost one rAF tick.

## Shared config groups

These four groups appear on every effect and are valid in both skins and
`config`:

- **`runtime`** — `autoStart` (bool), `maxFps` (`1..240`), `pixelRatio`
  (`1..2`), `pauseWhenHidden` (bool). `pauseWhenHidden` pauses the effect when
  its canvas leaves the viewport (preview only).
- **`render`** — `resolution` (`0.1..1`, fraction of the backing canvas actually
  computed), `smoothing` (bool, upscale interpolation). Mandelbrot adds
  `render.backend`.
- **`motion`** — `speed` plus effect-specific movement values.
- **`appearance`** — `palette` (2–64 hex stops), `colorCount` (`2..4096`),
  `backgroundColor`, plus effect-specific colours.

`resolution` changes sampling **cost**, not composition: every effect's geometry
is expressed in normalized viewport/texture coordinates, so the same descriptor
renders the same picture at any buffer size.

## Effect-specific groups (in `config` only)

| Effect        | Algorithmic groups (pass under `config`)                         |
|---------------|------------------------------------------------------------------|
| `plasma`      | `field` (frequencies, amplitudes, phase rates, radial centre)    |
| `fire`        | `simulation` (seed, stepHz, source geometry, cooling, rise)      |
| `starfield`   | `particles` (count, seed, fov, depth, speed, density budget)     |
| `metaballs`   | `field` (pointCount/points, radius, strength, threshold, band)   |
| `tunnel`      | `geometry` (centre, wall/angle frequencies, guarded depth, fog)  |
| `mandelbrot`  | `camera`, `algorithm` (iterations, escape radius) + `render.backend` |
| `sineScroller`| `text`, `wave`, `stars`                                          |
| `rotozoom`    | `texture` (tiles, checker, rings, spokes, centre)                |
| `feedback`    | `geometry`, `feedback` (decay, scale, rotation, fade)            |
| `copperBars`  | `bars` (array), `shading`                                        |

Unknown keys fail with their full path (e.g. `mandelbrot.camera.minZom`).

## Complete examples

### Fire — preview/mobile selection + cooling override + teardown

```js
// A gallery-style card on a touch device. device:'auto' resolves to 'mobile'
// from a coarse pointer, which selects the preview.mobile slot (24 FPS).
const fire = Demoscene.fire(canvas, {
  surface: 'preview',
  device: 'auto',
  config: { simulation: { cooling: 0.4 } }   // cooling is a height-fraction per step, bounded [0, 1]
});

fire.getSelection(); // { surface: 'preview', requestedDevice: 'auto', resolvedDevice: 'mobile', ... }
fire.getConfig();    // { runtime: { maxFps: 24, ... }, simulation: { cooling: 0.4, ... }, ... }

fire.destroy();
```

### Mandelbrot — custom skin + camera/iteration overrides + backend

```js
// The default backend is canvas2d (stable, deterministic). Set backend:'auto'
// (or 'webgl2') to opt into the perturbation WebGL2 renderer, which safely
// falls back to Canvas 2D if the context or shaders are unavailable.
const mandel = Demoscene.mandelbrot(canvas, {
  skin: {
    preset: 'classic',
    overrides: { appearance: { colorScale: 0.5, colorCurve: 2 } }  // continuous-coloring knobs
  },
  surface: 'fullscreen',
  device: 'desktop',
  config: {
    render: { backend: 'auto' },     // try WebGL2, fall back to Canvas 2D
    camera: { maxZoom: 250000 },
    algorithm: { maxIterations: 140 },
    appearance: { interiorColor: '#101010' }
  }
});

mandel.getStats(); // { backend: 'webgl2' | 'canvas2d', renderedFrames, ... } — the RESOLVED renderer
mandel.destroy();
```

More worked examples (including the full migration table) are in
[`docs/api-v3.md`](docs/api-v3.md).

## Bundles and the manifest

`npm run build` emits:

- `dist/demoscene.js` — all ten effects on one `Demoscene` namespace.
- `dist/effects/<name>.js` — one standalone IIFE per effect.
- `dist/manifest.json` — `{ version, apiVersion: 3, bundle, effects[] }`,
  enumerating each effect's `skins`, `surfaces`, and `devices`.

The public bundle filenames and the named `Demoscene.<effect>()` functions are
unchanged across the v2 → v3 break. Standalone bundles merge onto the same
shared scheduler when loaded together.

## Development

```sh
npm install
npm run build          # rebuild dist/ via esbuild
npm test               # build, then run the Node test suite
npm run benchmark:mandelbrot
npm run build:site
```

Source modules live in `src/`. Each effect owns an isolated package under
`src/effects/<name>/` — see [Contributing: skins & profiles](docs/skin-and-profile-authoring.md)
for the per-effect folder contract and how to add a new effect.

## Visual QA

A deterministic browser harness captures the ten effects across four responsive
profiles × three timestamps (120 images) and compares them against committed
baselines, using a pinned Python Playwright + Chromium pair.

```sh
npm run test:visual          # compare captures vs committed baselines
npm run visual:update        # replace baselines (review the contact sheet first)
npm run visual:contact-sheet # build review contact sheets
```

See [`visual/README.md`](visual/README.md) for the pinned runtime, determinism
invariants, the capture matrix, and the bounded tolerance policy.
