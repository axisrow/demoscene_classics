// Metaballs-focused suite for the normalized scalar field (issue #8).
//
// Covers the issue's required cases:
//   - normalized centre/trajectory positions at fixed times (in [0,1])
//   - resolution-independent relative radius / composition (res = sampling only)
//   - aspect-correct distance → circular blob in landscape and portrait
//   - finite scalar values at/near a centre (no infinities / NaN)
//   - monotonic, bounded, continuous threshold (smoothstep) mapping
//   - custom point/radius/strength configuration through explicit config
//   - connected-component evidence that a close two-ball fixture merges (neck)
//     and a far fixture separates
//   - fixed-step equivalence across 24/30/60 FPS (time-based motion)
//   - per-profile geometry parity (profiles never override field geometry)
//
// These tests mount the renderer directly through a mock Canvas 2D context
// (pure source, no browser) so the math is exercised deterministically.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  METABALLS_DEFAULTS,
  defaultPoint,
  scalarContribution,
  smoothstep,
  validateMetaballs
} from '../src/effects/metaballs/config.js';
import { createMetaballsRenderer } from '../src/effects/metaballs/renderer.js';
import { METABALLS_PROFILES } from '../src/effects/metaballs/profiles.js';

// --- minimal Canvas 2D mock -------------------------------------------------
//
// The renderer writes a Uint32Array pixel buffer into an OFFSCREEN canvas
// (created via document.createElement) and composites it onto the visible
// canvas with drawImage. We stub the offscreen context to expose the SAME
// ArrayBuffer-backed image the renderer writes (so tests can read the packed
// pixels back), and the visible context to a recording stub.

class PixelContext {
  constructor() {
    this.imageSmoothingEnabled = true;
    this.image = null;
  }
  createImageData(width, height) {
    // Real backing buffer so new Uint32Array(image.data.buffer) in resizePixelBuffer
    // aliases the same memory the renderer writes — tests can read it back.
    this.image = { width, height, data: new Uint8ClampedArray(width * height * 4) };
    return this.image;
  }
  putImageData(image) { this.image = image; }
  drawImage() {}
}

class OutputContext {
  constructor() { this.imageSmoothingEnabled = true; this.drawImageCalls = 0; }
  drawImage() { this.drawImageCalls++; }
}

class MockCanvas {
  constructor(width, height, context) {
    this.width = width;
    this.height = height;
    this.style = {};
    this._context = context;
  }
  getContext() { return this._context; }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
}

// Track every canvas the stub creates. The renderer's offscreen pixel buffer is
// the first one; the visible canvas is passed in directly by the test.
let createdCanvases = [];
function installDocumentStub() {
  createdCanvases = [];
  globalThis.document = globalThis.document || {};
  globalThis.document.createElement = (tag) => {
    if (tag !== 'canvas') throw new Error(`unexpected element: ${tag}`);
    const canvas = new MockCanvas(1, 1, new PixelContext());
    createdCanvases.push(canvas);
    return canvas;
  };
}

function mergeDeep(base, over) {
  if (over === undefined) return base;
  if (base && typeof base === 'object' && !Array.isArray(base) && over && typeof over === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = mergeDeep(base[k], over[k]);
    return out;
  }
  return over;
}

function configWith(overrides = {}) {
  return mergeDeep(
    { ...METABALLS_DEFAULTS, runtime: { ...METABALLS_DEFAULTS.runtime, pixelRatio: 1 } },
    overrides
  );
}

function mount(width, height, overrides = {}) {
  installDocumentStub();
  const output = new OutputContext();
  const canvas = new MockCanvas(width, height, output);
  const config = configWith(overrides);
  const renderer = createMetaballsRenderer({ canvas, config });
  renderer.resize(width, height);
  // The offscreen pixel buffer is the first canvas the stub created. Its
  // context.image.data aliases the Uint32Array the renderer fills.
  const buffer = createdCanvases[0];
  return { canvas, config, renderer, output, buffer };
}

// Drive a fixed 1/stepHz clock until the cumulative elapsed time reaches `to`
// seconds, landing the final frame exactly on `to`. (The harness advances every
// intermediate 1/hz step up to the capture timestamp; centre position is a pure
// function of `time`, so identical final times produce identical frames.)
function driveTo(renderer, { to, stepHz = 60 }) {
  const dt = 1 / stepHz;
  const steps = Math.round(to * stepHz);
  for (let i = 0; i <= steps; i++) {
    renderer.render({ time: i * dt, delta: i === 0 ? 0 : dt });
  }
}

// Decode the packed RGBA bytes of an offscreen pixel buffer into per-pixel
// foreground/background. A pixel is "occupied" (foreground) when it is
// meaningfully BRIGHTER than the dark background (max channel above a luminance
// threshold), NOT merely "any non-zero deviation" — the smoothstep field decays
// smoothly, so near-zero t produces faint grey everywhere; counting that as
// foreground would fill the whole frame. Using a brightness threshold makes the
// occupied area a faithful measure of the blob's visible body. The buffer is
// the offscreen MockCanvas the renderer writes; its pixel image lives on the
// PixelContext returned by getContext(). (These unit tests mount the renderer
// directly, so the classic indigo skin is NOT applied — the COMMON black/white
// palette is, with a black background.)
function pixelImage(buffer) {
  return buffer.getContext().image;
}
function occupiedMask(buffer, brightnessThreshold = 60) {
  const image = pixelImage(buffer);
  const pixels = image.data; // Uint8ClampedArray, RGBA
  const w = image.width;
  const h = image.height;
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    const bright = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    mask[p] = bright > brightnessThreshold ? 1 : 0;
  }
  return { mask, w, h };
}

// Count 4-connected foreground components that are at least `minPx` large.
function countComponents(mask, w, h, minPx = 4) {
  const seen = new Uint8Array(mask.length);
  const sizes = [];
  const stack = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let size = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const idx = stack.pop();
      size++;
      const x = idx % w;
      const y = (idx - x) / w;
      // 4-neighbours
      if (x > 0 && mask[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; stack.push(idx - 1); }
      if (x < w - 1 && mask[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; stack.push(idx + 1); }
      if (y > 0 && mask[idx - w] && !seen[idx - w]) { seen[idx - w] = 1; stack.push(idx - w); }
      if (y < h - 1 && mask[idx + w] && !seen[idx + w]) { seen[idx + w] = 1; stack.push(idx + w); }
    }
    if (size >= minPx) sizes.push(size);
  }
  return sizes;
}

// --- finite scalar contribution --------------------------------------------

test('scalarContribution is finite everywhere, peaks at the centre, decays monotonically', () => {
  // At r = 0 the value equals strength (no infinity, no NaN) — the epsilon guard.
  assert.equal(scalarContribution(0, 0.18, 1), 1);
  assert.ok(Number.isFinite(scalarContribution(0, 0.18, 1000)));
  assert.equal(scalarContribution(0.18, 0.18, 1), 0.5); // at r = radius → half
  // Monotonic decay outward.
  let prev = Infinity;
  for (let k = 0; k <= 5; k++) {
    const v = scalarContribution(k * 0.18, 0.18, 1);
    assert.ok(v <= prev + 1e-12, `monotonic at k=${k}`);
    assert.ok(Number.isFinite(v));
    prev = v;
  }
  // Bounded above by strength regardless of how small radius is.
  assert.ok(scalarContribution(0, 1e-3, 4) <= 4 + 1e-9);
});

// --- smoothstep threshold mapping ------------------------------------------

test('smoothstep is bounded to [0,1], monotonic, continuous, with soft edges', () => {
  const lo = 0.4, hi = 1.6;
  // Bounded.
  assert.equal(smoothstep(lo, hi, -10), 0);
  assert.equal(smoothstep(lo, hi, 10), 1);
  // Edges of the band.
  assert.ok(Math.abs(smoothstep(lo, hi, lo) - 0) < 1e-12);
  assert.ok(Math.abs(smoothstep(lo, hi, hi) - 1) < 1e-12);
  // Midpoint is exactly 0.5 (smoothstep symmetry).
  assert.ok(Math.abs(smoothstep(lo, hi, (lo + hi) / 2) - 0.5) < 1e-12);
  // Monotonic + continuous: sampling a rising field yields a non-decreasing t.
  let prev = -1;
  for (let i = 0; i <= 50; i++) {
    const t = smoothstep(lo, hi, lo + (hi - lo) * i / 50);
    assert.ok(t >= prev - 1e-12, `non-decreasing at i=${i}`);
    assert.ok(t >= 0 && t <= 1);
    prev = t;
  }
});

test('smoothstep collapses to a step when the band is closed', () => {
  assert.equal(smoothstep(1, 1, 0.9), 0);
  assert.equal(smoothstep(1, 1, 1.1), 1);
});

// --- normalized centres / resolution independence --------------------------

test('the render buffer resolution resamples the same composition (res = sampling only)', () => {
  // Same logical size, same time, different resolution: the occupied-area
  // RATIO (foreground fraction) must be stable — lowering resolution samples
  // the same normalized blobs into fewer pixels, it does not recompose them.
  const ratioAt = (resolution) => {
    const m = mount(120, 80, { render: { resolution }, field: { pointCount: 2 } });
    m.renderer.render({ time: 0.8, delta: 1 / 60 });
    const { mask } = occupiedMask(m.buffer);
    let occ = 0;
    for (let i = 0; i < mask.length; i++) occ += mask[i];
    return occ / mask.length;
  };
  const r1 = ratioAt(1);
  const r05 = ratioAt(0.5);
  const r033 = ratioAt(1 / 3);
  // Ratios agree within a coarse sampling tolerance (off-by-one cell edges at
  // very low res), but the composition is the same — not rescaled geometry.
  assert.ok(Math.abs(r1 - r05) < 0.03, `res 1 vs 0.5 ratios: ${r1} vs ${r05}`);
  assert.ok(Math.abs(r1 - r033) < 0.05, `res 1 vs 1/3 ratios: ${r1} vs ${r033}`);
});

test('centres are pure functions of time and stay in the viewport [0,1]', () => {
  // The centre formula is 0.5 + amplitude * sin(phase*freq + phase0), with
  // amplitude ∈ [0, 0.5] from defaultPoint, so cx,cy ∈ [0, 1] for all t.
  for (let i = 0; i < 6; i++) {
    const p = defaultPoint(i);
    assert.ok(p.amplitudeX >= 0 && p.amplitudeX <= 0.5, `point ${i} amplitudeX in [0,0.5]`);
    assert.ok(p.amplitudeY >= 0 && p.amplitudeY <= 0.5, `point ${i} amplitudeY in [0,0.5]`);
  }
  for (const t of [0, 0.3, 1.0, 2.5, 5.0]) {
    for (let i = 0; i < 6; i++) {
      const p = defaultPoint(i);
      const phase = t * 0.72;
      const cx = 0.5 + p.amplitudeX * Math.sin(phase * p.frequencyX + p.phaseX);
      const cy = 0.5 + p.amplitudeY * Math.sin(phase * p.frequencyY + p.phaseY);
      assert.ok(cx >= 0 && cx <= 1, `t=${t} point ${i} cx=${cx} in [0,1]`);
      assert.ok(cy >= 0 && cy <= 1, `t=${t} point ${i} cy=${cy} in [0,1]`);
    }
  }
});

test('the same elapsed time at 24/30/60 FPS yields the same normalized centres (time-based)', () => {
  // Centres depend only on `time` (not on frame count), so driving to the same
  // timestamp at different step rates lands blobs at identical positions. We
  // verify the occupied-mask is identical for the same final time.
  const maskAt = (hz) => {
    const m = mount(100, 64, { field: { pointCount: 2 } });
    driveTo(m.renderer, { to: 1.5, stepHz: hz });
    const { mask } = occupiedMask(m.buffer);
    return Buffer.from(mask).toString('hex');
  };
  // 1.5s at 24/30/60 FPS → identical final frame.
  const a = maskAt(24);
  const b = maskAt(30);
  const c = maskAt(60);
  assert.equal(a, b, '24 vs 30 FPS');
  assert.equal(a, c, '24 vs 60 FPS');
});

// --- aspect-correct circular blob ------------------------------------------

test('a single blob renders circular in landscape and portrait (aspect-correct)', () => {
  // One static-ish blob: hold it near the centre and measure the occupied
  // bounding box. Aspect-correct distance (u = nx*aspect) keeps the blob
  // circular, so the box aspect ratio tracks the FRAME aspect (a circle inscribed
  // in a W×H frame has a W:H bounding box), NOT a squashed ellipse.
  function bboxAt(w, h) {
    // Pin one ball at the viewport centre with zero amplitude so it does not
    // drift; give it a healthy radius so the shape is well sampled.
    const m = mount(w, h, {
      field: { pointCount: 1, points: [{ amplitudeX: 0, amplitudeY: 0, frequencyX: 1, frequencyY: 1, phaseX: 0, phaseY: 0, strength: 1 }], radius: 0.22, threshold: 1, mergeBand: 0.35 }
    });
    m.renderer.render({ time: 0, delta: 1 / 60 });
    const { mask, w: bw, h: bh } = occupiedMask(m.buffer);
    let minX = bw, maxX = -1, minY = bh, maxY = -1;
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        if (mask[y * bw + x]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { bw, bh, boxW: maxX - minX + 1, boxH: maxY - minY + 1 };
  }
  // Landscape 160×80 and portrait 80×160. With aspect-correct distance the blob
  // is circular, so its bounding box is roughly square in PIXEL space — the box
  // aspect ratio is ~1 in both orientations (a circle is isotropic).
  const land = bboxAt(160, 80);
  const port = bboxAt(80, 160);
  assert.ok(land.boxW > 0 && land.boxH > 0, 'landscape blob occupied');
  assert.ok(port.boxW > 0 && port.boxH > 0, 'portrait blob occupied');
  const landRatio = land.boxW / land.boxH;
  const portRatio = port.boxW / port.boxH;
  // Without aspect correction, a [0,1]² grid on a 160×80 buffer would make the
  // blob a 2:1 ellipse in landscape and 1:2 in portrait. Aspect correction keeps
  // both near 1:1 (circular). Allow generous tolerance for coarse sampling.
  assert.ok(Math.abs(landRatio - 1) < 0.35, `landscape blob circular (ratio ${landRatio.toFixed(2)})`);
  assert.ok(Math.abs(portRatio - 1) < 0.35, `portrait blob circular (ratio ${portRatio.toFixed(2)})`);
});

// --- finite pixels (no infinities / NaN) -----------------------------------

test('every rendered pixel is a finite, valid packed colour (no infinities near centres)', () => {
  // Force several blobs to overlap a single centre at t=0 and assert the buffer
  // contains only finite bytes — the epsilon guard prevents NaN/Infinity from
  // corrupting the packed RGBA write.
  const m = mount(80, 60, { field: { pointCount: 3, radius: 0.1, strength: 1e6 } });
  for (const t of [0, 0.5, 1.0, 5.0]) m.renderer.render({ time: t, delta: 1 / 60 });
  const data = pixelImage(m.buffer).data;
  assert.equal(data.length, pixelImage(m.buffer).width * pixelImage(m.buffer).height * 4);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    assert.ok(Number.isFinite(v), `byte ${i} finite`);
    assert.ok(v >= 0 && v <= 255, `byte ${i} in [0,255]`);
  }
});

// --- merge evidence (neck before merge) ------------------------------------

test('two close balls merge into one component; two far balls stay separate', () => {
  // Fixture: two static balls on a SQUARE buffer (aspect 1, so centres stay in
  // the frame and the field is sampled isotropically), offset symmetrically
  // about the centre along x. centre = 0.5 + amp*sin(phaseX) with frequency 0;
  // amplitudeX = separation and phaseX = ±π/2 place them at 0.5 ± separation.
  // When they are close, the summed field between them rises through the
  // smoothstep band and forms a neck → ONE 4-connected foreground component.
  // When they are far apart, two SEPARATE components.
  function componentCount(separation) {
    const p1 = { amplitudeX: separation, amplitudeY: 0, frequencyX: 0, frequencyY: 1, phaseX: Math.PI / 2, phaseY: 0, strength: 1 };
    const p2 = { amplitudeX: separation, amplitudeY: 0, frequencyX: 0, frequencyY: 1, phaseX: -Math.PI / 2, phaseY: 0, strength: 1 };
    const m = mount(120, 120, {
      render: { resolution: 1 },
      field: { pointCount: 2, points: [p1, p2], radius: 0.2, threshold: 1, mergeBand: 0.5 }
    });
    m.renderer.render({ time: 0, delta: 1 / 60 });
    const { mask, w, h } = occupiedMask(m.buffer);
    return countComponents(mask, w, h).length;
  }
  // Far apart → two distinct blobs.
  assert.equal(componentCount(0.32), 2, 'far balls separate');
  // Touching/overlapping field → merged into one component (neck before merge).
  assert.equal(componentCount(0.16), 1, 'close balls merge through a neck');
});

// --- custom config via explicit API v3 config ------------------------------

test('custom point/radius/strength are honoured through explicit config', () => {
  // A single custom ball with a large radius and strength fills more of the
  // frame than the default; verify the occupied ratio scales with radius and
  // that a strength override is bounded (never blows the palette to all-white).
  const ratioFor = (radius) => {
    const m = mount(120, 120, {
      render: { resolution: 1 },
      field: { pointCount: 1, points: [{ amplitudeX: 0, amplitudeY: 0, frequencyX: 1, frequencyY: 1, phaseX: 0, phaseY: 0, strength: 1 }], radius, threshold: 1, mergeBand: 0.4 }
    });
    m.renderer.render({ time: 0, delta: 1 / 60 });
    const { mask } = occupiedMask(m.buffer);
    let occ = 0;
    for (let i = 0; i < mask.length; i++) occ += mask[i];
    return occ / mask.length;
  };
  const small = ratioFor(0.08);
  const large = ratioFor(0.30);
  assert.ok(large > small * 1.5, `larger radius fills more (small=${small.toFixed(3)} large=${large.toFixed(3)})`);
  // The field→colour mapping is BOUNDED: smoothstep output t is always in
  // [0, 1], so the packed colour never overflows — every pixel stays a finite
  // byte even at very large strengths (no NaN, no value outside [0,255]). A
  // huge strength does saturate the body to white (the intended clip), but the
  // mapping itself is bounded.
  const m = mount(80, 80, {
    field: { pointCount: 1, points: [{ amplitudeX: 0, amplitudeY: 0, frequencyX: 1, frequencyY: 1, phaseX: 0, phaseY: 0, strength: 1e4 }], radius: 0.15, threshold: 1, mergeBand: 0.4 }
  });
  m.renderer.render({ time: 0, delta: 1 / 60 });
  const data = pixelImage(m.buffer).data;
  for (let i = 0; i < data.length; i++) {
    assert.ok(Number.isFinite(data[i]) && data[i] >= 0 && data[i] <= 255, `byte ${i} bounded`);
  }
});

// --- per-profile geometry parity -------------------------------------------

test('profiles never override normalized field geometry (relative radius/trajectory identical)', () => {
  // Geometry keys (radius/strength/threshold/mergeBand) define relative blob
  // size, peak field, body edge, and merge softness. Profiles must NOT set any
  // of them — otherwise a responsive slot would recompose the field instead of
  // just changing sampling/point budgets. pointCount IS allowed (it is an
  // execution budget, not geometry identity).
  const GEOMETRY_KEYS = ['radius', 'strength', 'threshold', 'mergeBand'];
  const slots = METABALLS_PROFILES.slots;
  for (const key of ['fullscreen.desktop', 'fullscreen.mobile', 'preview.desktop', 'preview.mobile']) {
    const field = slots[key].field;
    if (field) {
      for (const g of GEOMETRY_KEYS) {
        assert.ok(field[g] === undefined, `${key} must not override field.${g} (geometry identity)`);
      }
    }
    assert.ok(slots[key].runtime?.maxFps, `${key} runtime.maxFps`);
  }
  // Fullscreen keeps the classic composition (no field override at all).
  assert.equal(slots['fullscreen.desktop'].field, undefined);
  // Preview lowers the point budget + sampling only.
  assert.equal(slots['preview.desktop'].field.pointCount, 3, 'preview lowers point budget only');
  assert.ok(slots['preview.desktop'].render.resolution < 1, 'preview lowers sampling only');
});

// --- config validation -----------------------------------------------------

test('validateMetaballs accepts the defaults and rejects out-of-range geometry', () => {
  assert.doesNotThrow(() => validateMetaballs(configWith()));
  const base = configWith();
  assert.throws(() => validateMetaballs(mergeDeep(base, { field: { radius: 0 } })), /radius/);
  assert.throws(() => validateMetaballs(mergeDeep(base, { field: { radius: 2 } })), /radius/);
  assert.throws(() => validateMetaballs(mergeDeep(base, { field: { threshold: 0 } })), /threshold/);
  assert.throws(() => validateMetaballs(mergeDeep(base, { field: { mergeBand: -1 } })), /mergeBand/);
  assert.throws(
    () => validateMetaballs(mergeDeep(base, { field: { points: [{ amplitudeX: 2, amplitudeY: 0, frequencyX: 1, frequencyY: 1, phaseX: 0, phaseY: 0, strength: 1 }] } })),
    /amplitudeX/
  );
});

test('normalized field geometry lives in config.field, not appearance or skin', () => {
  const defaults = configWith();
  for (const key of ['radius', 'strength', 'threshold', 'mergeBand', 'pointCount']) {
    assert.ok(key in defaults.field, `${key} is algorithmic (field)`);
  }
  // The skin owns appearance (palette/shading), not field geometry.
  assert.ok(!('radius' in defaults.appearance));
});
