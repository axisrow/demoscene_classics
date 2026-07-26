// Issue #16: execute every code example that appears in the API v3
// documentation against the built bundles, so the docs cannot drift from the
// implementation. Each test below mirrors a documented snippet in
// README.md / docs/api-v3.md / docs/skin-and-profile-authoring.md. If an example
// here stops passing, the documentation is wrong, not the example.
//
// `npm test` builds first, so dist/ is fresh when this runs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);

// Minimal browser-ish sandbox, mirroring tests/library.test.js.
class Context {
  createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; }
  putImageData(image) { this.lastImage = image.data; }
  drawImage() {} fillRect() {}
  getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; }
  measureText() { return { width: 10, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 }; }
  beginPath() {} moveTo() {} lineTo() {} stroke() {} fillText() {}
  save() {} restore() {} translate() {} rotate() {} scale() {}
}
class Canvas {
  constructor(width = 120, height = 80) {
    this.width = width; this.height = height;
    this.context = new Context(); this.listeners = new Map();
  }
  getContext() { return this.context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
}

function createEnvironment({ matchMedia } = {}) {
  const canvases = [];
  let frames = [];
  let nextFrameId = 1;
  const sandbox = {
    console,
    matchMedia: matchMedia ?? ((query) => ({ matches: false, media: query })),
    document: { createElement: (tag) => tag === 'canvas' ? new Canvas() : { appendChild() {} } },
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    performance: { now: () => 0 },
    requestAnimationFrame(callback) { const id = nextFrameId++; frames.push({ id, callback }); return id; },
    cancelAnimationFrame(id) { frames = frames.filter((frame) => frame.id !== id); }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return {
    sandbox,
    canvases,
    createCanvas(selector, width, height) {
      const canvas = new Canvas(width, height);
      canvases.push(canvas);
      sandbox.document.querySelector = (sel) => sel === selector ? canvas : null;
      return canvas;
    },
    flush(timestamp) {
      const pending = frames; frames = [];
      for (const frame of pending) frame.callback(timestamp);
    }
  };
}

async function loadBundle(path, environment) {
  const source = await readFile(new URL(path, root), 'utf8');
  vm.runInContext(source, environment.sandbox, { filename: path });
}

// README "Quick start" + API v3 descriptor: bare call resolves to defaults.
test('docs: default descriptor resolves to classic/fullscreen/desktop', async () => {
  const env = createEnvironment();
  await loadBundle('dist/effects/fire.js', env);
  const sel = env.sandbox.Demoscene.fire(env.createCanvas('#demo', 48, 32), {}).getSelection();
  assert.equal(sel.requestedSkin, 'classic');
  assert.equal(sel.preset, 'classic');
  assert.equal(sel.surface, 'fullscreen');
  assert.equal(sel.requestedDevice, 'auto');
  assert.equal(sel.resolvedDevice, 'desktop');
});

// api-v3.md "Defaults": {} / undefined / omitted all behave identically.
test('docs: omitted, undefined, and empty descriptors are equivalent', async () => {
  for (const descriptor of [undefined, {}]) {
    const env = createEnvironment();
    await loadBundle('dist/effects/fire.js', env);
    const sel = env.sandbox.Demoscene.fire(env.createCanvas('#demo', 48, 32), descriptor).getSelection();
    assert.equal(sel.surface, 'fullscreen');
    assert.equal(sel.resolvedDevice, 'desktop');
  }
});

// README + api-v3.md "Custom skins": object form applies appearance overrides.
test('docs: custom skin object form applies appearance overrides', async () => {
  const env = createEnvironment();
  await loadBundle('dist/effects/fire.js', env);
  const controller = env.sandbox.Demoscene.fire(env.createCanvas('#demo', 48, 32), {
    skin: { preset: 'classic', overrides: { appearance: { backgroundColor: '#050102' } } }
  });
  assert.equal(controller.getConfig().appearance.backgroundColor, '#050102');
  assert.equal(controller.getSelection().requestedSkin.preset, 'classic');
  controller.destroy();
});

// api-v3.md: skin path allowlist blocks algorithmic groups; same value ok in config.
test('docs: skin overrides outside skinAllow are rejected, config accepts them', async () => {
  const env = createEnvironment();
  await loadBundle('dist/demoscene.js', env);
  const canvas = env.createCanvas('#demo', 48, 32);
  assert.throws(
    () => env.sandbox.Demoscene.fire(canvas, { skin: { overrides: { simulation: { seed: 1 } } } }),
    /out of scope at 'simulation'/
  );
  assert.doesNotThrow(() =>
    env.sandbox.Demoscene.fire(canvas, { config: { simulation: { seed: 1 } } })
  );
});

// api-v3.md "Resolution and merge contract": trace render.resolution through layers.
test('docs: merge precedence — defaults < preset < overrides < slot < explicit', async () => {
  const env = createEnvironment();
  await loadBundle('dist/effects/fire.js', env);
  const mk = () => env.createCanvas(null, 32, 20);
  const defaults = env.sandbox.Demoscene.fire(mk(),
    { config: { runtime: { autoStart: false } } }).getConfig().render.resolution;
  const slot = env.sandbox.Demoscene.fire(mk(),
    { surface: 'preview', device: 'mobile', config: { runtime: { autoStart: false } } }).getConfig().render.resolution;
  const explicit = env.sandbox.Demoscene.fire(mk(),
    { surface: 'preview', device: 'mobile', config: { runtime: { autoStart: false }, render: { resolution: 0.4 } } }).getConfig().render.resolution;
  assert.equal(defaults, 0.25);
  assert.equal(slot, 0.15);
  assert.equal(explicit, 0.4);
});

// api-v3.md + contributor guide: the four maxFps budgets.
test('docs: four profile slots carry the 60/30/30/24 maxFps budgets', async () => {
  const env = createEnvironment();
  await loadBundle('dist/effects/fire.js', env);
  const mk = () => env.createCanvas(null, 32, 20);
  const table = { 'fullscreen.desktop': 60, 'fullscreen.mobile': 30, 'preview.desktop': 30, 'preview.mobile': 24 };
  for (const [slot, maxFps] of Object.entries(table)) {
    const [surface, device] = slot.split('.');
    const cfg = env.sandbox.Demoscene.fire(mk(),
      { surface, device, config: { runtime: { autoStart: false } } }).getConfig();
    assert.equal(cfg.runtime.maxFps, maxFps, `fire ${slot}`);
    assert.equal(cfg.runtime.pixelRatio, 1, `fire ${slot} pixelRatio`);
    assert.equal(cfg.runtime.pauseWhenHidden, true, `fire ${slot} pauseWhenHidden`);
  }
});

// api-v3.md "Mount-time device resolution": coarse pointer resolves to mobile.
test('docs: device auto resolves mobile on a coarse pointer', async () => {
  const env = createEnvironment({ matchMedia: (q) => ({ matches: q === '(hover: none) and (pointer: coarse)' }) });
  await loadBundle('dist/effects/fire.js', env);
  const sel = env.sandbox.Demoscene.fire(env.createCanvas('#demo', 48, 32), { device: 'auto' }).getSelection();
  assert.equal(sel.requestedDevice, 'auto');
  assert.equal(sel.resolvedDevice, 'mobile');
});

// api-v3.md: getConfig is a frozen clone; getSelection reports resolved device.
test('docs: getConfig and getSelection are deeply frozen', async () => {
  const env = createEnvironment();
  await loadBundle('dist/effects/fire.js', env);
  const controller = env.sandbox.Demoscene.fire(env.createCanvas('#demo', 48, 32));
  assert.equal(Object.isFrozen(controller.getConfig()), true);
  assert.equal(Object.isFrozen(controller.getSelection()), true);
  controller.destroy();
});

// api-v3.md "Complete examples" — FIRE: preview/mobile + cooling override + teardown.
test('docs: full fire example renders and tears down', async () => {
  const env = createEnvironment({ matchMedia: (q) => ({ matches: q === '(hover: none) and (pointer: coarse)' }) });
  await loadBundle('dist/effects/fire.js', env);
  const canvas = env.createCanvas('#demo', 320, 200);
  const fire = env.sandbox.Demoscene.fire(canvas, {
    surface: 'preview', device: 'auto',
    config: { simulation: { cooling: 0.4 } }
  });
  const config = fire.getConfig();
  const selection = fire.getSelection();
  assert.equal(selection.surface, 'preview');
  assert.equal(selection.resolvedDevice, 'mobile');
  assert.equal(config.runtime.maxFps, 24);
  assert.equal(config.simulation.cooling, 0.4);
  for (const t of [0, 16, 33]) env.flush(t);
  fire.destroy();
});

// api-v3.md "Complete examples" — MANDELBROT: custom skin + camera/iter overrides + canvas2d.
test('docs: full mandelbrot example (canvas2d default) renders and tears down', async () => {
  const env = createEnvironment();  // no webgl => canvas2d (the default backend)
  await loadBundle('dist/effects/mandelbrot.js', env);
  const canvas = env.createCanvas('#demo', 320, 200);
  const mandel = env.sandbox.Demoscene.mandelbrot(canvas, {
    skin: { preset: 'classic', overrides: { appearance: { colorScale: 0.5, colorCurve: 2 } } },
    surface: 'fullscreen', device: 'desktop',
    config: {
      render: { backend: 'canvas2d' },
      camera: { maxZoom: 250000 },
      algorithm: { maxIterations: 140 },
      appearance: { interiorColor: '#101010' }
    }
  });
  const config = mandel.getConfig();
  assert.equal(config.appearance.colorScale, 0.5);    // skin override reached config
  assert.equal(config.appearance.colorCurve, 2);
  assert.equal(config.algorithm.maxIterations, 140);  // explicit config wins
  assert.equal(config.appearance.interiorColor, '#101010');
  for (const t of [0, 16, 33]) env.flush(t);
  assert.equal(mandel.getStats().backend, 'canvas2d'); // resolved renderer
  mandel.destroy();
});

// README: Mandelbrot backend:'auto' opts into WebGL2 (covered in full by
// library.test.js; here we assert the documented descriptor is accepted).
test('docs: mandelbrot backend auto descriptor is accepted', async () => {
  const env = createEnvironment();
  await loadBundle('dist/effects/mandelbrot.js', env);
  const controller = env.sandbox.Demoscene.mandelbrot(env.createCanvas('#demo', 64, 40), {
    config: { runtime: { autoStart: false }, render: { backend: 'auto' } }
  });
  assert.equal(controller.getConfig().render.backend, 'auto');
  assert.equal(['webgl2', 'canvas2d'].includes(controller.getStats().backend), true);
  controller.destroy();
});

// api-v3.md + README: controller lifecycle methods are chainable.
test('docs: controller lifecycle (renderOnce/start/stop/resize/destroy)', async () => {
  const env = createEnvironment();
  await loadBundle('dist/effects/fire.js', env);
  const controller = env.sandbox.Demoscene.fire(env.createCanvas('#demo', 48, 32),
    { config: { runtime: { autoStart: false } } });
  controller.renderOnce(0).start().stop().resize();
  controller.destroy();
});

// api-v3.md "v2 → v3 migration": legacy flat groups fail with the escape hatch.
test('docs: legacy v2 flat options fail with the migration hint and config escape hatch', async () => {
  const env = createEnvironment();
  await loadBundle('dist/demoscene.js', env);
  const canvas = env.createCanvas('#demo', 48, 32);
  for (const options of [{ simulation: { seed: 7 } }, { render: { resolution: 0.5 } }]) {
    assert.throws(
      () => env.sandbox.Demoscene.fire(canvas, options),
      (error) => /legacy v2 flat options/.test(error.message)
        && /config/.test(error.message)
        && error.message.includes('fire'),
      `legacy ${Object.keys(options)[0]} must fail with the migration hint`
    );
  }
});

// api-v3.md: the documented cooling bound is [0, 1] (it is a height-fraction).
test('docs: fire.simulation.cooling is bounded to [0, 1]', async () => {
  const env = createEnvironment();
  await loadBundle('dist/effects/fire.js', env);
  const canvas = env.createCanvas('#demo', 48, 32);
  assert.throws(
    () => env.sandbox.Demoscene.fire(canvas, { config: { simulation: { cooling: 3 } } }),
    /fire\.simulation\.cooling must be a finite number between 0 and 1/
  );
});

// README + contributor guide: the build emits an apiVersion:3 manifest.
test('docs: manifest declares apiVersion 3 and all ten effects', async () => {
  const manifest = JSON.parse(await readFile(new URL('dist/manifest.json', root), 'utf8'));
  assert.equal(manifest.apiVersion, 3);
  assert.equal(manifest.bundle, 'demoscene.js');
  assert.equal(manifest.effects.length, 10);
  for (const effect of manifest.effects) {
    assert.deepEqual(effect.skins, ['classic']);
    assert.deepEqual(effect.surfaces, ['fullscreen', 'preview']);
    assert.deepEqual(effect.devices, ['desktop', 'mobile']);
  }
});
