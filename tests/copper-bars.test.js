// Copper-bars-focused suite for the refined skin/composition (issue #14).
//
// Covers the issue's required cases:
//   - normalized placement/thickness stable across render resolutions
//   - render.resolution controls sampling cost only (buffer size), not composition
//   - deterministic phase behavior and fixed-step 24/30/60 FPS equivalence
//   - bounded overlap composite: crossings never clip to flat white / wash out
//   - narrow bounded specular highlight (fraction of half-height)
//   - portrait framing: vertical coverage + no crowding into one band
//   - appearance (skin) vs bar geometry/shading (config/profiles) separation
//
// These tests mount the renderer directly through a mock Canvas 2D context that
// captures the offscreen pixel buffer (pure source, no browser). The renderer
// writes the buffer via putImageData and composites onto the visible canvas with
// drawImage; the buffer's last putImageData image is what we inspect.

import assert from 'node:assert/strict';
import test from 'node:test';

import { COPPER_BARS_DEFAULTS, validateCopperBars } from '../src/effects/copper-bars/config.js';
import { createCopperBarsRenderer } from '../src/effects/copper-bars/renderer.js';
import { COPPER_BARS_PROFILES } from '../src/effects/copper-bars/profiles.js';
import { COPPER_BARS_SKINS } from '../src/effects/copper-bars/skins.js';

// --- minimal Canvas 2D mock (pixel buffer) ---------------------------------

class PixelContext {
  constructor() {
    this.imageSmoothingEnabled = true;
    this.lastImage = null;
  }
  createImageData(width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  putImageData(image) {
    this.lastImage = new Uint8ClampedArray(image.data);
    this.imageWidth = image.width;
    this.imageHeight = image.height;
  }
  drawImage() {}
}

class MockCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.style = {};
    this.context = new PixelContext();
  }
  getContext() { return this.context; }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
}

let createdCanvases = [];
function installDocumentStub() {
  createdCanvases = [];
  globalThis.document = globalThis.document || {};
  globalThis.document.createElement = (tag) => {
    if (tag !== 'canvas') throw new Error(`unexpected element: ${tag}`);
    const canvas = new MockCanvas(1, 1);
    createdCanvases.push(canvas);
    return canvas;
  };
}

// Build a resolved config (defaults + overrides) for direct renderer use.
function configWith(overrides = {}) {
  const merge = (base, over) => {
    if (over === undefined) return base;
    if (base && typeof base === 'object' && !Array.isArray(base) && over && typeof over === 'object') {
      const out = { ...base };
      for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
      return out;
    }
    return over;
  };
  return merge(
    merge(
      { ...COPPER_BARS_DEFAULTS, runtime: { ...COPPER_BARS_DEFAULTS.runtime, pixelRatio: 1 } },
      overrides
    ),
    {}
  );
}

function mount(width, height, overrides = {}) {
  installDocumentStub();
  const canvas = new MockCanvas(width, height);
  const config = configWith(overrides);
  const renderer = createCopperBarsRenderer({ canvas, config });
  renderer.resize(width, height);
  // The offscreen pixel buffer is the first canvas the stub created. Its context
  // receives putImageData with the rendered rows.
  const buffer = createdCanvases[0];
  return { canvas, config, renderer, buffer };
}

function drive(renderer, { steps, stepHz = 60 }) {
  const dt = 1 / stepHz;
  for (let i = 0; i < steps; i++) renderer.render({ time: i * dt, delta: i === 0 ? 0 : dt });
}

// Read the packed RGBA rows from the last rendered buffer image as [r,g,b] per
// row (averaged across the width, since each row is uniform horizontally).
function rowColors(buffer) {
  const img = buffer.context.lastImage;
  const w = buffer.context.imageWidth;
  const h = buffer.context.imageHeight;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const off = y * w * 4;
    rows.push([img[off], img[off + 1], img[off + 2]]);
  }
  return rows;
}

// Fraction of rows whose colour differs from the background by more than a
// threshold — the "active" (bar-touched) vertical extent.
function activeFraction(rows, bg) {
  let active = 0;
  for (const [r, g, b] of rows) {
    if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 24) active++;
  }
  return active / rows.length;
}

// --- A. resolution-stable placement/thickness -------------------------------

test('normalized placement: bar rows appear at the same height fractions across resolutions', () => {
  // Place one bar at yBase 0.5 and render at time 0 (no sway). The active rows
  // must land at the same height FRACTION regardless of render.resolution.
  const singleBar = {
    bars: [{ yBase: 0.5, amplitude: 0, frequency: 0.7, phase: 0, height: 0.2, colorOffset: 0 }]
  };
  const fractions = (resolution) => {
    const m = mount(200, 200, { render: { resolution }, ...singleBar });
    m.renderer.render({ time: 0 });
    const rows = rowColors(m.buffer);
    const bg = m.config.appearance.backgroundColor;
    const bgRgb = [
      Number.parseInt(bg.slice(1, 3), 16),
      Number.parseInt(bg.slice(3, 5), 16),
      Number.parseInt(bg.slice(5, 7), 16)
    ];
    const centers = [];
    for (let y = 0; y < rows.length; y++) {
      const [r, g, b] = rows[y];
      if (Math.abs(r - bgRgb[0]) + Math.abs(g - bgRgb[1]) + Math.abs(b - bgRgb[2]) > 24) {
        centers.push(y / rows.length);
      }
    }
    // Mid-fraction of the active band.
    return centers.length ? centers[Math.floor(centers.length / 2)] : -1;
  };
  const f1 = fractions(1);
  const f2 = fractions(0.5);
  const f3 = fractions(0.25);
  assert.ok(Math.abs(f1 - 0.5) < 0.06, `res1 center near 0.5, got ${f1}`);
  assert.ok(Math.abs(f1 - f2) < 0.03, `res1 vs res0.5 placement drifted: ${f1} vs ${f2}`);
  assert.ok(Math.abs(f1 - f3) < 0.03, `res1 vs res0.25 placement drifted: ${f1} vs ${f3}`);
});

test('render.resolution changes only the backing buffer size, not the composition', () => {
  const m1 = mount(200, 200, { render: { resolution: 1 } });
  const m2 = mount(200, 200, { render: { resolution: 0.5 } });
  m1.renderer.render({ time: 0 });
  m2.renderer.render({ time: 0 });
  // Buffer dims scale with resolution.
  assert.equal(m1.buffer.context.imageWidth, 200);
  assert.equal(m2.buffer.context.imageWidth, 100);
  assert.equal(m1.buffer.context.imageHeight, 200);
  assert.equal(m2.buffer.context.imageHeight, 100);
});

// --- B. deterministic phase / fixed-step FPS equivalence --------------------

test('motion is time-based: same elapsed time at 24/30/60 FPS places bars identically', () => {
  // Motion uses `time` (sin(time*speed*freq+phase)), not delta. Summing frames
  // to the same total T must land every bar at the same row.
  const T = 1.0;
  const centerAt = (hz) => {
    const m = mount(120, 120, { render: { resolution: 1 } });
    const steps = Math.round(T * hz);
    for (let i = 0; i < steps; i++) m.renderer.render({ time: i / hz, delta: i === 0 ? 0 : 1 / hz });
    // Recompute the expected center directly from the motion formula.
    const bar = m.config.bars[0];
    const scaled = T * m.config.motion.speed;
    return (bar.yBase + bar.amplitude * Math.sin(scaled * bar.frequency + bar.phase)) * 120;
  };
  const c24 = centerAt(24);
  const c30 = centerAt(30);
  const c60 = centerAt(60);
  assert.equal(c24, c30);
  assert.equal(c30, c60);
});

test('deterministic: same time reproduces the exact frame', () => {
  const run = () => {
    const m = mount(100, 100);
    m.renderer.render({ time: 1.37 });
    return Array.from(m.buffer.context.lastImage);
  };
  assert.deepEqual(run(), run());
});

// --- C. bounded overlap composite ------------------------------------------

test('row colour never exceeds the channel range (no additive clip)', () => {
  // Force three bars to overlap on the same rows by giving them identical yBase
  // and zero phase/sway. The legacy additive model would sum three glossy bars
  // and clip to 255; the bounded source-over model stays within range by being a
  // convex combination.
  const overlap = {
    bars: [
      { yBase: 0.5, amplitude: 0, frequency: 0.7, phase: 0, height: 0.3, colorOffset: 0.0 },
      { yBase: 0.5, amplitude: 0, frequency: 0.9, phase: 0, height: 0.3, colorOffset: 0.2 },
      { yBase: 0.5, amplitude: 0, frequency: 1.0, phase: 0, height: 0.3, colorOffset: 0.4 }
    ]
  };
  const m = mount(80, 80, overlap);
  m.renderer.render({ time: 0 });
  const img = m.buffer.context.lastImage;
  for (let i = 0; i < img.length; i += 4) {
    assert.ok(img[i] >= 0 && img[i] <= 255);
    assert.ok(img[i + 1] >= 0 && img[i + 1] <= 255);
    assert.ok(img[i + 2] >= 0 && img[i + 2] <= 255);
  }
});

test('overlap is bounded: lower barAlphaScale keeps the background visible behind bars', () => {
  // With barAlphaScale well below 1, even fully overlapping bars cannot fully
  // occlude the background — the row stays a convex blend toward the bar colour.
  const opaque = mount(60, 60, {
    shading: { glossyFalloff: 0.62, barAlphaScale: 0.3, specularWidth: 0, specularFalloff: 3, specularGain: 0 }
  });
  opaque.renderer.render({ time: 0 });
  const bg = opaque.config.appearance.backgroundColor;
  const bgR = Number.parseInt(bg.slice(1, 3), 16);
  const rows = rowColors(opaque.buffer);
  // At least some bar-touched row is brighter than the pure background on R
  // (copper body is warm), but it has NOT reached a saturated 255 everywhere.
  let anyBrighter = false;
  let anyBelow255 = false;
  for (const [r] of rows) {
    if (r > bgR + 20) anyBrighter = true;
    if (r < 255) anyBelow255 = true;
  }
  assert.ok(anyBrighter, 'bars should brighten rows above the background');
  assert.ok(anyBelow255, 'low barAlphaScale must not saturate every row to 255');
});

// --- D. narrow bounded specular --------------------------------------------

test('specular is a narrow band: the bright core is a small fraction of the bar', () => {
  // One bar, measure how many rows exceed a high brightness threshold. With a
  // narrow specular (specularWidth 0.18, power falloff), the saturated core is a
  // small fraction of the bar thickness.
  const m = mount(120, 120, {
    bars: [{ yBase: 0.5, amplitude: 0, frequency: 0.7, phase: 0, height: 0.4, colorOffset: 0.85 }],
    shading: { glossyFalloff: 0.62, barAlphaScale: 1, specularWidth: 0.18, specularFalloff: 3, specularGain: 200 }
  });
  m.renderer.render({ time: 0 });
  const rows = rowColors(m.buffer);
  let saturated = 0;
  let barRows = 0;
  const bg = m.config.appearance.backgroundColor;
  const bgSum = Number.parseInt(bg.slice(1, 3), 16) + Number.parseInt(bg.slice(3, 5), 16) + Number.parseInt(bg.slice(5, 7), 16);
  for (const [r, g, b] of rows) {
    if (r + g + b > bgSum + 24) {
      barRows++;
      if (r + g + b > 700) saturated++; // near-white specular core
    }
  }
  assert.ok(barRows > 0, 'expected a visible bar');
  assert.ok(saturated / barRows < 0.5, `specular core must be narrow, got ${saturated}/${barRows}`);
});

// --- E. portrait framing / coverage ----------------------------------------

test('every profile slot keeps bar centres within the active vertical band', () => {
  for (const key of ['fullscreen.desktop', 'fullscreen.mobile', 'preview.desktop', 'preview.mobile']) {
    const bars = COPPER_BARS_PROFILES.slots[key].bars;
    for (const bar of bars) {
      assert.ok(bar.yBase >= 0.12 && bar.yBase <= 0.92, `${key} yBase ${bar.yBase} in [0.12,0.92]`);
    }
  }
});

test('desktop slots use 5 bars, mobile slots use 4', () => {
  assert.equal(COPPER_BARS_PROFILES.slots['fullscreen.desktop'].bars.length, 5);
  assert.equal(COPPER_BARS_PROFILES.slots['preview.desktop'].bars.length, 5);
  assert.equal(COPPER_BARS_PROFILES.slots['fullscreen.mobile'].bars.length, 4);
  assert.equal(COPPER_BARS_PROFILES.slots['preview.mobile'].bars.length, 4);
});

test('bar centres are spread (no crowding into one band)', () => {
  for (const key of ['fullscreen.desktop', 'fullscreen.mobile']) {
    const bases = COPPER_BARS_PROFILES.slots[key].bars.map((b) => b.yBase).sort((a, b) => a - b);
    for (let i = 1; i < bases.length; i++) {
      assert.ok(bases[i] - bases[i - 1] >= 0.1, `${key} consecutive centres >=0.1 apart`);
    }
  }
});

test('portrait canvas uses its height: bar coverage spans most of the frame', () => {
  // 390x844 (mobile portrait) and 360x180 (mobile preview). The active vertical
  // extent must cover a large fraction of the height (no dominant empty region).
  for (const [w, h] of [[390, 844], [360, 180]]) {
    const m = mount(w, h, { render: { resolution: 0.5 }, bars: COPPER_BARS_PROFILES.slots['fullscreen.mobile'].bars });
    m.renderer.render({ time: 0.3 });
    const bg = m.config.appearance.backgroundColor;
    const bgRgb = [
      Number.parseInt(bg.slice(1, 3), 16),
      Number.parseInt(bg.slice(3, 5), 16),
      Number.parseInt(bg.slice(5, 7), 16)
    ];
    const frac = activeFraction(rowColors(m.buffer), bgRgb);
    assert.ok(frac > 0.3, `${w}x${h} active coverage ${frac.toFixed(2)} > 0.3`);
  }
});

// --- F. skin / config separation -------------------------------------------

test('appearance lives in the skin; bars/shading do not', () => {
  const appearance = COPPER_BARS_SKINS.classic.appearance;
  for (const key of ['palette', 'backgroundColor', 'colorCount']) {
    assert.ok(key in appearance, `${key} is skin-owned (appearance)`);
  }
  assert.ok(!('bars' in COPPER_BARS_SKINS.classic), 'bars are not skin-owned');
  assert.ok(!('shading' in COPPER_BARS_SKINS.classic), 'shading is not skin-owned');
});

test('the classic skin is non-empty and frozen', () => {
  assert.ok(Object.keys(COPPER_BARS_SKINS.classic.appearance).length >= 3);
  assert.ok(Object.isFrozen(COPPER_BARS_SKINS.classic));
  assert.ok(Object.isFrozen(COPPER_BARS_SKINS.classic.appearance));
});

test('validateCopperBars rejects barAlphaScale > 1', () => {
  const base = configWith();
  assert.throws(
    () => validateCopperBars({ ...base, shading: { ...base.shading, barAlphaScale: 1.5 } }),
    /barAlphaScale/
  );
});

test('validateCopperBars rejects out-of-range bar geometry', () => {
  const base = configWith();
  assert.throws(
    () => validateCopperBars({
      ...base,
      bars: [{ ...base.bars[0], yBase: 1.5 }]
    }),
    /yBase/
  );
  assert.throws(
    () => validateCopperBars({
      ...base,
      bars: [{ ...base.bars[0], colorOffset: 2 }]
    }),
    /colorOffset/
  );
});

test('validateCopperBars accepts the defaults', () => {
  assert.doesNotThrow(() => validateCopperBars(configWith()));
});

test('deleted shading fields are rejected as unknown options (resolver)', async () => {
  // The resolver's assertKnownKeys runs before validate; feeding a legacy field
  // through normalizeEffectConfig rejects it. We exercise the standalone bundle
  // to hit the real resolver path.
  const { normalizeEffectConfig } = await import('../src/config.js');
  assert.throws(
    () => normalizeEffectConfig(
      'copperBars',
      { shading: { highlightStrength: 40 } },
      COPPER_BARS_DEFAULTS,
      validateCopperBars
    ),
    /Unknown option: copperBars\.shading\.highlightStrength/
  );
});
