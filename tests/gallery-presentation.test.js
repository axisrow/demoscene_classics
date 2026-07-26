import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Issue #15 — gallery presentation-layer contract.
//
// The gallery must be a NEUTRAL responsive presentation layer: it selects API v3
// preview profiles, preserves each effect's output (no CSS filter/aspect stretch
// on the canvas), uses safe-area-aware spacing, disables hover transforms on
// coarse pointers, isolates mount failures, and keeps CRT decoration off the
// canvas image. These assertions run as plain Node tests (no Playwright) so they
// gate every `npm test` / CI run. The Playwright gallery screenshot harness
// (test:gallery:visual) owns the decorated full-page baseline separately.

const root = new URL('../', import.meta.url);

function readText(file) {
  return readFile(new URL(file, root), 'utf8');
}

// --- CSS source-level assertions -------------------------------------------------

// Extract the body of a top-level @media block ( brace-matched ) from CSS text.
// Returns '' if the query is not present. This is intentionally a tiny scanner,
// not a CSS parser: the gallery CSS is hand-authored and stable, and a structural
// assertion ("this declaration lives inside THIS media block") is exactly what we
// need to prevent regressions like a hover transform leaking back into a bare
// :hover rule.
function mediaBody(css, queryFragment) {
  const idx = css.indexOf('@media');
  let from = 0;
  while (idx !== -1 && from < css.length) {
    const at = css.indexOf('@media', from);
    if (at === -1) break;
    const headerEnd = css.indexOf('{', at);
    if (headerEnd === -1) break;
    const header = css.slice(at, headerEnd);
    if (header.includes(queryFragment)) {
      // Match braces from headerEnd to find the block body.
      let depth = 0;
      let end = headerEnd;
      for (let i = headerEnd; i < css.length; i++) {
        const ch = css[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      return css.slice(headerEnd + 1, end);
    }
    from = headerEnd + 1;
  }
  return '';
}

test('index.css: .preview owns a 16/9 aspect-ratio with isolation', async () => {
  const css = await readText('index.css');
  // Find the bare `.preview { ... }` rule (not the one nested in a media block).
  // `.preview` is the rule that starts the desktop default; assert it carries the
  // 16/9 aspect and the stacking-context isolation that protects the canvas.
  const previewIdx = css.indexOf('.preview {');
  assert.notEqual(previewIdx, -1, '.preview rule missing');
  // Read up to the closing brace of that first .preview block.
  let depth = 0;
  let end = previewIdx;
  for (let i = previewIdx; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const previewBlock = css.slice(previewIdx, end);
  assert.match(previewBlock, /aspect-ratio:\s*16\s*\/\s*9/, 'desktop .preview must be 16/9');
  assert.match(previewBlock, /isolation:\s*isolate/, '.preview must isolate the canvas from page overlays');
});

test('index.css: mobile breakpoint switches to single-column + 4/3 aspect', async () => {
  const css = await readText('index.css');
  const mobile = mediaBody(css, 'max-width: 767px');
  assert.ok(mobile, 'a (max-width: 767px) breakpoint must exist');
  assert.match(mobile, /grid-template-columns:\s*1fr/, 'mobile grid must be single-column');
  assert.match(mobile, /\.preview\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/, 'mobile .preview must be 4/3');
});

test('index.css: no CSS brightness/contrast/saturate filter targets the canvas', async () => {
  const css = await readText('index.css');
  // A canvas skin-substitute filter looks like `... canvas { filter: brightness(...) }`.
  // The presentation layer must never apply such a filter; the canvas image is the
  // effect's own output. We reject any `filter:` rule that mentions canvas AND a
  // brightness/contrast/saturate function anywhere in the stylesheet.
  const canvasFilter = css.match(/[^{}]*canvas[^{}]*\{[^}]*filter\s*:\s*(brightness|contrast|saturate)/);
  assert.equal(canvasFilter, null, 'a canvas element must not carry a brightness/contrast/saturate CSS filter');
  // Belt-and-suspenders: no `filter:` on `.preview canvas` at all.
  assert.doesNotMatch(css, /\.preview\s+canvas[^{}]*\{[^}]*filter\s*:/,
    '.preview canvas must not carry any CSS filter');
});

test('index.css: every safe-area inset edge is referenced', async () => {
  const css = await readText('index.css');
  for (const edge of ['top', 'bottom', 'left', 'right']) {
    assert.match(css, new RegExp(`env\\(safe-area-inset-${edge}\\)`),
      `env(safe-area-inset-${edge}) must be used so the HUD clears notches/home indicators`);
  }
});

test('index.css: coarse-pointer and hover-capable media queries both exist', async () => {
  const css = await readText('index.css');
  // Coarse-pointer / no-hover devices must get an explicit neutralising block.
  const coarse = mediaBody(css, 'hover: none');
  const coarseAlt = mediaBody(css, 'pointer: coarse');
  assert.ok(coarse || coarseAlt, 'a (hover: none) or (pointer: coarse) block must exist');
  // Hover transforms must be gated behind a hover-capable query.
  const hoverBlock = mediaBody(css, 'hover: hover');
  assert.ok(hoverBlock, 'a (hover: hover) block must exist to gate hover transforms');
  assert.match(hoverBlock, /transform:\s*translateY/, 'the hover transform must live inside the hover-capable block');
});

test('index.css: .card has an always-on focus-visible rule independent of hover', async () => {
  const css = await readText('index.css');
  // Focus treatment must not depend on hover. Assert a .card:focus-visible rule
  // exists with an outline (keyboard affordance).
  assert.match(css, /\.card:focus-visible\s*\{[^}]*outline/, '.card:focus-visible must carry an outline');
});

test('index.css: a bare .card:hover rule never carries a transform', async () => {
  const css = await readText('index.css');
  // Any `.card:hover` rule that is NOT inside a media block would fire on touch.
  // Scan top-level (non-media) occurrences of `.card:hover { ... }` and reject a
  // transform inside them. The hover: hover media block is allowed to carry one.
  const hoverHoverBlock = mediaBody(css, 'hover: hover');
  // Remove the hover: hover media block from the source so top-level scans do not
  // match its inner .card:hover. A simple cut at the matched slice.
  const cssWithoutHoverBlock = css.replace(hoverHoverBlock, '');
  // Also cut the coarse block so its `.card:hover { transform: none }` (which is
  // the explicit neutraliser) is not mistaken for an offending transform.
  const coarseBlock = mediaBody(css, 'hover: none') || mediaBody(css, 'pointer: coarse');
  const cssTopLevel = cssWithoutHoverBlock.replace(coarseBlock, '');
  const bareHover = cssTopLevel.match(/\.card:hover\s*\{[^}]*transform\s*:\s*(?!none)/);
  assert.equal(bareHover, null,
    'a top-level .card:hover rule must not apply a transform (it would fire on coarse pointers)');
});

// --- HTML source-level assertions ------------------------------------------------

test('index.html: no inline effect visual presets; mounts via surface/device only', async () => {
  const html = await readText('index.html');
  assert.doesNotMatch(html, /PREVIEW_SKINS/, 'PREVIEW_SKINS must not live in the gallery');
  assert.match(html, /surface:\s*['"]preview['"]/, 'gallery must select the preview surface');
  assert.match(html, /device:\s*['"]auto['"]/, 'gallery must resolve device automatically');
  assert.doesNotMatch(html, /<canvas[^>]*style="[^"]*filter:/i,
    'no canvas element may carry an inline filter style');
});

test('index.html: each mount is isolated by try/catch with an accessible error notice', async () => {
  const html = await readText('index.html');
  assert.match(html, /try\s*\{/, 'each effect mount must be wrapped in try/catch');
  // The catch must surface an in-place, accessible notice rather than rethrowing.
  assert.match(html, /preview-error/, 'the catch path must inject a .preview-error placeholder');
  assert.match(html, /role/, 'the error notice must carry an ARIA role');
  assert.match(html, /preview unavailable/, 'the error notice must carry human-readable text');
});

// --- VM execution: mount loop + mount-error isolation ---------------------------

// A minimal DOM rich enough for index.html's script: createElement builds
// elements that support className/setAttribute/textContent/appendChild/remove/
// querySelector, and the grid exposes its children. Canvas stubs satisfy the
// runtime's getContext/getBoundingClientRect/addEventListener contract.
class CanvasStub {
  constructor() {
    this.width = 120;
    this.height = 80;
    this.parentElement = null;
    this.context = {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {}, drawImage() {}, fillRect() {},
      measureText: () => ({ width: 10, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 }),
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {},
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {}
    };
    this.listeners = new Map();
  }
  getContext() { return this.context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 80 }; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  // Mirror Element.remove(): detach from the live DOM so the gallery's
  // mount-error path can replace a failed canvas with the notice.
  remove() {
    if (this.parentElement) {
      const i = this.parentElement.children.indexOf(this);
      if (i !== -1) this.parentElement.children.splice(i, 1);
      this.parentElement = null;
    }
  }
}

class DomNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this._canvas = null;
  }
  appendChild(child) { this.children.push(child); return child; }
  remove() {
    if (this.parentElement) {
      const i = this.parentElement.children.indexOf(this);
      if (i !== -1) this.parentElement.children.splice(i, 1);
    }
  }
  set className(v) { this._className = v; }
  get className() { return this._className || ''; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  set textContent(v) { this._text = v; }
  get textContent() { return this._text || ''; }
  // querySelector descends into the subtree so `card.querySelector('canvas')`
  // finds the canvas living inside the card's `.preview` child (a grandchild).
  querySelector(selector) {
    if (matchesSelector(this, selector)) return this;
    for (const child of this.children) {
      if (matchesSelector(child, selector)) return child;
      const deeper = child.querySelector?.(selector);
      if (deeper) return deeper;
    }
    return null;
  }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) {
    // index.html builds a card via innerHTML. We don't parse HTML, but we must
    // surface the <canvas> and .preview elements the script later queries. Parse
    // just enough: if the markup contains a .preview div and a canvas, materialise
    // them as children so querySelector('.preview')/querySelector('canvas') work.
    this._html = v;
    this.children = [];
    if (/<div class="preview">/.test(v)) {
      const preview = new DomNode('div');
      preview.className = 'preview';
      if (/<canvas/.test(v)) {
        const canvas = new CanvasStub();
        preview._canvas = canvas;
        preview.children.push(canvas);
        canvas.parentElement = preview;
      }
      this.children.push(preview);
      preview.parentElement = this;
    }
  }
}

function matchesSelector(node, selector) {
  if (!node) return false;
  // Canvas stubs answer to the `canvas` type selector.
  if (selector === 'canvas') return node instanceof CanvasStub;
  if (selector.startsWith('.')) return node._className === selector.slice(1);
  if (selector.startsWith('#')) return node.attributes && node.attributes.id === selector.slice(1);
  return node.tag === selector;
}

class Observer {
  observe() {}
  disconnect() {}
}

function createGalleryEnvironment({ failingApis = [] } = {}) {
  let frames = [];
  let nextFrameId = 1;
  const grid = new DomNode('div');
  grid.attributes.id = 'grid';

  const document = {
    createElement(tag) {
      if (tag === 'canvas') return new CanvasStub();
      const node = new DomNode(tag);
      return node;
    },
    getElementById(id) { return id === 'grid' ? grid : null; },
    querySelector() { return null; }
  };

  const sandbox = {
    console,
    document,
    ResizeObserver: Observer,
    IntersectionObserver: Observer,
    requestAnimationFrame(callback) { frames.push({ id: nextFrameId++, callback }); return nextFrameId; },
    cancelAnimationFrame() {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  return {
    sandbox,
    grid,
    failingApis,
    flush(timestamp) {
      const pending = frames;
      frames = [];
      for (const frame of pending) frame.callback(timestamp);
    }
  };
}

// Load the dist bundle and install Demoscene.*, optionally making named APIs
// throw, so we can exercise the gallery mount loop and its error isolation.
async function installDemoscene(sandbox, { failingApis = [] } = {}) {
  const bundle = await readFile(new URL('dist/demoscene.js', root), 'utf8');
  vm.runInContext(bundle, sandbox, { filename: 'dist/demoscene.js' });
  const api = sandbox.Demoscene;
  for (const name of Object.keys(api)) {
    if (failingApis.includes(name)) {
      const original = api[name];
      api[name] = () => { throw new Error(`forced mount failure: ${name}`); };
      // Preserve non-enumerable identity is not required; the gallery indexes by
      // name only. Keep a reference for symmetry.
      void original;
    }
  }
  return api;
}

async function executeGallery({ failingApis = [] } = {}) {
  const env = createGalleryEnvironment({ failingApis });
  await installDemoscene(env.sandbox, { failingApis });
  // Run the inline gallery script from index.html (the EFFECTS loop + mount).
  const html = await readText('index.html');
  const inline = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  assert.ok(inline, 'index.html must have an inline gallery script');
  // The inline script references Demoscene[effect.api]; our installed namespace
  // already has the throwing overrides applied.
  vm.runInContext(inline[1], env.sandbox, { filename: 'index.html:inline' });
  env.flush(0);
  env.flush(16.67);
  return env;
}

test('gallery mounts all 10 preview cards', async () => {
  const env = await executeGallery();
  assert.equal(env.grid.children.length, 10, 'the grid must hold one card per effect');
});

test('a single failing mount is isolated: grid stays at 10, only that card shows the error', async () => {
  // Make one effect throw at mount. The grid must still contain 10 cards, every
  // other card must still hold its canvas, and ONLY the failing card may carry a
  // .preview-error notice. No successful canvas is replaced; the loop does not abort.
  const env = await executeGallery({ failingApis: ['plasma'] });
  assert.equal(env.grid.children.length, 10, 'the grid must not lose cards when one mount fails');

  let errorCards = 0;
  let canvasCards = 0;
  for (const card of env.grid.children) {
    const preview = card.children.find((c) => c._className === 'preview');
    assert.ok(preview, 'every card must keep its .preview box (no layout disruption)');
    const hasError = preview.children.some((c) => c._className === 'preview-error');
    const hasCanvas = preview.children.some((c) => c instanceof CanvasStub);
    if (hasError) errorCards++;
    if (hasCanvas) canvasCards++;
    // A card is either healthy (canvas) or failed (notice), never both, never neither.
    assert.equal(hasError || hasCanvas, true, 'every card must show either its canvas or the error notice');
    assert.equal(hasError && hasCanvas, false, 'a card must not show both a canvas and an error notice');
  }
  assert.equal(errorCards, 1, 'exactly the failing card shows the error notice');
  assert.equal(canvasCards, 9, 'the other nine cards keep their canvases');
});
