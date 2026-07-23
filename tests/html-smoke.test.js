import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);

class Context {
  createImageData(width, height) {
    return { data: new Uint8ClampedArray(width * height * 4) };
  }
  putImageData() {}
  drawImage() {}
  fillRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  fillText() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  scale() {}
}

class Canvas {
  constructor() {
    this.width = 120;
    this.height = 80;
    this.context = new Context();
    this.listeners = new Map();
  }
  getContext() { return this.context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 80 }; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
}

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.previewCanvas = new Canvas();
  }
  appendChild(child) { this.children.push(child); }
  querySelector(selector) { return selector === 'canvas' ? this.previewCanvas : null; }
}

function createPageEnvironment() {
  let frames = [];
  let nextFrameId = 1;
  const grid = new Element('div');
  const mainCanvas = new Canvas();

  class Observer {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.target = target; }
    disconnect() {}
  }

  const sandbox = {
    console,
    document: {
      createElement(tag) { return tag === 'canvas' ? new Canvas() : new Element(tag); },
      getElementById(id) { return id === 'grid' ? grid : id === 'c' ? mainCanvas : null; },
      querySelector(selector) { return selector === '#c' ? mainCanvas : null; }
    },
    ResizeObserver: Observer,
    IntersectionObserver: Observer,
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
    grid,
    flush(timestamp) {
      const pending = frames;
      frames = [];
      for (const frame of pending) frame.callback(timestamp);
    }
  };
}

async function executeHtmlScripts(filename) {
  const htmlUrl = new URL(filename, root);
  const html = await readFile(htmlUrl, 'utf8');
  const environment = createPageEnvironment();
  const scriptPattern = /<script(?:\s+src="([^"]+)")?>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = scriptPattern.exec(html))) {
    const source = match[1]
      ? await readFile(new URL(match[1], htmlUrl), 'utf8')
      : match[2];
    vm.runInContext(source, environment.sandbox, { filename: match[1] || filename });
  }
  environment.flush(0);
  environment.flush(16.67);
  return environment;
}

test('every HTML demo loads its browser script and renders frames', async () => {
  const files = (await readdir(root))
    .filter((filename) => filename.endsWith('.html'))
    .sort();
  assert.equal(files.length, 11);

  for (const filename of files) {
    const environment = await executeHtmlScripts(filename);
    assert.ok(environment.sandbox.Demoscene, filename);
    if (filename === 'index.html') assert.equal(environment.grid.children.length, 10);
  }
});

// Issue #3 call-site migration: the gallery must select profiles through the
// API (surface: 'preview', device: 'auto') rather than carrying inline
// PREVIEW_SKINS visual/budget data, and standalone pages must use fullscreen.
test('gallery mounts preview/auto and standalone pages mount fullscreen via the API', async () => {
  const indexHtml = await readFile(new URL('index.html', root), 'utf8');
  // PREVIEW_SKINS no longer lives in the gallery; effect budgets are owned by
  // the per-effect profile slots.
  assert.match(indexHtml, /surface:\s*'preview'/);
  assert.match(indexHtml, /device:\s*'auto'/);
  assert.doesNotMatch(indexHtml, /PREVIEW_SKINS/);
  // No inline effect-specific config object is passed to the gallery cards.
  assert.doesNotMatch(indexHtml, /config:\s*PREVIEW_SKINS/);

  // Each standalone effect page mounts its effect with no inline surface/device
  // descriptor, which resolves to the fullscreen/auto defaults.
  const standalone = (await readdir(root))
    .filter((filename) => /^\d{2}-.+\.html$/.test(filename))
    .sort();
  assert.equal(standalone.length, 10);
  for (const filename of standalone) {
    const html = await readFile(new URL(filename, root), 'utf8');
    assert.doesNotMatch(html, /surface:\s*['"]preview['"]/,
      `${filename} must not opt into the preview surface`);
    assert.doesNotMatch(html, /config:\s*\{/,
      `${filename} must not pass inline effect config`);
  }
});
