# Demoscene Classics

🌍 **Live demo:** https://axisrow.github.io/demoscene_classics/

Ten configurable demoscene effects distributed as ordinary browser scripts.
The library owns effect algorithms, validation, scheduling and canvas
rendering. Colours, density, motion and rendering budgets belong to the project
that embeds it.

## API v2

Load the complete bundle, then pass a JSON-compatible skin to an effect:

```html
<canvas id="proof" style="width:100vw;height:100vh"></canvas>
<script src="dist/demoscene.js"></script>
<script>
const proofSkin = {
  runtime: {
    autoStart: true,
    maxFps: 24,
    pixelRatio: 1,
    pauseWhenHidden: true
  },
  render: {
    backend: 'auto',
    resolution: 0.22,
    smoothing: true
  },
  motion: {
    speed: 1,
    cycleSeconds: 20,
    startPhase: 0.25
  },
  appearance: {
    palette: ['#050607', '#30393a', '#dfd0b8'],
    colorCount: 256,
    backgroundColor: '#050607',
    interiorColor: '#050607'
  },
  camera: {
    centerX: -0.7436438870371587,
    centerY: 0.1318259042053119,
    minZoom: 4000,
    maxZoom: 250000
  },
  algorithm: {
    iterationBase: 80,
    iterationGrowth: 60,
    maxIterations: 140,
    escapeRadius: 16
  }
};

const proof = Demoscene.mandelbrot('#proof', proofSkin);
```

Available functions are `plasma`, `fire`, `starfield`, `metaballs`, `tunnel`,
`mandelbrot`, `sineScroller`, `rotozoom`, `feedback`, and `copperBars`. Standalone
scripts remain available under `dist/effects/`.

Every controller supports:

```js
effect.stop();
effect.start();
effect.resize();
effect.renderOnce(0);
const normalizedSkin = effect.getConfig();
const stats = effect.getStats();
effect.destroy();
```

Skins are cloned, validated and frozen during mounting. `getConfig()` returns a
fresh copy. Options cannot be updated in place: destroy and remount the effect
when switching theme or skin. Unknown keys fail with their complete path.

## Shared groups

- `runtime`: `autoStart`, `maxFps` (`1..240`), `pixelRatio` (`1..2`) and
  `pauseWhenHidden`.
- `render`: `resolution` (`0.1..1`) and `smoothing`.
- `motion`: `speed` plus effect-specific movement values.
- `appearance`: `palette` (2–64 hex stops), `colorCount` (`2..4096`) and
  effect-specific colours.

`resolution` is the fraction of the backing canvas actually calculated by the
renderer. A fullscreen Mandelbrot at `0.25` computes one sixteenth as many
pixels as one at `1`, then scales the result using the selected smoothing mode.

## Effect-specific groups

- `plasma`: four-element `field.frequencies`, amplitudes, phase rates and radial centre;
  `motion.paletteCycleSpeed` in palette cycles per second.
- `fire`: deterministic `simulation` seed, step rate, source density/intensity,
  variance, cooling, drift and catch-up budget.
- `starfield`: `particles` count, seed, FOV, depth, travel speed, perspective
  centre, trail fade, alpha and line-width ranges.
- `metaballs`: `field.pointCount`, `fieldStrength`, threshold and mapping. Use
  `field.points` instead of `pointCount` to specify every trajectory explicitly.
- `tunnel`: `geometry` centre, radial/angular frequencies and fog; motion has
  forward, rotation and colour-cycle speeds.
- `mandelbrot`: `camera`, `algorithm`, zoom-loop motion and interior colour;
  `render.backend` accepts `canvas2d`, `webgl2` or `auto`.
- `sineScroller`: `text`, `wave`, deterministic `stars`, scroll/phase speeds,
  palette, background and shadow styling.
- `rotozoom`: procedural `texture` size, checker, rings, spokes and centre;
  rotation and zoom motion.
- `feedback`: polygon `geometry`, recursive `feedback` decay/scale/rotation/fade,
  orbit and colour-cycle motion.
- `copperBars`: a `bars` array plus glossy/highlight `shading` and colour-cycle
  motion.

The HTML gallery keeps its preview skins in `index.html`; they are examples,
not presets embedded in the library.

Mandelbrot keeps `canvas2d` as its default backend so classic demos and pixel
snapshots remain stable. `auto` tries the WebGL2 perturbation renderer and
safely falls back to Canvas 2D if the context or shaders are unavailable.
`getStats()` reports the selected backend and submitted frame count/timing.

## Development

```sh
npm install
npm run build
npm test
npm run benchmark:mandelbrot
npm run build:site
```

Source modules live in `src/`. The build emits the complete bundle, ten
standalone scripts and `dist/manifest.json` with `apiVersion: 3`. Generated
bundles remain committed because the demos also work when opened through
`file://`.

## Visual QA

A deterministic browser harness captures the ten effects across four responsive
profiles × three timestamps (120 images) and compares them against committed
baselines. It uses a pinned Python Playwright + Chromium pair.

```sh
pip install playwright==1.59.0 && python -m playwright install chromium
npm run test:visual          # compare captures vs committed baselines
npm run visual:update        # replace baselines (review the contact sheet first)
npm run visual:contact-sheet # build review contact sheets
```

See [`visual/README.md`](visual/README.md) for the pinned runtime, determinism
invariants, the capture matrix, and the bounded tolerance policy.

