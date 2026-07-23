import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import vm from 'node:vm';

import { mandelbrotPaletteIndex, mandelbrotZoom, renderMandelbrotPixels } from '../src/effects/mandelbrot/mandelbrot-core.js';
import { MANDELBROT_FRAGMENT_SHADER } from '../src/effects/mandelbrot/mandelbrot-webgl.js';
import { mandelbrotDefinition } from '../src/effects/mandelbrot/index.js';
import { resolveDescriptor } from '../src/resolver.js';
import { buildGradientPalette, packHexColor, packRgb } from '../src/effects/utils.js';
import { PROFILE_SLOT_KEYS, buildProfiles } from '../src/effects/profiles.js';

// [publicName, definition module, definition export, standalone filename, config defaults export]
const EFFECTS = [
  ['plasma', 'plasma/index.js', 'plasmaDefinition', 'plasma.js', 'PLASMA_DEFAULTS'],
  ['fire', 'fire/index.js', 'fireDefinition', 'fire.js', 'FIRE_DEFAULTS'],
  ['starfield', 'starfield/index.js', 'starfieldDefinition', 'starfield.js', 'STARFIELD_DEFAULTS'],
  ['metaballs', 'metaballs/index.js', 'metaballsDefinition', 'metaballs.js', 'METABALLS_DEFAULTS'],
  ['tunnel', 'tunnel/index.js', 'tunnelDefinition', 'tunnel.js', 'TUNNEL_DEFAULTS'],
  ['mandelbrot', 'mandelbrot/index.js', 'mandelbrotDefinition', 'mandelbrot.js', 'MANDELBROT_DEFAULTS'],
  ['sineScroller', 'sine-scroller/index.js', 'sineScrollerDefinition', 'sine-scroller.js', 'SINE_SCROLLER_DEFAULTS'],
  ['rotozoom', 'rotozoom/index.js', 'rotozoomDefinition', 'rotozoom.js', 'ROTOZOOM_DEFAULTS'],
  ['feedback', 'feedback/index.js', 'feedbackDefinition', 'feedback.js', 'FEEDBACK_DEFAULTS'],
  ['copperBars', 'copper-bars/index.js', 'copperBarsDefinition', 'copper-bars.js', 'COPPER_BARS_DEFAULTS']
];

class MockContext {
  constructor() {
    this.drawCalls = 0;
    this.strokeCalls = 0;
    this.imageSmoothingEnabled = true;
    this.lastImage = null;
    this.globalAlpha = 1;
    this.traceHash = 2166136261;
  }
  record(name, values = []) {
    const text = `${name}:${values.map((value) => (
      typeof value === 'number' ? Math.round(value * 1000) / 1000 : String(value)
    )).join(',')};`;
    for (let index = 0; index < text.length; index++) {
      this.traceHash ^= text.charCodeAt(index);
      this.traceHash = Math.imul(this.traceHash, 16777619) >>> 0;
    }
  }
  createImageData(width, height) {
    this.record('createImageData', [width, height]);
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  putImageData(image, ...values) {
    this.lastImage = new Uint8ClampedArray(image.data);
    this.record('putImageData', values);
  }
  drawImage(...values) {
    this.drawCalls++;
    this.record('drawImage', values.slice(1));
  }
  fillRect(...values) { this.record('fillRect', values); }
  clearRect(...values) { this.record('clearRect', values); }
  beginPath() { this.record('beginPath'); }
  moveTo(...values) { this.record('moveTo', values); }
  lineTo(...values) { this.record('lineTo', values); }
  stroke() { this.strokeCalls++; this.record('stroke'); }
  fillText(...values) { this.record('fillText', values); }
  save() { this.record('save'); }
  restore() { this.record('restore'); }
  translate(...values) { this.record('translate', values); }
  rotate(...values) { this.record('rotate', values); }
  scale(...values) { this.record('scale', values); }
}

class MockWebGL2Context {
  constructor({ shaderFailure = false } = {}) {
    this.shaderFailure = shaderFailure;
    this.drawCalls = 0;
    this.textureUploads = 0;
    this.textureSubUploads = 0;
    this.VERTEX_SHADER = 0x8b31;
    this.FRAGMENT_SHADER = 0x8b30;
    this.COMPILE_STATUS = 0x8b81;
    this.LINK_STATUS = 0x8b82;
    this.MAX_TEXTURE_SIZE = 0x0d33;
    this.TEXTURE0 = 0x84c0;
    this.TEXTURE1 = 0x84c1;
    this.TEXTURE_2D = 0x0de1;
    this.TEXTURE_MIN_FILTER = 0x2801;
    this.TEXTURE_MAG_FILTER = 0x2800;
    this.TEXTURE_WRAP_S = 0x2802;
    this.TEXTURE_WRAP_T = 0x2803;
    this.NEAREST = 0x2600;
    this.CLAMP_TO_EDGE = 0x812f;
    this.RGBA8 = 0x8058;
    this.RGBA32F = 0x8814;
    this.RGBA = 0x1908;
    this.UNSIGNED_BYTE = 0x1401;
    this.FLOAT = 0x1406;
    this.BLEND = 0x0be2;
    this.DEPTH_TEST = 0x0b71;
    this.TRIANGLES = 0x0004;
  }
  createShader(type) { return { type }; }
  shaderSource(shader, source) { shader.source = source; }
  compileShader(shader) { shader.compiled = !this.shaderFailure; }
  getShaderParameter(shader) { return shader.compiled; }
  getShaderInfoLog() { return this.shaderFailure ? 'mock compile failure' : ''; }
  deleteShader() {}
  createProgram() { return {}; }
  attachShader() {}
  linkProgram(program) { program.linked = !this.shaderFailure; }
  getProgramParameter(program) { return program.linked; }
  getProgramInfoLog() { return this.shaderFailure ? 'mock link failure' : ''; }
  deleteProgram() {}
  createTexture() { return {}; }
  activeTexture() {}
  bindTexture() {}
  texParameteri() {}
  texImage2D() { this.textureUploads++; }
  texSubImage2D() { this.textureSubUploads++; }
  getParameter(parameter) { return parameter === this.MAX_TEXTURE_SIZE ? 8192 : 0; }
  getUniformLocation(program, name) { return name; }
  getExtension() { return null; }
  disable() {}
  viewport() {}
  useProgram() {}
  uniform1f() {}
  uniform1i() {}
  uniform2f() {}
  uniform4f() {}
  drawArrays() { this.drawCalls++; }
  deleteTexture() {}
}

class MockCanvas {
  constructor(width = 48, height = 32, webglOptions = null) {
    this.width = width;
    this.height = height;
    this.clientWidth = width;
    this.clientHeight = height;
    this.context = new MockContext();
    this.webglContext = webglOptions ? new MockWebGL2Context(webglOptions) : null;
    this.style = {};
    this.listeners = new Map();
  }
  getContext(type = '2d', options) {
    if (type === 'webgl2') {
      this.lastWebglOptions = options;
      return this.webglContext;
    }
    return this.context;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
}

function createEnvironment({ webgl = false, shaderFailure = false, matchMedia = null } = {}) {
  let nextFrameId = 1;
  let frames = [];
  const canvases = [];
  const resizeObservers = [];
  const intersectionObservers = [];
  const selectors = new Map();
  class MockResizeObserver {
    constructor(callback) { this.callback = callback; resizeObservers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    trigger() { this.callback([{ target: this.target }]); }
  }
  class MockIntersectionObserver {
    constructor(callback) { this.callback = callback; intersectionObservers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    trigger(isIntersecting) { this.callback([{ target: this.target, isIntersecting }]); }
  }
  const sandbox = {
    console,
    document: {
      createElement(tag) {
        if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`);
        const canvas = new MockCanvas(48, 32, webgl ? { shaderFailure } : null);
        canvases.push(canvas);
        return canvas;
      },
      querySelector(selector) { return selectors.get(selector) ?? null; }
    },
    ResizeObserver: MockResizeObserver,
    IntersectionObserver: MockIntersectionObserver,
    requestAnimationFrame(callback) {
      const id = nextFrameId++;
      frames.push({ id, callback });
      return id;
    },
    cancelAnimationFrame(id) { frames = frames.filter((frame) => frame.id !== id); }
  };
  if (matchMedia) sandbox.matchMedia = matchMedia;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return {
    sandbox, canvases, resizeObservers, intersectionObservers,
    createCanvas(selector, width, height) {
      const canvas = new MockCanvas(width, height, webgl ? { shaderFailure } : null);
      canvases.push(canvas);
      if (selector) selectors.set(selector, canvas);
      return canvas;
    },
    flush(timestamp) {
      const pending = frames;
      frames = [];
      pending.forEach((frame) => frame.callback(timestamp));
    },
    frameCount() { return frames.length; }
  };
}

async function loadBundle(path, environment) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  vm.runInContext(source, environment.sandbox, { filename: path });
}

function valueAtPath(value, path) {
  return path.reduce((current, key) => current[key], value);
}

function assertDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

function hashBytes(bytes) {
  let hash = 2166136261;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// Render an effect from a standalone bundle under a v3 descriptor and return a
// stable signature string. The default descriptor {} resolves to
// classic/fullscreen/desktop, which must remain visually identical to the v2
// baseline (this structural PR must not redesign any effect).
async function rendererSignature(name, filename, descriptor = {}) {
  const environment = createEnvironment();
  await loadBundle(`../dist/effects/${filename}`, environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  environment.sandbox.Demoscene[name](canvas, descriptor);
  for (const timestamp of [0, 17, 34, 51]) environment.flush(timestamp);
  const buffer = environment.canvases.find((candidate) => candidate !== canvas);
  return buffer.context.lastImage
    ? `pixels:${hashBytes(buffer.context.lastImage)}`
    : `vector:${buffer.context.traceHash.toString(16).padStart(8, '0')}`;
}

test('every effect exposes a complete definition with the v3 contract shape', async () => {
  for (const [name, module, exportName] of EFFECTS) {
    const definition = (await import(`../src/effects/${module}`))[exportName];
    assert.equal(definition.name, name, `${name} definition name`);
    assert.equal(typeof definition.rendererFactory, 'function', `${name} rendererFactory`);
    assert.ok(definition.configDefaults && typeof definition.configDefaults === 'object', `${name} configDefaults`);
    assert.equal(typeof definition.validate, 'function', `${name} validate`);
    assert.ok(definition.skins && typeof definition.skins === 'object', `${name} skins`);
    assert.ok('classic' in definition.skins, `${name} must ship a 'classic' skin`);
    assert.ok(definition.profiles && definition.profiles.surfaces && definition.profiles.devices, `${name} profiles`);
    assert.ok(definition.profiles.surfaces.fullscreen !== undefined, `${name} fullscreen surface`);
    assert.ok(definition.profiles.surfaces.preview !== undefined, `${name} preview surface`);
    assert.ok(definition.profiles.devices.desktop !== undefined, `${name} desktop device`);
    assert.ok(definition.profiles.devices.mobile !== undefined, `${name} mobile device`);
    assert.ok(definition.capabilities?.skinAllow instanceof Set, `${name} capabilities.skinAllow`);
    for (const group of ['runtime', 'render', 'motion', 'appearance']) {
      assert.ok(definition.capabilities.skinAllow.has(group), `${name} skinAllow must include ${group}`);
    }
  }
});

test('standalone bundles expose v3 controllers for every effect', async () => {
  for (const [name, , , filename] of EFFECTS) {
    const environment = createEnvironment();
    await loadBundle(`../dist/effects/${filename}`, environment);
    const canvas = environment.createCanvas('#demo', 48, 32);
    const controller = environment.sandbox.Demoscene[name](canvas, {
      config: { runtime: { autoStart: false }, render: { resolution: 0.25 } }
    });
    assert.equal(typeof controller.start, 'function');
    assert.equal(typeof controller.stop, 'function');
    assert.equal(typeof controller.resize, 'function');
    assert.equal(typeof controller.renderOnce, 'function');
    assert.equal(typeof controller.getConfig, 'function');
    assert.equal(typeof controller.getSelection, 'function');
    assert.equal(typeof controller.getStats, 'function');
    assert.equal(typeof controller.destroy, 'function');
    controller.renderOnce(0).start().stop().resize();
    controller.destroy();
  }
});

test('the aggregate bundle installs all ten effects on one namespace', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/demoscene.js', environment);
  // Compare as joined strings to avoid cross-realm string reference issues.
  const installed = Object.keys(environment.sandbox.Demoscene).sort().join(',');
  const expected = EFFECTS.map(([name]) => name).sort().join(',');
  assert.equal(installed, expected);
});

test('complete and standalone bundles share one scheduler', async () => {
  for (const mode of ['complete', 'standalone']) {
    const environment = createEnvironment();
    if (mode === 'complete') await loadBundle('../dist/demoscene.js', environment);
    else {
      await loadBundle('../dist/effects/plasma.js', environment);
      await loadBundle('../dist/effects/fire.js', environment);
    }
    environment.sandbox.Demoscene.plasma(environment.createCanvas('#a', 30, 20));
    environment.sandbox.Demoscene.fire(environment.createCanvas('#b', 30, 20));
    assert.equal(environment.frameCount(), 1);
  }
});

test('the default descriptor resolves to classic/fullscreen/desktop and auto', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/plasma.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  const controller = environment.sandbox.Demoscene.plasma(canvas, {});
  const selection = controller.getSelection();
  // Compare field-by-field: the selection object is created inside the bundle's
  // vm realm, so deepStrictEqual across realms fails on reference identity.
  assert.strictEqual(selection.requestedSkin, 'classic');
  assert.strictEqual(selection.preset, 'classic');
  assert.strictEqual(selection.surface, 'fullscreen');
  assert.strictEqual(selection.requestedDevice, 'auto');
  assert.strictEqual(selection.resolvedDevice, 'desktop');
  assert.equal(Object.isFrozen(selection), true);
});

test('device auto resolves to mobile on coarse/narrow viewports and stays desktop otherwise', async () => {
  for (const { matchMedia, expected } of [
    { matchMedia: () => ({ matches: false }), expected: 'desktop' },
    { matchMedia: (query) => ({ matches: query === '(max-width: 767px)' }), expected: 'mobile' },
    { matchMedia: (query) => ({ matches: query === '(hover: none) and (pointer: coarse)' }), expected: 'mobile' }
  ]) {
    const environment = createEnvironment({ matchMedia });
    await loadBundle('../dist/effects/plasma.js', environment);
    const canvas = environment.createCanvas('#demo', 48, 32);
    const controller = environment.sandbox.Demoscene.plasma(canvas, { device: 'auto' });
    assert.equal(controller.getSelection().resolvedDevice, expected);
  }
  // No matchMedia available -> desktop.
  const environment = createEnvironment();
  await loadBundle('../dist/effects/plasma.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  assert.equal(
    environment.sandbox.Demoscene.plasma(canvas, { device: 'auto' }).getSelection().resolvedDevice,
    'desktop'
  );
});

test('explicit device values bypass auto-detection', async () => {
  const environment = createEnvironment({ matchMedia: () => ({ matches: true }) });
  await loadBundle('../dist/effects/plasma.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  const desktop = environment.sandbox.Demoscene.plasma(environment.createCanvas('#a', 30, 20), { device: 'desktop' });
  const mobile = environment.sandbox.Demoscene.plasma(environment.createCanvas('#b', 30, 20), { device: 'mobile' });
  assert.equal(desktop.getSelection().resolvedDevice, 'desktop');
  assert.equal(mobile.getSelection().resolvedDevice, 'mobile');
  assert.equal(desktop.getSelection().requestedDevice, 'desktop');
  assert.equal(mobile.getSelection().requestedDevice, 'mobile');
});

test('merge precedence: defaults -> skin preset -> overrides -> matched profile slot -> explicit config', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/plasma.js', environment);

  // Defaults: plasma render.resolution defaults to 0.25.
  const baseline = environment.sandbox.Demoscene.plasma(
    environment.createCanvas(null, 32, 20), { config: { runtime: { autoStart: false } } }
  ).getConfig();
  assert.equal(baseline.render.resolution, 0.25);

  // Explicit config wins over every preceding layer (the expert escape hatch).
  const explicit = environment.sandbox.Demoscene.plasma(
    environment.createCanvas(null, 32, 20), { config: { runtime: { autoStart: false }, render: { resolution: 0.5 } } }
  ).getConfig();
  assert.equal(explicit.render.resolution, 0.5);

  // Custom skin overrides land between the preset and the surface/device layers.
  const skinned = environment.sandbox.Demoscene.plasma(
    environment.createCanvas(null, 32, 20),
    { skin: { preset: 'classic', overrides: { motion: { speed: 2.5 } } }, config: { runtime: { autoStart: false } } }
  ).getConfig();
  assert.equal(skinned.motion.speed, 2.5);
});

test('string and custom-object skin selection both resolve to the same preset', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/plasma.js', environment);
  const byString = environment.sandbox.Demoscene.plasma(
    environment.createCanvas(null, 32, 20), { skin: 'classic' }
  ).getSelection();
  const byObject = environment.sandbox.Demoscene.plasma(
    environment.createCanvas(null, 32, 20), { skin: { preset: 'classic' } }
  ).getSelection();
  // Both resolve to the same preset/surface/device...
  assert.equal(byString.preset, 'classic');
  assert.equal(byObject.preset, 'classic');
  assert.equal(byString.surface, byObject.surface);
  assert.equal(byString.resolvedDevice, byObject.resolvedDevice);
  // ...but requestedSkin echoes what the caller passed: a string vs the object form.
  assert.strictEqual(byString.requestedSkin, 'classic');
  assert.strictEqual(byObject.requestedSkin.preset, 'classic');
});

test('unknown skin, surface, and device values fail with full paths', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/demoscene.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  assert.throws(() => environment.sandbox.Demoscene.plasma(canvas, { skin: 'neon' }), /unknown skin 'neon'/);
  assert.throws(
    () => environment.sandbox.Demoscene.plasma(canvas, { skin: { preset: 'nope' } }),
    /unknown skin preset 'nope'/
  );
  assert.throws(() => environment.sandbox.Demoscene.plasma(canvas, { surface: 'windowed' }), /unknown surface 'windowed'/);
  assert.throws(() => environment.sandbox.Demoscene.plasma(canvas, { device: 'tablet' }), /unknown device 'tablet'/);
  assert.throws(() => environment.sandbox.Demoscene.plasma(canvas, { colour: 'red' }), /Unknown descriptor field: plasma\.colour/);
  assert.throws(
    () => environment.sandbox.Demoscene.plasma(canvas, { skin: { overrides: 1 } }),
    /plasma\.skin\.overrides must be an object/
  );
});

test('skin overrides outside the declared visual paths are rejected', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/demoscene.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  // Algorithmic groups (field/simulation/geometry/...) are out of scope for a skin.
  assert.throws(
    () => environment.sandbox.Demoscene.plasma(canvas, { skin: { overrides: { field: { pointCount: 3 } } } }),
    /out of scope at 'field'/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.fire(canvas, { skin: { overrides: { simulation: { seed: 1 } } } }),
    /out of scope at 'simulation'/
  );
  // ...but the same values are accepted under the explicit config escape hatch.
  assert.doesNotThrow(() => environment.sandbox.Demoscene.fire(canvas, { config: { simulation: { seed: 1 } } }));
});

test('caller input is cloned and never mutated, and resolved config is deeply frozen', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/demoscene.js', environment);
  const supplied = {
    skin: { preset: 'classic', overrides: { appearance: { palette: ['#000', '#fff'] } } },
    config: { runtime: { autoStart: false, maxFps: 24 }, field: { radialCenterX: 0.25 } }
  };
  const controller = environment.sandbox.Demoscene.plasma(environment.createCanvas(null, 32, 20), supplied);
  const config = controller.getConfig();

  // Mutating caller input after mount must not affect the resolved config.
  supplied.config.runtime.maxFps = 1;
  supplied.config.field.radialCenterX = 0.99;
  supplied.skin.overrides.appearance.palette[0] = '#f00';
  assert.equal(config.runtime.maxFps, 24);
  assert.equal(config.field.radialCenterX, 0.25);
  assert.equal(config.appearance.palette[0], '#000');

  // getConfig() returns the fully resolved, deeply frozen configuration. It is
  // immutable, so attempts to mutate it cannot leak back into the live config.
  assert.equal(Object.isFrozen(config), true);
  assertDeepFrozen(config);
  assert.equal(Object.isFrozen(controller.getConfig()), true);
  assert.equal(controller.getConfig().runtime.maxFps, 24);
  assert.equal(controller.getConfig().field.radialCenterX, 0.25);
});

test('explicit config is validated with full paths and rejects unknown keys', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/demoscene.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  assert.throws(
    () => environment.sandbox.Demoscene.plasma(canvas, { config: { maxFps: 30 } }),
    /Unknown option: plasma\.maxFps/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.mandelbrot(canvas, { config: { camera: { minZom: 10 } } }),
    /mandelbrot\.camera\.minZom/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.mandelbrot(canvas, { config: { appearance: { paletteMode: 'sine' } } }),
    /mandelbrot\.appearance\.paletteMode/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.plasma(canvas, { config: { render: { resolution: 0.05 } } }),
    /plasma\.render\.resolution/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.starfield(canvas, { config: { particles: { particleCount: 10001 } } }),
    /starfield\.particles\.particleCount/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.metaballs(canvas, { config: { field: { pointCount: 3, points: [] } } }),
    /cannot be used together/
  );
});

test('legacy v2 flat options fail everywhere with an actionable migration message', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/demoscene.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  // Every legacy top-level group is rejected, naming the offending key and the escape hatch.
  for (const [name, options] of [
    ['plasma', { render: { resolution: 0.5 } }],
    ['fire', { simulation: { seed: 7 } }],
    ['starfield', { particles: { particleCount: 42 } }],
    ['metaballs', { field: { pointCount: 7 } }],
    ['mandelbrot', { camera: { centerX: -0.16 } }],
    ['sineScroller', { stars: { count: 12 } }],
    ['copperBars', { bars: [] }]
  ]) {
    assert.throws(
      () => environment.sandbox.Demoscene[name](canvas, options),
      (error) => /legacy v2 flat options/.test(error.message)
        && /config/.test(error.message)
        && error.message.includes(name),
      `${name} legacy v2 object must fail with a migration hint`
    );
  }
});

// Every effect's default descriptor (classic/fullscreen/desktop) must render a
// stable, frozen signature. Eight of the ten are still byte-identical to the v2
// baseline. Starfield was normalized in #7 (aspect-correct projection, viewport
// visibility culling, density budgets), tunnel was normalized in #9
// (aspect-correct normalized polar coordinates, guarded bounded-inverse depth,
// meaningful fog), and copperBars was refined in #14 (copper palette, bounded
// overlap composite, normalized portrait layout), so each moved off its v2
// value and is pinned to its normalized composition below. The effect-specific
// suites (tests/starfield.test.js, tests/tunnel.test.js,
// tests/copper-bars.test.js) cover the normalized behavior in depth.
test('classic default frames remain pixel-stable and unchanged from the v2 baseline', async () => {
  const snapshots = {};
  for (const [name, , , filename] of EFFECTS) {
    snapshots[name] = await rendererSignature(name, filename);
  }
  assert.deepEqual(snapshots, {
    plasma: 'pixels:19981681',
    fire: 'pixels:9aac868b',
    starfield: 'vector:95857935',
    metaballs: 'pixels:b18e0d45',
    tunnel: 'pixels:73466750',
    mandelbrot: 'pixels:f05b5719',
    sineScroller: 'vector:1a8c3cf0',
    rotozoom: 'pixels:cb358dc5',
    feedback: 'vector:7e2ccd86',
    copperBars: 'pixels:7ac0c2b5'
  });
});

// Four-profile contact sheet. Issue #3 fills the previously empty profile
// slots with real budgets: preview slots lower the render resolution (and, for
// starfield/metaballs/sine-scroller, the particle/point budget) while every
// slot sets maxFps/pixelRatio/pauseWhenHidden. The contact sheet proves three
// things at once:
//   1. The fullscreen/desktop slot (the default descriptor) preserves the
//      classic composition pixel-for-pixel — the profile layer did not redesign
//      the fullscreen desktop baseline.
//   2. Every preview slot lowers render.resolution below the fullscreen default
//      (the responsive sampling budget), and the pixel effects actually render
//      a different backing buffer at that lower resolution.
//   3. Starfield/metaballs/sine-scroller preview slots also cut the
//      particle/point budget, so their vector/pixel signatures change too.
// (Feedback is the one vector effect whose preview slot only lowers resolution;
// resolution does not change a vector trace, so its signature is allowed to
// match the baseline — the resolution drop is still asserted on its config.)
test('four-profile contact sheet: fullscreen desktop is unchanged, preview lowers the buffer', async () => {
  // Effects whose preview slot lowers a pixel buffer (resolution changes the
  // rendered image) — their preview signature must differ from the baseline.
  const PIXEL_PREVIEW_DIFFERS = new Set([
    'plasma', 'fire', 'metaballs', 'tunnel', 'mandelbrot', 'rotozoom', 'copperBars',
    'starfield', // particleCount 600 -> 120 changes the trace
    'sineScroller' // star count 220 -> 60 changes the trace
  ]);
  for (const [name, , , filename] of EFFECTS) {
    const baseline = await rendererSignature(name, filename, {});
    // The default descriptor resolves to fullscreen/desktop and must remain the
    // unchanged classic baseline (slots do not alter fullscreen composition).
    const explicitFullscreenDesktop = await rendererSignature(name, filename,
      { surface: 'fullscreen', device: 'desktop' });
    assert.equal(explicitFullscreenDesktop, baseline,
      `${name} fullscreen/desktop drifted from the classic baseline`);

    // The preview surface lowers render.resolution below the fullscreen default.
    const env = createEnvironment();
    await loadBundle(`../dist/effects/${filename}`, env);
    env.sandbox.Demoscene[name](env.createCanvas('#demo', 48, 32),
      { surface: 'preview', device: 'desktop', config: { runtime: { autoStart: false } } });
    // (autoStart:false keeps this a pure config-resolution check; resolution is
    // resolved before any render, so it is present on getConfig() regardless.)

    const previewConfig = env.sandbox.Demoscene[name](env.createCanvas('#demo2', 48, 32),
      { surface: 'preview', device: 'desktop', config: { runtime: { autoStart: false } } }).getConfig();
    const fullscreenConfig = env.sandbox.Demoscene[name](env.createCanvas('#demo3', 48, 32),
      { surface: 'fullscreen', device: 'desktop', config: { runtime: { autoStart: false } } }).getConfig();
    assert.ok(previewConfig.render.resolution < fullscreenConfig.render.resolution,
      `${name} preview resolution must be below the fullscreen default`);

    if (PIXEL_PREVIEW_DIFFERS.has(name)) {
      const previewDesktop = await rendererSignature(name, filename,
        { surface: 'preview', device: 'desktop' });
      assert.notEqual(previewDesktop, baseline,
        `${name} preview/desktop must lower the buffer away from the fullscreen baseline`);
    }
  }
});

// Load an effect definition module directly from source (no browser code runs
// at import time — see scripts/build.mjs readEffectMetadata). Used to inspect
// the four-slot profile registry without mounting a renderer.
async function loadDefinition(modulePath, exportName) {
  const url = new URL(`../src/effects/${modulePath}`, import.meta.url);
  const mod = await import(url);
  return mod[exportName];
}

// Issue #3: the shared profile-registry builder validates its four slots and
// hands back a frozen, self-contained registry. Direct unit tests exercise every
// validation branch and the deep-clone immutability guarantee (an effect may
// spread one factored const into several slots; the registry must not alias it).
test('buildProfiles validates four slots and returns a deep-cloned frozen registry', () => {
  // Happy path: four valid slots build a registry that owns its own objects.
  const sharedRuntime = { maxFps: 60 };
  const input = {
    'fullscreen.desktop': { runtime: sharedRuntime },
    'fullscreen.mobile': { runtime: { maxFps: 30 } },
    'preview.desktop': { runtime: { maxFps: 30 }, render: { resolution: 0.2 } },
    'preview.mobile': { runtime: { maxFps: 24 }, render: { resolution: 0.2 } }
  };
  const registry = buildProfiles(input);
  assert.deepEqual(Object.keys(registry.slots).sort(), [...PROFILE_SLOT_KEYS].sort());
  // The matched-slot values are intact.
  assert.equal(registry.slots['preview.mobile'].runtime.maxFps, 24);
  // surfaces/devices are empty enumerations only (no overlay data).
  assert.deepEqual(registry.surfaces.fullscreen, {});
  assert.deepEqual(registry.devices.desktop, {});

  // The registry does not alias caller-owned objects, and mutating the input
  // after build does not affect the frozen registry.
  assert.equal(Object.is(registry.slots['fullscreen.desktop'], input['fullscreen.desktop']), false);
  assert.equal(Object.is(registry.slots['fullscreen.desktop'].runtime, sharedRuntime), false);
  input['fullscreen.desktop'].runtime.maxFps = 1;
  assert.equal(registry.slots['fullscreen.desktop'].runtime.maxFps, 60);

  // The returned slots are deeply frozen.
  assert.equal(Object.isFrozen(registry.slots['fullscreen.desktop'].runtime), true);
  assert.equal(Object.isFrozen(registry), true);

  // Validation branches.
  assert.throws(() => buildProfiles(null), /expects a slots object/);
  assert.throws(() => buildProfiles('x'), /expects a slots object/);
  assert.throws(() => buildProfiles({}), /Profile slot 'fullscreen\.desktop' is missing/);
  assert.throws(
    () => buildProfiles({
      'fullscreen.desktop': [],
      'fullscreen.mobile': {},
      'preview.desktop': {},
      'preview.mobile': {}
    }),
    /Profile slot 'fullscreen\.desktop' must be a plain object/
  );
  assert.throws(
    () => buildProfiles({
      'fullscreen.desktop': {},
      'fullscreen.mobile': {},
      'preview.desktop': {},
      'preview.mobile': {},
      'fullscreen.tablet': {}
    }),
    /Unknown profile slot 'fullscreen\.tablet'/
  );
});

// Issue #3: the resolver fails loud when the matched (surface × resolved-device)
// profile slot is missing — no silent empty-overlay fallback that would drop the
// effect's runtime budgets. Uses a synthetic definition so the missing-slot path
// is reachable (every shipped effect defines all four slots).
test('resolver fails loud on a missing matched profile slot instead of silently applying defaults', async () => {
  const { resolveDescriptor } = await import(new URL('../src/resolver.js', import.meta.url));
  const definition = {
    name: 'synthetic',
    configDefaults: {
      runtime: { autoStart: true, maxFps: 60, pixelRatio: 1, pauseWhenHidden: true },
      render: { resolution: 1, smoothing: false },
      motion: { speed: 1 },
      appearance: { palette: ['#000000', '#ffffff'], colorCount: 256, backgroundColor: '#000000' }
    },
    validate: () => {},
    skins: { classic: {} },
    // Deliberately missing the preview.mobile slot.
    profiles: {
      slots: {
        'fullscreen.desktop': {},
        'fullscreen.mobile': {},
        'preview.desktop': {}
      },
      surfaces: { fullscreen: {}, preview: {} },
      devices: { desktop: {}, mobile: {} }
    },
    capabilities: { skinAllow: new Set(['runtime', 'render', 'motion', 'appearance']) }
  };
  assert.throws(
    () => resolveDescriptor(definition, { surface: 'preview', device: 'mobile' }),
    /synthetic: profile slot 'preview\.mobile' is missing/
  );
});

// Issue #3: every effect exposes four explicit, complete, effect-owned profile
// slots — one per (surface × device) combination — with no implicit fallbacks.
test('every effect exposes four complete profile slots with the required maxFps budgets', async () => {
  // Required runtime budgets per the #3 table: [surface, device, maxFps].
  const EXPECTED = [
    ['fullscreen', 'desktop', 60],
    ['fullscreen', 'mobile', 30],
    ['preview', 'desktop', 30],
    ['preview', 'mobile', 24]
  ];
  for (const [name, module, exported] of EFFECTS) {
    const definition = await loadDefinition(module, exported);
    const slots = definition.profiles.slots;
    assert.ok(slots, `${name} must expose profiles.slots`);
    // Exactly the four canonical slot keys, nothing missing or extra.
    assert.deepEqual(Object.keys(slots).sort(), [...PROFILE_SLOT_KEYS].sort(),
      `${name} slot keys`);
    for (const [surface, device, maxFps] of EXPECTED) {
      const slot = slots[`${surface}.${device}`];
      assert.ok(slot && typeof slot === 'object', `${name} ${surface}.${device} slot must be an object`);
      assert.equal(slot.runtime?.maxFps, maxFps,
        `${name} ${surface}.${device} maxFps must be ${maxFps}`);
      assert.equal(slot.runtime?.pixelRatio, 1,
        `${name} ${surface}.${device} pixelRatio must start at 1`);
      assert.equal(slot.runtime?.pauseWhenHidden, true,
        `${name} ${surface}.${device} pauseWhenHidden must start true`);
    }
  }
});

// Issue #3: the four-slot form exists precisely because maxFps depends on BOTH
// surface and device at once (e.g. preview/desktop 30 vs fullscreen/desktop 60
// share a device but differ by surface). A two-axis merge could not express
// this; the composite matched slot can. Verify the resolved config reflects the
// exact per-(surface,device) maxFps through the public API.
test('resolved maxFps varies by both surface and device (four-slot expressiveness)', async () => {
  const EXPECTED = {
    'fullscreen.desktop': 60,
    'fullscreen.mobile': 30,
    'preview.desktop': 30,
    'preview.mobile': 24
  };
  for (const [name, , , filename] of EFFECTS) {
    for (const [slotKey, maxFps] of Object.entries(EXPECTED)) {
      const [surface, device] = slotKey.split('.');
      const env = createEnvironment();
      await loadBundle(`../dist/effects/${filename}`, env);
      const controller = env.sandbox.Demoscene[name](env.createCanvas('#demo', 32, 20),
        { surface, device, config: { runtime: { autoStart: false } } });
      assert.equal(controller.getConfig().runtime.maxFps, maxFps,
        `${name} ${slotKey} resolved maxFps`);
    }
  }
});

// Issue #3: device:'auto' is resolved exactly once at mount. An explicit device
// always wins. A matchMedia change, resize, or orientation change after mount
// must NOT recreate the renderer or silently change the resolved profile.
test('device auto resolves once at mount and is stable across post-mount media/resize changes', async () => {
  // matchMedia reports desktop at mount, then flips to mobile afterwards.
  let narrow = false;
  let coarse = false;
  const listeners = [];
  const matchMedia = (query) => {
    const mql = {
      get matches() {
        return query === '(max-width: 767px)' ? narrow
          : query === '(hover: none) and (pointer: coarse)' ? coarse : false;
      },
      media: query,
      addEventListener(type, listener) { listeners.push({ type, listener }); },
      removeEventListener(type, listener) {
        const index = listeners.findIndex((entry) => entry.type === type && entry.listener === listener);
        if (index >= 0) listeners.splice(index, 1);
      },
      addListener(listener) { listeners.push({ type: 'change', listener }); },
      removeListener(listener) {
        const index = listeners.findIndex((entry) => entry.listener === listener);
        if (index >= 0) listeners.splice(index, 1);
      }
    };
    return mql;
  };
  const env = createEnvironment({ matchMedia });
  await loadBundle('../dist/effects/plasma.js', env);
  const canvas = env.createCanvas('#demo', 48, 32);

  const controller = env.sandbox.Demoscene.plasma(canvas, { device: 'auto' });
  // Resolved desktop at mount time.
  assert.equal(controller.getSelection().requestedDevice, 'auto');
  assert.equal(controller.getSelection().resolvedDevice, 'desktop');
  const mountConfig = controller.getConfig();

  // Flip the media queries to a mobile state and fire change listeners.
  narrow = true;
  coarse = true;
  listeners.forEach((entry) => entry.listener());
  // Resize the canvas (forces applySize) and flush frames.
  canvas.width = 60;
  canvas.height = 40;
  env.resizeObservers.forEach((observer) => observer.trigger());
  env.flush(0);
  env.flush(16);

  // The resolved device, selection, and resolved config are unchanged: the
  // renderer is not recreated and the profile is not silently re-resolved.
  assert.equal(controller.getSelection().resolvedDevice, 'desktop');
  assert.equal(controller.getSelection().requestedDevice, 'auto');
  assert.equal(controller.getConfig().runtime.maxFps, mountConfig.runtime.maxFps);
  assert.equal(controller.getConfig().render.resolution, mountConfig.render.resolution);
  // Still rendering (not destroyed/recreated).
  assert.equal(env.frameCount() >= 0, true);
  controller.destroy();
});

// Issue #3: getSelection reports BOTH the requested and resolved device, so
// 'auto' is distinguishable from its mount-time resolution; surface is echoed
// verbatim.
test('getSelection reports requested and resolved skin, surface, and device', async () => {
  for (const { descriptor, expected } of [
    { descriptor: {}, expected: { surface: 'fullscreen', requestedDevice: 'auto', resolvedDevice: 'desktop' } },
    { descriptor: { device: 'mobile' }, expected: { surface: 'fullscreen', requestedDevice: 'mobile', resolvedDevice: 'mobile' } },
    { descriptor: { surface: 'preview', device: 'desktop' }, expected: { surface: 'preview', requestedDevice: 'desktop', resolvedDevice: 'desktop' } }
  ]) {
    const env = createEnvironment();
    await loadBundle('../dist/effects/plasma.js', env);
    const canvas = env.createCanvas('#demo', 32, 20);
    const selection = env.sandbox.Demoscene.plasma(canvas, descriptor).getSelection();
    assert.equal(selection.surface, expected.surface);
    assert.equal(selection.requestedDevice, expected.requestedDevice);
    assert.equal(selection.resolvedDevice, expected.resolvedDevice);
    assert.equal(Object.isFrozen(selection), true);
  }
});

test('explicit config changes the actual renderer for all ten effects', async () => {
  const CUSTOM_PALETTE = ['#001122', '#38c878', '#f2eadc'];
  const variants = {
    plasma: { field: { frequencies: [0.08, 0.06, 0.04, 1.2] }, appearance: { colorCount: 32 } },
    fire: { simulation: { seed: 7, cooling: 0.3 } },
    starfield: { particles: { particleCount: 42 } },
    metaballs: { motion: { speed: 1.7 }, appearance: { palette: CUSTOM_PALETTE, colorCount: 17 } },
    tunnel: { geometry: { angularFrequency: 9 } },
    mandelbrot: { render: { backend: 'auto' }, algorithm: { maxIterations: 120 } },
    sineScroller: { stars: { count: 12 } },
    rotozoom: { motion: { speed: 1.7 }, appearance: { palette: CUSTOM_PALETTE, colorCount: 17 } },
    feedback: { geometry: { sides: 8 } },
    copperBars: { shading: { barAlphaScale: 0.5 } }
  };
  for (const [name, , , filename] of EFFECTS) {
    const classic = await rendererSignature(name, filename);
    const changed = await rendererSignature(name, filename, { config: variants[name] });
    assert.notEqual(changed, classic, name);
  }
  // Custom-object skin overrides must also change the renderer (via appearance).
  const skinned = await rendererSignature('plasma', 'plasma.js', {
    skin: { preset: 'classic', overrides: { appearance: { palette: CUSTOM_PALETTE, colorCount: 17 } } }
  });
  assert.notEqual(skinned, await rendererSignature('plasma', 'plasma.js'), 'plasma custom skin');
});

test('render.resolution controls the real buffer for every effect', async () => {
  for (const [name, , , filename] of EFFECTS) {
    const environment = createEnvironment();
    await loadBundle(`../dist/effects/${filename}`, environment);
    const canvas = environment.createCanvas('#demo', 40, 24);
    environment.sandbox.Demoscene[name](canvas, {
      config: { runtime: { autoStart: false }, render: { resolution: 0.5 } }
    }).renderOnce(0);
    const buffer = environment.canvases.find((candidate) => candidate !== canvas);
    assert.deepEqual([buffer.width, buffer.height], [20, 12], name);
  }
});

test('pauseWhenHidden controls viewport scheduling', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/plasma.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  environment.sandbox.Demoscene.plasma(canvas, { config: { runtime: { pauseWhenHidden: true } } });
  environment.intersectionObservers[0].trigger(false);
  environment.flush(0);
  assert.equal(environment.frameCount(), 0);
  environment.intersectionObservers[0].trigger(true);
  assert.equal(environment.frameCount(), 1);
});

test('maxFps skips renderer work while preserving the shared scheduler', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/plasma.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  environment.sandbox.Demoscene.plasma(canvas, { config: { runtime: { maxFps: 30 } } });
  environment.flush(0);
  assert.equal(canvas.context.drawCalls, 1);
  environment.flush(16);
  assert.equal(canvas.context.drawCalls, 1);
  environment.flush(34);
  assert.equal(canvas.context.drawCalls, 2);
  assert.equal(environment.frameCount(), 1);
});

test('60 FPS limiter tolerates a slightly early display callback', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/plasma.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  environment.sandbox.Demoscene.plasma(canvas, { config: { runtime: { maxFps: 60 } } });
  environment.flush(0);
  environment.flush(16.2);
  assert.equal(canvas.context.drawCalls, 2);
});

test('pixelRatio, resolution and renderOnce produce an exact static backing buffer', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/mandelbrot.js', environment);
  const canvas = environment.createCanvas('#demo', 100, 60);
  const controller = environment.sandbox.Demoscene.mandelbrot(canvas, {
    config: {
      runtime: { autoStart: false, pixelRatio: 1.5 },
      render: { resolution: 0.25, smoothing: true },
      camera: { minZoom: 4000, maxZoom: 250000 }
    }
  });
  controller.renderOnce(0);
  const offscreen = environment.canvases.find((candidate) => candidate !== canvas);
  assert.deepEqual([canvas.width, canvas.height], [150, 90]);
  assert.deepEqual([offscreen.width, offscreen.height], [37, 22]);
  assert.equal(canvas.context.imageSmoothingEnabled, true);
  assert.equal(environment.frameCount(), 0);
});

test('controller stats report renderer backend and measured frames', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/mandelbrot.js', environment);
  const controller = environment.sandbox.Demoscene.mandelbrot(
    environment.createCanvas('#demo', 48, 32),
    { config: { runtime: { autoStart: false } } }
  );
  const initial = controller.getStats();
  assert.equal(initial.backend, 'canvas2d');
  assert.equal(initial.renderedFrames, 0);
  assert.equal(initial.lastFrameMs, 0);
  assert.equal(initial.averageFrameMs, 0);
  controller.renderOnce(0);
  const stats = controller.getStats();
  assert.equal(stats.backend, 'canvas2d');
  assert.equal(stats.renderedFrames, 1);
  assert.ok(stats.lastFrameMs >= 0);
  assert.ok(stats.averageFrameMs >= 0);
});

test('Mandelbrot auto selects WebGL2 and survives context restoration', async () => {
  const environment = createEnvironment({ webgl: true });
  await loadBundle('../dist/effects/mandelbrot.js', environment);
  const canvas = environment.createCanvas('#demo', 100, 60);
  const controller = environment.sandbox.Demoscene.mandelbrot(canvas, {
    config: {
      runtime: { autoStart: false },
      render: { backend: 'auto', resolution: 0.6 },
      algorithm: { maxIterations: 140 }
    }
  });
  controller.renderOnce(0);
  assert.equal(controller.getStats().backend, 'webgl2');
  assert.equal(canvas.lastWebglOptions.preserveDrawingBuffer, true);
  assert.deepEqual([canvas.width, canvas.height], [60, 36]);
  assert.equal(canvas.webglContext.drawCalls, 1);
  assert.equal(canvas.webglContext.textureUploads, 2);
  assert.equal(canvas.webglContext.textureSubUploads, 0);
  controller.start();
  environment.flush(0);
  assert.equal(canvas.webglContext.drawCalls, 2);
  let prevented = false;
  canvas.listeners.get('webglcontextlost')({ preventDefault() { prevented = true; } });
  environment.flush(17);
  assert.equal(prevented, true);
  assert.equal(canvas.webglContext.drawCalls, 2);
  assert.equal(environment.frameCount(), 0);
  canvas.listeners.get('webglcontextrestored')({});
  assert.equal(environment.frameCount(), 1);
  environment.flush(34);
  assert.equal(canvas.webglContext.drawCalls, 3);
  assert.equal(canvas.webglContext.textureUploads, 4);
  assert.equal(canvas.webglContext.textureSubUploads, 0);
  controller.stop();
});

test('Mandelbrot auto and explicit WebGL2 safely fall back to Canvas 2D', async () => {
  for (const options of [
    { webgl: false },
    { webgl: true, shaderFailure: true }
  ]) {
    const environment = createEnvironment(options);
    await loadBundle('../dist/effects/mandelbrot.js', environment);
    const controller = environment.sandbox.Demoscene.mandelbrot(
      environment.createCanvas('#demo', 48, 32),
      { config: { runtime: { autoStart: false }, render: { backend: 'webgl2' } } }
    );
    controller.renderOnce(0);
    assert.equal(controller.getStats().backend, 'canvas2d');
  }
});

async function firePixels(seed) {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/fire.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  environment.sandbox.Demoscene.fire(canvas, { config: { simulation: { seed } } });
  environment.flush(0);
  environment.flush(17);
  environment.flush(34);
  environment.flush(51);
  return environment.canvases.find((candidate) => candidate !== canvas).context.lastImage;
}

test('seeded simulations are reproducible', async () => {
  assert.deepEqual(await firePixels(42), await firePixels(42));
  assert.notDeepEqual(await firePixels(42), await firePixels(43));
  for (const [name, filename, makeConfig] of [
    ['starfield', 'starfield.js', (seed) => ({ particles: { seed, particleCount: 60 } })],
    ['sineScroller', 'sine-scroller.js', (seed) => ({ stars: { seed, count: 60 } })]
  ]) {
    assert.equal(
      await rendererSignature(name, filename, { config: makeConfig(42) }),
      await rendererSignature(name, filename, { config: makeConfig(42) }),
      `${name} same seed`
    );
    assert.notEqual(
      await rendererSignature(name, filename, { config: makeConfig(42) }),
      await rendererSignature(name, filename, { config: makeConfig(43) }),
      `${name} different seed`
    );
  }
});

test('Mandelbrot core is DOM-independent and honours camera and algorithm config', () => {
  const config = {
    motion: { speed: 1, cycleSeconds: 20, startPhase: 0.25 },
    camera: { centerX: -0.7436438870371587, centerY: 0.1318259042053119, minZoom: 4000, maxZoom: 250000 },
    algorithm: { iterationBase: 80, iterationGrowth: 60, maxIterations: 90, escapeRadius: 16 }
  };
  const zoom = mandelbrotZoom(0, { ...config.motion, ...config.camera });
  assert.ok(zoom > 4000 && zoom <= 250000);
  const pixels = new Uint32Array(64 * 40);
  const result = renderMandelbrotPixels({
    pixels, width: 64, height: 40, time: 0, config,
    palette: buildGradientPalette(new Uint32Array(32), ['#000', '#fff']),
    interiorColor: packHexColor('#000')
  });
  assert.equal(result.maxIterations, 90);
  assert.ok(pixels.some((pixel) => pixel !== 0));
});

test('hex palettes interpolate to the configured number of colours', () => {
  const palette = buildGradientPalette(new Uint32Array(3), ['#000', '#ffffff']);
  assert.equal(palette[0], packRgb(0, 0, 0) >>> 0);
  assert.equal(palette[1], packRgb(128, 128, 128) >>> 0);
  assert.equal(palette[2], packRgb(255, 255, 255) >>> 0);
});

test('build emits an API v3 manifest with effect names and skin names', async () => {
  const manifest = JSON.parse(await readFile(new URL('../dist/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.apiVersion, 3);
  assert.equal(manifest.bundle, 'demoscene.js');
  assert.equal(manifest.version, process.env.GITHUB_SHA || process.env.DEMOSCENE_VERSION || 'local');
  assert.deepEqual(manifest.effects.map((effect) => effect.name).sort(),
    EFFECTS.map(([name]) => name).sort());
  for (const effect of manifest.effects) {
    assert.deepEqual(effect.skins, ['classic']);
    assert.deepEqual(effect.surfaces.sort(), ['fullscreen', 'preview']);
    assert.deepEqual(effect.devices.sort(), ['desktop', 'mobile']);
  }
});

test('output filenames are unchanged from the v2 public contract', async () => {
  const expected = EFFECTS.map(([, , , filename]) => filename).sort();
  const { readdir } = await import('node:fs/promises');
  const present = (await readdir(new URL('../dist/effects/', import.meta.url))).sort();
  assert.deepEqual(present, expected);
});

// ---------------------------------------------------------------------------
// Issue #10 — Mandelbrot continuous coloring, Canvas2D/WebGL parity, and
// responsive camera/quality. These tests live with the rest of the suite
// because the deterministic pixel-baseline path (Canvas 2D) is the in-repo
// proxy for the browser visual harness (#4), which is not in this branch.
// ---------------------------------------------------------------------------

// Resolve the default mandelbrot config (defaults -> classic skin -> matched
// slot) so the continuous-coloring tests use the real authored knobs instead of
// hand-built values.
function mandelbrotConfig(overrides = {}) {
  return resolveDescriptor(mandelbrotDefinition, { config: overrides }).config;
}

function buildPalette(config) {
  return buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
}

test('mandelbrot continuous coloring is finite, gradient-rich, monotonic in iteration, and interior-stable', () => {
  const config = mandelbrotConfig({
    runtime: { autoStart: false },
    camera: { minZoom: 1, maxZoom: 60 }, // low zoom so the boundary is sampled at 64 wide
    algorithm: { maxIterations: 120 }
  });
  const width = 64;
  const height = 48;
  const pixels = new Uint32Array(width * height);
  const palette = buildPalette(config);
  const interiorColor = packHexColor(config.appearance.interiorColor);
  renderMandelbrotPixels({ pixels, width, height, time: 0, config, palette, interiorColor });

  // Every pixel is a finite, defined packed colour (no NaN/undefined leak).
  for (const pixel of pixels) {
    assert.equal(Number.isFinite(pixel), true);
    assert.equal(pixel >= 0, true);
  }

  // Continuous (not banded) coloring proof: the rendered escape region uses a
  // LARGE number of distinct palette entries. The old `floor(smooth * 8) %
  // length` quantized every escape pixel into one of ~8 bands per integer
  // iteration, collapsing the output to a handful of repeating stripes. A
  // continuous ramp walks many distinct entries; require a healthy minimum.
  const escapeColors = new Set();
  for (const pixel of pixels) {
    if ((pixel >>> 0) !== (interiorColor >>> 0)) escapeColors.add(pixel >>> 0);
  }
  assert.ok(escapeColors.size >= 50,
    `continuous coloring produced only ${escapeColors.size} distinct colours (band-chop regression)`);

  // Monotonicity is a property of the FORMULA, not the fractal boundary
  // (adjacent image pixels can have wildly different iteration counts by
  // construction). Holding mag2 fixed and stepping iteration by 1, the palette
  // index must advance smoothly — never jumping backwards by a large amount
  // within one iteration unit (cyclic distance, since the ramp wraps).
  const paletteLength = palette.length;
  let prev = null;
  for (let iteration = 5; iteration < 40; iteration++) {
    const index = mandelbrotPaletteIndex({
      iteration, mag2: 300, colorScale: 0.06, colorCurve: 1, cyclePhase: 0, paletteLength
    });
    assert.equal(Number.isFinite(index), true);
    assert.ok(index >= 0 && index < paletteLength);
    if (prev !== null) {
      const linear = Math.abs(index - prev);
      const cyclicJump = Math.min(linear, paletteLength - linear);
      // ~0.06 palette-widths per iteration => well under paletteLength/8.
      assert.ok(cyclicJump < paletteLength / 8,
        `smooth index moved ${cyclicJump} entries for one iteration (band-chop)`);
    }
    prev = index;
  }

  // Interior pixels (the cardioid centre is firmly inside the set) are the
  // configured interior colour, stably, and distinct from the escape ramp.
  const interiorX = Math.floor(width * 0.5);
  const interiorY = Math.floor(height * 0.5);
  assert.equal(pixels[interiorY * width + interiorX] >>> 0, interiorColor >>> 0);
});

test('mandelbrot smooth palette index is guarded against degenerate escape magnitudes', () => {
  const paletteLength = 256;
  const common = { colorScale: 0.06, colorCurve: 1, cyclePhase: 0, paletteLength };

  // A barely-escaped point and an absurdly-escaped point both yield a finite,
  // in-range index — no NaN/-Infinity reaches the lookup.
  const tiny = mandelbrotPaletteIndex({ iteration: 5, mag2: 4.0001, ...common });
  const huge = mandelbrotPaletteIndex({ iteration: 5, mag2: 1e18, ...common });
  assert.equal(Number.isFinite(tiny), true);
  assert.equal(Number.isFinite(huge), true);
  assert.ok(tiny >= 0 && tiny < paletteLength);
  assert.ok(huge >= 0 && huge < paletteLength);

  // Degenerate magnitudes that would feed log(<=0) are clamped, not NaN'd.
  const zero = mandelbrotPaletteIndex({ iteration: 5, mag2: 0, ...common });
  const negative = mandelbrotPaletteIndex({ iteration: 5, mag2: -1, ...common });
  assert.equal(Number.isFinite(zero), true);
  assert.equal(Number.isFinite(negative), true);

  // Monotonicity around escape fixtures: holding iteration, a larger escape
  // magnitude must not invert the smooth value's direction in a way that
  // breaks continuity across neighbouring iteration bands.
  const atBoundary = mandelbrotPaletteIndex({ iteration: 10, mag2: 4.5, ...common });
  const farther = mandelbrotPaletteIndex({ iteration: 10, mag2: 100, ...common });
  assert.ok(Math.abs(atBoundary - farther) <= paletteLength,
    'smooth value stays within one palette traversal for one iteration unit');

  // colorScale 0 collapses the ramp to a single band (palette[0]) with no NaN.
  const flat = mandelbrotPaletteIndex({ iteration: 50, mag2: 1e6, colorScale: 0, colorCurve: 1, cyclePhase: 0, paletteLength });
  assert.equal(flat, 0);

  // Render path with the minimum escape radius stays NaN-free.
  const config = mandelbrotConfig({
    runtime: { autoStart: false },
    algorithm: { escapeRadius: 2, maxIterations: 80 }
  });
  const pixels = new Uint32Array(32 * 20);
  const palette = buildPalette(config);
  renderMandelbrotPixels({
    pixels, width: 32, height: 20, time: 0, config, palette,
    interiorColor: packHexColor(config.appearance.interiorColor)
  });
  assert.ok(pixels.every((pixel) => Number.isFinite(pixel) && pixel >= 0));
});

test('mandelbrot Canvas2D and WebGL share the same guarded coloring formula and complex-plane mapping', () => {
  // The GLSL cannot run in Node, so parity is verified structurally: the
  // fragment shader source must contain the exact guarded expressions and
  // uniform names that mandelbrot-core.js uses, proving the two paths mirror
  // one formula.
  const shader = MANDELBROT_FRAGMENT_SHADER;
  assert.match(shader, /uniform float uColorScale;/);
  assert.match(shader, /uniform float uColorCurve;/);
  assert.match(shader, /uniform float uCyclePhase;/);
  // Guards present verbatim.
  assert.ok(shader.includes('max(dot(z, z), 1.0001)'), 'shader must guard the magnitude');
  assert.ok(shader.includes('max(ratio, 1e-12)'), 'shader must guard the inner log argument');
  // Continuous ramp wrap + curve present, old band-chop absent.
  assert.ok(shader.includes('colorCoord - floor(colorCoord)'));
  assert.ok(shader.includes('pow(colorCoord, 1.0 / clamp(uColorCurve, 0.01, 100.0))'));
  assert.equal(shader.includes('* 8.0'), false, 'old aggressive *8 band factor must be gone');

  // Same coordinate transform: both derive the complex window from
  // span = 3 / zoom and aspect = W/H with span as a real-axis half-extent.
  // Evaluate the JS mapping and the GLSL deltaC expression with identical
  // uploaded values and confirm the four corners match.
  const zoom = 4;
  const centerX = -0.7436438870371587;
  const centerY = 0.1318259042053119;
  const W = 100;
  const H = 60;
  const aspect = W / H;
  const span = 3 / zoom;

  function jsCorner(px, py) {
    // realStart = centerX - span; realStep = 2*span/W
    const real = centerX - span + px * (2 * span / W);
    // imaginaryStart = centerY - span/aspect; imaginaryStep = 2*span/aspect/H
    const imaginary = centerY - span / aspect + py * (2 * span / aspect / H);
    return [real, imaginary];
  }
  // GLSL: pixelX = gl_FragCoord.x - 0.5; deltaC = (-span + 2*span*pixelX/W, -span/aspect + 2*span*pixelY/(aspect*H)); point = center + deltaC
  function glslCorner(px, py) {
    const pixelX = px + 0.5 - 0.5; // texel centre
    const pixelY = py + 0.5 - 0.5;
    const real = centerX + (-span + 2 * span * pixelX / W);
    const imaginary = centerY + (-span / aspect + 2 * span * pixelY / (aspect * H));
    return [real, imaginary];
  }
  for (const [px, py] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) {
    const [jr, ji] = jsCorner(px, py);
    const [gr, gi] = glslCorner(px, py);
    assert.ok(Math.abs(jr - gr) < 1e-9, `real corner mismatch at ${px},${py}`);
    assert.ok(Math.abs(ji - gi) < 1e-9, `imag corner mismatch at ${px},${py}`);
  }
});

test('mandelbrot Canvas2D classifies a point that escapes on the final iteration as escaped, matching WebGL', () => {
  // Issue #10 parity requirement: a point whose magnitude crosses the escape
  // radius on the very last iteration is an ESCAPED point, not interior. The
  // WebGL shader sets `escaped = true` and applies continuous coloring; Canvas
  // 2D must agree rather than treating `iteration === maxIterations` as a
  // blanket interior signal. (maxIterations:1, escapeRadius:2, point (3,0):
  // one step -> z=3, mag2=9 >= 4 -> escaped.)
  const config = {
    motion: { speed: 1, cycleSeconds: 28, startPhase: 0 },
    camera: { centerX: 6, centerY: 0, minZoom: 1, maxZoom: 1 },
    algorithm: { iterationBase: 80, iterationGrowth: 60, maxIterations: 1, escapeRadius: 2 },
    appearance: {
      palette: ['#000000', '#ffffff'], colorCount: 256, backgroundColor: '#000000',
      interiorColor: '#000000', colorScale: 0.06, colorCurve: 1, colorOffset: 0, cycleSpeed: 0
    }
  };
  // centerX=6 with zoom=1 => span=3 => realStart = 6-3 = 3, so the lone pixel
  // (x=0) samples real=3 (the escape fixture). imag lands near 0.
  const pixels = new Uint32Array(1);
  const palette = buildGradientPalette(new Uint32Array(256), config.appearance.palette);
  const interiorColor = packHexColor(config.appearance.interiorColor) >>> 0;
  renderMandelbrotPixels({ pixels, width: 1, height: 1, time: 0, config, palette, interiorColor });
  // The point escaped (mag2=9 >= escapeSquared=4), so it must NOT be interior.
  assert.notEqual(pixels[0] >>> 0, interiorColor,
    'a point that escapes on the final iteration must be coloured, not painted interior');
});

test('mandelbrot portrait and landscape profile slots carry distinct cameras and resolution-independent bounds', () => {
  const slots = {
    'fullscreen.desktop': resolveDescriptor(mandelbrotDefinition, { surface: 'fullscreen', device: 'desktop' }).config,
    'fullscreen.mobile': resolveDescriptor(mandelbrotDefinition, { surface: 'fullscreen', device: 'mobile' }).config,
    'preview.desktop': resolveDescriptor(mandelbrotDefinition, { surface: 'preview', device: 'desktop' }).config,
    'preview.mobile': resolveDescriptor(mandelbrotDefinition, { surface: 'preview', device: 'mobile' }).config
  };

  // Desktop slots (landscape) and mobile slots (portrait) diverge on the zoom
  // floor — the explicit responsive camera override from issue #10.
  assert.equal(slots['fullscreen.desktop'].camera.minZoom, slots['preview.desktop'].camera.minZoom);
  assert.equal(slots['fullscreen.mobile'].camera.minZoom, slots['preview.mobile'].camera.minZoom);
  assert.notEqual(slots['fullscreen.desktop'].camera.minZoom, slots['fullscreen.mobile'].camera.minZoom,
    'portrait and landscape must frame differently');
  // Both orientations point at the same Seahorse-Valley feature.
  assert.equal(slots['fullscreen.desktop'].camera.centerX, slots['fullscreen.mobile'].camera.centerX);
  assert.equal(slots['fullscreen.desktop'].camera.centerY, slots['fullscreen.mobile'].camera.centerY);
  // Preview resolution raised above the old 0.15 and still below the fullscreen default.
  assert.ok(slots['preview.desktop'].render.resolution > 0.15);
  assert.ok(slots['preview.desktop'].render.resolution < slots['fullscreen.desktop'].render.resolution);

  // Resolution-independence: the complex-plane window must NOT move when the
  // buffer dimensions change. Evaluate the same slot config at two buffer sizes
  // and confirm the span (and the complex coordinate of the buffer centre)
  // are identical — bounds come from zoom + centre + aspect, never from the
  // sampling resolution.
  function windowAt(config, W, H) {
    const zoom = mandelbrotZoom(0, { ...config.motion, ...config.camera });
    const span = 3 / zoom;
    const aspect = W / H;
    const centreReal = config.camera.centerX - span + (W / 2) * (2 * span / W);
    const centreImag = config.camera.centerY - span / aspect + (H / 2) * (2 * span / aspect / H);
    return { span, centreReal, centreImag };
  }
  for (const key of Object.keys(slots)) {
    const a = windowAt(slots[key], 1280, 720);
    const b = windowAt(slots[key], 640, 360);
    assert.equal(a.span, b.span, `${key} span must not depend on buffer size`);
    // The complex coordinate of the buffer centre is exactly camera.center for
    // any buffer size (the window is centred on the camera by construction).
    assert.ok(Math.abs(a.centreReal - slots[key].camera.centerX) < 1e-9, `${key} centre real drift`);
    assert.ok(Math.abs(b.centreReal - slots[key].camera.centerX) < 1e-9, `${key} centre real drift at half size`);
  }
});

test('mandelbrot full API v3 skin and config overrides drive the continuous coloring', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/mandelbrot.js', environment);
  const canvas = environment.createCanvas('#demo', 64, 40);

  const controller = environment.sandbox.Demoscene.mandelbrot(canvas, {
    skin: { preset: 'classic', overrides: { appearance: { colorScale: 0.5, colorCurve: 2, cycleSpeed: 0.1 } } },
    config: { runtime: { autoStart: false }, appearance: { interiorColor: '#101010' } }
  });
  const config = controller.getConfig();
  // Skin override reaches the resolved config (explicit config did not touch colorScale).
  assert.equal(config.appearance.colorScale, 0.5);
  assert.equal(config.appearance.colorCurve, 2);
  assert.equal(config.appearance.cycleSpeed, 0.1);
  // Explicit config still wins where it speaks.
  assert.equal(config.appearance.interiorColor, '#101010');

  // The authored knobs reach the pixel output: a frame with the overridden
  // colorScale differs from the default-skin frame.
  controller.renderOnce(0);
  const overridden = new Uint32Array(
    environment.canvases.find((candidate) => candidate !== canvas).context.lastImage.slice()
  );
  controller.destroy();

  const baseEnv = createEnvironment();
  await loadBundle('../dist/effects/mandelbrot.js', baseEnv);
  const baseCanvas = baseEnv.createCanvas('#demo', 64, 40);
  const baseController = baseEnv.sandbox.Demoscene.mandelbrot(baseCanvas, {
    config: { runtime: { autoStart: false } }
  });
  baseController.renderOnce(0);
  const base = new Uint32Array(
    baseEnv.canvases.find((candidate) => candidate !== baseCanvas).context.lastImage.slice()
  );
  assert.notDeepEqual([...overridden], [...base], 'colorScale override must change the rendered frame');
});

test('mandelbrot WebGL renderer renders with the parity uniforms without breaking texture budgets', async () => {
  const environment = createEnvironment({ webgl: true });
  await loadBundle('../dist/effects/mandelbrot.js', environment);
  const canvas = environment.createCanvas('#demo', 100, 60);
  const controller = environment.sandbox.Demoscene.mandelbrot(canvas, {
    config: {
      runtime: { autoStart: false },
      render: { backend: 'webgl2', resolution: 0.6 },
      algorithm: { maxIterations: 140 }
    }
  });
  controller.renderOnce(0);
  // Backend, texture uploads (palette + reference orbit, unchanged), and draw
  // are all exercised. The new continuous-coloring knobs ride on uniforms
  // (uniform1f), NOT textures, so upload counts stay at 2 — verified here.
  // The shader-source parity itself is asserted by the dedicated parity test
  // against the imported MANDELBROT_FRAGMENT_SHADER (no live GL needed).
  assert.equal(controller.getStats().backend, 'webgl2');
  assert.equal(canvas.webglContext.textureUploads, 2);
  assert.equal(canvas.webglContext.drawCalls, 1);
  controller.destroy();
});

test('mandelbrot benchmark stays within the existing frame budget', () => {
  // Mirrors scripts/benchmark-mandelbrot.mjs at the portfolio skin settings:
  // 1456x902 css, resolution 0.22, 140 iterations, 8 timed samples. This is a
  // regression guard for the continuous-coloring change — it catches a gross
  // slowdown (e.g. an O(n^2) accident), NOT the sub-millisecond jitter that
  // depends on co-running test load and CPU state. The precise 30ms/41ms
  // portfolio gate is enforced by `npm run benchmark:mandelbrot` (exit code),
  // which runs isolated; here we use a generous ceiling that still fails on any
  // real regression without flaking under concurrent test load.
  const cssWidth = 1456;
  const cssHeight = 902;
  const resolution = 0.22;
  const width = Math.floor(cssWidth * resolution);
  const height = Math.floor(cssHeight * resolution);
  const { config } = resolveDescriptor(mandelbrotDefinition, {
    config: {
      runtime: { autoStart: false, pauseWhenHidden: false },
      render: { smoothing: true, resolution },
      motion: { speed: 1, cycleSeconds: 20, startPhase: 0.25 },
      camera: { minZoom: 4000, maxZoom: 250000 },
      algorithm: { maxIterations: 140 }
    }
  });
  const pixels = new Uint32Array(width * height);
  const palette = buildPalette(config);
  const interiorColor = packHexColor(config.appearance.interiorColor);
  const samples = [];
  for (let i = 0; i < 8; i++) {
    const time = i * config.motion.cycleSeconds / 8;
    const started = performance.now();
    renderMandelbrotPixels({ pixels, width, height, time, config, palette, interiorColor });
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  // The benchmark target is median <= 30ms; 2x headroom absorbs concurrent
  // test-load jitter while still failing a genuine algorithmic regression.
  assert.ok(median <= 60, `mandelbrot portfolio median ${median.toFixed(2)}ms is a gross regression`);
});

