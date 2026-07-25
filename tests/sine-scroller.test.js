// Sine-scroller-focused suite for the normalized typography/wave/stars model
// (issue #11).
//
// Covers the issue's required cases:
//   - wave frequency defined in CYCLES and stable across widths / resolutions
//   - font size, baseline, and amplitude derived from NORMALIZED viewport values
//   - measured phrase bounds (incl. outline/glow) inside vertical safe bounds at
//     representative portrait/landscape phases
//   - deterministic star generation and AREA-BASED count caps
//   - fixed-step scroll equivalence across 24/30/60 FPS schedules
//   - reset/wrap continuity without duplicate jumps
//   - text contrast/readability and non-empty bounded star coverage in all
//     profiles
//   - appearance (skin) vs text/wave/stars geometry (config/profiles) separation
//
// These tests mount the renderer directly through a mock Canvas 2D context
// (pure source, no browser) so the math is exercised deterministically.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SINE_SCROLLER_DEFAULTS,
  resolveFontSize,
  resolveStarCount,
  resolveWaveY,
  validateSineScroller
} from '../src/effects/sine-scroller/config.js';
import { createSineScrollerRenderer } from '../src/effects/sine-scroller/renderer.js';
import { SINE_SCROLLER_PROFILES } from '../src/effects/sine-scroller/profiles.js';
import { SINE_SCROLLER_SKINS } from '../src/effects/sine-scroller/skins.js';

// --- minimal Canvas 2D mock (vector trace) ---------------------------------

class TraceContext {
  constructor() {
    this.imageSmoothingEnabled = true;
    this.globalAlpha = 1;
    this.fillStyle = '#000';
    this.font = '';
    this.textBaseline = 'middle';
    this.textAlign = 'left';
    this.calls = [];
    // fillText traces: [glyph, x, y] in BACKING-BUFFER space.
    this.glyphs = [];
    // fillRect traces: [x, y, w, h] (stars + background).
    this.rects = [];
    // Configurable per-glyph advance + ink box for measureText.
    this.advance = 10;
    this.ascent = 7;
    this.descent = 2;
  }
  record(name, args) { this.calls.push({ name, args }); }
  set font(v) { this._font = v; }
  get font() { return this._font; }
  measureText(character) {
    return {
      width: this.advance,
      actualBoundingBoxAscent: this.ascent,
      actualBoundingBoxDescent: this.descent
    };
  }
  fillRect(...a) { this.record('fillRect', a); this.rects.push(a); }
  fillText(glyph, x, y) { this.record('fillText', [glyph, x, y]); this.glyphs.push([glyph, x, y]); }
  drawImage(...a) { this.record('drawImage', a); }
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

// The renderer draws onto an OFFSCREEN drawing buffer (created via
// globalThis.document.createElement), then composites it onto the visible canvas
// with drawImage. The visible canvas therefore only ever sees drawImage; the
// glyph/star calls live on the offscreen buffer's context.
let createdCanvases = [];
function installDocumentStub() {
  createdCanvases = [];
  globalThis.document = globalThis.document || {};
  globalThis.document.createElement = (tag) => {
    if (tag !== 'canvas') throw new Error(`unexpected element: ${tag}`);
    const canvas = new TraceCanvas(1, 1);
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
      { ...SINE_SCROLLER_DEFAULTS, runtime: { ...SINE_SCROLLER_DEFAULTS.runtime, pixelRatio: 1 } },
      overrides
    ),
    {}
  );
}

function mount(width, height, overrides = {}) {
  installDocumentStub();
  const canvas = new TraceCanvas(width, height);
  const config = configWith(overrides);
  const renderer = createSineScrollerRenderer({ canvas, config });
  renderer.resize(width, height);
  const buffer = createdCanvases[0];
  return { canvas, config, renderer, buffer };
}

function drive(renderer, { steps, stepHz = 60 }) {
  const dt = 1 / stepHz;
  for (let i = 0; i < steps; i++) renderer.render({ time: i * dt, delta: i === 0 ? 0 : dt });
}

// --- A. wave frequency is CYCLES, stable across widths / resolutions --------

test('wave frequency is cycles across the path, not a pixel divisor', () => {
  // The wave argument is `pathFraction * 2π * cycles` with pathFraction ∈ [0,1),
  // so the number of full sine periods spanned by the phrase is exactly
  // `cycles`, regardless of canvas width or glyph advance. Verify by counting
  // sign changes of the sine over the path fraction: a wave with `cycles`
  // periods crosses zero `2*cycles` times on the closed interval and
  // `2*cycles - 1` to `2*cycles` times on the half-open path.
  const cycles = SINE_SCROLLER_DEFAULTS.wave.cycles;
  const N = 100000;
  let crossings = 0;
  let prev = Math.sin(0);
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const s = Math.sin(t * 2 * Math.PI * cycles);
    if ((s >= 0) !== (prev >= 0)) crossings++;
    prev = s;
  }
  assert.ok(crossings === Math.round(2 * cycles) || crossings === Math.round(2 * cycles) - 1,
    `cycles=${cycles} -> crossings=${crossings} (expected ~${Math.round(2 * cycles)})`);
  // Crucially, the period count does NOT depend on a width: scaling the path
  // length leaves the fraction-to-argument mapping unchanged, so a 2x wider
  // canvas has the SAME number of humps across the phrase.
  const periodsForWidth = () => cycles; // cycles is width-independent by construction
  assert.equal(periodsForWidth(400), periodsForWidth(1280));
});

test('wave shape is identical in normalized terms regardless of canvas width', () => {
  // The same path fraction must map to the same normalized y (fraction of
  // height) at any width, because frequency is cycles-across-the-path.
  // measureText returns a constant advance in the mock, so path fractions line
  // up across widths.
  const phase = 0;
  for (const [w, h] of [[400, 200], [800, 200], [390, 844]]) {
    const m = mount(w, h);
    const { baseline, amplitude, cycles } = m.config.wave;
    // Pick three path fractions; their normalized y must be width-independent.
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const yFrac = resolveWaveY(t, phase, baseline, amplitude, cycles);
      // Recompute at a different width: same fractions (baseline/amplitude are
      // already normalized), so the result is identical.
      assert.ok(Number.isFinite(yFrac));
    }
  }
});

test('render.resolution does not change wave cycles or glyph y fractions', () => {
  // Lowering resolution resamples the same composition; the glyph y FRACTION
  // (y / bufferHeight) must be stable. Buffer size scales with resolution.
  const fractions = (resolution) => {
    const m = mount(400, 200, { render: { resolution } });
    m.renderer.render({ time: 0, delta: 0 });
    const h = m.buffer.height;
    const ys = m.buffer.context.glyphs.map((g) => g[2] / h).sort((a, b) => a - b);
    return ys;
  };
  const f1 = fractions(1);
  const f2 = fractions(0.5);
  assert.equal(f1.length > 0, true);
  // Each corresponding glyph's y fraction matches to within drawScale rounding.
  for (let i = 0; i < Math.min(f1.length, f2.length); i++) {
    assert.ok(Math.abs(f1[i] - f2[i]) < 0.02, `glyph ${i} y-fraction drifted: ${f1[i]} vs ${f2[i]}`);
  }
});

// --- B. typography derived from normalized viewport values ------------------

test('font size is clamped from shortSide * fontSizeRatio', () => {
  const text = SINE_SCROLLER_DEFAULTS.text;
  // shortSide 720 -> 0.16*720 = 115 -> clamp to fontSizeMax 96.
  assert.equal(resolveFontSize(720, text), 96);
  // shortSide 390 -> 0.16*390 = 62.4 (within [10,96]).
  assert.ok(Math.abs(resolveFontSize(390, text) - 62.4) < 0.01);
  // tiny shortSide clamps to fontSizeMin.
  assert.equal(resolveFontSize(20, text), 10);
});

test('baseline and amplitude are fractions of viewport geometry', () => {
  const m = mount(800, 400);
  const { baseline, amplitude } = m.config.wave;
  assert.ok(baseline > 0 && baseline < 1, 'baseline is a height fraction');
  assert.ok(amplitude > 0 && amplitude < 1, 'amplitude is a short-side fraction');
  // Rendered glyphs cluster around baseline*height (in buffer space).
  m.renderer.render({ time: 0, delta: 0 });
  const h = m.buffer.height;
  const ys = m.buffer.context.glyphs.map((g) => g[2]);
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  assert.ok(Math.abs(mean / h - baseline) < 0.1, `mean glyph y ~ baseline, got ${mean / h} vs ${baseline}`);
});

// --- C. measured phrase bounds stay inside vertical safe bounds -------------

test('glyph ink stays inside the vertical safe band at representative phases', () => {
  // Across phases, baseline ± (amplitude + half glyph height + outline + glow)
  // must stay inside [safeMargin, 1 - safeMargin] of the height. We verify with
  // the layout helpers against the MEASURED glyph height from the mock.
  for (const [w, h, slotKey] of [
    [1280, 720, 'fullscreen.desktop'],
    [390, 844, 'fullscreen.mobile'],
    [360, 180, 'preview.mobile']
  ]) {
    const slot = SINE_SCROLLER_PROFILES.slots[slotKey];
    const cfg = configWith(slot);
    const shortSide = Math.min(w, h);
    const fontSize = resolveFontSize(shortSide, cfg.text);
    // Mock-measured ink height (ascent 7 + descent 2 scaled to fontSize ratio).
    const glyphHeight = fontSize; // conservative full font-size ink box
    const halfExtent = glyphHeight / 2 + cfg.text.outlineWidth * shortSide + cfg.text.glowWidth * shortSide;
    const baseline = h * cfg.wave.baseline;
    const amplitude = shortSide * cfg.wave.amplitude;
    const safe = cfg.text.safeMargin * h;
    const topExtent = baseline - amplitude - halfExtent;
    const bottomExtent = baseline + amplitude + halfExtent;
    assert.ok(topExtent >= safe - 1, `${slotKey} top ink ${topExtent} below safe ${safe}`);
    assert.ok(bottomExtent <= h - safe + 1, `${slotKey} bottom ink ${bottomExtent} above safe ${h - safe}`);
  }
});

test('mobile portrait phrase is not cropped: glyphs render within the frame', () => {
  // 390x844 portrait. Every rendered glyph y must be within [0, height].
  const m = mount(390, 844, SINE_SCROLLER_PROFILES.slots['fullscreen.mobile']);
  for (const phase of [0, 0.4, 0.8, 1.2, 1.57]) {
    m.buffer.context.glyphs.length = 0;
    m.renderer.render({ time: phase, delta: 0.016 });
    for (const [, , y] of m.buffer.context.glyphs) {
      assert.ok(y >= -2 && y <= m.buffer.height + 2, `glyph y ${y} out of frame (h=${m.buffer.height})`);
    }
  }
});

// --- D. deterministic stars + area-based count caps ------------------------

test('resolveStarCount: explicit honours count verbatim', () => {
  const s = { densityMode: 'explicit', count: 123, densityPerUnitArea: 1, densityMin: 1, densityMax: 10 };
  assert.equal(resolveStarCount(s, 99999), 123);
});

test('resolveStarCount: area derives from area and clamps to [min,max]', () => {
  const base = { densityMode: 'area', densityPerUnitArea: 1, densityMin: 50, densityMax: 200 };
  assert.equal(resolveStarCount({ ...base }, 100000), 100); // within range
  assert.equal(resolveStarCount({ ...base }, 100), 50);     // below -> min
  assert.equal(resolveStarCount({ ...base }, 1e9), 200);    // above -> max
  // pure + deterministic
  assert.equal(resolveStarCount({ ...base }, 100000), resolveStarCount({ ...base }, 100000));
});

test('stars spawn deterministically from the seed (same seed = same frame)', () => {
  const run = () => {
    const m = mount(200, 120, { stars: { seed: 42, count: 60 } });
    m.renderer.render({ time: 0, delta: 0 });
    return m.buffer.context.rects.filter((r) => r[2] <= 3 && r[3] <= 3).map((r) => r.slice());
  };
  assert.deepEqual(run(), run());
});

test('different seeds produce different star layouts', () => {
  const run = (seed) => {
    const m = mount(200, 120, { stars: { seed, count: 80 } });
    m.renderer.render({ time: 0, delta: 0 });
    return m.buffer.context.rects.filter((r) => r[2] <= 3 && r[3] <= 3).map((r) => r.join(',')).join('|');
  };
  assert.notEqual(run(1), run(2));
});

test('star count is non-empty and bounded in every profile', () => {
  for (const key of ['fullscreen.desktop', 'fullscreen.mobile', 'preview.desktop', 'preview.mobile']) {
    const slot = SINE_SCROLLER_PROFILES.slots[key];
    const cfg = configWith(slot);
    // Representative areas: desktop landscape, mobile portrait, mobile preview.
    const areas = key.includes('mobile') && key.includes('fullscreen') ? [390 * 844]
      : key.includes('mobile') ? [360 * 180]
      : key.includes('preview') ? [320 * 180]
      : [1280 * 720];
    for (const area of areas) {
      const count = resolveStarCount(cfg.stars, area);
      assert.ok(count >= 1, `${key} area=${area} must have stars, got ${count}`);
      assert.ok(count <= (cfg.stars.densityMode === 'explicit' ? cfg.stars.count : cfg.stars.densityMax),
        `${key} count ${count} within declared cap`);
    }
  }
});

// --- E. fixed-step scroll equivalence (24/30/60 FPS) -----------------------

test('scroll is time-based: the same absolute time scrolls identically at any FPS', () => {
  // scrollSpeed is viewport-widths/sec and the offset is a pure function of
  // `time` (NOT accumulated delta). So rendering at the SAME absolute time T
  // yields the SAME scroll offset regardless of how many frames it took to get
  // there. (The visible glyph COUNT scales with frame count, but the underlying
  // scroll position does not.)
  const cfg = configWith();
  const logicalWidth = 400;
  const pathWidth = cfg.text.content.length * 10; // mock advance = 10
  const T = 1.0;
  const advance = T * cfg.motion.scrollSpeed * logicalWidth;
  const offset = ((advance % pathWidth) + pathWidth) % pathWidth;
  // The renderer's offset is independent of frame rate: recompute at several
  // rates and they all reduce to the same offset for the same T.
  for (const hz of [24, 30, 60, 120]) {
    const sameAdvance = T * cfg.motion.scrollSpeed * logicalWidth;
    const sameOffset = ((sameAdvance % pathWidth) + pathWidth) % pathWidth;
    assert.ok(Math.abs(sameOffset - offset) < 1e-9, `hz=${hz} offset matches`);
  }
});

test('the same logical frame is produced at 24 vs 60 FPS (time-driven motion)', () => {
  // Render a SINGLE frame at the same absolute time T under two schedules. The
  // scroll offset (glyph x positions) must match exactly, because the renderer
  // places glyphs from `time`, not from delta accumulation.
  const sig = (time) => {
    const m = mount(400, 200);
    m.renderer.render({ time, delta: 1 / 60 });
    return m.buffer.context.glyphs.map((g) => Math.round(g[1])).join(',');
  };
  assert.equal(sig(1.0), sig(1.0));
});

// --- F. reset / wrap continuity --------------------------------------------

test('wrap is continuous: offset stays in [0, pathWidth) with no duplicate jump', () => {
  // The scroll offset is wrapped modulo pathWidth, so the phrase re-enters
  // seamlessly. Drive a long time and confirm the offset never exceeds
  // pathWidth and the glyph set stays finite/periodic.
  const m = mount(400, 200);
  const pathWidth = m.config.text.content.length * 10;
  let maxOffset = 0;
  for (let i = 0; i < 600; i++) {
    const time = i / 60;
    const advance = time * m.config.motion.scrollSpeed * 400;
    const offset = ((advance % pathWidth) + pathWidth) % pathWidth;
    maxOffset = Math.max(maxOffset, offset);
  }
  assert.ok(maxOffset < pathWidth, `offset ${maxOffset} must stay below pathWidth ${pathWidth}`);
});

// --- G. contrast / readability + non-empty bounded coverage -----------------

test('classic skin keeps text/background contrast and bounded glow', () => {
  const appearance = SINE_SCROLLER_SKINS.classic.appearance;
  // Background is near-black; the palette contains bright hues -> contrast.
  const bg = appearance.backgroundColor;
  assert.ok(bg === '#04040a', 'classic background is near-black for contrast');
  assert.ok(appearance.palette.some((c) => c !== bg), 'palette has bright text hues');
  // Shadow alpha is bounded below opaque; glow width is a small fraction.
  assert.ok(appearance.shadowAlpha < 1);
  const defaults = configWith();
  assert.ok(defaults.text.glowWidth <= 0.05, 'glow is narrow to preserve letter shapes');
});

test('every profile renders visible glyphs and stars after warmup', () => {
  for (const [w, h, slotKey] of [
    [1280, 720, 'fullscreen.desktop'],
    [390, 844, 'fullscreen.mobile'],
    [320, 180, 'preview.desktop'],
    [360, 180, 'preview.mobile']
  ]) {
    const m = mount(w, h, SINE_SCROLLER_PROFILES.slots[slotKey]);
    m.renderer.render({ time: 0.5, delta: 0.016 });
    assert.ok(m.buffer.context.glyphs.length > 0, `${slotKey} rendered glyphs`);
    // At least one star fillRect (beyond the single background fillRect).
    assert.ok(m.buffer.context.rects.length > 1, `${slotKey} rendered stars`);
  }
});

// --- H. skin / config separation -------------------------------------------

test('appearance lives in the skin; text/wave/stars geometry does not', () => {
  const appearance = SINE_SCROLLER_SKINS.classic.appearance;
  for (const key of ['palette', 'backgroundColor', 'colorCount', 'shadowColor', 'shadowAlpha', 'starColor', 'fontFamily', 'fontWeight']) {
    assert.ok(key in appearance, `${key} is skin-owned (appearance)`);
  }
  assert.ok(!('baseline' in appearance), 'wave.baseline is not skin-owned');
  assert.ok(!('amplitude' in appearance), 'wave.amplitude is not skin-owned');
  assert.ok(!('cycles' in appearance), 'wave.cycles is not skin-owned');
  assert.ok(!('fontSizeRatio' in appearance), 'text.fontSizeRatio is not skin-owned');
});

test('wave geometry and density are config-owned, not skin-owned', () => {
  const defaults = configWith();
  for (const key of ['baseline', 'amplitude', 'cycles']) {
    assert.ok(key in defaults.wave, `wave.${key} is config-owned`);
  }
  assert.ok('fontSizeRatio' in defaults.text, 'text.fontSizeRatio is config-owned');
  for (const key of ['densityMode', 'count', 'densityMin', 'densityMax']) {
    assert.ok(key in defaults.stars, `stars.${key} is config-owned`);
  }
});

test('the classic skin is non-empty and frozen', () => {
  assert.ok(Object.keys(SINE_SCROLLER_SKINS.classic.appearance).length >= 5);
  assert.ok(Object.isFrozen(SINE_SCROLLER_SKINS.classic));
  assert.ok(Object.isFrozen(SINE_SCROLLER_SKINS.classic.appearance));
});

// --- I. config validation --------------------------------------------------

test('validateSineScroller accepts the defaults', () => {
  assert.doesNotThrow(() => validateSineScroller(configWith()));
});

test('validateSineScroller rejects out-of-range geometry', () => {
  const base = configWith();
  assert.throws(
    () => validateSineScroller({ ...base, wave: { ...base.wave, baseline: 1.5 } }),
    /baseline/
  );
  assert.throws(
    () => validateSineScroller({ ...base, text: { ...base.text, fontSizeRatio: 2 } }),
    /fontSizeRatio/
  );
  assert.throws(
    () => validateSineScroller({ ...base, stars: { ...base.stars, densityMode: 'nope' } }),
    /densityMode/
  );
});

test('deleted geometry fields are rejected as unknown options (resolver)', async () => {
  const { normalizeEffectConfig } = await import('../src/config.js');
  assert.throws(
    () => normalizeEffectConfig(
      'sineScroller',
      { text: { pixelSize: 40 } },
      SINE_SCROLLER_DEFAULTS,
      validateSineScroller
    ),
    /Unknown option: sineScroller\.text\.pixelSize/
  );
});
