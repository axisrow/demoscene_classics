import { assertNumber, createEffectDefaults } from '../../config.js';

const DEFAULT_BARS = [
  { yBase: 0.22, amplitude: 0.12, frequency: 0.7, phase: 0, height: 0.048, colorOffset: 0 },
  { yBase: 0.40, amplitude: 0.10, frequency: 0.9, phase: 1, height: 0.063, colorOffset: 0.2 },
  { yBase: 0.55, amplitude: 0.13, frequency: 0.6, phase: 2, height: 0.041, colorOffset: 0.4 },
  { yBase: 0.70, amplitude: 0.11, frequency: 1.0, phase: 3, height: 0.074, colorOffset: 0.65 },
  { yBase: 0.85, amplitude: 0.09, frequency: 0.8, phase: 4, height: 0.052, colorOffset: 0.85 }
];

export const COPPER_BARS_DEFAULTS = createEffectDefaults({
  render: { resolution: 0.5, smoothing: true },
  motion: { speed: 1, colorCycleSpeed: 0.06 },
  appearance: {
    palette: ['#ff244c', '#ffe844', '#28e880', '#35a8ff', '#dc4dff', '#ff244c'],
    colorCount: 360,
    backgroundColor: '#060812'
  },
  bars: DEFAULT_BARS,
  shading: {
    glossyFalloff: 0.7,
    highlightStrength: 90,
    highlightWidth: 1.5
  }
});

/**
 * Validate the fully resolved copper-bars configuration (bar layout + shading).
 * @param {object} config
 */
export function validateCopperBars(config) {
  if (!Array.isArray(config.bars) || config.bars.length < 1 || config.bars.length > 64) {
    throw new RangeError('copperBars.bars must contain between 1 and 64 bars.');
  }
  config.bars.forEach((bar, index) => {
    for (const key of ['yBase', 'amplitude', 'frequency', 'phase', 'height', 'colorOffset']) {
      assertNumber(bar[key], `copperBars.bars[${index}].${key}`, {
        min: ['amplitude', 'frequency', 'height'].includes(key) ? 0 : -Infinity
      });
    }
  });
  assertNumber(config.motion.colorCycleSpeed, 'copperBars.motion.colorCycleSpeed');
  assertNumber(config.shading.glossyFalloff, 'copperBars.shading.glossyFalloff', { min: Number.MIN_VALUE });
  assertNumber(config.shading.highlightStrength, 'copperBars.shading.highlightStrength', { min: 0 });
  assertNumber(config.shading.highlightWidth, 'copperBars.shading.highlightWidth', { min: 0 });
}
