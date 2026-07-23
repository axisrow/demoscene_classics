import { assertNumber, createEffectDefaults } from '../../config.js';

export const FIRE_DEFAULTS = createEffectDefaults({
  render: { resolution: 0.25, smoothing: false },
  motion: { speed: 1 },
  appearance: {
    palette: ['#000000', '#ff0000', '#ffff00', '#ffffff'],
    colorCount: 256,
    backgroundColor: '#000000'
  },
  simulation: {
    seed: 1993,
    stepHz: 60,
    sourceDensity: 0.65,
    sourceIntensity: 255,
    sourceVariance: 96,
    cooling: 2,
    horizontalDrift: 1,
    maxCatchUpSteps: 3
  }
});

/**
 * Validate the fully resolved fire configuration (heat-simulation fields).
 * @param {object} config
 */
export function validateFire(config) {
  assertNumber(config.simulation.seed, 'fire.simulation.seed', { min: 0, max: 0xffffffff, integer: true });
  assertNumber(config.simulation.stepHz, 'fire.simulation.stepHz', { min: 1, max: 240 });
  assertNumber(config.simulation.sourceDensity, 'fire.simulation.sourceDensity', { min: 0, max: 1 });
  assertNumber(config.simulation.sourceIntensity, 'fire.simulation.sourceIntensity', { min: 0, max: 255, integer: true });
  assertNumber(config.simulation.sourceVariance, 'fire.simulation.sourceVariance', { min: 0, max: 255, integer: true });
  assertNumber(config.simulation.cooling, 'fire.simulation.cooling', { min: 0, max: 32, integer: true });
  assertNumber(config.simulation.horizontalDrift, 'fire.simulation.horizontalDrift', { min: 0, max: 16, integer: true });
  assertNumber(config.simulation.maxCatchUpSteps, 'fire.simulation.maxCatchUpSteps', { min: 1, max: 20, integer: true });
}
