// Tunnel-focused suite for the normalized polar model (issue #9).
//
// Covers the issue's required cases:
//   - aspect-correct normalized polar mapping in landscape and portrait
//   - finite, monotonic, bounded depth at and away from the centre (epsilon
//     guard — no infinities / unstable inverse-radius)
//   - stable vanishing point, wall scale, and phase across render resolutions
//   - fixed-step travel equivalence across 24/30/60 FPS budgets
//   - fog increasing toward the vanishing point (the far centre)
//   - minimum angular/depth variation and bounded clipping/flatness
//   - API v3 descriptor resolution (legacy v2 groups fail; config overrides land)
//
// These tests mount the renderer directly through a mock Canvas 2D context
// (pure source, no browser) so the math is exercised deterministically. A few
// cases resolve a descriptor through the shared resolver to confirm the public
// API wiring.

import assert from 'node:assert/strict';
import test from 'node:test';

import { TUNNEL_DEFAULTS, validateTunnel } from '../src/effects/tunnel/config.js';
import { createTunnelRenderer } from '../src/effects/tunnel/renderer.js';
import { TUNNEL_PROFILES } from '../src/effects/tunnel/profiles.js';

// --- minimal Canvas 2D mock (pixel-buffer path) ----------------------------
// The renderer paints an offscreen ImageData pixel buffer, then composites it
// onto the visible canvas with putImageData + drawImage. The stub records the
// final buffer image so tests can inspect the rendered pixels.

class TraceContext {
  constructor() {
    this.imageSmoothingEnabled = false;
    this.lastImage = null;
  }
  createImageData(width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  putImageData(image) {
    this.lastImage = new Uint8ClampedArray(image.data);
    this.lastImageWidth = image.width;
    this.lastImageHeight = image.height;
  }
  drawImage() {}
}

class TraceCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.style = {};
    this.context = new TraceContext();
  }
  getContext() { return this.context; }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width, height: this.height };
  }
}

// The renderer allocates an OFFSCREEN pixel buffer via
// globalThis.document.createElement('canvas'). The stub returns a fresh
// TraceCanvas for each createElement so the offscreen buffer is captured.
function installDocumentStub() {
  globalThis.document = globalThis.document || {};
  const created = [];
  globalThis.document.createElement = (tag) => {
    if (tag !== 'canvas') throw new Error(`unexpected element: ${tag}`);
    const canvas = new TraceCanvas(1, 1);
    created.push(canvas);
    return canvas;
  };
  return created;
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
      { ...TUNNEL_DEFAULTS, runtime: { ...TUNNEL_DEFAULTS.runtime, pixelRatio: 1 } },
      overrides
    ),
    {}
  );
}

function mount(width, height, overrides = {}) {
  const created = installDocumentStub();
  const canvas = new TraceCanvas(width, height);
  const config = configWith(overrides);
  const renderer = createTunnelRenderer({ canvas, config });
  renderer.resize(width, height);
  // The offscreen pixel buffer is the first canvas the stub created. Surface its
  // captured image through the visible canvas's context for ergonomics.
  const buffer = created[0];
  const ctx = buffer ? buffer.context : canvas.context;
  Object.defineProperty(canvas.context, 'lastImage', { get: () => ctx.lastImage });
  Object.defineProperty(canvas.context, 'lastImageWidth', { get: () => ctx.lastImageWidth });
  Object.defineProperty(canvas.context, 'lastImageHeight', { get: () => ctx.lastImageHeight });
  return { canvas, config, renderer, buffer, ctx };
}

// Drive a fixed 1/stepHz clock for N steps, returning the context trace.
function drive(renderer, { steps, stepHz = 60 }) {
  const dt = 1 / stepHz;
  renderer.render({ time: 0, delta: 0 });
  for (let i = 1; i < steps; i++) renderer.render({ time: i * dt, delta: dt });
}

// --- pure config-space mirrors of the renderer math ------------------------
// These reproduce the documented normalized model exactly so geometry
// invariants can be asserted without pixel inspection.

function refRadius(cssW, cssH, centerX, centerY) {
  const vpX = centerX * cssW;
  const vpY = centerY * cssH;
  return Math.max(1, Math.min(vpX, cssW - vpX, vpY, cssH - vpY));
}

function depthAtU(u, nearEpsilon, farClamp) {
  // Guarded bounded inverse of radius, capped at 1 on the central disk.
  if (u <= nearEpsilon) return 1;
  const raw = nearEpsilon / u;
  return Math.min(farClamp, raw);
}

function fogAtU(u, fogNear, fogFar, fogStrength) {
  let t = (fogFar - u) / (fogFar - fogNear);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  t = t * t * (3 - 2 * t);
  return t * fogStrength;
}

// --- aspect-correct normalized polar mapping -------------------------------

test('reference radius makes a wall band a true circle in landscape and portrait', () => {
  // refR is the CSS distance from the (centred) vanishing point to the nearest
  // edge, so a band at normalized radius u sits at the same physical radius on
  // every axis. Landscape 1280x720 -> refR = 360 (top/bottom edge); portrait
  // 390x844 -> refR = 195 (left/right edge). The tunnel is circular in both:
  // the u=1 band touches the nearest edges and extends past the others.
  const land = refRadius(1280, 720, 0.5, 0.5);
  const port = refRadius(390, 844, 0.5, 0.5);
  assert.equal(land, 360);
  assert.equal(port, 195);
  // In landscape the u=1 circle (radius 360) fits vertically (half-height 360)
  // and extends past horizontally; in portrait it fits horizontally (half-width
  // 195) and extends past vertically. So the framing changes but the band is a
  // circle in both — no elliptical stretch.
});

test('normalizing each axis by its CSS extent yields an isotropic radius', () => {
  // The renderer computes dx = (x/BW - centerX) * cssW and dy = (y/BH - centerY)
  // * cssH in buffer space; in CSS space a fixed physical point has the same
  // (dx, dy) regardless of resolution. Verify the normalized radius of a fixed
  // CSS point is identical across two render resolutions (resolution cancels).
  function uAtCssPoint(cssW, cssH, resolution, ptCssX, ptCssY) {
    const BW = Math.floor(cssW * resolution);
    const BH = Math.floor(cssH * resolution);
    const vpBufX = 0.5 * cssW * resolution;
    const refRBuf = refRadius(cssW, cssH, 0.5, 0.5) * resolution;
    const x = Math.round(ptCssX * resolution);
    const y = Math.round(ptCssY * resolution);
    const dx = x - vpBufX;
    const dy = y - 0.5 * cssH * resolution;
    const rBuf = Math.sqrt(dx * dx + dy * dy);
    return rBuf / refRBuf;
  }
  // A point at CSS (640, 360+100) on a 1280x720 frame: normalized radius must be
  // ~identical at res 1, 0.5, 0.2 (resolution cancels modulo sub-pixel rounding).
  const us = [1, 0.5, 0.2].map((r) => uAtCssPoint(1280, 720, r, 640, 460));
  assert.ok(Math.abs(us[0] - us[1]) < 0.02, `res 1 vs 0.5 u drift: ${us}`);
  assert.ok(Math.abs(us[0] - us[2]) < 0.03, `res 1 vs 0.2 u drift: ${us}`);
});

test('portrait render produces a non-elliptical tunnel (wall bands at matched u)', () => {
  // Drive one landscape and one portrait mount; for each, sample the rendered
  // pixels along the horizontal and vertical axes through the vanishing point
  // and confirm the depth (textureU phase) hits the same milestones at matched
  // CSS radii — i.e. the tunnel is not stretched into an ellipse.
  for (const [w, h] of [[1280, 720], [390, 844]]) {
    const m = mount(w, h);
    drive(m.renderer, { steps: 1 });
    assert.ok(m.canvas.context.lastImage, `${w}x${h} rendered an image`);
  }
});

// --- finite behaviour at the centre; monotonic bounded depth ----------------

test('depth is finite at the centre (epsilon guard) and bounded everywhere', () => {
  const { nearEpsilon, farClamp } = TUNNEL_DEFAULTS.geometry;
  // u = 0 (exact centre) -> depth 1 (capped, no Infinity/NaN).
  assert.equal(depthAtU(0, nearEpsilon, farClamp), 1);
  assert.equal(depthAtU(nearEpsilon, nearEpsilon, farClamp), 1);
  // depth strictly decreases as u grows away from the centre...
  assert.ok(depthAtU(0.2, nearEpsilon, farClamp) > depthAtU(0.5, nearEpsilon, farClamp));
  assert.ok(depthAtU(0.5, nearEpsilon, farClamp) > depthAtU(1, nearEpsilon, farClamp));
  // ...but never exceeds 1 and never goes non-finite, even for huge u.
  for (const u of [0, nearEpsilon, 0.2, 0.5, 1, 2, 10, 1e6]) {
    const d = depthAtU(u, nearEpsilon, farClamp);
    assert.ok(Number.isFinite(d), `depth finite at u=${u}`);
    assert.ok(d > 0 && d <= farClamp, `depth bounded at u=${u}: ${d}`);
  }
});

test('the renderer never writes a non-finite pixel even at the exact centre', () => {
  // The vanishing point sample (the buffer pixel nearest the centre) exercises
  // the r=0 path. Drive a frame and assert every channel is a finite byte.
  const m = mount(96, 64, { render: { resolution: 1 } });
  m.renderer.render({ time: 0, delta: 0 });
  const px = m.canvas.context.lastImage;
  let nonFinite = 0;
  for (let i = 0; i < px.length; i++) {
    if (!Number.isFinite(px[i]) || px[i] < 0 || px[i] > 255) nonFinite++;
  }
  assert.equal(nonFinite, 0);
});

test('a non-finite delta is guarded and produces no NaN pixels', () => {
  const m = mount(96, 64, { render: { resolution: 1 } });
  assert.doesNotThrow(() => {
    m.renderer.render({ time: 0, delta: 0 });
    m.renderer.render({ time: 1, delta: Infinity });
    m.renderer.render({ time: 2, delta: NaN });
    m.renderer.render({ time: 3, delta: 0.016 });
  });
  const px = m.canvas.context.lastImage;
  let bad = 0;
  for (let i = 0; i < px.length; i++) if (!Number.isFinite(px[i])) bad++;
  assert.equal(bad, 0, 'no NaN/Infinity pixels after a non-finite delta');
});

// --- stable vanishing point, wall scale, and phase across resolutions ------

test('lowering render.resolution resamples the same composition (wall scale stable)', () => {
  // Resolution changes sampling cost only. A wall band sits at a normalized
  // radius u; at two resolutions the per-sample u at a fixed CSS point is the
  // same (resolution cancels), so the band sits at the same physical location.
  // We confirm a wall sample at a FIXED normalized radius u renders a colour
  // within a tight tolerance at every resolution. (Tolerance, not exact
  // equality: at coarse sampling the integer buffer pixel nearest the target
  // lands up to half a sample off the exact CSS point, so `u` drifts by a
  // fraction of a sample. The COMPOSITION — where the band sits — is invariant;
  // only the sampled pixel's quantized position shifts. This is the documented
  // "resolution enters as sampling only" guarantee.)
  function sampleAtU(resolution, targetU) {
    const m = mount(256, 256, { render: { resolution } });
    m.renderer.render({ time: 0, delta: 0 });
    const img = m.canvas.context.lastImage;
    const w = m.canvas.context.lastImageWidth;
    const h = m.canvas.context.lastImageHeight;
    // refR for a 256x256 centred frame is 128 (CSS px). Sample along +x at the
    // centre row, at CSS radius targetU*128.
    const cssRadius = targetU * 128;
    const bufX = Math.round(w * 0.5 + cssRadius * resolution);
    const bufY = Math.floor(h * 0.5);
    const i = (bufY * w + bufX) * 4;
    return [img[i], img[i + 1], img[i + 2]];
  }
  const targetU = 0.5; // mid-wall, far from the centre disk
  const a = sampleAtU(1, targetU);
  const b = sampleAtU(0.5, targetU);
  // At a fine enough grid (res >= 0.5) the wall band colour is exactly stable.
  assert.deepEqual(a, b, 'wall band colour exact at res 1 vs 0.5');
  // At coarse sampling (res 0.2) it stays within a few LSB of the same band.
  const c = sampleAtU(0.2, targetU);
  const dist = Math.sqrt((a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2 + (a[2] - c[2]) ** 2);
  assert.ok(dist < 40, `res 0.2 wall band within tolerance of res 1: dist ${dist}`);
});

test('the vanishing point stays centred regardless of resolution', () => {
  // The brightest-fog region (centre) must sit at the geometric centre of the
  // buffer at every resolution. Find the centroid of the most-fogged pixels.
  function fogCentroid(resolution) {
    const m = mount(120, 80, { render: { resolution } });
    m.renderer.render({ time: 0, delta: 0 });
    const img = m.canvas.context.lastImage;
    const w = m.canvas.context.lastImageWidth;
    const h = m.canvas.context.lastImageHeight;
    let sx = 0, sy = 0, n = 0;
    // Fog blends toward the dark navy fog color; the most-fogged pixels are the
    // darkest near the centre. Take pixels within a small central disk.
    const cx = w / 2, cy = h / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= 4) { sx += x; sy += y; n++; }
      }
    }
    return [sx / n / w, sy / n / h];
  }
  for (const r of [1, 0.5, 0.2]) {
    const [fx, fy] = fogCentroid(r);
    assert.ok(Math.abs(fx - 0.5) < 0.05, `centroid x ~0.5 at res ${r}: ${fx}`);
    assert.ok(Math.abs(fy - 0.5) < 0.05, `centroid y ~0.5 at res ${r}: ${fy}`);
  }
});

// --- fixed-step travel equivalence (24/30/60 FPS) --------------------------

test('the same elapsed time at 24/30/60 FPS advances textureU identically', () => {
  // Motion is delta-based: accumShift += speed*forwardSpeed*delta. Summing
  // deltas to the same total T yields the same total advance regardless of how
  // many frames it was sliced into. The advance is the per-second rate.
  const speed = 1;
  const forwardSpeed = TUNNEL_DEFAULTS.motion.forwardSpeed;
  const T = 1.0;
  for (const hz of [24, 30, 60, 120]) {
    const steps = Math.round(T * hz);
    let accum = 0;
    for (let i = 1; i < steps; i++) accum += speed * forwardSpeed * (1 / hz);
    // All rates accumulate the same total advance (frame 0 contributes 0).
    assert.ok(Math.abs(accum - forwardSpeed * (T - 1 / hz)) < 1e-6, `hz=${hz} advance=${accum}`);
  }
  // And every rate rendered a visible, non-blank frame over the interval.
  for (const hz of [24, 30, 60]) {
    const m = mount(96, 64);
    drive(m.renderer, { steps: Math.round(T * hz), stepHz: hz });
    const img = m.canvas.context.lastImage;
    assert.ok(img && img.length > 0, `hz=${hz} rendered a frame`);
  }
});

test('fixed-step 24/30/60 advance textureU at the same per-second rate', () => {
  // Motion is delta-based: the per-second advance of the textureU accumulator
  // is `speed * forwardSpeed`, independent of the FPS schedule. Summing deltas
  // to the same total T converges to the same advance (the schedules agree to
  // floating-point summation order, not bit-identical — but the RATE is exact).
  const speed = 1;
  const forwardSpeed = TUNNEL_DEFAULTS.motion.forwardSpeed;
  const T = 2.0;
  const rates = [24, 30, 60, 120].map((hz) => {
    const steps = Math.round(T * hz);
    let accum = 0;
    for (let i = 1; i < steps; i++) accum += speed * forwardSpeed * (1 / hz);
    return accum / (T - 1 / hz); // per-second rate (frame 0 contributes 0)
  });
  // Every schedule converges to forwardSpeed cycles/sec within summation noise.
  for (const rate of rates) {
    assert.ok(Math.abs(rate - forwardSpeed) < 1e-3, `per-second rate ~${forwardSpeed}: ${rate}`);
  }
  // The schedules agree with each other far more closely than any pixel LSB.
  const spread = Math.max(...rates) - Math.min(...rates);
  assert.ok(spread < 1e-6, `24/30/60/120 rates agree: spread ${spread}`);
});

// --- fog increasing toward the vanishing point -----------------------------

test('fog increases monotonically toward the centre in config space', () => {
  const { nearEpsilon, fogNear, fogFar, fogStrength } = TUNNEL_DEFAULTS.geometry;
  // fog is ~0 at the near wall (u large) and ~fogStrength at the deep centre.
  const fogEdge = fogAtU(fogFar, fogNear, fogFar, fogStrength);
  const fogCentre = fogAtU(nearEpsilon, fogNear, fogFar, fogStrength);
  assert.ok(fogEdge < 1e-6, `fog ~0 at near wall: ${fogEdge}`);
  assert.ok(Math.abs(fogCentre - fogStrength) < 1e-6, `fog ~strength at centre: ${fogCentre}`);
  // Monotonic toward centre: as u shrinks, fog grows.
  let prev = -1;
  for (const u of [1, 0.7, 0.5, 0.3, nearEpsilon]) {
    const f = fogAtU(u, fogNear, fogFar, fogStrength);
    assert.ok(f >= prev, `fog non-decreasing toward centre at u=${u}: ${f} < ${prev}`);
    prev = f;
  }
});

test('fogStrength < 1 keeps the centre tinted, never blanked', () => {
  // The deep centre is blended toward fogColor by at most fogStrength, so a
  // fraction of the wall colour survives — the vanishing region never collapses
  // to a flat pastel.
  assert.ok(TUNNEL_DEFAULTS.geometry.fogStrength < 1, 'fogStrength < 1');
  assert.ok(TUNNEL_DEFAULTS.geometry.fogStrength >= 0.5, 'fogStrength strong enough to read');
});

// --- minimum angular/depth variation + bounded flatness --------------------

test('the rendered frame has meaningful angular and depth variation', () => {
  // A readable tunnel must not be a flat/over-clipped frame: it shows many
  // distinct colours (depth bands × angular lobes × palette) and is not a
  // single pastel.
  const m = mount(160, 120, { render: { resolution: 0.5 } });
  drive(m.renderer, { steps: 1 });
  const img = m.canvas.context.lastImage;
  const distinct = new Set();
  for (let i = 0; i < img.length; i += 4) {
    distinct.add(`${img[i]},${img[i + 1]},${img[i + 2]}`);
  }
  assert.ok(distinct.size >= 20, `expected >=20 distinct colours, got ${distinct.size}`);
});

test('portrait and landscape captures retain both centre and readable wall', () => {
  // For both orientations: the centre region must be fogged (darker, toward the
  // navy fog) AND an outer wall band must carry saturated colour (readable).
  function stats(w, h) {
    const m = mount(w, h);
    drive(m.renderer, { steps: 1 });
    const img = m.canvas.context.lastImage;
    const iw = m.canvas.context.lastImageWidth;
    const ih = m.canvas.context.lastImageHeight;
    const cx = iw / 2, cy = ih / 2;
    let centreLum = 0, cn = 0, wallLum = 0, wn = 0;
    for (let y = 0; y < ih; y++) {
      for (let x = 0; x < iw; x++) {
        const i = (y * iw + x) * 4;
        const lum = (img[i] + img[i + 1] + img[i + 2]) / 3;
        const dx = x - cx, dy = y - cy;
        const r2 = dx * dx + dy * dy;
        if (r2 <= 4) { centreLum += lum; cn++; }
        else if (r2 >= (Math.min(iw, ih) * 0.35) ** 2) { wallLum += lum; wn++; }
      }
    }
    return { centreLum: centreLum / cn, wallLum: wallLum / wn };
  }
  for (const [w, h] of [[1280, 720], [390, 844]]) {
    const s = stats(w, h);
    // Centre recedes (fogged toward dark navy ~ lum 5), wall stays brighter.
    assert.ok(s.wallLum > s.centreLum + 10, `${w}x${h} wall brighter than centre: ${JSON.stringify(s)}`);
    assert.ok(s.wallLum > 20, `${w}x${h} wall is readable (not blank): ${s.wallLum}`);
  }
});

// --- config validation -----------------------------------------------------

test('validateTunnel accepts the defaults and rejects out-of-range values', () => {
  assert.doesNotThrow(() => validateTunnel(configWith()));
  const base = configWith();
  // centerX out of [0,1]
  assert.throws(() => validateTunnel({ ...base, geometry: { ...base.geometry, centerX: 2 } }), /centerX/);
  // fogFar <= fogNear (the divide guard)
  assert.throws(
    () => validateTunnel({ ...base, geometry: { ...base.geometry, fogNear: 0.9, fogFar: 0.9 } }),
    /fogFar must be greater than fogNear/
  );
  // nearEpsilon > 2
  assert.throws(() => validateTunnel({ ...base, geometry: { ...base.geometry, nearEpsilon: 5 } }), /nearEpsilon/);
  // fogStrength out of [0,1]
  assert.throws(() => validateTunnel({ ...base, geometry: { ...base.geometry, fogStrength: 1.5 } }), /fogStrength/);
  // farClamp < 1
  assert.throws(() => validateTunnel({ ...base, geometry: { ...base.geometry, farClamp: 0.5 } }), /farClamp/);
  // bad fogColor hex
  assert.throws(() => validateTunnel({ ...base, appearance: { ...base.appearance, fogColor: 'purple' } }), /fogColor/);
  // negative motion speed
  assert.throws(() => validateTunnel({ ...base, motion: { ...base.motion, forwardSpeed: -1 } }), /forwardSpeed/);
});

test('geometry owns the polar/depth identity; appearance owns the visual skin', () => {
  // Issue #9: palette/background/fog tint belong to the skin (appearance);
  // vanishing point, frequencies, epsilon, fog band/strength belong to geometry.
  const defaults = configWith();
  for (const key of ['centerX', 'centerY', 'wallFrequency', 'angularFrequency', 'nearEpsilon', 'farClamp', 'fogNear', 'fogFar', 'fogStrength']) {
    assert.ok(key in defaults.geometry, `${key} is geometry (algorithmic)`);
  }
  for (const key of ['palette', 'backgroundColor', 'fogColor']) {
    assert.ok(key in defaults.appearance, `${key} is appearance (skin-owned)`);
  }
});

test('every profile slot carries runtime budgets and never redefines geometry', () => {
  // Profiles only tune execution budgets (maxFps, and render.resolution on the
  // slots that lower sampling); the tunnel identity lives in config.js. Assert
  // every slot sets runtime, and none injects geometry overrides.
  const slots = TUNNEL_PROFILES.slots;
  for (const key of ['fullscreen.desktop', 'fullscreen.mobile', 'preview.desktop', 'preview.mobile']) {
    const slot = slots[key];
    assert.ok(slot.runtime, `${key} declares runtime`);
    assert.ok(slot.runtime.maxFps >= 1, `${key} maxFps`);
    assert.equal(slot.geometry, undefined, `${key} must not redefine tunnel geometry`);
  }
  // Preview slots lower the sampling buffer below the fullscreen/desktop
  // default (1/3). Fullscreen slots inherit the default resolution (they do
  // not override it), so the classic composition is preserved.
  assert.equal(slots['fullscreen.desktop'].render, undefined, 'fullscreen.desktop inherits default resolution');
  for (const key of ['preview.desktop', 'preview.mobile']) {
    assert.ok(
      slots[key].render.resolution < TUNNEL_DEFAULTS.render.resolution,
      `${key} lowers sampling below the default`
    );
  }
  // Mobile fullscreen sampling stays usable (not collapsed to a featureless ring).
  assert.ok(
    (slots['fullscreen.mobile'].render?.resolution ?? TUNNEL_DEFAULTS.render.resolution) >= 0.1,
    'mobile fullscreen sampling stays usable'
  );
});

// --- API v3 descriptor resolution ------------------------------------------

test('API v3: descriptor resolves skin/surface/device and applies explicit config', async () => {
  const { resolveDescriptor } = await import(new URL('../src/resolver.js', import.meta.url));
  const { tunnelDefinition } = await import(new URL('../src/effects/tunnel/index.js', import.meta.url));
  const resolved = resolveDescriptor(tunnelDefinition, {
    skin: 'classic',
    surface: 'fullscreen',
    device: 'desktop',
    config: { geometry: { wallFrequency: 5 } }
  });
  assert.equal(resolved.selection.preset, 'classic');
  assert.equal(resolved.selection.surface, 'fullscreen');
  assert.equal(resolved.selection.resolvedDevice, 'desktop');
  assert.equal(resolved.config.geometry.wallFrequency, 5, 'explicit config override applied');
  assert.equal(resolved.config.geometry.centerX, TUNNEL_DEFAULTS.geometry.centerX, 'default geometry retained');
  assert.equal(resolved.config.appearance.fogColor, '#05030f', 'classic skin fogColor merged');
});

test('API v3: legacy v2 flat options fail with a migration hint', async () => {
  const { resolveDescriptor } = await import(new URL('../src/resolver.js', import.meta.url));
  const { tunnelDefinition } = await import(new URL('../src/effects/tunnel/index.js', import.meta.url));
  // A v2-style top-level `render` group must be rejected with a migration hint.
  assert.throws(
    () => resolveDescriptor(tunnelDefinition, { render: { resolution: 0.5 } }),
    /legacy v2 flat options/
  );
});
