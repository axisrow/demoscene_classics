# API v3 — migration guide and reference

API v3 is a clean break from the flat v2 options object. This document is the
single source of truth for the public API: how to call an effect, how
configuration is resolved, how the four responsive profiles work, and how to
migrate a v2 call site in one pass.

Every code sample below is executed by `tests/docs-examples.test.js` against the
built bundles, so the prose cannot drift from the implementation.

> Historical rationale for individual choices lives in the linked issues
> (#2 API v3, #3 profiles, #4 visual QA, #5–#14 effects). This guide documents
> the **merged** behaviour, not the proposals.

## Contents

- [The descriptor](#the-descriptor)
- [Defaults](#defaults)
- [Custom skins](#custom-skins)
- [Resolution and merge contract](#resolution-and-merge-contract)
- [Mount-time device resolution](#mount-time-device-resolution)
- [Responsive profile semantics](#responsive-profile-semantics)
- [Inspecting a mounted effect](#inspecting-a-mounted-effect)
- [Controller lifecycle](#controller-lifecycle)
- [Shared config groups](#shared-config-groups)
- [Mandelbrot backend and fallback](#mandelbrot-backend-and-fallback)
- [Complete examples](#complete-examples)
- [v2 → v3 migration](#v2--v3-migration)
- [Error reference](#error-reference)

---

## The descriptor

Every effect accepts one optional descriptor object:

```js
Demoscene.fire(canvas, {
  skin: 'classic',
  surface: 'fullscreen',
  device: 'auto',
  config: { simulation: { cooling: 0.4 } }
});
```

| Field     | Type                                   | Default        |
|-----------|----------------------------------------|----------------|
| `skin`    | `string` \| `{ preset, overrides }`    | `'classic'`    |
| `surface` | `'fullscreen'` \| `'preview'`          | `'fullscreen'` |
| `device`  | `'auto'` \| `'desktop'` \| `'mobile'`  | `'auto'`       |
| `config`  | `object`                               | `{}`           |

A bare `Demoscene.fire(canvas)` resolves to `classic` / `fullscreen` / `desktop`
(`device:'auto'` resolves to `desktop` in a non-mobile environment).

`target` (the first argument) is a `<canvas>` element or a CSS selector string
resolving to one.

## Defaults

```js
Demoscene.fire(canvas, {});          // == classic / fullscreen / desktop
Demoscene.fire(canvas, undefined);   // same
Demoscene.fire(canvas);              // same
```

The default `surface: 'fullscreen'` is right for **standalone** demo pages. Use
`surface: 'preview'` for gallery-style cards (see
[index.html](../index.html)). The default `device: 'auto'` resolves once at
mount (below).

## Custom skins

A skin is a **named visual preset**. The `classic` preset ships with every
effect. Select it by string, or use the object form to layer appearance
overrides:

```js
// String form — just the preset.
Demoscene.fire(canvas, { skin: 'classic' });

// Object form — preset plus visual overrides.
Demoscene.fire(canvas, {
  skin: {
    preset: 'classic',
    overrides: { appearance: { backgroundColor: '#050102' } }
  }
});
```

The two forms resolve to the **same** preset; only `getSelection().requestedSkin`
echoes the form you passed (a string vs the object).

**What a skin may touch.** A skin may only override the visual groups declared
in `capabilities.skinAllow`: `runtime`, `render`, `motion`, `appearance`
(every shipped effect allows exactly these four). Algorithmic groups
(`simulation`, `field`, `camera`, `geometry`, `algorithm`, `text`, `wave`,
`stars`, `texture`, `feedback`, `bars`, `shading`) are **out of scope for a
skin** and are rejected. Geometry, physics, and cameras are the effect's
algorithmic identity — change them through `config`, not through a skin.

```js
// ✗ rejected — simulation is algorithmic, not a skin concern
Demoscene.fire(canvas, { skin: { overrides: { simulation: { seed: 1 } } } });
// → RangeError: fire: skin overrides is out of scope at 'simulation'.

// ✓ accepted — the same value through the config escape hatch
Demoscene.fire(canvas, { config: { simulation: { seed: 1 } } });
```

## Resolution and merge contract

Configuration is resolved in a fixed order, then deeply frozen. Tracing one
value (`fire.render.resolution`) through every layer:

| Step | Source                              | `render.resolution` after this step |
|------|-------------------------------------|-------------------------------------|
| 1    | effect defaults                     | `0.25` (fire default)               |
| 2    | skin **preset** (`classic`)         | `0.25` (preset does not set it)     |
| 3    | skin **overrides**                  | unchanged (no `render` override)    |
| 4    | matched **profile slot**            | `0.15` for `preview.mobile`         |
| 5    | resolved **device**                 | (already folded into the slot)      |
| 6    | explicit **`config`**               | `0.4` if you passed it — **wins**   |

```js
Demoscene.fire(canvas, {
  surface: 'preview', device: 'mobile',
  config: { render: { resolution: 0.4 } }
}).getConfig().render.resolution; // → 0.4 (explicit config beats the 0.15 slot)
```

**Merge semantics.** Each step is a recursive deep merge: plain-object leaves
recurse, every other leaf (number, string, boolean, array, `null`) is replaced
wholesale by the input. Arrays replace — they are not concatenated or
deep-merged element-wise (except that object elements of an array are
key-checked against the first template element during validation).

**Immutability.** Caller input and exported presets are deep-cloned before
merging and never mutated. The resolved config is `Object.freeze`-d recursively.
`getConfig()` returns a fresh frozen clone of that frozen config, so no caller
can ever hold a live reference into the renderer's state. To change anything,
`destroy()` and remount.

**Validation.** Explicit `config` is key-checked against the effect defaults
**before** merging — unknown keys fail with their full path
(e.g. `mandelbrot.camera.minZom`). Range/type validation runs on the final
merged config. The optional `validateInput` hook (if an effect defines one) runs
on the raw caller object pre-merge, for constraints that cannot be checked on
the merged result (e.g. mutually exclusive options — `metaballs.field.points`
vs `field.pointCount`).

## Mount-time device resolution

`device: 'auto'` resolves **exactly once at mount**, using:

```js
matchMedia('(max-width: 767px), (hover: none) and (pointer: coarse)')
```

- A match on **either** query → `mobile`.
- Otherwise → `desktop`.
- If `matchMedia` is unavailable → `desktop`.

```js
const fire = Demoscene.fire(canvas, { device: 'auto' });
fire.getSelection().requestedDevice; // 'auto'   (what you asked for)
fire.getSelection().resolvedDevice;  // 'desktop' (what auto resolved to)
```

**Explicit selection wins.** `device: 'desktop'` or `device: 'mobile'` skips
detection entirely (`requestedDevice === resolvedDevice`).

**Stable after mount.** A matchMedia change, resize, or orientation change
after mount does **not** recreate the renderer or change the resolved profile.
The renderer is created once for the resolved `(surface, device)` slot and keeps
that identity for its lifetime. To re-target a different device, destroy and
remount.

## Responsive profile semantics

Every effect owns **four explicit profile slots** — one per
`(surface × resolved-device)` combination:

| Slot                | `maxFps` | Typical use                              |
|---------------------|----------|------------------------------------------|
| `fullscreen.desktop`| 60       | Standalone page, desktop.                |
| `fullscreen.mobile` | 30       | Standalone page, mobile.                 |
| `preview.desktop`   | 30       | Gallery card, desktop.                   |
| `preview.mobile`    | 24       | Gallery card, mobile.                    |

All four slots pin `pixelRatio: 1` and `pauseWhenHidden: true`. Beyond the
runtime budget, each slot may set `render.resolution` (the sampling budget) and,
for some effects, a density/particle budget (starfield, metaballs, sine-scroller
cut their particle/point counts in preview/mobile slots).

**Why four slots, not two axes.** A budget like `maxFps` depends on **both**
axes at once: `preview.desktop` is 30 but `fullscreen.desktop` is 60 — same
device, different surface. A surface overlay plus a device overlay cannot
express that with leaf-replacement semantics. The four-slot form makes every
per-(surface, device) value representable; conceptually a slot is "the surface
profile composed with the device profile", declared as one composite overlay.

Profiles own **execution and composition budgets only** (`runtime`, `render`,
and the density knobs that change cost). They never carry palette or skin data —
that is the skin layer's job.

**Explicit `config` overrides the slot.** Anything you pass under `config`
beats the matched slot (merge step 6), so you can always pin a specific budget
regardless of surface/device.

**No mobile renderer.** Mobile is not a separate renderer. The same renderer
runs for every slot; the slot only changes budgets and (for mandelbrot) the
camera framing. Landscape and portrait point at the same algorithmic feature.

## Inspecting a mounted effect

```js
const effect = Demoscene.plasma(canvas, {});

effect.getConfig();
// → a fresh, deeply frozen clone of the fully resolved config.

effect.getSelection();
// → {
//     requestedSkin: 'classic' | { preset, overrides },  // echoes your input
//     preset: 'classic',                                  // resolved preset name
//     surface: 'fullscreen' | 'preview',
//     requestedDevice: 'auto' | 'desktop' | 'mobile',     // echoes your input
//     resolvedDevice: 'desktop' | 'mobile'                // what auto resolved to
//   }
```

`getSelection()` is itself frozen. It returns `null` for effects mounted through
the internal `mountEffect` API directly (the public `Demoscene.<effect>()`
functions always pass a selection snapshot).

## Controller lifecycle

```js
effect.stop();          // pause this effect on the shared rAF loop
effect.start();         // resume
effect.resize();        // re-measure (also automatic via ResizeObserver)
effect.renderOnce(t);   // render one static frame at time t (seconds); pauses the loop
effect.getConfig();     // frozen final config (clone)
effect.getSelection();  // frozen { requestedSkin, preset, surface, requestedDevice, resolvedDevice }
effect.getStats();      // { backend, renderedFrames, lastFrameMs, averageFrameMs }
effect.destroy();       // stop, detach observers/listeners, free the renderer
```

`runtime.autoStart` defaults to `true`. All effects on a page share **one**
`requestAnimationFrame` loop (stored on a well-known `Symbol` on `globalThis`),
so mounting ten gallery cards costs a single rAF tick. `renderOnce` is the
deterministic single-frame entry point used by the visual harness and tests.

## Shared config groups

Valid in both skins and `config`:

- **`runtime`** — `autoStart` (bool), `maxFps` (`1..240`), `pixelRatio`
  (`1..2`), `pauseWhenHidden` (bool).
- **`render`** — `resolution` (`0.1..1`), `smoothing` (bool). Mandelbrot adds
  `backend` (`'canvas2d'` | `'webgl2'` | `'auto'`).
- **`motion`** — `speed` (≥ MIN_VALUE) plus effect-specific movement values.
- **`appearance`** — `palette` (2–64 `#rgb`/`#rrggbb` stops), `colorCount`
  (`2..4096`), `backgroundColor`, plus effect-specific colours.

Effect-specific algorithmic groups (`simulation`, `field`, `camera`, `geometry`,
`algorithm`, `text`, `wave`, `stars`, `texture`, `feedback`, `bars`, `shading`)
are valid under `config` only. Unknown keys anywhere fail with their full path.

## Mandelbrot backend and fallback

Mandelbrot's **default** `render.backend` is `'canvas2d'` — stable, pixel-deterministic,
and dependency-free. Set it to `'auto'` or `'webgl2'` to opt into the WebGL2
perturbation renderer:

```js
Demoscene.mandelbrot(canvas, {
  config: { render: { backend: 'auto' } }   // try WebGL2, fall back to Canvas 2D
});
```

- `'canvas2d'` — always Canvas 2D.
- `'webgl2'` — require WebGL2; if the context or shaders are unavailable, warn
  and **safely fall back** to Canvas 2D.
- `'auto'` — prefer WebGL2, fall back to Canvas 2D (same fallback path).

`getStats().backend` reports the **resolved** renderer (`'webgl2'` or
`'canvas2d'`), which may differ from `getConfig().render.backend` (the requested
value) when a fallback occurred. The WebGL2 renderer survives
`webglcontextlost`/`webglcontextrestored` without remounting.

Mandelbrot also adds continuous-coloring knobs to `appearance`
(`colorScale`, `colorCurve`, `colorOffset`, `cycleSpeed`) — these are
**presentation only** and never move the complex-plane camera, so they are
skin-safe.

## Complete examples

### Fire — preview/mobile selection, cooling override, inspection, teardown

```js
// A gallery card on a touch device. device:'auto' resolves to 'mobile' from a
// coarse pointer, selecting the preview.mobile slot (24 FPS, coarser grid).
const fire = Demoscene.fire(canvas, {
  surface: 'preview',
  device: 'auto',
  config: { simulation: { cooling: 0.4 } }   // cooling ∈ [0, 1]: height-fraction lost per step
});

const selection = fire.getSelection();
// → { requestedSkin: 'classic', preset: 'classic', surface: 'preview',
//     requestedDevice: 'auto', resolvedDevice: 'mobile' }

const config = fire.getConfig();
// → { runtime: { maxFps: 24, ... }, simulation: { cooling: 0.4, ... }, ... }

fire.destroy();
```

### Mandelbrot — custom skin, camera/iteration overrides, backend

```js
const mandel = Demoscene.mandelbrot(canvas, {
  skin: {
    preset: 'classic',
    overrides: { appearance: { colorScale: 0.5, colorCurve: 2 } }  // continuous-coloring knobs
  },
  surface: 'fullscreen',
  device: 'desktop',
  config: {
    render: { backend: 'auto' },     // try WebGL2, fall back to Canvas 2D
    camera: { maxZoom: 250000 },     // algorithmic identity → config, not skin
    algorithm: { maxIterations: 140 },
    appearance: { interiorColor: '#101010' }
  }
});

mandel.getConfig().appearance.colorScale;   // 0.5   (skin override reached the config)
mandel.getConfig().algorithm.maxIterations; // 140   (explicit config wins)
mandel.getStats().backend;                  // 'webgl2' or 'canvas2d' — the RESOLVED renderer

mandel.destroy();
```

## v2 → v3 migration

**v2 flat options are rejected.** API v3 detects the legacy top-level groups
and throws immediately, naming the offending key and the escape hatch:

```js
// v2 (REJECTED in v3):
Demoscene.fire(canvas, { simulation: { seed: 7 } });
// → TypeError: fire: the legacy v2 flat options object is no longer supported
//   in API v3. Move 'simulation' under the config escape hatch, e.g.
//   Demoscene.fire(canvas, { skin:'classic', surface:'fullscreen',
//   device:'auto', config: { simulation: ... } }). See the API v3 migration guide.
```

### Before / after

| v2 (rejected)                                              | v3 (correct)                                                                            |
|------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| `Demoscene.fire(canvas, { simulation: { seed: 7 } })`      | `Demoscene.fire(canvas, { config: { simulation: { seed: 7 } } })`                       |
| `Demoscene.fire(canvas, { render: { resolution: 0.5 } })`  | `Demoscene.fire(canvas, { config: { render: { resolution: 0.5 } } })`                   |
| `Demoscene.fire(canvas, { appearance: { palette: [...] } })` | `Demoscene.fire(canvas, { skin: { preset:'classic', overrides: { appearance: { palette: [...] } } } })` *(visual → skin)* |
| Inline preview FPS/resolution in the gallery markup        | `Demoscene.fire(canvas, { surface: 'preview', device: 'auto' })` — budgets live in profile slots |
| `PREVIEW_SKINS` object in `index.html`                     | removed — preview budgets are owned by the per-effect profile slots                     |
| `effect.getConfig()` returned the (v2) merged skin         | same name, now returns the fully resolved, deeply frozen v3 config                     |
| bundle filenames / `Demoscene.<effect>()` names            | **unchanged**                                                                           |

### Migration steps

1. **Wrap algorithmic groups in `config`.** Anything that was a top-level v2
   group (`simulation`, `field`, `camera`, `geometry`, `algorithm`, `text`,
   `wave`, `stars`, `texture`, `feedback`, `bars`, `shading`) moves under
   `config`. The four shared groups (`runtime`, `render`, `motion`,
   `appearance`) also move under `config` when you want to override them
   programmatically.

   > **⚠ Leaf schemas changed.** Moving a group under `config` is necessary but
   > **not sufficient**: v3 re-normalized most effects, so many leaf fields were
   > **renamed, moved between groups, changed units, or removed**. A v2 value
   > copied verbatim under `config` will usually throw `Unknown option` or a
   > range error. Use the per-effect table below to translate each leaf value.
   > The `tests/docs-examples.test.js` "v2→v3 migration" cases mount one
   > representative v3 configuration per effect and are the executable guarantee
   > for this table.

   **Per-effect leaf changes (v2 → v3):**

   | Effect | What changed |
   |---|---|
   | `fire` | `simulation.sourceDensity`/`sourceIntensity`(0–255)/`sourceVariance`/`cooling`(int 0–32)/`horizontalDrift` → normalized `simulation.sourceWidthFrac` + `sourceDepthFrac` + `sourceIntensity`(0–1) + `cooling`(frac 0–1) + `riseFrac`. |
   | `starfield` | `particles.trailFade`, `minAlpha`/`maxAlpha`, `minLineWidth`/`maxLineWidth` → **`appearance.*`** (skin-owned). `particles` geometry (fov/depth/speed/centre/density) is normalized but keeps the same names. |
   | `rotozoom` | `texture.size`/`checkerSize`/`ringFrequency`/`spokeCount`/`centerRadius`/`borderRadius` → single normalized `texture.tiles` (capped). `motion.zoomBase`/`zoomAmplitude`/`zoomSpeed` → normalized zoom motion. |
   | `feedback` | `feedback.alphaDecay`/`scale`/`rotation`/`fade` → **per-second** `feedback.decayPerSecond`/`scalePerSecond`/`rotationPerSecond`. `geometry.*` radii/widths → fractions of the short side. |
   | `plasma` | `field.frequencies` units change from buffer-pixels to **cycles per viewport-height** (4-element array preserved). `field.amplitudes`/`phaseRates` preserved. |
   | `tunnel` | `geometry.radialFrequency` → `geometry.wallFrequency`; `geometry.fogDistance`/`fogMinimum` → `geometry.fogNear`/`fogFar`/`geometry.fogStrength` + **`appearance.fogColor`** (the colour moved from the geometry group to appearance). `motion.forwardSpeed`/`rotationSpeed`/`colorCycleSpeed` units normalized. |
   | `metaballs` | `field.fieldStrength` → `field.strength`; `field.radius` and `field.mergeBand` are **new** (normalized blob radius + merge softness); `field.lowScale`/`highScale` **removed** (mapping is now palette-driven). `field.pointCount`/`points`/`threshold` keep their names, but `points` units changed: v2 used unbounded pixel-space amplitudes/strengths, v3 caps per-point amplitudes to `[0,1]` and treats `strength` as normalized. |
   | `mandelbrot` | `camera`/`algorithm` **preserved**. Added continuous-coloring knobs `appearance.colorScale`/`colorCurve`/`colorOffset`/`cycleSpeed`. |
   | `sineScroller` | `wave.frequency` → `wave.cycles`; `text.maxFontSize` → `text.fontSizeMax` (+ new `fontSizeMin`); `text.fontFamily`/`fontWeight` → **`appearance.*`** (skin-owned); `text.shadowOffsetX/Y` → normalized fractions; `stars.*` sizes/speed units normalized; new `stars.density*` budget. |
   | `copperBars` | `shading.highlightStrength`/`highlightWidth` → `shading.barAlphaScale` + `shading.specularWidth`/`specularFalloff`/`specularGain`; `bars` array preserved. |

2. **Move visual choices to a skin.** Palette, background, glow, and other
   presentation-only values belong in `skin.overrides.appearance`, not in the
   flat object. This keeps algorithmic identity (config) separate from look
   (skin). Note from the table above that some fields that *looked* algorithmic
   in v2 (e.g. `starfield.particles.trailFade`) are **visual** in v3 and belong
   in a skin, not in `config`.

3. **Pick a surface.** Standalone pages use the default `fullscreen`; gallery
   cards use `surface: 'preview'`. Do **not** pass inline `runtime`/`render`
   preview budgets from markup — the matched profile slot already supplies them.

4. **Pick a device.** Leave `device: 'auto'` (the default) unless you need to
   force one. Auto resolves once at mount; you usually do not need to think
   about it.

5. **Drop `PREVIEW_SKINS`.** The gallery no longer carries inline preview data.
   Mount each card with `{ surface: 'preview', device: 'auto' }` and let the
   profile slots own the budgets.

6. **Re-read the controller.** `getConfig()` / `getSelection()` / `getStats()`
   are the introspection surface; the method names are unchanged but their
   return shapes are the v3 ones documented above.

## Error reference

| Situation                                   | Error class  | Message fragment                                                                 |
|---------------------------------------------|--------------|----------------------------------------------------------------------------------|
| Legacy v2 flat group at descriptor root     | `TypeError`  | `the legacy v2 flat options object is no longer supported`                       |
| Unknown descriptor field                    | `RangeError` | `Unknown descriptor field: <effect>.<field>`                                     |
| Unknown skin (string)                       | `RangeError` | `unknown skin '<x>'. Known skins: ...`                                           |
| Unknown skin preset                         | `RangeError` | `unknown skin preset '<x>'. Known skins: ...`                                    |
| Unknown surface                             | `RangeError` | `unknown surface '<x>'. Known surfaces: fullscreen, preview`                     |
| Unknown device                              | `RangeError` | `unknown device '<x>'. Known devices: auto, desktop, mobile`                     |
| Skin override outside `skinAllow`           | `RangeError` | `skin <label> is out of scope at '<group>'`                                      |
| Unknown `config` key                        | `RangeError` | `Unknown option: <effect>.<path>`                                                |
| Missing profile slot                        | `RangeError` | `profile slot '<surface>.<device>' is missing`                                   |
| Range/type violation (any validated field)  | `RangeError`/`TypeError` | `<effect>.<path> must be ...`                                       |
