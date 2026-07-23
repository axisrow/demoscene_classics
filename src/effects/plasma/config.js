import { assertNumber, createEffectDefaults } from '../../config.js';

export const PLASMA_DEFAULTS = createEffectDefaults({
  render: { resolution: 0.25, smoothing: false },
  motion: { speed: 1, paletteCycleSpeed: 0.19 },
  appearance: {
    palette: [
      '#80ed12', '#bfbf01', '#ed8012', '#ff4040', '#ed127f', '#bf01bf', '#8012ed',
      '#4040ff', '#127fed', '#01bfbf', '#12ed80', '#40ff40', '#7fed12'
    ],
    colorCount: 256,
    backgroundColor: '#000000'
  },
  field: {
    frequencies: [0.04, 0.04, 0.04, 1],
    radialCenterX: 0.5,
    radialCenterY: 0.5,
    amplitudes: [1, 1, 1, 1],
    phaseRates: [1, 0.5, 0.5, 1]
  }
});

/**
 * Validate the fully resolved plasma configuration (algorithm/geometry/motion fields).
 * @param {object} config
 */
export function validatePlasma(config) {
  assertNumber(config.motion.paletteCycleSpeed, 'plasma.motion.paletteCycleSpeed', { min: 0 });
  for (const key of ['radialCenterX', 'radialCenterY']) {
    assertNumber(config.field[key], `plasma.field.${key}`);
  }
  for (const key of ['frequencies', 'amplitudes', 'phaseRates']) {
    if (!Array.isArray(config.field[key]) || config.field[key].length !== 4) {
      throw new RangeError(`plasma.field.${key} must contain four numbers.`);
    }
    config.field[key].forEach((value, index) => assertNumber(
      value,
      `plasma.field.${key}[${index}]`,
      key === 'frequencies' ? { min: Number.MIN_VALUE } : undefined
    ));
  }
}
