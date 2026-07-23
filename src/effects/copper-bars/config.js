import { assertNumber, createEffectDefaults } from '../../config.js';

// Copper-bars composition (issue #14).
//
// The composition is expressed entirely as FRACTIONS OF HEIGHT so it is stable
// across resolutions (render.resolution only resamples rows) and across aspect
// ratios (the bar stack fills the same vertical fraction in landscape and
// portrait). Coordinates are documented here so profiles.js can re-declare the
// per-slot layouts without ambiguity:
//
//   yBase       ∈ [0,1]  — bar centre as a fraction of height (at rest)
//   amplitude   ∈ [0,1]  — half the vertical travel of the sine sway (fraction)
//   frequency   > 0      — sway rate (radians per scaled-time unit)
//   phase       ≥ 0      — deterministic per-bar phase offset (radians)
//   height      ∈ [0,1]  — full bar thickness as a fraction of height
//   colorOffset ∈ [0,1]  — palette position so adjacent bars differ in hue
//
// The DESKTOP layout below is the documented default shape (5 overlapping bars
// spanning ~0.18–0.86 of the height, reduced amplitudes to keep the hierarchy
// readable, slightly larger heights for the classic overlap). Mobile slots in
// profiles.js drop to 4 bars but keep the same stacked/overlapping hierarchy.
const DEFAULT_BARS = [
  { yBase: 0.18, amplitude: 0.055, frequency: 0.7, phase: 0.0, height: 0.062, colorOffset: 0.00 },
  { yBase: 0.34, amplitude: 0.070, frequency: 0.9, phase: 1.1, height: 0.078, colorOffset: 0.18 },
  { yBase: 0.52, amplitude: 0.050, frequency: 0.6, phase: 2.2, height: 0.054, colorOffset: 0.40 },
  { yBase: 0.70, amplitude: 0.065, frequency: 1.0, phase: 3.3, height: 0.072, colorOffset: 0.62 },
  { yBase: 0.86, amplitude: 0.045, frequency: 0.8, phase: 4.4, height: 0.058, colorOffset: 0.85 }
];

export const COPPER_BARS_DEFAULTS = createEffectDefaults({
  render: { resolution: 0.5, smoothing: true },
  motion: { speed: 1, colorCycleSpeed: 0.05 },
  appearance: {
    palette: ['#1a0a04', '#5e1d0a', '#b8430f', '#ff8a2a', '#ffe6c4', '#b8430f'],
    colorCount: 256,
    backgroundColor: '#0a0712'
  },
  bars: DEFAULT_BARS,
  shading: {
    // Bar core shape and bounded overlap composite (see renderer.js).
    glossyFalloff: 0.62,
    barAlphaScale: 0.92,
    // Narrow specular expressed as a fraction of half-height.
    specularWidth: 0.18,
    specularFalloff: 3.0,
    specularGain: 120
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
    assertNumber(bar.yBase, `copperBars.bars[${index}].yBase`, { min: 0, max: 1 });
    assertNumber(bar.amplitude, `copperBars.bars[${index}].amplitude`, { min: 0, max: 1 });
    assertNumber(bar.frequency, `copperBars.bars[${index}].frequency`, { min: 0 });
    assertNumber(bar.phase, `copperBars.bars[${index}].phase`);
    assertNumber(bar.height, `copperBars.bars[${index}].height`, { min: 0, max: 1 });
    assertNumber(bar.colorOffset, `copperBars.bars[${index}].colorOffset`, { min: 0, max: 1 });
  });
  assertNumber(config.motion.colorCycleSpeed, 'copperBars.motion.colorCycleSpeed', { min: 0 });
  assertNumber(config.shading.glossyFalloff, 'copperBars.shading.glossyFalloff', { min: Number.MIN_VALUE });
  assertNumber(config.shading.barAlphaScale, 'copperBars.shading.barAlphaScale', {
    min: Number.MIN_VALUE,
    max: 1
  });
  assertNumber(config.shading.specularWidth, 'copperBars.shading.specularWidth', { min: 0, max: 1 });
  assertNumber(config.shading.specularFalloff, 'copperBars.shading.specularFalloff', {
    min: Number.MIN_VALUE
  });
  assertNumber(config.shading.specularGain, 'copperBars.shading.specularGain', { min: 0 });
}
