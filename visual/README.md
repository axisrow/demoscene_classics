# Visual QA harness

A deterministic, browser-based visual-QA harness for the ten demoscene effects.
It mounts each effect directly via the API v3 public function, advances it with
a fixed 1/60 s clock, captures the complete responsive matrix, and produces
reviewable contact sheets — so a baseline change becomes an explicit, inspected
action instead of an incidental test update.

## Pinned runtime

The harness drives a headless browser through **Python Playwright** (no Node
`playwright` dependency). It is reproducible only against the exact pair below.

| Component          | Pinned value | Source of truth |
|---|---|---|
| Python Playwright  | `1.59.0`     | `pip install playwright==1.59.0` |
| Chromium build     | `1217`       | Playwright 1.59.0's `browsers.json` |

Playwright 1.59.0's bundled driver resolves **chromium build 1217** (not any
other build that may be sitting in the local browser cache). `visual/pin.mjs`
and `visual/capture_runner.py` both assert this build at runtime; a mismatched
install fails loudly instead of emitting drifting baselines. If a Playwright
upgrade re-pins a different chromium build, baselines **must** be regenerated
and reviewed deliberately.

Install the runtime:

```sh
pip install playwright==1.59.0
python -m playwright install chromium
```

## Commands

```sh
npm run test:visual          # build, capture into visual/captures/, compare vs visual/baselines/
npm run visual:update        # build, capture into visual/baselines/ (replace), regenerate contact sheets
npm run visual:contact-sheet # build per-effect + all-effect sheets from visual/baselines/
npm run test:visual:unit     # matrix, fixed-step, pixel comparator, WebGL smoke (no browser matrix)
```

`visual:update` regenerates contact sheets automatically. `npm test` (the normal
suite) still runs; the visual matrix lives behind the dedicated commands above.

## Determinism invariants

- The test clock advances in **exact 1/60 s** steps. A capture at `t` seconds
  runs `Math.round(t * 60)` fixed steps (0 / 90 / 300 for 0 / 1.5 / 5 s), always
  advancing every intermediate step — never jumping from zero to the capture
  timestamp. This is mandatory for stateful effects whose state accumulates
  across delta (fire's accumulator, starfield/sine-scroller positions, feedback's
  prior-frame reads).
- The harness drives `controller._tick(i * 1000/60)` directly with
  `runtime:{ autoStart:false, maxFps:240, pauseWhenHidden:false, pixelRatio:1 }`.
  `maxFps:240` defeats the runtime frame limiter so `_tick` never skips a fixed
  step (it is capped at 1..240, so 1000 is not allowed).
- A fresh effect mount per capture → each renderer's `resize()` reseeds →
  identical starting state; the controller is destroyed after the capture.
- The browser's own sources of nondeterminism are held constant: `Date`,
  `performance.now`, `Math.random`, device scale factor (`1`), color scheme
  (`dark`), reduced motion, and animation scheduling (`requestAnimationFrame` is
  stubbed — the harness drives the clock).
- `device` is passed **explicitly** (`desktop`/`mobile`), never `auto`, so the
  resolver never reads `matchMedia` and `selection.resolvedDevice` is constant
  and filename-encodable.
- A case fails on any console error, page error, unhandled rejection, missing
  canvas, or suspiciously blank capture.

## Capture matrix

Each effect is captured at `0`, `1.5`, and `5` seconds across four profiles:

| Profile | Canvas/viewport | Surface | Device |
|---|---|---|---|
| desktop-preview | 320 × 180 | preview | desktop |
| mobile-preview | 360 × 180 | preview | mobile |
| desktop-fullscreen | 1280 × 720 | fullscreen | desktop |
| mobile-fullscreen | 390 × 844 | fullscreen | mobile |

That is 12 images per effect and **120** for the full ten-effect suite. Filenames
encode `effect__profile__WxH__resolvedDevice__timestamp.png`
(e.g. `mandelbrot__mobile-fullscreen__390x844__mobile__1p5s.png`) so stale or
missing cases are detectable by name.

The fixture **geometry** (the canvas size) is independent of `render.resolution`,
which only controls sampling cost. Effects keep their own deterministic seeds.

## Tolerance

Pixel-buffer effects (plasma, fire, metaballs, tunnel, mandelbrot, rotozoom,
copper-bars) target **byte-identical** reproduction (`maxDiffPixelRatio = 0`).
Vector effects rendered through the Canvas 2D stroke/fill/text APIs (starfield,
sine-scroller, feedback) compare against a small, **bounded** tolerance
(`maxDiffPixelRatio = 0.01`) to absorb sub-pixel rasterisation variance. Both
are bounded, so unconstrained differences always fail. Tune in `visual/pin.mjs`.

The Canvas 2D Mandelbrot is the canonical pixel baseline; a separate WebGL
Mandelbrot smoke test (`tests/webgl-smoke.test.js`) verifies WebGL2 context
creation, shader compile/link, no GL errors after a draw, and graceful Canvas 2D
fallback — independent of the pixel baselines.

## Review-before-baseline rule

No baseline update is accepted unless the PR author has reviewed the generated
four-profile contact sheet and states that explicitly in the PR description.
`visual:update` is the only path that writes `visual/baselines/`; `test:visual`
never mutates baselines.
