import { assertNumber, createEffectDefaults } from '../../config.js';

export const STARFIELD_DEFAULTS = createEffectDefaults({
  render: { resolution: 1, smoothing: true },
  motion: { speed: 1 },
  appearance: {
    palette: ['#b4c8ff', '#ffffff'],
    colorCount: 256,
    backgroundColor: '#000000'
  },
  particles: {
    seed: 1993,
    particleCount: 600,
    fov: 256,
    depth: 256,
    travelSpeed: 192,
    centerX: 0.5,
    centerY: 0.5,
    trailFade: 0.35,
    minAlpha: 0.25,
    maxAlpha: 0.95,
    minLineWidth: 1,
    maxLineWidth: 3
  }
});

/**
 * Validate the fully resolved starfield configuration (particle projection fields).
 * @param {object} config
 */
export function validateStarfield(config) {
  assertNumber(config.particles.seed, 'starfield.particles.seed', { min: 0, max: 0xffffffff, integer: true });
  assertNumber(config.particles.particleCount, 'starfield.particles.particleCount', { min: 1, max: 10000, integer: true });
  for (const key of ['fov', 'depth', 'travelSpeed']) {
    assertNumber(config.particles[key], `starfield.particles.${key}`, { min: Number.MIN_VALUE });
  }
  for (const key of ['centerX', 'centerY', 'trailFade', 'minAlpha', 'maxAlpha']) {
    assertNumber(config.particles[key], `starfield.particles.${key}`, { min: 0, max: 1 });
  }
  assertNumber(config.particles.minLineWidth, 'starfield.particles.minLineWidth', { min: Number.MIN_VALUE });
  assertNumber(config.particles.maxLineWidth, 'starfield.particles.maxLineWidth', { min: config.particles.minLineWidth });
  if (config.particles.maxAlpha < config.particles.minAlpha) {
    throw new RangeError('starfield.particles.maxAlpha must be at least minAlpha.');
  }
}
