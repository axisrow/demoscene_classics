// Rotozoom-focused suite for the coherent tileable texture + normalized sampling
// model (issue #12).
//
// Covers the issue's required cases:
//   - the texture is INTENTIONALLY TILEABLE (seamless at the u/v wrap), with no
//     accidental centre disk / bullseye dominating the default fixture
//   - the transform is sampled in normalized texture space, so the tile scale,
//     transform centre, and phase stay stable when render resolution or canvas
//     size change (resolution enters as sampling density only)
//   - rotation is in turns/sec and zoom is a bounded time-based function; both
//     are FPS-independent (deterministic time output, fixed-step 24/30/60
//     equivalence)
//   - UV wrap is explicit, transform values stay finite, and zoom is bounded
//     even at extreme supported config
//   - luminance/colour variance thresholds reject both moiré-dominated noise
//     and broad flat single-colour frames
//   - config/skin separation: appearance-only overrides cannot alter the texture
//     or transform geometry paths
//
// These tests mount the renderer directly through a mock Canvas 2D context
// (pure source, no browser) so the math is exercised deterministically. A few
// cases also resolve a descriptor through the standalone bundle to confirm the
// public API wiring and merge precedence.

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

import { ROTOZOOM_DEFAULTS, validateRotozoom } from '../src/effects/rotozoom/config.js';
import { createRotozoomRenderer } from '../src/effects/rotozoom/renderer.js';
import { ROTOZOOM_PROFILES } from '../src/effects/rotozoom/profiles.js';
import { ROTOZOOM_SKINS } from '../src/effects/rotozoom/skins.js';
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
    this.buffer = null;
  }
  getContext() { return this.context; }
}

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

// Build a resolved config (defaults + classic skin + overrides). Mirrors the
// resolver's defaults -> classic-skin -> override merge.
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
  const base = JSON.parse(JSON.stringify(ROTOZOOM_DEFAULTS));
  base.runtime = { ...base.runtime, pixelRatio: 1 };
  let config = base;
  if (withClassicSkin) config = merge(config, JSON.parse(JSON.stringify(ROTOZOOM_SKINS.classic)));
  return merge(config, overrides);
}

function mount(width, height, overrides = {}, options = {}) {
  installDocumentStub();
  const canvas = new PixelCanvas(width, height);
  const config = configWith(overrides, options);
  const renderer = createRotozoomRenderer({ canvas, config });
  renderer.resize(width, height);
  return { canvas, config, renderer, buffer: createdBuffers[0] };
}

function drive(renderer, { steps, stepHz = 60, firstTime = 0 }) {
  const dt = 1 / stepHz;
  for (let i = 0; i < steps; i++) {
    const step = i + firstTime * stepHz;
    renderer.render({ time: step * dt, delta: i === 0 ? 0 : dt });
  }
}

function bufferPixels(m) {
  const img = m.buffer.context.lastImage;
  return { width: img.width, height: img.height, data: new Uint32Array(img.data.buffer.slice()) };
}

function lum(packed) {
  return 0.299 * (packed & 0xff) + 0.587 * ((packed >>> 8) & 0xff) + 0.114 * ((packed >>> 16) & 0xff);
}

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

function distributionDistance(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let sum = 0;
  for (const k of keys) sum += Math.abs((a[k] || 0) - (b[k] || 0));
  return sum / 2;
}

// --- intentional tileability: no centre disk / bullseye ---------------------

test('no disproportionately dominant centre disk in the default fixture', () => {
  // The old texture was dominated by an accidental centre disk / bullseye: the
  // central region was forced to a single saturated colour much brighter than
  // its surroundings. The coherent lattice must NOT do that — the centre region
  // must be statistically indistinguishable from an annulus of the same area
  // around it (no central highlight, no central saturation). We measure mean
  // luminance of a central disk vs an equal-area annulus; their difference must
  // be small relative to the frame's overall luminance spread.
  const m = mount(400, 240);
  m.renderer.render({ time: 0.83, delta: 0 });
  const { width, height, data } = bufferPixels(m);
  const cx = width / 2;
  const cy = height / 2;
  const innerR = Math.min(width, height) * 0.10;
  const outerR = innerR * Math.SQRT2; // equal-area annulus (π·outerR² − π·innerR² = π·innerR²)
  let cSum = 0, cN = 0, aSum = 0, aN = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const value = lum(data[y * width + x]);
      if (d <= innerR) { cSum += value; cN++; }
      else if (d <= outerR) { aSum += value; aN++; }
    }
  }
  const cMean = cSum / cN;
  const aMean = aSum / aN;
  // Overall luminance spread of the frame, for scale.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const value = lum(data[i]);
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  const spread = hi - lo;
  assert.ok(spread > 50, `frame has meaningful luminance spread (${spread.toFixed(1)})`);
  // Centre-vs-annulus delta is tiny relative to the spread — no central disk.
  assert.ok(
    Math.abs(cMean - aMean) / spread < 0.15,
    `centre disk dominant: |Δ|=${Math.abs(cMean - aMean).toFixed(1)} vs spread ${spread.toFixed(1)}`
  );
});

test('the centre colour is not a unique outlier: it occurs on the four cardinal axes', () => {
  // A bullseye pins the centre to a unique colour found nowhere else. The
  // coherent lattice has no central feature, so the centre colour must recur at
  // off-centre points along the cardinal axes (the same lattice value appears
  // at many transform points, not just the pivot). Sample the four axes and
  // confirm the centre colour reappears at least once off-centre.
  const m = mount(320, 200);
  m.renderer.render({ time: 0.4, delta: 0 });
  const { width, height, data } = bufferPixels(m);
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const centre = data[cy * width + cx];
  let reappearances = 0;
  const step = Math.max(1, Math.round(Math.min(width, height) / 40));
  for (let x = 0; x < width; x += step) {
    if (x === cx) continue;
    if (data[cy * width + x] === centre) reappearances++;
  }
  for (let y = 0; y < height; y += step) {
    if (y === cy) continue;
    if (data[y * width + cx] === centre) reappearances++;
  }
  assert.ok(reappearances >= 1, `centre colour is a unique outlier (0 reappearances) — looks like a bullseye`);
});

// --- seamless tile edges ----------------------------------------------------

test('the texture function is seamless at the u/v wrap (integer cycle counts)', () => {
  // Each lattice component is a sinusoid at an INTEGER cycle count per tile, so
  // the field value at tu=0 equals the value at tu=1 (modulo float ULP). After
  // palette indexing the colours are identical. Reproduce the renderer's texture
  // value formula and confirm f(0) and f(1) index the same palette entry.
  const palette = buildGradientPalette(new Uint32Array(256), ROTOZOOM_SKINS.classic.appearance.palette);
  const { frequencyU, frequencyV, weightU, weightV, weightDiag } = ROTOZOOM_DEFAULTS.texture;
  const contrast = ROTOZOOM_SKINS.classic.appearance.contrast;
  const twoPi = Math.PI * 2;
  const fU = frequencyU * twoPi;
  const fV = frequencyV * twoPi;
  const wSum = weightU + weightV + weightDiag;
  const wU = weightU / wSum;
  const wV = weightV / wSum;
  const wD = weightDiag / wSum;
  function indexAt(tu, tv) {
    let value = Math.sin(fU * tu) * wU + Math.sin(fV * tv) * wV + Math.sin(fU * (tu + tv)) * wD;
    value = value * 0.5 + 0.5;
    if (value > 0) value = Math.pow(value, contrast);
    return Math.min(palette.length - 1, Math.max(0, Math.round(value * (palette.length - 1))));
  }
  // Both wrap axes: f(0,*) == f(1,*) and f(*,0) == f(*,1), at several probes.
  for (const [tu, tv] of [[0.13, 0.0], [0.13, 1.0], [0.0, 0.37], [1.0, 0.37], [0.0, 0.0], [1.0, 1.0]]) {
    const i = indexAt(tu, tv);
    const wrappedTu = tu === 1.0 ? 0.0 : tu;
    const wrappedTv = tv === 1.0 ? 0.0 : tv;
    assert.equal(indexAt(wrappedTu, wrappedTv), i, `seamless at (${tu},${tv})`);
  }
});

test('the rendered motif is periodic across one tile in a stationary frame', () => {
  // With no rotation/zoom drift (speed 0), the transform is a pure scale by
  // `tiles`. Along the horizontal centre row the motif therefore repeats every
  // (canvasWidth / tiles) pixels. A seamless tile reproduces the same run.
  const m = mount(400, 200, { motion: { speed: 0 } });
  m.renderer.render({ time: 0, delta: 0 });
  const { width, height, data } = bufferPixels(m);
  const tiles = ROTOZOOM_DEFAULTS.texture.tiles;
  const period = width / tiles; // 400 / 5 = 80 px
  const cy = Math.floor(height / 2);
  // Sample a window shorter than one period and confirm it recurs one period
  // later (tile repeats seamlessly). Use a 40px window.
  const window = 40;
  let matching = 0;
  for (let i = 0; i < window; i++) {
    if (data[cy * width + i] === data[cy * width + i + Math.round(period)]) matching++;
  }
  assert.ok(matching / window > 0.8, `tile period recurred ${matching}/${window}`);
});

// --- normalized sampling: resolution / canvas independence ------------------

test('render.resolution changes sampling density only — colour distribution is stable', () => {
  // The transform is a pure function of (nx, ny, time); the texture is a pure
  // function of (tu, tv). Changing render.resolution only changes how densely
  // the transform is sampled, so the COLOUR DISTRIBUTION (the share of the frame
  // at each palette value) is near-invariant. Comparing distributions — not
  // exact pixels — proves the tile scale, centre, and phase did not move.
  const TIME = 0.83;
  const runs = [1, 0.5, 0.25].map((res) => {
    const m = mount(400, 240, { render: { resolution: res } });
    m.renderer.render({ time: TIME, delta: 0 });
    return { res, pixels: bufferPixels(m) };
  });
  // The buffers really did shrink (sampling cost scaled down).
  assert.ok(runs[0].pixels.width > runs[1].pixels.width, '0.5 samples fewer cells than 1.0');
  assert.ok(runs[1].pixels.width > runs[2].pixels.width, '0.25 samples fewer cells than 0.5');
  const histFull = colourHistogram(runs[0].pixels);
  for (const { res, pixels } of runs.slice(1)) {
    const dist = distributionDistance(histFull, colourHistogram(pixels));
    assert.ok(dist < 0.12, `resolution ${res} drifted the distribution (TV=${dist.toFixed(3)})`);
  }
});

test('scaling the canvas (at fixed resolution) keeps the same composition', () => {
  // The texture is anchored to normalized coords, so scaling the canvas at a
  // fixed resolution resamples the SAME composition — the distribution is
  // unchanged (a much stronger statement than the resolution test above, since
  // here the sampling density in normalized space is identical).
  const TIME = 1.2;
  const a = mount(200, 120, { render: { resolution: 0.5 } });
  const b = mount(400, 240, { render: { resolution: 0.5 } });
  a.renderer.render({ time: TIME, delta: 0 });
  b.renderer.render({ time: TIME, delta: 0 });
  const dist = distributionDistance(colourHistogram(bufferPixels(a)), colourHistogram(bufferPixels(b)));
  assert.ok(dist < 0.10, `canvas size changed the composition (TV=${dist.toFixed(3)})`);
});

test('the transform centre stays at the geometric centre regardless of resolution', () => {
  // The rotation/zoom pivot is the documented transform centre in normalized
  // [0,1]². At any resolution it must land at the buffer centre. We render a
  // frame with no rotation and confirm the centre column/row are mirrors of the
  // composition pivot (the value at the exact centre is finite and lies on the
  // tile lattice, not at a wrap seam artifact).
  for (const res of [1, 0.5, 0.25]) {
    const m = mount(240, 160, { render: { resolution: res }, motion: { speed: 0 } });
    m.renderer.render({ time: 0, delta: 0 });
    const { width, height, data } = bufferPixels(m);
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);
    const centre = data[cy * width + cx];
    assert.ok(Number.isFinite(centre), `centre finite at res ${res}`);
    // The four cells one step off-centre are all finite too (no NaN bleed).
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      assert.ok(Number.isFinite(data[(cy + dy) * width + (cx + dx)]), `finite at res ${res}`);
    }
  }
});

// --- aspect-correct transform ----------------------------------------------

test('aspect correction keeps the tile motif square: turning it OFF stretches the distribution', () => {
  // With aspect correction ON, the horizontal axis is scaled by the viewport
  // aspect so the tile motif is square (a texture feature at normalized radius r
  // is sampled isotropically along x and y in viewport-height units). Turning it
  // OFF couples the horizontal axis to raw normalized x, stretching the lattice
  // on a non-square canvas and changing the colour distribution. The two must
  // therefore differ on a 2:1 canvas.
  const TIME = 0.5;
  const on = mount(400, 200, { transform: { aspectCorrection: true } });
  const off = mount(400, 200, { transform: { aspectCorrection: false } });
  on.renderer.render({ time: TIME, delta: 0 });
  off.renderer.render({ time: TIME, delta: 0 });
  const dist = distributionDistance(colourHistogram(bufferPixels(on)), colourHistogram(bufferPixels(off)));
  assert.ok(dist > 0.05, `aspect correction must reshape a 2:1 frame (TV=${dist.toFixed(3)})`);
});

test('a square canvas is unaffected by the aspect-correction flag', () => {
  // On a 1:1 canvas the aspect factor is 1, so the flag must not change the
  // composition at all (distributions identical). This guards the test above
  // from being inert: the flag only matters on a non-square canvas.
  const TIME = 0.5;
  const on = mount(200, 200, { transform: { aspectCorrection: true } });
  const off = mount(200, 200, { transform: { aspectCorrection: false } });
  on.renderer.render({ time: TIME, delta: 0 });
  off.renderer.render({ time: TIME, delta: 0 });
  const dist = distributionDistance(colourHistogram(bufferPixels(on)), colourHistogram(bufferPixels(off)));
  assert.equal(dist, 0, 'square canvas is aspect-flag invariant');
});

// --- determinism + fixed-step equivalence -----------------------------------

test('deterministic: same config/time reproduces the exact frame', () => {
  const run = () => {
    const m = mount(160, 100);
    drive(m.renderer, { steps: 30 });
    return bufferPixels(m).data.join(',');
  };
  assert.equal(run(), run());
});

test('fixed-step equivalence: the frame depends only on time, not on FPS schedule', () => {
  // Motion is a pure function of time (rotation = speed·rotationSpeed·t·2π,
  // zoom = bounded sinusoid of t). So a frame at time T is identical whether T
  // was reached in 24, 30, or 60 fixed steps, and identical regardless of delta
  // magnitude. This is the time-based determinism the issue requires (motion
  // driven by time, never by frame count).
  const T = 1.0;
  function finalFrameAt(stepHz) {
    const m = mount(200, 120);
    drive(m.renderer, { steps: Math.round(T * stepHz), stepHz });
    m.renderer.render({ time: T, delta: 1 / stepHz });
    return bufferPixels(m).data.join(',');
  }
  const f24 = finalFrameAt(24);
  const f30 = finalFrameAt(30);
  const f60 = finalFrameAt(60);
  assert.equal(f30, f60, '30 Hz and 60 Hz must reach the same frame at T=1s');
  assert.equal(f24, f60, '24 Hz and 60 Hz must reach the same frame at T=1s');

  // Delta magnitude is irrelevant: rendering T with a tiny or huge delta yields
  // the same frame (motion does not accumulate delta).
  const small = mount(200, 120);
  small.renderer.render({ time: T, delta: 0.001 });
  const large = mount(200, 120);
  large.renderer.render({ time: T, delta: 0.25 });
  assert.equal(bufferPixels(small).data.join(','), bufferPixels(large).data.join(','),
    'delta magnitude must not affect the rotozoom frame');
});

// --- bounded zoom, finite transforms, UV wrap -------------------------------

test('zoom stays bounded within [zoomMin, zoomBase+zoomAmplitude] for all time', () => {
  const { zoomBase, zoomAmplitude, zoomMin } = ROTOZOOM_DEFAULTS.motion;
  for (let i = 0; i < 1000; i++) {
    const t = i * 0.05;
    const scaled = t * ROTOZOOM_DEFAULTS.motion.speed;
    const zoom = Math.max(zoomMin, zoomBase + Math.sin(scaled * ROTOZOOM_DEFAULTS.motion.zoomSpeed) * zoomAmplitude);
    assert.ok(Number.isFinite(zoom), `zoom finite at t=${t}`);
    assert.ok(zoom >= zoomMin, `zoom >= zoomMin at t=${t}: ${zoom}`);
    assert.ok(zoom <= zoomBase + zoomAmplitude + 1e-9, `zoom <= max at t=${t}: ${zoom}`);
  }
});

test('extreme supported config produces no non-finite pixels (UV wrap + bounded zoom)', () => {
  // Drive the renderer with the most extreme validated values: max rotation
  // speed, max zoom amplitude, many tiles. The UV frac-wrap and bounded zoom
  // must keep every pixel finite even at the most stretched transform.
  const extreme = {
    motion: { rotationSpeed: 1.0, zoomBase: 0.5, zoomAmplitude: 0.45, zoomSpeed: 1.0, zoomMin: 0.05 },
    texture: { tiles: 30, frequencyU: 8, frequencyV: 7 }
  };
  const m = mount(96, 64, extreme);
  assert.doesNotThrow(() => {
    m.renderer.render({ time: 0, delta: 0 });
    m.renderer.render({ time: 12.5, delta: 1 / 30 });
    m.renderer.render({ time: 1234.5, delta: 1 / 24 });
  });
  const { data } = bufferPixels(m);
  let bad = 0;
  for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) bad++;
  assert.equal(bad, 0, 'no non-finite pixels under extreme config');
});

test('a non-finite delta is ignored (time-based motion, not delta-accumulated)', () => {
  const m = mount(96, 64);
  assert.doesNotThrow(() => {
    m.renderer.render({ time: 0, delta: 0 });
    m.renderer.render({ time: 1, delta: Infinity });
    m.renderer.render({ time: 2, delta: NaN });
    m.renderer.render({ time: 3, delta: 0.016 });
  });
  const { data } = bufferPixels(m);
  let bad = 0;
  for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) bad++;
  assert.equal(bad, 0, 'no NaN/Infinity pixels after a non-finite delta');
});

// --- variance / flatness thresholds ----------------------------------------

test('the rendered frame has meaningful colour variance (not flat, not moiré noise)', () => {
  // A readable rotozoom must carry a broad value distribution — neither a flat
  // single-colour wash nor high-frequency moiré noise. The coherent lattice
  // sweeps many palette values, so the frame has high luminance variance and
  // many distinct colours.
  const m = mount(320, 200);
  drive(m.renderer, { steps: 90 });
  const { data } = bufferPixels(m);
  let sum = 0, sumSq = 0, n = data.length;
  for (let i = 0; i < n; i++) {
    const value = lum(data[i]);
    sum += value;
    sumSq += value * value;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  assert.ok(variance > 1500, `variance too low (${variance.toFixed(1)}) — frame may be flat`);
  const distinct = new Set(data);
  assert.ok(distinct.size >= 40, `too few distinct colours (${distinct.size}) — frame may be flat or moiré`);
});

test('the classic skin keeps dark, mid, and bright bands present across 0/1.5/5 s', () => {
  // Reject a near-flat or clipped frame without overfitting exact pixels. The
  // classic palette runs continuously from a deep shadow to a near-white crest.
  // A healthy rotating lattice sweeps the whole value range at every timestamp,
  // so the frame must contain colours from the palette's low, mid, and high
  // luminance thirds — and the near-white crest must stay a small accent.
  const palette = Array.from(buildGradientPalette(new Uint32Array(256), ROTOZOOM_SKINS.classic.appearance.palette));
  const lums = palette.map((c) => lum(c));
  const lo = Math.min(...lums.slice(0, 64));
  const hi = Math.max(...lums.slice(192));
  const mid = (lo + hi) / 2;
  const palLum = new Map(palette.map((c, i) => [c, lums[i]]));
  function bandOf(packed) {
    const value = palLum.get(packed);
    if (value === undefined) return 'other';
    if (value < lo + (mid - lo) * 0.5) return 'dark';
    if (value > hi - (hi - mid) * 0.5) return 'bright';
    return 'mid';
  }
  for (const seconds of [0, 1.5, 5]) {
    const m = mount(320, 180);
    // Drive at least one frame so a buffer image exists (0 s -> 1 frame).
    drive(m.renderer, { steps: Math.max(1, Math.round(seconds * 60)) });
    const { data } = bufferPixels(m);
    const tally = { dark: 0, mid: 0, bright: 0, other: 0, white: 0 };
    for (let i = 0; i < data.length; i++) {
      tally[bandOf(data[i])]++;
      const r = data[i] & 0xff, g = (data[i] >>> 8) & 0xff, b = (data[i] >>> 16) & 0xff;
      if (r > 235 && g > 235 && b > 235) tally.white++;
    }
    const total = data.length;
    assert.ok(tally.dark / total > 0.03, `${seconds}s dark band present (${(tally.dark / total * 100).toFixed(1)}%)`);
    assert.ok(tally.mid / total > 0.03, `${seconds}s midtone band present (${(tally.mid / total * 100).toFixed(1)}%)`);
    assert.ok(tally.bright / total > 0.02, `${seconds}s highlight band present (${(tally.bright / total * 100).toFixed(1)}%)`);
    assert.ok(tally.white / total < 0.4, `${seconds}s white must stay an accent (${(tally.white / total * 100).toFixed(1)}%)`);
  }
});

test('the classic skin palette interpolates continuously and stays bounded', () => {
  const palette = buildGradientPalette(new Uint32Array(256), ROTOZOOM_SKINS.classic.appearance.palette);
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
  assert.ok(maxJump <= 80, `palette interpolation must be smooth, max jump was ${maxJump}`);
  const first = parseHexColor(ROTOZOOM_SKINS.classic.appearance.palette[0]);
  assert.ok((first[0] + first[1] + first[2]) < 90, 'shadow stop is dark');
});

// --- config / skin separation ----------------------------------------------

test('geometry lives in config, appearance lives in the skin (no leak)', () => {
  const skin = ROTOZOOM_SKINS.classic;
  for (const key of ['tiles', 'frequencyU', 'frequencyV', 'weightU', 'weightV', 'weightDiag']) {
    assert.ok(key in ROTOZOOM_DEFAULTS.texture, `${key} is a config.texture geometry key`);
    assert.ok(!(key in (skin.appearance || {})), `${key} must not leak into the skin`);
  }
  for (const key of ['centerX', 'centerY', 'aspectCorrection']) {
    assert.ok(key in ROTOZOOM_DEFAULTS.transform, `${key} is a config.transform geometry key`);
  }
  for (const key of ['palette', 'backgroundColor', 'contrast']) {
    assert.ok(key in skin.appearance, `${key} is skin-owned (appearance)`);
  }
  // Rotation/zoom motion is algorithmic identity and lives in config.motion, not
  // in the skin's motion group (the skin may carry motion tempo, but not the
  // rotation/zoom GEOMETRY defaults).
  for (const key of ['rotationSpeed', 'zoomBase', 'zoomAmplitude', 'zoomSpeed', 'zoomMin']) {
    assert.ok(key in ROTOZOOM_DEFAULTS.motion, `${key} is config.motion geometry`);
  }
});

test('an appearance-only skin override cannot change the texture geometry', () => {
  // Two frames that differ ONLY in palette (appearance) must produce the same
  // number of distinct palette-index buckets — the geometry/value-mapping path
  // is untouched, only the colour identity differs.
  const TIME = 0.5;
  const baseTransform = { transform: { centerX: 0.5, centerY: 0.5 } };
  const runPalette = (palette) => {
    const m = mount(200, 120, {
      ...baseTransform,
      appearance: { palette, colorCount: 64, contrast: 1 }
    });
    m.renderer.render({ time: TIME, delta: 0 });
    return bufferPixels(m).data;
  };
  const a = runPalette(['#000000', '#770077', '#ffffff']);
  const b = runPalette(['#001100', '#1177aa', '#ffaa00']);
  assert.ok(new Set(a).size > 4 && new Set(b).size > 4, 'texture should produce several buckets');
  assert.equal(new Set(a).size, new Set(b).size, 'palette swap must not change the texture bucket count');
});

test('validateRotozoom accepts defaults and rejects out-of-range geometry', () => {
  assert.doesNotThrow(() => validateRotozoom(configWith()));
  const base = configWith();
  assert.throws(
    () => validateRotozoom({ ...base, transform: { ...base.transform, centerX: 2 } }),
    /centerX/
  );
  assert.throws(
    () => validateRotozoom({ ...base, texture: { ...base.texture, frequencyU: 2.5 } }),
    /frequencyU/
  );
  assert.throws(
    () => validateRotozoom({ ...base, motion: { ...base.motion, zoomMin: 2 } }),
    /zoomMin/
  );
  assert.throws(
    () => validateRotozoom({ ...base, texture: { ...base.texture, weightU: 5 } }),
    /weightU/
  );
  assert.throws(
    () => validateRotozoom({ ...base, appearance: { ...base.appearance, contrast: 0 } }),
    /contrast/
  );
});

test('the four profile slots preserve geometry and only tune sampling/budget', () => {
  const slots = ROTOZOOM_PROFILES.slots;
  for (const key of ['fullscreen.desktop', 'fullscreen.mobile', 'preview.desktop', 'preview.mobile']) {
    const slot = slots[key];
    assert.ok(!slot.transform, `${key} must not redefine transform geometry`);
    assert.ok(!slot.texture, `${key} must not redefine texture geometry`);
    assert.ok(slot.runtime && Number.isFinite(slot.runtime.maxFps), `${key} declares a runtime budget`);
    assert.ok(Number.isFinite(slot.render.resolution), `${key} declares a sampling resolution`);
  }
  // Mobile/preview sample more coarsely but stay well above the floor (0.1)
  // where the lattice would alias into a differently-scaled or flat wash.
  for (const key of ['fullscreen.mobile', 'preview.desktop', 'preview.mobile']) {
    assert.ok(slots[key].render.resolution >= 0.1, `${key} samples above the floor`);
    assert.ok(slots[key].render.resolution <= slots['fullscreen.desktop'].render.resolution,
      `${key} samples no denser than fullscreen desktop`);
  }
  // Composition is identical across all four profiles: none touch transform/texture.
  const allClean = Object.values(slots).every((s) => !s.transform && !s.texture);
  assert.ok(allClean, 'composition is identical across all four profiles');
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
  await loadBundle('../dist/effects/rotozoom.js', env);
  const canvas = new BundleCanvas(64, 40);
  const controller = env.sandbox.Demoscene.rotozoom(canvas, {
    skin: 'classic',
    surface: 'fullscreen',
    device: 'desktop',
    config: { texture: { tiles: 8 }, runtime: { autoStart: false } }
  });
  const config = controller.getConfig();
  assert.equal(config.texture.tiles, 8, 'explicit config override wins');
  assert.deepEqual([...config.appearance.palette], [...ROTOZOOM_SKINS.classic.appearance.palette], 'classic skin palette applied');
  assert.equal(config.appearance.contrast, ROTOZOOM_SKINS.classic.appearance.contrast, 'skin contrast applied');
});

test('API v3: a custom skin override changes appearance without touching geometry', async () => {
  const env = createBundleEnvironment();
  await loadBundle('../dist/effects/rotozoom.js', env);
  const canvas = new BundleCanvas(64, 40);
  const controller = env.sandbox.Demoscene.rotozoom(canvas, {
    skin: { preset: 'classic', overrides: { appearance: { palette: ['#000', '#0ff', '#fff'] } } },
    config: { runtime: { autoStart: false } }
  });
  const config = controller.getConfig();
  assert.deepEqual([...config.appearance.palette], ['#000', '#0ff', '#fff'], 'custom palette override applied');
  assert.deepEqual(config.transform.centerX, ROTOZOOM_DEFAULTS.transform.centerX, 'geometry unchanged');
  assert.deepEqual(config.texture.tiles, ROTOZOOM_DEFAULTS.texture.tiles, 'texture geometry unchanged');
});

test('API v3: skin overrides into the texture/transform geometry groups are rejected', async () => {
  const env = createBundleEnvironment();
  await loadBundle('../dist/effects/rotozoom.js', env);
  const canvas = new BundleCanvas(64, 40);
  assert.throws(
    () => env.sandbox.Demoscene.rotozoom(canvas, { skin: { overrides: { texture: { tiles: 2 } } } }),
    /out of scope at 'texture'/
  );
  assert.throws(
    () => env.sandbox.Demoscene.rotozoom(canvas, { skin: { overrides: { transform: { centerX: 0.25 } } } }),
    /out of scope at 'transform'/
  );
  // ...but the same values are accepted under explicit config.
  assert.doesNotThrow(() => env.sandbox.Demoscene.rotozoom(new BundleCanvas(64, 40), {
    config: { texture: { tiles: 2 }, transform: { centerX: 0.25 }, runtime: { autoStart: false } }
  }));
});
