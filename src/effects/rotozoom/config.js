import { assertNumber, createEffectDefaults } from '../../config.js';

export const ROTOZOOM_DEFAULTS = createEffectDefaults({
  render: { resolution: 0.5, smoothing: true },
  motion: {
    speed: 1,
    rotationSpeed: 0.8,
    zoomBase: 1.2,
    zoomAmplitude: 0.7,
    zoomSpeed: 0.5
  },
  appearance: {
    palette: ['#141e28', '#284d68', '#d47832', '#f0b050', '#00f0c8', '#000000'],
    colorCount: 256,
    backgroundColor: '#000000'
  },
  texture: {
    size: 256,
    checkerSize: 32,
    ringFrequency: 0.12,
    spokeCount: 8,
    centerRadius: 26,
    borderRadius: 30
  }
});

/**
 * Validate the fully resolved rotozoom configuration (motion + procedural texture fields).
 * @param {object} config
 */
export function validateRotozoom(config) {
  for (const key of ['rotationSpeed', 'zoomAmplitude', 'zoomSpeed']) {
    assertNumber(config.motion[key], `rotozoom.motion.${key}`);
  }
  assertNumber(config.motion.zoomBase, 'rotozoom.motion.zoomBase', { min: Number.MIN_VALUE });
  assertNumber(config.texture.size, 'rotozoom.texture.size', { min: 16, max: 1024, integer: true });
  assertNumber(config.texture.checkerSize, 'rotozoom.texture.checkerSize', { min: 1, max: 512, integer: true });
  assertNumber(config.texture.ringFrequency, 'rotozoom.texture.ringFrequency', { min: 0 });
  assertNumber(config.texture.spokeCount, 'rotozoom.texture.spokeCount', { min: 1, max: 64, integer: true });
  assertNumber(config.texture.centerRadius, 'rotozoom.texture.centerRadius', { min: 0 });
  assertNumber(config.texture.borderRadius, 'rotozoom.texture.borderRadius', { min: config.texture.centerRadius });
}
