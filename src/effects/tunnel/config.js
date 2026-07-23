import { assertNumber, createEffectDefaults } from '../../config.js';

export const TUNNEL_DEFAULTS = createEffectDefaults({
  render: { resolution: 1 / 3, smoothing: false },
  motion: { speed: 1, forwardSpeed: 84, rotationSpeed: 1.26, colorCycleSpeed: 63 },
  appearance: {
    palette: ['#ff80ee', '#60dfff', '#ffe86b', '#ff80ee'],
    colorCount: 256,
    backgroundColor: '#000000'
  },
  geometry: {
    centerX: 0.5,
    centerY: 0.5,
    radialFrequency: 60,
    angularFrequency: 6,
    fogDistance: 0.5,
    fogMinimum: 0.15
  }
});

/**
 * Validate the fully resolved tunnel configuration (polar mapping + motion fields).
 * @param {object} config
 */
export function validateTunnel(config) {
  for (const key of ['forwardSpeed', 'rotationSpeed', 'colorCycleSpeed']) {
    assertNumber(config.motion[key], `tunnel.motion.${key}`);
  }
  for (const key of ['centerX', 'centerY']) {
    assertNumber(config.geometry[key], `tunnel.geometry.${key}`);
  }
  for (const key of ['radialFrequency', 'angularFrequency', 'fogDistance']) {
    assertNumber(config.geometry[key], `tunnel.geometry.${key}`, { min: Number.MIN_VALUE });
  }
  assertNumber(config.geometry.fogMinimum, 'tunnel.geometry.fogMinimum', { min: 0, max: 1 });
}
