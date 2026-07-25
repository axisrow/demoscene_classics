import { assertBoolean, assertNumber, createEffectDefaults } from '../../config.js';

// Plasma field geometry is expressed in NORMALIZED VIEWPORT COORDINATES, never
// in render-buffer pixels (issue #5). The renderer maps each buffer cell to a
// viewport-space (u, v) sample point:
//
//   nx = (bx + 0.5) / bufferW - 0.5      // [-0.5, +0.5]
//   ny = (by + 0.5) / bufferH - 0.5
//   aspect = bufferW / bufferH
//   u = nx * aspect ,  v = ny            // aspect-corrected viewport units
//
// Because the horizontal axis is scaled by `aspect`, sqrt(u² + v²) is a true
// Euclidean distance measured in viewport-height units — so circular / radial
// features stay circular regardless of orientation, and a given wavelength is
// comparable in landscape and portrait. `render.resolution` only changes how
// many buffer cells sample that field (sampling density); it cannot move the
// field's scale, centre, wavelength, or animation speed, because the field is a
// pure function of (u, v, time).
//
// `field.frequencies` are counts of full sinusoidal CYCLES that fit across one
// viewport height (the v axis spans exactly 1.0 in height-units). A frequency
// `f` on the u axis therefore renders `f * aspect` horizontal crests. The four
// entries drive, in order: the horizontal axis wave, the vertical axis wave, the
// diagonal/interference wave (evaluated on u + v), and the radial wave
// (evaluated on the Euclidean radius). `amplitudes` and `phaseRates` mirror that
// order. `radialCenterX/Y` place the radial origin in normalized [0,1] space.
export const PLASMA_DEFAULTS = createEffectDefaults({
  render: { resolution: 0.25, smoothing: false },
  motion: { speed: 1, paletteCycleSpeed: 0.19 },
  appearance: {
    // `contrast` is an appearance-only gamma applied to the normalised field
    // value before palette lookup (see renderer.js). The classic skin overrides
    // it; the default here is a neutral 1.0 (no reshaping).
    contrast: 1
  },
  field: {
    // Cycles-per-viewport-height for the four components (axis-x, axis-y,
    // diagonal/interference, radial). Chosen so the field shows several crests
    // in every direction at once without collapsing into a near-flat wash.
    frequencies: [3, 3, 2, 2.5],
    amplitudes: [1, 1, 1, 1],
    phaseRates: [1, 0.5, 0.5, 1],
    radialCenterX: 0.5,
    radialCenterY: 0.5,
    aspectCorrection: true
  }
});

/**
 * Validate the fully resolved plasma configuration (geometry/motion fields).
 * Appearance (palette, background, contrast/curve) lives in skins.js and is
 * validated by the shared appearance validator.
 * @param {object} config
 */
export function validatePlasma(config) {
  assertNumber(config.motion.paletteCycleSpeed, 'plasma.motion.paletteCycleSpeed', { min: 0 });
  assertNumber(config.appearance.contrast, 'plasma.appearance.contrast', { min: Number.MIN_VALUE, max: 4 });
  assertBoolean(config.field.aspectCorrection, 'plasma.field.aspectCorrection');
  for (const key of ['radialCenterX', 'radialCenterY']) {
    assertNumber(config.field[key], `plasma.field.${key}`, { min: 0, max: 1 });
  }
  for (const key of ['frequencies', 'amplitudes', 'phaseRates']) {
    if (!Array.isArray(config.field[key]) || config.field[key].length !== 4) {
      throw new RangeError(`plasma.field.${key} must contain four numbers.`);
    }
    config.field[key].forEach((value, index) => assertNumber(
      value,
      `plasma.field.${key}[${index}]`,
      key === 'frequencies' || key === 'amplitudes' ? { min: Number.MIN_VALUE } : undefined
    ));
  }
}
