import { assertNumber, assertString, createEffectDefaults } from '../../config.js';

const DEFAULT_TEXT = '  GREETZ TO ALL DEMOSCENERS  ***  PLASMA  FIRE  METABALLS  TUNNEL  FRACTALS  ROTOZOOM  FEEDBACK  COPPER BARS  ***  JS DEMO PACK 2026  ***  KEEP IT REAL  ***  ';

export const SINE_SCROLLER_DEFAULTS = createEffectDefaults({
  render: { resolution: 1, smoothing: true },
  motion: { speed: 1, scrollSpeed: 132, phaseSpeed: 3, colorCycleSpeed: 0.33 },
  appearance: {
    palette: ['#78a0ff', '#70f0ff', '#f080ff', '#ffe66d', '#78a0ff'],
    colorCount: 360,
    backgroundColor: '#04040a',
    shadowColor: '#000000',
    shadowAlpha: 0.6,
    starColor: '#78a0ff'
  },
  text: {
    content: DEFAULT_TEXT,
    fontFamily: 'Courier New, monospace',
    fontWeight: 900,
    fontSizeRatio: 0.13,
    maxFontSize: 72,
    characterWidthRatio: 0.62,
    shadowOffsetX: 4,
    shadowOffsetY: 4
  },
  wave: { baseline: 0.62, amplitude: 0.12, frequency: 0.018 },
  stars: {
    seed: 1993,
    count: 220,
    speed: 36,
    minDepth: 0.2,
    maxDepth: 2.2,
    minSize: 0.3,
    maxSize: 1.9,
    minAlpha: 0.3,
    maxAlpha: 1
  }
});

/**
 * Validate the fully resolved sine-scroller configuration (typography, wave, stars, motion).
 * @param {object} config
 */
export function validateSineScroller(config) {
  for (const key of ['content', 'fontFamily']) assertString(config.text[key], `sineScroller.text.${key}`);
  assertNumber(config.text.fontWeight, 'sineScroller.text.fontWeight', { min: 100, max: 1000, integer: true });
  for (const key of ['fontSizeRatio', 'maxFontSize', 'characterWidthRatio']) {
    assertNumber(config.text[key], `sineScroller.text.${key}`, { min: Number.MIN_VALUE });
  }
  for (const key of ['shadowOffsetX', 'shadowOffsetY']) assertNumber(config.text[key], `sineScroller.text.${key}`);
  assertNumber(config.wave.baseline, 'sineScroller.wave.baseline', { min: 0, max: 1 });
  assertNumber(config.wave.amplitude, 'sineScroller.wave.amplitude', { min: 0, max: 1 });
  assertNumber(config.wave.frequency, 'sineScroller.wave.frequency', { min: Number.MIN_VALUE });
  for (const key of ['scrollSpeed', 'phaseSpeed', 'colorCycleSpeed']) {
    assertNumber(config.motion[key], `sineScroller.motion.${key}`);
  }
  assertNumber(config.appearance.shadowAlpha, 'sineScroller.appearance.shadowAlpha', { min: 0, max: 1 });
  assertString(config.appearance.shadowColor, 'sineScroller.appearance.shadowColor');
  assertString(config.appearance.starColor, 'sineScroller.appearance.starColor');
  assertNumber(config.stars.seed, 'sineScroller.stars.seed', { min: 0, max: 0xffffffff, integer: true });
  assertNumber(config.stars.count, 'sineScroller.stars.count', { min: 0, max: 5000, integer: true });
  for (const key of ['speed', 'minDepth', 'maxDepth', 'minSize', 'maxSize', 'minAlpha', 'maxAlpha']) {
    assertNumber(config.stars[key], `sineScroller.stars.${key}`, { min: 0 });
  }
  for (const [minimum, maximum] of [['minDepth', 'maxDepth'], ['minSize', 'maxSize'], ['minAlpha', 'maxAlpha']]) {
    if (config.stars[maximum] < config.stars[minimum]) {
      throw new RangeError(`sineScroller.stars.${maximum} must be at least ${minimum}.`);
    }
  }
  if (config.stars.maxAlpha > 1) throw new RangeError('sineScroller.stars.maxAlpha must be at most 1.');
}
