import { assertNumber, assertString, createEffectDefaults } from '../../config.js';

const DEFAULT_TEXT = '  GREETZ TO ALL DEMOSCENERS  ***  PLASMA  FIRE  METABALLS  TUNNEL  FRACTALS  ROTOZOOM  FEEDBACK  COPPER BARS  ***  JS DEMO PACK 2026  ***  KEEP IT REAL  ***  ';

// Sine-scroller composition (issue #11).
//
// The composition is expressed entirely in NORMALIZED VIEWPORT terms measured
// against the LOGICAL (CSS) canvas, so it is stable across resolutions
// (render.resolution only resamples) and across aspect ratios. Coordinates are
// documented here so profiles.js can re-declare per-slot geometry without
// ambiguity:
//
// TYPOGRAPHY (text.*, all normalized against the short viewport side):
//   fontSizeRatio ∈ (0,1] — font size as a fraction of the short side.
//   fontSizeMin/Max      — clamp the derived font size to logical CSS px so the
//                          phrase never collapses to nothing on a tiny card nor
//                          explodes on a huge screen.
//   characterWidthRatio  — fallback per-glyph advance (fraction of fontSize)
//                          used only when measureText() reports no width.
//   outlineWidth/glowWidth — outline/glow half-extent as a fraction of the short
//                          side; counts toward the vertical safe band.
//   shadowOffsetX/Y      — drop-shadow offset as a fraction of the short side.
//   safeMargin           — vertical safe band as a fraction of the height, kept
//                          clear of glyph ink (ascenders/descenders + amplitude
//                          + outline + glow) so the phrase is never cropped.
//
// WAVE (wave.*, normalized against viewport geometry):
//   baseline   ∈ [0,1]   — glyph centre as a fraction of height (at rest).
//   amplitude  ∈ [0,1]   — half the vertical travel of the sine, as a fraction
//                          of the SHORT side (so the sway does not stretch with
//                          aspect ratio).
//   cycles     > 0        — wave frequency expressed as CYCLES ACROSS THE TEXT
//                          PATH, not a pixel divisor. The renderer places a glyph
//                          at path-fraction t at y = baseline + sin(t*2π·cycles
//                          + phase)*amplitude, so the number of humps across the
//                          phrase is exactly `cycles` regardless of canvas width.
//
// MOTION (motion.*, time-based and normalized):
//   scrollSpeed          — scroll rate in VIEWPORT-WIDTHS PER SECOND. The phrase
//                          advances `scrollSpeed * logicalWidth * delta` logical
//                          units per frame, so the same elapsed time scrolls the
//                          same viewport fraction at any frame rate.
//   phaseSpeed           — wave phase advance in radians per scaled-second.
//   colorCycleSpeed      — palette cycle rate (palette-fraction per scaled-sec).
//
// STARS (stars.*, deterministic and area-budgeted):
//   seed                 — deterministic RNG seed for spawn + recycle order.
//   count                — explicit star count (the escape-hatch budget used by
//                          callers overriding via `config.stars.count`).
//   densityMode          — 'explicit' honours `count` verbatim (default);
//                          'area' derives count from the CSS viewport area and
//                          clamps to [densityMin, densityMax] (see
//                          resolveStarCount). Mobile slots use 'area' so a small
//                          screen stays populated without the desktop cost.
//   speed                — drift rate in viewport-widths/sec (parallax by z).
//   minDepth/maxDepth    — parallax depth band; near stars drift faster.
//   minSize/maxSize      — star size as a fraction of the short side (by depth).
//   minAlpha/maxAlpha    — star brightness band (by depth).
export const SINE_SCROLLER_DEFAULTS = createEffectDefaults({
  render: { resolution: 1, smoothing: true },
  motion: { speed: 1, scrollSpeed: 0.18, phaseSpeed: 3, colorCycleSpeed: 0.33 },
  appearance: {
    palette: ['#78a0ff', '#70f0ff', '#f080ff', '#ffe66d', '#78a0ff'],
    colorCount: 360,
    backgroundColor: '#04040a',
    shadowColor: '#000000',
    shadowAlpha: 0.6,
    starColor: '#78a0ff',
    // Font family/weight are VISUAL (skin-owned): they change how the phrase
    // looks, not its layout geometry. Size, spacing, baseline, and the wave
    // geometry stay in text/wave (config/profiles).
    fontFamily: 'Courier New, monospace',
    fontWeight: 900
  },
  text: {
    content: DEFAULT_TEXT,
    fontSizeRatio: 0.16,
    fontSizeMin: 10,
    fontSizeMax: 96,
    characterWidthRatio: 0.62,
    outlineWidth: 0,
    glowWidth: 0.02,
    shadowOffsetX: 0.012,
    shadowOffsetY: 0.012,
    safeMargin: 0.04
  },
  wave: { baseline: 0.62, amplitude: 0.06, cycles: 2.5 },
  stars: {
    seed: 1993,
    count: 220,
    densityMode: 'explicit',
    densityPerUnitArea: 0.45,
    densityMin: 60,
    densityMax: 1200,
    speed: 0.06,
    minDepth: 0.2,
    maxDepth: 2.2,
    minSize: 0.0015,
    maxSize: 0.006,
    minAlpha: 0.3,
    maxAlpha: 1
  }
});

/**
 * Resolve the font size (logical CSS px) for a given short viewport side.
 * Pure and deterministic: fontSize = clamp(shortSide * ratio, min, max).
 * @param {number} shortSide - min(logicalWidth, logicalHeight).
 * @param {object} text - the resolved config.text group.
 * @returns {number}
 */
export function resolveFontSize(shortSide, text) {
  return Math.min(text.fontSizeMax, Math.max(text.fontSizeMin, shortSide * text.fontSizeRatio));
}

/**
 * Vertical wave Y (logical units) for a glyph at a given path fraction.
 * Pure and deterministic: y = baseline + sin(pathFraction*2π·cycles + phase)*amp.
 * @param {number} pathFraction - distance along the text path / pathWidth ∈ [0,1).
 * @param {number} phase - wave phase (radians).
 * @param {number} baseline - glyph centre at rest (logical units).
 * @param {number} amplitude - half travel (logical units).
 * @param {number} cycles - wave cycles across the text path.
 * @returns {number}
 */
export function resolveWaveY(pathFraction, phase, baseline, amplitude, cycles) {
  return baseline + Math.sin(pathFraction * 2 * Math.PI * cycles + phase) * amplitude;
}

/**
 * Half the vertical ink extent of a glyph including outline + glow, in logical
 * units. Used to confirm the baseline keeps glyph ink inside the safe band at
 * every phase: baseline ± (amplitude + this) must stay within
 * [safeMargin, height - safeMargin].
 * @param {number} glyphHeight - measured ascender+descender height (logical).
 * @param {number} shortSide - min(logicalWidth, logicalHeight).
 * @param {object} text - the resolved config.text group.
 * @returns {number}
 */
export function resolveGlyphHalfExtent(glyphHeight, shortSide, text) {
  return glyphHeight / 2 + text.outlineWidth * shortSide + text.glowWidth * shortSide;
}

/**
 * Resolve the active star budget from the resolved config and the CSS viewport
 * area. 'explicit' returns count unchanged; 'area' derives the count from area
 * and clamps it to [densityMin, densityMax]. Pure and deterministic: the same
 * (config, area) always yields the same count.
 * @param {object} stars - the resolved config.stars group.
 * @param {number} area - the CSS viewport area (logicalWidth * logicalHeight).
 * @returns {number}
 */
export function resolveStarCount(stars, area) {
  if (stars.densityMode !== 'area') return Math.min(stars.count, 5000);
  const derived = Math.round(stars.densityPerUnitArea * Math.max(0, area) / 1000);
  // Defensive hard cap: even if a caller bypasses validation, the renderer must
  // never allocate an unbounded array (new Array(count)) — that hangs/OOMs the
  // browser. The validated ceiling is 5000 (matches `count`).
  return Math.min(5000, Math.min(stars.densityMax, Math.max(stars.densityMin, derived)));
}

/**
 * Validate the fully resolved sine-scroller configuration (typography, wave, stars, motion).
 * @param {object} config
 */
export function validateSineScroller(config) {
  assertString(config.text.content, 'sineScroller.text.content');
  assertString(config.appearance.fontFamily, 'sineScroller.appearance.fontFamily');
  assertNumber(config.appearance.fontWeight, 'sineScroller.appearance.fontWeight', { min: 100, max: 1000, integer: true });
  assertNumber(config.text.fontSizeRatio, 'sineScroller.text.fontSizeRatio', { min: Number.MIN_VALUE, max: 1 });
  assertNumber(config.text.fontSizeMin, 'sineScroller.text.fontSizeMin', { min: 1, integer: true });
  assertNumber(config.text.fontSizeMax, 'sineScroller.text.fontSizeMax', {
    min: config.text.fontSizeMin,
    integer: true
  });
  assertNumber(config.text.characterWidthRatio, 'sineScroller.text.characterWidthRatio', { min: Number.MIN_VALUE });
  for (const key of ['outlineWidth', 'glowWidth', 'shadowOffsetX', 'shadowOffsetY', 'safeMargin']) {
    assertNumber(config.text[key], `sineScroller.text.${key}`, { min: 0, max: 1 });
  }
  assertNumber(config.wave.baseline, 'sineScroller.wave.baseline', { min: 0, max: 1 });
  assertNumber(config.wave.amplitude, 'sineScroller.wave.amplitude', { min: 0, max: 1 });
  assertNumber(config.wave.cycles, 'sineScroller.wave.cycles', { min: Number.MIN_VALUE });
  for (const key of ['scrollSpeed', 'phaseSpeed', 'colorCycleSpeed']) {
    assertNumber(config.motion[key], `sineScroller.motion.${key}`);
  }
  assertNumber(config.appearance.shadowAlpha, 'sineScroller.appearance.shadowAlpha', { min: 0, max: 1 });
  assertString(config.appearance.shadowColor, 'sineScroller.appearance.shadowColor');
  assertString(config.appearance.starColor, 'sineScroller.appearance.starColor');
  assertNumber(config.stars.seed, 'sineScroller.stars.seed', { min: 0, max: 0xffffffff, integer: true });
  if (!['explicit', 'area'].includes(config.stars.densityMode)) {
    throw new RangeError(`sineScroller.stars.densityMode must be 'explicit' or 'area'.`);
  }
  assertNumber(config.stars.count, 'sineScroller.stars.count', { min: 0, max: 5000, integer: true });
  assertNumber(config.stars.densityPerUnitArea, 'sineScroller.stars.densityPerUnitArea', { min: 0 });
  assertNumber(config.stars.densityMin, 'sineScroller.stars.densityMin', { min: 0, max: 5000, integer: true });
  assertNumber(config.stars.densityMax, 'sineScroller.stars.densityMax', {
    min: config.stars.densityMin,
    max: 5000,
    integer: true
  });
  for (const key of ['speed', 'minDepth', 'maxDepth', 'minSize', 'maxSize']) {
    assertNumber(config.stars[key], `sineScroller.stars.${key}`, { min: 0 });
  }
  assertNumber(config.stars.minAlpha, 'sineScroller.stars.minAlpha', { min: 0, max: 1 });
  assertNumber(config.stars.maxAlpha, 'sineScroller.stars.maxAlpha', { min: 0, max: 1 });
  for (const [minimum, maximum] of [['minDepth', 'maxDepth'], ['minSize', 'maxSize'], ['minAlpha', 'maxAlpha']]) {
    if (config.stars[maximum] < config.stars[minimum]) {
      throw new RangeError(`sineScroller.stars.${maximum} must be at least ${minimum}.`);
    }
  }
}
