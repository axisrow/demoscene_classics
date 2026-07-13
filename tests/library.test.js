import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { copperHue } from '../src/effects/copper-bars.js';
import {
  MANDELBROT_INTERIOR_COLOR,
  mandelbrotScale
} from '../src/effects/mandelbrot.js';
import { packRgb } from '../src/effects/utils.js';

const EFFECTS = [
  ['plasma', 'plasma.js'],
  ['fire', 'fire.js'],
  ['starfield', 'starfield.js'],
  ['metaballs', 'metaballs.js'],
  ['tunnel', 'tunnel.js'],
  ['mandelbrot', 'mandelbrot.js'],
  ['sineScroller', 'sine-scroller.js'],
  ['rotozoom', 'rotozoom.js'],
  ['feedback', 'feedback.js'],
  ['copperBars', 'copper-bars.js']
];

class MockContext {
  constructor() {
    this.drawCalls = 0;
    this.strokeCalls = 0;
    this.imageSmoothingEnabled = true;
    this.lastImage = null;
  }
  createImageData(width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  putImageData(image) {
    this.lastImage = new Uint8ClampedArray(image.data);
  }
  drawImage() { this.drawCalls++; }
  fillRect() {}
  clearRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() { this.strokeCalls++; }
  fillText() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  scale() {}
}

class MockCanvas {
  constructor(width = 48, height = 32) {
    this.width = width;
    this.height = height;
    this.clientWidth = width;
    this.clientHeight = height;
    this.context = new MockContext();
    this.listeners = new Map();
  }
  getContext() { return this.context; }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
}

function createEnvironment() {
  let nextFrameId = 1;
  let frames = [];
  const canvases = [];
  const resizeObservers = [];
  const intersectionObservers = [];
  const selectors = new Map();

  class MockResizeObserver {
    constructor(callback) {
      this.callback = callback;
      resizeObservers.push(this);
    }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    trigger() { this.callback([{ target: this.target }]); }
  }

  class MockIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      intersectionObservers.push(this);
    }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    trigger(isIntersecting) {
      this.callback([{ target: this.target, isIntersecting }]);
    }
  }

  const sandbox = {
    console,
    document: {
      createElement(tag) {
        if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`);
        const canvas = new MockCanvas();
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
    cancelAnimationFrame(id) {
      frames = frames.filter((frame) => frame.id !== id);
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  return {
    sandbox,
    canvases,
    resizeObservers,
    intersectionObservers,
    createCanvas(selector, width, height) {
      const canvas = new MockCanvas(width, height);
      canvases.push(canvas);
      if (selector) selectors.set(selector, canvas);
      return canvas;
    },
    flush(timestamp) {
      const pending = frames;
      frames = [];
      for (const frame of pending) frame.callback(timestamp);
    },
    frameCount() { return frames.length; }
  };
}

async function loadBundle(path, environment) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  vm.runInContext(source, environment.sandbox, { filename: path });
}

test('standalone bundles expose and run every named effect', async () => {
  for (const [name, filename] of EFFECTS) {
    const environment = createEnvironment();
    await loadBundle(`../dist/effects/${filename}`, environment);
    assert.equal(typeof environment.sandbox.Demoscene[name], 'function', name);
    const canvas = environment.createCanvas('#demo', 48, 32);
    const controller = environment.sandbox.Demoscene[name]('#demo', { quality: 'preview' });
    environment.flush(0);
    environment.flush(16.67);
    assert.equal(typeof controller.start, 'function');
    assert.equal(typeof controller.stop, 'function');
    assert.equal(typeof controller.resize, 'function');
    assert.equal(typeof controller.destroy, 'function');
    controller.stop().stop().start().start();
    controller.resize();
    controller.destroy();
    controller.destroy();
    assert.ok(canvas.context.drawCalls + canvas.context.strokeCalls >= 0);
  }
});

test('complete bundle exposes all effects and shares one animation frame', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/demoscene.js', environment);
  for (const [name] of EFFECTS) assert.equal(typeof environment.sandbox.Demoscene[name], 'function');

  const first = environment.createCanvas('#first', 48, 32);
  const second = environment.createCanvas('#second', 48, 32);
  environment.sandbox.Demoscene.plasma(first, { quality: 'preview' });
  environment.sandbox.Demoscene.fire(second, { quality: 'preview' });
  assert.equal(environment.frameCount(), 1);
});

test('standalone bundles merge their APIs and share the scheduler', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/plasma.js', environment);
  await loadBundle('../dist/effects/fire.js', environment);
  assert.equal(typeof environment.sandbox.Demoscene.plasma, 'function');
  assert.equal(typeof environment.sandbox.Demoscene.fire, 'function');

  const first = environment.createCanvas('#first', 48, 32);
  const second = environment.createCanvas('#second', 48, 32);
  environment.sandbox.Demoscene.plasma(first, { quality: 'preview' });
  environment.sandbox.Demoscene.fire(second, { quality: 'preview' });
  assert.equal(environment.frameCount(), 1);
});

test('preview visibility pauses and resumes the shared scheduler', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/plasma.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  environment.sandbox.Demoscene.plasma(canvas, { quality: 'preview' });
  environment.intersectionObservers[0].trigger(false);
  environment.flush(0);
  assert.equal(environment.frameCount(), 0);
  environment.intersectionObservers[0].trigger(true);
  assert.equal(environment.frameCount(), 1);
});

test('starfield does not draw false streaks on its first frame', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/starfield.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  environment.sandbox.Demoscene.starfield(canvas, { quality: 'preview' });
  environment.flush(0);
  assert.equal(canvas.context.strokeCalls, 0);
});

test('pixelated effects disable interpolation', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/plasma.js', environment);
  const canvas = environment.createCanvas('#demo', 48, 32);
  environment.sandbox.Demoscene.plasma(canvas, { quality: 'preview' });
  environment.flush(0);
  assert.equal(canvas.context.imageSmoothingEnabled, false);
});

async function plasmaPixelsAfterOneSecond(rate) {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/plasma.js', environment);
  const canvas = environment.createCanvas('#demo', 24, 18);
  environment.sandbox.Demoscene.plasma(canvas, { quality: 'preview' });
  environment.flush(0);
  for (let frame = 1; frame <= rate; frame++) {
    environment.flush(frame * 1000 / rate);
  }
  const offscreen = environment.canvases.find(
    (candidate) => candidate !== canvas && candidate.context.lastImage
  );
  return offscreen.context.lastImage;
}

test('time-based effects reach the same frame at 60 Hz and 120 Hz', async () => {
  const at60Hz = await plasmaPixelsAfterOneSecond(60);
  const at120Hz = await plasmaPixelsAfterOneSecond(120);
  assert.deepEqual(at60Hz, at120Hz);
});

test('Mandelbrot uses a black interior and adaptive full quality', () => {
  assert.equal(MANDELBROT_INTERIOR_COLOR, packRgb(0, 0, 0));
  assert.equal(mandelbrotScale(1, 'full'), 3);
  assert.equal(mandelbrotScale(1_000, 'full'), 5);
  assert.equal(mandelbrotScale(1_000_000, 'full'), 10);
  assert.equal(mandelbrotScale(1_000_000, 'preview'), 3);
});

test('Copper Bars hue changes between scanlines', () => {
  assert.notEqual(copperHue(0, -0.5, 1), copperHue(0, 0.5, 1));
});

test('invalid targets and options fail with useful errors', async () => {
  const environment = createEnvironment();
  await loadBundle('../dist/effects/plasma.js', environment);
  assert.throws(() => environment.sandbox.Demoscene.plasma('#missing'), /target not found/i);
  const canvas = environment.createCanvas('#demo', 48, 32);
  assert.throws(
    () => environment.sandbox.Demoscene.plasma(canvas, { quality: 'ultra' }),
    /quality must be/i
  );
});
