import { assertNumber, createEffectDefaults } from '../../config.js';

export const FEEDBACK_DEFAULTS = createEffectDefaults({
  render: { resolution: 1, smoothing: true },
  motion: {
    speed: 1,
    orbitSpeedX: 0.6,
    orbitSpeedY: 0.7,
    polygonRotationSpeed: 1,
    passRotationStep: 0.3,
    colorCycleSpeed: 0.17
  },
  appearance: {
    palette: ['#ff58d6', '#5ca8ff', '#60ffd0', '#ffe66d', '#ff58d6'],
    colorCount: 360,
    backgroundColor: '#000005',
    strokeAlpha: 0.9
  },
  geometry: {
    sides: 5,
    passes: 3,
    radius: 40,
    radiusOscillation: 14,
    radiusOscillationSpeed: 3,
    passSpacing: 8,
    strokeWidth: 2,
    shadowBlur: 18,
    orbitX: 0.18,
    orbitY: 0.18
  },
  feedback: {
    alphaDecay: 0.93,
    scale: 0.985,
    rotation: 0.012,
    fade: 0.96
  }
});

/**
 * Validate the fully resolved feedback configuration (polygon geometry + feedback loop).
 * @param {object} config
 */
export function validateFeedback(config) {
  for (const key of ['orbitSpeedX', 'orbitSpeedY', 'polygonRotationSpeed', 'passRotationStep', 'colorCycleSpeed']) {
    assertNumber(config.motion[key], `feedback.motion.${key}`);
  }
  assertNumber(config.appearance.strokeAlpha, 'feedback.appearance.strokeAlpha', { min: 0, max: 1 });
  assertNumber(config.geometry.sides, 'feedback.geometry.sides', { min: 3, max: 64, integer: true });
  assertNumber(config.geometry.passes, 'feedback.geometry.passes', { min: 1, max: 32, integer: true });
  for (const key of ['radius', 'radiusOscillation', 'radiusOscillationSpeed', 'passSpacing', 'strokeWidth', 'shadowBlur']) {
    assertNumber(config.geometry[key], `feedback.geometry.${key}`, { min: 0 });
  }
  for (const key of ['orbitX', 'orbitY']) {
    assertNumber(config.geometry[key], `feedback.geometry.${key}`, { min: 0, max: 1 });
  }
  for (const key of ['alphaDecay', 'scale', 'fade']) {
    assertNumber(config.feedback[key], `feedback.feedback.${key}`, { min: 0, max: 1 });
  }
  assertNumber(config.feedback.rotation, 'feedback.feedback.rotation');
}
