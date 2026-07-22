import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { mandelbrotZoom, renderMandelbrotPixels } from '../src/effects/mandelbrot-core.js';
import { buildGradientPalette, packHexColor, packRgb } from '../src/effects/utils.js';

const EFFECTS = [
  ['plasma', 'plasma.js'], ['fire', 'fire.js'], ['starfield', 'starfield.js'],
  ['metaballs', 'metaballs.js'], ['tunnel', 'tunnel.js'], ['mandelbrot', 'mandelbrot.js'],
  ['sineScroller', 'sine-scroller.js'], ['rotozoom', 'rotozoom.js'],
  ['feedback', 'feedback.js'], ['copperBars', 'copper-bars.js']
];

const EFFECT_MODULES = [
  ['plasma', 'plasma.js', 'normalizePlasmaConfig', 'PLASMA_DEFAULTS'],
  ['fire', 'fire.js', 'normalizeFireConfig', 'FIRE_DEFAULTS'],
  ['starfield', 'starfield.js', 'normalizeStarfieldConfig', 'STARFIELD_DEFAULTS'],
  ['metaballs', 'metaballs.js', 'normalizeMetaballsConfig', 'METABALLS_DEFAULTS'],
  ['tunnel', 'tunnel.js', 'normalizeTunnelConfig', 'TUNNEL_DEFAULTS'],
  ['mandelbrot', 'mandelbrot.js', 'normalizeMandelbrotConfig', 'MANDELBROT_DEFAULTS'],
  ['sineScroller', 'sine-scroller.js', 'normalizeSineScrollerConfig', 'SINE_SCROLLER_DEFAULTS'],
  ['rotozoom', 'rotozoom.js', 'normalizeRotozoomConfig', 'ROTOZOOM_DEFAULTS'],
  ['feedback', 'feedback.js', 'normalizeFeedbackConfig', 'FEEDBACK_DEFAULTS'],
  ['copperBars', 'copper-bars.js', 'normalizeCopperBarsConfig', 'COPPER_BARS_DEFAULTS']
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

function createEnvironment({ webgl = false, shaderFailure = false } = {}) {
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

function skinAtPath(path, value) {
  return path.reduceRight((current, key) => ({ [key]: current }), value);
}

function publicLeaves(value, path = []) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, item]) => publicLeaves(item, [...path, key]));
  }
  return [[path, value]];
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

async function rendererSignature(name, filename, skin = {}) {
  const environment = createEnvironment();
  await loadBundle(`../dist/effects/${filename}`, environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  environment.sandbox.Demoscene[name](canvas, skin);
  for (const timestamp of [0, 17, 34, 51]) environment.flush(timestamp);
  const buffer = environment.canvases.find((candidate) => candidate !== canvas);
  return buffer.context.lastImage
    ? `pixels:${hashBytes(buffer.context.lastImage)}`
    : `vector:${buffer.context.traceHash.toString(16).padStart(8, '0')}`;
}

test('standalone bundles expose API v2 controllers for every effect', async () => {
  for (const [name, filename] of EFFECTS) {
    const environment = createEnvironment();
    await loadBundle(`../dist/effects/${filename}`, environment);
    const canvas = environment.createCanvas('#demo', 48, 32);
    const controller = environment.sandbox.Demoscene[name](canvas, {
      runtime: { autoStart: false },
      render: { resolution: 0.25 }
    });
    assert.equal(typeof controller.start, 'function');
    assert.equal(typeof controller.stop, 'function');
    assert.equal(typeof controller.resize, 'function');
    assert.equal(typeof controller.renderOnce, 'function');
    assert.equal(typeof controller.getConfig, 'function');
    assert.equal(typeof controller.getStats, 'function');
    assert.equal(typeof controller.destroy, 'function');
    controller.renderOnce(0).start().stop().resize();
    controller.destroy();
  }
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

test('pauseWhenHidden controls viewport scheduling without a quality preset', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/plasma.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  environment.sandbox.Demoscene.plasma(canvas);
  environment.intersectionObservers[0].trigger(false);
  environment.flush(0);
  assert.equal(environment.frameCount(), 0);
  environment.intersectionObservers[0].trigger(true);
  assert.equal(environment.frameCount(), 1);
});

const CONFIG_CASES = [
  ['plasma', { field: { frequencies: [0.08, 0.06, 0.04, 1.2] }, appearance: { colorCount: 32 } }, ['field', 'frequencies', 0], 0.08],
  ['fire', { simulation: { seed: 7, sourceDensity: 0.4 } }, ['simulation', 'seed'], 7],
  ['starfield', { particles: { particleCount: 42 } }, ['particles', 'particleCount'], 42],
  ['metaballs', { field: { pointCount: 7 } }, ['field', 'pointCount'], 7],
  ['tunnel', { geometry: { angularFrequency: 9 } }, ['geometry', 'angularFrequency'], 9],
  ['mandelbrot', { render: { backend: 'auto' }, algorithm: { maxIterations: 120 } }, ['render', 'backend'], 'auto'],
  ['sineScroller', { stars: { count: 12 } }, ['stars', 'count'], 12],
  ['rotozoom', { texture: { spokeCount: 12 } }, ['texture', 'spokeCount'], 12],
  ['feedback', { geometry: { sides: 8 } }, ['geometry', 'sides'], 8],
  ['copperBars', { shading: { highlightStrength: 40 } }, ['shading', 'highlightStrength'], 40]
];

test('all ten effects accept structured, immutable skin values', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/demoscene.js', environment);
  for (const [name, skin, path, expected] of CONFIG_CASES) {
    const controller = environment.sandbox.Demoscene[name](
      environment.createCanvas(null, 32, 20),
      { runtime: { autoStart: false }, ...skin }
    );
    const first = controller.getConfig();
    assert.equal(path.reduce((value, key) => value[key], first), expected, name);
    first.runtime.maxFps = 1;
    assert.equal(controller.getConfig().runtime.maxFps, 60, `${name} config leaked`);
    controller.renderOnce(0);
  }

  const supplied = {
    runtime: { autoStart: false, maxFps: 24 },
    appearance: { palette: ['#000', '#fff'] }
  };
  const cloned = environment.sandbox.Demoscene.plasma(
    environment.createCanvas(null, 32, 20),
    supplied
  );
  supplied.runtime.maxFps = 1;
  supplied.appearance.palette[0] = '#f00';
  assert.equal(cloned.getConfig().runtime.maxFps, 24);
  assert.equal(cloned.getConfig().appearance.palette[0], '#000');
});

test('every documented public option is accepted, normalized and deeply frozen', async () => {
  for (const [name, filename, normalizerName, defaultsName] of EFFECT_MODULES) {
    const module = await import(`../src/effects/${filename}`);
    const normalize = module[normalizerName];
    const defaults = module[defaultsName];
    for (const [path, value] of publicLeaves(defaults)) {
      const normalized = normalize(skinAtPath(path, value));
      assert.deepEqual(valueAtPath(normalized, path), value, `${name}.${path.join('.')}`);
      assertDeepFrozen(normalized);
    }
  }
});

const CUSTOM_PALETTE = ['#001122', '#38c878', '#f2eadc'];
const RENDERER_VARIANTS = {
  plasma: {
    render: { resolution: 0.4 }, motion: { speed: 1.7 },
    appearance: { palette: CUSTOM_PALETTE, colorCount: 17 },
    field: { frequencies: [0.07, 0.05, 0.03, 1.4] }
  },
  fire: {
    render: { resolution: 0.4 }, motion: { speed: 1.7 },
    appearance: { palette: CUSTOM_PALETTE, colorCount: 17 },
    simulation: { seed: 7, sourceDensity: 0.3, sourceIntensity: 220 }
  },
  starfield: {
    render: { resolution: 0.4 }, motion: { speed: 1.7 },
    appearance: { palette: CUSTOM_PALETTE, colorCount: 17 },
    particles: { seed: 7, particleCount: 42 }
  },
  metaballs: {
    render: { resolution: 0.4 }, motion: { speed: 1.7 },
    appearance: { palette: CUSTOM_PALETTE, colorCount: 17 },
    field: { pointCount: 7, fieldStrength: 2.2 }
  },
  tunnel: {
    render: { resolution: 0.4 }, motion: { speed: 1.7 },
    appearance: { palette: CUSTOM_PALETTE, colorCount: 17 },
    geometry: { angularFrequency: 9 }
  },
  mandelbrot: {
    render: { resolution: 0.4 }, motion: { speed: 1.7 },
    appearance: {
      palette: CUSTOM_PALETTE, colorCount: 17, interiorColor: '#001122'
    },
    camera: { centerX: -0.16, centerY: 1.04, minZoom: 2, maxZoom: 8000 }
  },
  sineScroller: {
    render: { resolution: 0.4 }, motion: { speed: 1.7 },
    appearance: { palette: CUSTOM_PALETTE, colorCount: 17 },
    text: { content: 'API V2 ' }, stars: { seed: 7, count: 12 }
  },
  rotozoom: {
    render: { resolution: 0.4 }, motion: { speed: 1.7 },
    appearance: { palette: CUSTOM_PALETTE, colorCount: 17 },
    texture: { checkerSize: 11, spokeCount: 12 }
  },
  feedback: {
    render: { resolution: 0.4 }, motion: { speed: 1.7 },
    appearance: { palette: CUSTOM_PALETTE, colorCount: 17 },
    geometry: { sides: 8, passes: 2 }
  },
  copperBars: {
    render: { resolution: 0.4 }, motion: { speed: 1.7 },
    appearance: { palette: CUSTOM_PALETTE, colorCount: 17 },
    bars: [{
      yBase: 0.5, amplitude: 0.15, frequency: 1.1, phase: 0.3,
      height: 0.08, colorOffset: 0.4
    }]
  }
};

test('skin values change the actual renderer for all ten effects', async () => {
  for (const [name, filename] of EFFECTS) {
    const classic = await rendererSignature(name, filename);
    const skinned = await rendererSignature(name, filename, RENDERER_VARIANTS[name]);
    assert.notEqual(skinned, classic, name);
  }
});

test('render.resolution controls the real buffer for every effect', async () => {
  for (const [name, filename] of EFFECTS) {
    const environment = createEnvironment();
    await loadBundle(`../dist/effects/${filename}`, environment);
    const canvas = environment.createCanvas('#demo', 40, 24);
    environment.sandbox.Demoscene[name](canvas, {
      runtime: { autoStart: false },
      render: { resolution: 0.5 }
    }).renderOnce(0);
    const buffer = environment.canvases.find((candidate) => candidate !== canvas);
    assert.deepEqual([buffer.width, buffer.height], [20, 12], name);
  }
});

test('classic default frames remain pixel-stable', async () => {
  const snapshots = {};
  for (const [name, filename] of EFFECTS) {
    snapshots[name] = await rendererSignature(name, filename);
  }
  assert.deepEqual(snapshots, {
    plasma: 'pixels:19981681',
    fire: 'pixels:a5da6421',
    starfield: 'vector:1bd6eae4',
    metaballs: 'pixels:b18e0d45',
    tunnel: 'pixels:ac04a300',
    mandelbrot: 'pixels:72d102ad',
    sineScroller: 'vector:1a8c3cf0',
    rotozoom: 'pixels:cb358dc5',
    feedback: 'vector:7e2ccd86',
    copperBars: 'pixels:d6bbc495'
  });
});

test('legacy flat options and unknown nested keys fail with full paths', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/demoscene.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  assert.throws(() => environment.sandbox.Demoscene.plasma(canvas, { quality: 'preview' }), /plasma\.quality/);
  assert.throws(() => environment.sandbox.Demoscene.plasma(canvas, { maxFps: 30 }), /plasma\.maxFps/);
  assert.throws(
    () => environment.sandbox.Demoscene.mandelbrot(canvas, { appearance: { paletteMode: 'sine' } }),
    /mandelbrot\.appearance\.paletteMode/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.mandelbrot(canvas, { appearance: { palette: ['black', '#fff'] } }),
    /mandelbrot\.appearance\.palette\[0\]/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.mandelbrot(canvas, { camera: { minZom: 10 } }),
    /mandelbrot\.camera\.minZom/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.mandelbrot(canvas, { render: { resolution: 0.05 } }),
    /mandelbrot\.render\.resolution/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.mandelbrot(canvas, { render: { backend: 'webgpu' } }),
    /mandelbrot\.render\.backend/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.metaballs(canvas, { field: { pointCount: 3, points: [] } }),
    /cannot be used together/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.starfield(canvas, { particles: { particleCount: 10001 } }),
    /starfield\.particles\.particleCount/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.metaballs(canvas, {
      field: { points: Array.from({ length: 65 }, () => ({})) }
    }),
    /between 1 and 64 points/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.copperBars(canvas, {
      bars: Array.from({ length: 65 }, () => ({
        yBase: 0.5, amplitude: 0.1, frequency: 1, phase: 0, height: 0.1, colorOffset: 0
      }))
    }),
    /between 1 and 64 bars/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.plasma(canvas, { appearance: { colorCount: 4097 } }),
    /plasma\.appearance\.colorCount/
  );
  assert.throws(
    () => environment.sandbox.Demoscene.plasma(canvas, {
      appearance: { palette: Array.from({ length: 65 }, () => '#000') }
    }),
    /between 2 and 64 colours/
  );
});

test('pixelRatio, resolution and renderOnce produce an exact static backing buffer', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/mandelbrot.js', environment);
  const canvas = environment.createCanvas('#demo', 100, 60);
  const controller = environment.sandbox.Demoscene.mandelbrot(canvas, {
    runtime: { autoStart: false, pixelRatio: 1.5 },
    render: { resolution: 0.25, smoothing: true },
    camera: { minZoom: 4000, maxZoom: 250000 }
  });
  controller.renderOnce(0);
  const offscreen = environment.canvases.find((candidate) => candidate !== canvas);
  assert.deepEqual([canvas.width, canvas.height], [150, 90]);
  assert.deepEqual([offscreen.width, offscreen.height], [37, 22]);
  assert.equal(canvas.context.imageSmoothingEnabled, true);
  assert.equal(environment.frameCount(), 0);
});

test('maxFps skips renderer work while preserving the shared scheduler', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/plasma.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  environment.sandbox.Demoscene.plasma(canvas, { runtime: { maxFps: 30 } });
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
  environment.sandbox.Demoscene.plasma(canvas, { runtime: { maxFps: 60 } });
  environment.flush(0);
  environment.flush(16.2);
  assert.equal(canvas.context.drawCalls, 2);
});

test('controller stats report renderer backend and measured frames', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/mandelbrot.js', environment);
  const controller = environment.sandbox.Demoscene.mandelbrot(
    environment.createCanvas('#demo', 48, 32),
    { runtime: { autoStart: false } }
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
    runtime: { autoStart: false },
    render: { backend: 'auto', resolution: 0.6 },
    algorithm: { maxIterations: 140 }
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
      { runtime: { autoStart: false }, render: { backend: 'webgl2' } }
    );
    controller.renderOnce(0);
    assert.equal(controller.getStats().backend, 'canvas2d');
  }
});

async function firePixels(seed) {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/fire.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  environment.sandbox.Demoscene.fire(canvas, {
    simulation: { seed }
  });
  environment.flush(0);
  environment.flush(17);
  environment.flush(34);
  environment.flush(51);
  return environment.canvases.find((candidate) => candidate !== canvas).context.lastImage;
}

test('seeded simulations are reproducible', async () => {
  assert.deepEqual(await firePixels(42), await firePixels(42));
  assert.notDeepEqual(await firePixels(42), await firePixels(43));
  for (const [name, filename, makeSkin] of [
    ['starfield', 'starfield.js', (seed) => ({ particles: { seed, particleCount: 60 } })],
    ['sineScroller', 'sine-scroller.js', (seed) => ({ stars: { seed, count: 60 } })]
  ]) {
    assert.equal(
      await rendererSignature(name, filename, makeSkin(42)),
      await rendererSignature(name, filename, makeSkin(42)),
      `${name} same seed`
    );
    assert.notEqual(
      await rendererSignature(name, filename, makeSkin(42)),
      await rendererSignature(name, filename, makeSkin(43)),
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

test('build emits an API v2 manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../dist/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest, {
    version: process.env.GITHUB_SHA || process.env.DEMOSCENE_VERSION || 'local',
    apiVersion: 2,
    bundle: 'demoscene.js'
  });
});
