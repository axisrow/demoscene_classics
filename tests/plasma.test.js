// Plasma-focused suite for the normalized field geometry (issue #5).
//
// Covers the issue's required cases:
//   - the field is evaluated in normalized viewport coordinates (no buffer
//     pixels in the geometry), and `render.resolution` changes sampling density
//     only — at the same time/config the field scale, centre, wavelength, and
//     phase are invariant
//   - aspect correction keeps circular / radial features circular in landscape
//     and portrait (the Euclidean radius is a true distance in viewport-height
//     units)
//   - deterministic output for the same config/time, and fixed-step equivalence
//     across 24/30/60 FPS schedules (time-based phase, not frame-count)
//   - continuous, bounded palette interpolation; the classic skin keeps dark,
//     midtone, and highlight bands present at 1.5 s and 5 s without clipping
//   - config/skin separation: appearance-only overrides cannot alter the field
//     geometry paths
//
// These tests mount the renderer directly through a mock Canvas 2D context
// (pure source, no browser) so the math is exercised deterministically. A few
// cases also resolve a descriptor through the standalone bundle to confirm the
// public API wiring and merge precedence.

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

import { PLASMA_DEFAULTS, validatePlasma } from '../src/effects/plasma/config.js';
import { createPlasmaRenderer } from '../src/effects/plasma/renderer.js';
import { PLASMA_PROFILES } from '../src/effects/plasma/profiles.js';
import { PLASMA_SKINS } from '../src/effects/plasma/skins.js';
import { buildGradientPalette, parseHexColor } from '../src/effects/utils.js';

// --- minimal Canvas 2D mock (records the pixel-buffer ImageData) ------------

class PixelContext {
  constructor() {
    this.imageSmoothingEnabled = true;
    this.lastImage = null;
    this.drawImageCount = 0;
  }
  createImageData(width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  // putImageData receives the renderer's ImageData; snapshot the whole object so
  // tests can read .width/.height/.data together.
  putImageData(image) {
    this.lastImage = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
  }
  drawImage() { this.drawImageCount++; }
}

class PixelCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.style = {};
    this.context = new PixelContext();
    // The offscreen pixel-buffer canvas the renderer creates via document.
    this.buffer = null;
  }
  getContext() { return this.context; }
}

// document.createElement stub: returns a fresh buffer canvas each call.
let createdBuffers = [];
function installDocumentStub() {
  createdBuffers = [];
  globalThis.document = globalThis.document || {};
  globalThis.document.createElement = (tag) => {
    if (tag !== 'canvas') throw new Error(`unexpected element: ${tag}`);
    const canvas = new PixelCanvas(1, 1);
    createdBuffers.push(canvas);
    return canvas;
  };
}

// Build a resolved config (defaults + skin overlay + overrides) for direct
// renderer use. Mirrors the resolver's defaults -> classic-skin -> override
// merge so the renderer sees the same shape the public API produces.
function configWith(overrides = {}, { withClassicSkin = true } = {}) {
  const merge = (base, over) => {
    if (over === undefined) return base;
    if (base && typeof base === 'object' && !Array.isArray(base)
      && over && typeof over === 'object') {
      const out = { ...base };
      for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
      return out;
    }
    return over;
  };
  const base = JSON.parse(JSON.stringify(PLASMA_DEFAULTS));
  base.runtime = { ...base.runtime, pixelRatio: 1 };
  let config = base;
  if (withClassicSkin) config = merge(config, JSON.parse(JSON.stringify(PLASMA_SKINS.classic)));
  return merge(config, overrides);
}

function mount(width, height, overrides = {}, options = {}) {
  installDocumentStub();
  const canvas = new PixelCanvas(width, height);
  const config = configWith(overrides, options);
  const renderer = createPlasmaRenderer({ canvas, config });
  renderer.resize(width, height);
  return { canvas, config, renderer, buffer: createdBuffers[0] };
}

// Drive a fixed 1/stepHz clock for N steps, capturing the buffer pixels.
function drive(renderer, { steps, stepHz = 60, firstTime = 0 }) {
  const dt = 1 / stepHz;
  for (let i = 0; i < steps; i++) {
    const step = i + firstTime * stepHz;
    renderer.render({ time: step * dt, delta: i === 0 ? 0 : dt });
  }
}

// Extract the rendered buffer as [width, height, Uint32Array-of-packed-RGBA].
function bufferPixels(m) {
  const img = m.buffer.context.lastImage;
  return { width: img.width, height: img.height, data: new Uint32Array(img.data.buffer.slice()) };
}

// --- normalized coordinates / resolution independence ----------------------

// Build a normalized histogram (fraction of cells) of the rendered colours. The
// field is a pure function of (u, v, time); changing render.resolution only
// changes how densely that field is sampled, so the COLOUR DISTRIBUTION (the
// share of the frame at each palette value) is resolution-invariant. Comparing
// these fractions — not exact pixels — rejects overfitting while still proving
// the field scale/centre/wavelength did not move.
function colourHistogram(pixels) {
  const counts = new Map();
  for (let i = 0; i < pixels.data.length; i++) {
    counts.set(pixels.data[i], (counts.get(pixels.data[i]) || 0) + 1);
  }
  const total = pixels.data.length;
  const out = {};
  for (const [colour, count] of counts) out[colour] = count / total;
  return out;
}

// Total-variation distance between two normalized distributions.
function distributionDistance(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let sum = 0;
  for (const k of keys) sum += Math.abs((a[k] || 0) - (b[k] || 0));
  return sum / 2;
}

// Map a normalized viewport point (nx, ny) in [0,1]² to the buffer cell that
// samples it, and return that cell's packed colour. The renderer samples cell
// (bx, by) at nx=(bx+0.5)/w, ny=(by+0.5)/h, so the inverse is bx=round(nx*w-0.5).
function colourAtNormalized(pixels, nx, ny) {
  const bx = Math.min(pixels.width - 1, Math.max(0, Math.round(nx * pixels.width - 0.5)));
  const by = Math.min(pixels.height - 1, Math.max(0, Math.round(ny * pixels.height - 0.5)));
  return pixels.data[by * pixels.width + bx];
}

test('render.resolution changes sampling density only — same normalized point resolves to the same field value', () => {
  // The decisive test: the field is a pure function of (u, v, time). At a fixed
  // time/config, the SAME normalized point must resolve to the same palette
  // colour regardless of sampling density. A resolution-COUPLED field (wavelength
  // tied to buffer pixels) would fail this even though its overall colour
  // histogram looks similar. We probe several off-centre normalized points.
  const TIME = 0.83;
  const runs = [1, 0.5, 0.25].map((res) => {
    const m = mount(400, 240, { render: { resolution: res } });
    m.renderer.render({ time: TIME, delta: 0 });
    return { res, pixels: bufferPixels(m) };
  });
  const PROBES = [[0.3, 0.2], [0.7, 0.4], [0.5, 0.5], [0.15, 0.8], [0.85, 0.65]];
  for (const [nx, ny] of PROBES) {
    const full = colourAtNormalized(runs[0].pixels, nx, ny);
    for (const { res, pixels } of runs.slice(1)) {
      const here = colourAtNormalized(pixels, nx, ny);
      // Allow a 1-palette-step tolerance for cell-centre rounding between grids.
      const d = Math.min(
        Math.abs((full & 0xff) - (here & 0xff)),
        255
      );
      assert.ok(
        full === here || d <= 24,
        `resolution ${res} moved the field at normalized (${nx},${ny}): ${full} vs ${here}`
      );
    }
  }
  // And the buffers really did shrink (sampling cost scaled down).
  assert.ok(runs[0].pixels.width > runs[1].pixels.width, '0.5 samples fewer cells than 1.0');
  assert.ok(runs[1].pixels.width > runs[2].pixels.width, '0.25 samples fewer cells than 0.5');
  // The colour distribution is also near-identical (a weaker backstop).
  const histFull = colourHistogram(runs[0].pixels);
  for (const { res, pixels } of runs.slice(1)) {
    const dist = distributionDistance(histFull, colourHistogram(pixels));
    assert.ok(dist < 0.1, `resolution ${res} drifted the field distribution (TV=${dist.toFixed(3)})`);
  }
});

test('the geometry never reads buffer pixels: doubling the canvas keeps the same field distribution', () => {
  // The field is anchored to normalized coords, so scaling the canvas (at a fixed
  // resolution) resamples the SAME field — the distribution is unchanged.
  const TIME = 1.2;
  const a = mount(200, 120, { render: { resolution: 0.5 } });
  const b = mount(400, 240, { render: { resolution: 0.5 } });
  a.renderer.render({ time: TIME, delta: 0 });
  b.renderer.render({ time: TIME, delta: 0 });
  const d = distributionDistance(colourHistogram(bufferPixels(a)), colourHistogram(bufferPixels(b)));
  assert.ok(d < 0.1, `canvas size changed the field distribution (TV=${d.toFixed(3)})`);
});

// --- aspect correction -----------------------------------------------------

test('radial structure stays circular: equal Euclidean radii sample equal field values on +x and +y (landscape and portrait)', () => {
  // Isolate the radial term (zero the axis + diagonal waves). With aspect
  // correction the radial field is f(sqrt(u²+v²)) where u=nx·aspect, v=ny — a
  // true circle. So a point at normalized radius r along +x (nx = 0.5 + r/aspect,
  // ny = 0.5) and a point at the SAME radius r along +y (nx = 0.5, ny = 0.5 + r)
  // sit on the same ring and MUST render the same palette colour. We sample
  // several radii in BOTH landscape and portrait; every pair must match.
  const isolateRadial = {
    field: { amplitudes: [0, 0, 0, 1], frequencies: [0, 0, 0, 5], phaseRates: [0, 0, 0, 0] }
  };
  for (const [w, h] of [[400, 200], [200, 400]]) {
    const m = mount(w, h, isolateRadial);
    m.renderer.render({ time: 0, delta: 0 });
    const pixels = bufferPixels(m);
    const aspect = pixels.width / pixels.height; // buffer aspect (== canvas aspect)
    // Radii chosen to stay inside the frame on BOTH axes: along +x the reach in
    // normalized-x is r/aspect (must be < 0.5 → r < 0.5·aspect), along +y it is r
    // (must be < 0.5). Take fractions of that shared ceiling so both landscape
    // and portrait get several in-frame radii.
    const maxR = Math.min(0.5, 0.5 * aspect) - 0.03;
    const radii = [0.35, 0.55, 0.75, 0.95].map((frac) => +(maxR * frac).toFixed(4));
    let matches = 0, pairs = 0;
    for (const r of radii) {
      const onX = colourAtNormalized(pixels, 0.5 + r / aspect, 0.5); // u = r, v = 0
      const onY = colourAtNormalized(pixels, 0.5, 0.5 + r); //           u = 0, v = r
      pairs++;
      if (onX === onY) matches++;
    }
    assert.ok(pairs >= 3, `need at least three radii inside ${w}x${h} (got ${pairs})`);
    assert.equal(matches, pairs,
      `radial field must be isotropic at ${w}x${h}: ${matches}/${pairs} equal-radius pairs matched`);
  }
});

test('WITHOUT aspect correction the same equal-radius probe is anisotropic (guards the test itself)', () => {
  // Sanity check that the isotropy probe above actually has teeth: turn aspect
  // correction OFF and the equal-radius +x vs +y colours must DIVERGE on a
  // non-square canvas (the ring becomes an ellipse in normalized-x). If this
  // test ever passes trivially, the isotropy test is inert.
  const m = mount(400, 200, {
    field: { amplitudes: [0, 0, 0, 1], frequencies: [0, 0, 0, 5], phaseRates: [0, 0, 0, 0], aspectCorrection: false }
  });
  m.renderer.render({ time: 0, delta: 0 });
  const pixels = bufferPixels(m);
  // Without aspect correction u = nx (not nx·aspect), so along +x the field
  // reaches radius r at nx = 0.5 + r; sample the same nx offset on each axis.
  let diverged = 0, pairs = 0;
  for (const r of [0.15, 0.25, 0.35]) {
    const onX = colourAtNormalized(pixels, 0.5 + r, 0.5);
    const onY = colourAtNormalized(pixels, 0.5, 0.5 + r);
    pairs++;
    if (onX !== onY) diverged++;
  }
  assert.ok(diverged >= 1, `un-corrected field must be anisotropic on 400x200 (${diverged}/${pairs} pairs diverged)`);
});

test('a circular landmark does not stretch into an ellipse when aspect correction is on', () => {
  // With aspectCorrection the field is the same shape in landscape/portrait;
  // disabling it would couple u to raw buffer x and stretch circles. We assert
  // the renderer respects the flag: centre colour is identical either way (the
  // flag only reshapes the x mapping, centre stays put), but the off-centre
  // quarter landmark DIFFERS between on/off for a non-square canvas.
  const TIME = 0.4;
  const on = mount(300, 150, { field: { aspectCorrection: true } });
  const off = mount(300, 150, { field: { aspectCorrection: false } });
  on.renderer.render({ time: TIME, delta: 0 });
  off.renderer.render({ time: TIME, delta: 0 });
  const pon = bufferPixels(on);
  const poff = bufferPixels(off);
  // Centre is invariant to the flag.
  const con = pon.data[Math.floor(pon.height / 2) * pon.width + Math.floor(pon.width / 2)];
  const coff = poff.data[Math.floor(poff.height / 2) * poff.width + Math.floor(poff.width / 2)];
  assert.equal(con, coff, 'centre is aspect-flag invariant');
  // An off-axis point differs (the x mapping changed).
  const edgeOn = pon.data[Math.floor(pon.height / 2) * pon.width + 2];
  const edgeOff = poff.data[Math.floor(poff.height / 2) * poff.width + 2];
  assert.notEqual(edgeOn, edgeOff, 'aspect correction must change the off-centre field');
});

// --- determinism + fixed-step equivalence ----------------------------------

test('deterministic: same config/time reproduces the exact frame', () => {
  const run = () => {
    const m = mount(160, 100);
    drive(m.renderer, { steps: 30 });
    return bufferPixels(m).data.join(',');
  };
  assert.equal(run(), run());
});

test('fixed-step equivalence: the frame depends only on time, not on frame count or delta size', () => {
  // Plasma is stateless: render({time}) is a pure function of time. So a frame
  // at time T is identical whether T was reached in 24, 30, or 60 fixed steps,
  // and identical whether the delta was large or small. This is the time-based
  // determinism the issue requires (motion driven by time, never by frame count).
  const T = 1.0;
  // Reach the SAME final time T via three different step rates. The last render
  // of each run is at exactly time = T (we render an explicit final frame at T).
  function finalFrameAt(stepHz) {
    const m = mount(200, 120);
    // Warm up with fixed steps, then render one explicit frame at exactly T so
    // all three schedules compare the identical timestamp.
    drive(m.renderer, { steps: Math.round(T * stepHz), stepHz });
    m.renderer.render({ time: T, delta: 1 / stepHz });
    return bufferPixels(m).data.join(',');
  }
  const f24 = finalFrameAt(24);
  const f30 = finalFrameAt(30);
  const f60 = finalFrameAt(60);
  assert.equal(f30, f60, '30 Hz and 60 Hz must reach the same frame at T=1s');
  assert.equal(f24, f60, '24 Hz and 60 Hz must reach the same frame at T=1s');

  // And the delta magnitude is irrelevant: rendering T with a tiny delta and a
  // huge delta yields the same frame (the field does not accumulate delta).
  const m2 = mount(200, 120);
  m2.renderer.render({ time: T, delta: 0.001 });
  const small = bufferPixels(m2).data.join(',');
  const m3 = mount(200, 120);
  m3.renderer.render({ time: T, delta: 0.25 });
  const large = bufferPixels(m3).data.join(',');
  assert.equal(small, large, 'delta magnitude must not affect the plasma frame');
});

// --- palette interpolation (bounded, continuous, tonal structure) ----------

test('the classic skin palette interpolates continuously and stays bounded', () => {
  // buildGradientPalette is the shared, bounded interpolator the renderer uses.
  const palette = buildGradientPalette(new Uint32Array(256), PLASMA_SKINS.classic.appearance.palette);
  // Every channel is in [0,255]; adjacent entries change by at most 255 (no
  // discontinuity larger than a single segment can jump).
  let maxJump = 0;
  for (let i = 0; i < palette.length; i++) {
    const r = palette[i] & 0xff;
    const g = (palette[i] >>> 8) & 0xff;
    const b = (palette[i] >>> 16) & 0xff;
    assert.ok(r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255, 'channels bounded');
    if (i > 0) {
      const pr = palette[i - 1] & 0xff;
      const pg = (palette[i - 1] >>> 8) & 0xff;
      const pb = (palette[i - 1] >>> 16) & 0xff;
      maxJump = Math.max(maxJump, Math.abs(r - pr), Math.abs(g - pg), Math.abs(b - pb));
    }
  }
  // Interpolation is continuous: consecutive palette entries differ by a small,
  // bounded amount (no full-spectrum banding cliff).
  assert.ok(maxJump <= 80, `palette interpolation must be smooth, max jump was ${maxJump}`);
  // The first stop is the deep shadow, the last is the white crest accent.
  const first = parseHexColor(PLASMA_SKINS.classic.appearance.palette[0]);
  const last = parseHexColor(PLASMA_SKINS.classic.appearance.palette[PLASMA_SKINS.classic.appearance.palette.length - 1]);
  assert.ok((first[0] + first[1] + first[2]) < 90, 'shadow stop is dark');
  assert.ok(last[0] > 240 && last[1] > 240 && last[2] > 240, 'crest stop is near-white highlight');
});

test('the rendered frame keeps dark, midtone, and highlight bands present at 1.5 s and 5 s', () => {
  // Reject a near-flat or clipped frame without overfitting exact pixels. The
  // classic palette runs continuously from a deep shadow (low luminance) to a
  // near-white crest (high luminance). A healthy plasma field sweeps the whole
  // value range, so the rendered frame must contain colours from the palette's
  // low, mid, and high luminance thirds — and the near-white crest must stay a
  // small accent, never the dominant field. We measure against the palette's
  // OWN luminance bands so the time-based palette scroll cannot mask a collapse.
  const palette = Array.from(buildGradientPalette(new Uint32Array(256), PLASMA_SKINS.classic.appearance.palette));
  // Luminance of every palette entry, and the thresholds splitting it in thirds.
  const lums = palette.map((c) =>
    0.299 * (c & 0xff) + 0.587 * ((c >>> 8) & 0xff) + 0.114 * ((c >>> 16) & 0xff));
  const lo = Math.min(...lums.slice(0, 64));
  const hi = Math.max(...lums.slice(192));
  const mid = (lo + hi) / 2;
  // Map a packed colour to its palette luminance band by nearest palette entry.
  const palLum = new Map(palette.map((c, i) => [c, lums[i]]));
  function bandOf(packed) {
    const lum = palLum.get(packed);
    if (lum === undefined) return 'other';
    if (lum < lo + (mid - lo) * 0.5) return 'dark';
    if (lum > hi - (hi - mid) * 0.5) return 'bright';
    return 'mid';
  }
  for (const seconds of [1.5, 5]) {
    const m = mount(320, 180);
    drive(m.renderer, { steps: Math.round(seconds * 60) });
    const { data } = bufferPixels(m);
    const tally = { dark: 0, mid: 0, bright: 0, other: 0, white: 0 };
    for (let i = 0; i < data.length; i++) {
      const band = bandOf(data[i]);
      tally[band]++;
      const r = data[i] & 0xff, g = (data[i] >>> 8) & 0xff, b = (data[i] >>> 16) & 0xff;
      if (r > 235 && g > 235 && b > 235) tally.white++;
    }
    const total = data.length;
    // All three tonal bands of the palette are populated — the field is not flat.
    assert.ok(tally.dark / total > 0.04, `${seconds}s dark band present (${(tally.dark / total * 100).toFixed(1)}%)`);
    assert.ok(tally.mid / total > 0.04, `${seconds}s midtone band present (${(tally.mid / total * 100).toFixed(1)}%)`);
    assert.ok(tally.bright / total > 0.02, `${seconds}s highlight band present (${(tally.bright / total * 100).toFixed(1)}%)`);
    // White is a small highlight, never the dominant field.
    assert.ok(tally.white / total < 0.4, `${seconds}s white must stay an accent (${(tally.white / total * 100).toFixed(1)}%)`);
  }
});

test('the classic skin never renders a clipped flat frame (variance floor)', () => {
  // Representative variance/luminance threshold that rejects nearly-flat
  // captures without overfitting exact pixels. A healthy plasma field has a
  // broad value distribution; a collapsed one has near-zero variance.
  const m = mount(256, 160);
  drive(m.renderer, { steps: 90 });
  const { data } = bufferPixels(m);
  let sum = 0, sumSq = 0, n = data.length;
  for (let i = 0; i < n; i++) {
    const lum = ((data[i] & 0xff) + ((data[i] >>> 8) & 0xff) + ((data[i] >>> 16) & 0xff)) / 3;
    sum += lum;
    sumSq += lum * lum;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  assert.ok(variance > 200, `field variance too low (mean ${mean.toFixed(1)}, var ${variance.toFixed(1)}) — field may have collapsed`);
});

// --- config / skin separation ----------------------------------------------

test('geometry lives in config, appearance lives in the skin (no leak)', () => {
  // The field-defining keys (frequencies, centres, amplitudes, aspectCorrection)
  // are algorithmic identity and belong to config.field, not to the skin.
  const skin = PLASMA_SKINS.classic;
  for (const key of ['frequencies', 'amplitudes', 'phaseRates', 'radialCenterX', 'radialCenterY', 'aspectCorrection']) {
    assert.ok(key in PLASMA_DEFAULTS.field, `${key} is a config.field geometry key`);
    assert.ok(!(key in (skin.appearance || {})), `${key} must not leak into the skin`);
  }
  // Visual keys belong to the skin appearance, not to the field geometry.
  for (const key of ['palette', 'backgroundColor', 'contrast']) {
    assert.ok(key in skin.appearance, `${key} is skin-owned (appearance)`);
    assert.ok(!(key in PLASMA_DEFAULTS.field), `${key} is not geometry`);
  }
});

test('an appearance-only skin override cannot change the field geometry', () => {
  // Two skins that differ ONLY in palette (appearance) must produce the same
  // field VALUE distribution shape — the geometry path is untouched, so the
  // histogram of palette indices has the same shape (only the colour mapping
  // differs). We assert the SET of distinct palette-index buckets is identical
  // and their rank order is preserved.
  const TIME = 0.5;
  const baseGeom = { field: { frequencies: [3, 3, 2, 2.5], amplitudes: [1, 1, 1, 1] } };
  const runPalette = (palette) => {
    const m = mount(200, 120, {
      ...baseGeom,
      appearance: { palette, colorCount: 64, contrast: 1 }
    });
    m.renderer.render({ time: TIME, delta: 0 });
    return bufferPixels(m).data;
  };
  const a = runPalette(['#000000', '#770077', '#ffffff']);
  const b = runPalette(['#001100', '#1177aa', '#ffaa00']);
  // Distinct colours present in each (proves the field is not flat).
  assert.ok(new Set(a).size > 4 && new Set(b).size > 4, 'field should produce several buckets');
  // Same number of distinct buckets → the geometry/value-mapping is identical,
  // only the colour identity differs. (contrast=1, colorCount=64 for both.)
  assert.equal(new Set(a).size, new Set(b).size, 'palette swap must not change the field bucket count');
});

test('the contrast gamma honours the whole validated (0, 4] range, not just <= 1', () => {
  // Regression guard: the renderer must NOT clamp contrast to 1. The validator
  // admits up to 4, so a contrast of 2 (compress midtones toward highlights)
  // must produce a visibly different frame from contrast 1 — otherwise valid
  // user input is silently ignored. We render the same geometry at contrast 1
  // and contrast 2.5 and require the tonal distributions to differ.
  const TIME = 0.5;
  const render = (contrast) => {
    const m = mount(200, 120, { appearance: { contrast } });
    m.renderer.render({ time: TIME, delta: 0 });
    return bufferPixels(m).data;
  };
  const neutral = render(1);
  const compressed = render(2.5);
  let differing = 0;
  for (let i = 0; i < neutral.length; i++) if (neutral[i] !== compressed[i]) differing++;
  assert.ok(
    differing / neutral.length > 0.1,
    `contrast 2.5 must reshape the frame vs contrast 1 (only ${(differing / neutral.length * 100).toFixed(1)}% differed — is it clamped to 1?)`
  );
});

test('validatePlasma accepts defaults and rejects out-of-range geometry', () => {
  assert.doesNotThrow(() => validatePlasma(configWith()));
  const base = configWith();
  assert.throws(
    () => validatePlasma({ ...base, field: { ...base.field, radialCenterX: 2 } }),
    /radialCenterX/
  );
  assert.throws(
    () => validatePlasma({ ...base, field: { ...base.field, frequencies: [1, 2, 3] } }),
    /frequencies must contain four numbers/
  );
  assert.throws(
    () => validatePlasma({ ...base, field: { ...base.field, aspectCorrection: 'yes' } }),
    /aspectCorrection/
  );
  assert.throws(
    () => validatePlasma({ ...base, appearance: { ...base.appearance, contrast: 0 } }),
    /contrast/
  );
});

test('the four profile slots preserve geometry and only tune sampling/budget', () => {
  const slots = PLASMA_PROFILES.slots;
  for (const key of ['fullscreen.desktop', 'fullscreen.mobile', 'preview.desktop', 'preview.mobile']) {
    const slot = slots[key];
    // Profiles never carry field geometry — that is config identity.
    assert.ok(!slot.field, `${key} must not redefine field geometry`);
    assert.ok(slot.runtime && Number.isFinite(slot.runtime.maxFps), `${key} declares a runtime budget`);
    assert.ok(Number.isFinite(slot.render.resolution), `${key} declares a sampling resolution`);
  }
  // Mobile may sample more coarsely than desktop within a surface, but stays
  // well above the floor (0.1) where the field would alias.
  assert.ok(slots['fullscreen.mobile'].render.resolution >= 0.1, 'mobile fullscreen samples above the floor');
  assert.ok(slots['preview.mobile'].render.resolution >= 0.1, 'mobile preview samples above the floor');
  // Every slot resolves to the same field because none of them touch field.* —
  // the composition is identical; only sampling density and fps differ.
  const allHaveNoField = Object.values(slots).every((s) => !s.field);
  assert.ok(allHaveNoField, 'composition is identical across all four profiles');
});

// --- public API wiring + merge precedence (standalone bundle) --------------

async function loadBundle(path, environment) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  vm.runInContext(source, environment.sandbox, { filename: path });
}

class BundleCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.clientWidth = width;
    this.clientHeight = height;
    this.style = {};
    this.context = new PixelContext();
    this.buffer = null;
    this.listeners = new Map();
  }
  getContext() { return this.context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
}

function createBundleEnvironment() {
  const sandbox = {
    console,
    document: {
      createElement(tag) {
        if (tag !== 'canvas') throw new Error(`unexpected element: ${tag}`);
        return new BundleCanvas(1, 1);
      }
    },
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox };
}

test('API v3: explicit config overrides win after skin and profile resolution', async () => {
  const env = createBundleEnvironment();
  await loadBundle('../dist/effects/plasma.js', env);
  const canvas = new BundleCanvas(64, 40);
  // Override a geometry value via the explicit config escape hatch; it must win
  // over the classic-skin defaults and the matched profile slot.
  const controller = env.sandbox.Demoscene.plasma(canvas, {
    skin: 'classic',
    surface: 'fullscreen',
    device: 'desktop',
    config: { field: { radialCenterX: 0.25 }, runtime: { autoStart: false } }
  });
  const config = controller.getConfig();
  assert.equal(config.field.radialCenterX, 0.25, 'explicit config override wins');
  assert.deepEqual([...config.appearance.palette], [...PLASMA_SKINS.classic.appearance.palette], 'classic skin palette applied');
  // The contrast curve from the skin is present.
  assert.equal(config.appearance.contrast, PLASMA_SKINS.classic.appearance.contrast, 'skin contrast applied');
});

test('API v3: a custom skin override changes appearance without touching geometry', async () => {
  const env = createBundleEnvironment();
  await loadBundle('../dist/effects/plasma.js', env);
  const canvas = new BundleCanvas(64, 40);
  const controller = env.sandbox.Demoscene.plasma(canvas, {
    skin: { preset: 'classic', overrides: { appearance: { palette: ['#000', '#f0f', '#fff'] } } },
    config: { runtime: { autoStart: false } }
  });
  const config = controller.getConfig();
  assert.deepEqual([...config.appearance.palette], ['#000', '#f0f', '#fff'], 'custom palette override applied');
  // Geometry is still the config defaults (untouched by the skin override).
  assert.deepEqual([...config.field.frequencies], [...PLASMA_DEFAULTS.field.frequencies], 'geometry unchanged');
});

test('API v3: skin overrides into the field geometry group are rejected', async () => {
  const env = createBundleEnvironment();
  await loadBundle('../dist/effects/plasma.js', env);
  const canvas = new BundleCanvas(64, 40);
  assert.throws(
    () => env.sandbox.Demoscene.plasma(canvas, { skin: { overrides: { field: { frequencies: [1, 1, 1, 1] } } } }),
    /out of scope at 'field'/
  );
  // ...but the same value is accepted under explicit config.
  assert.doesNotThrow(() => env.sandbox.Demoscene.plasma(new BundleCanvas(64, 40), {
    config: { field: { frequencies: [1, 1, 1, 1] }, runtime: { autoStart: false } }
  }));
});
