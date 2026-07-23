import { assertNumber, assertString, createEffectDefaults } from '../../config.js';

export const MANDELBROT_INTERIOR_DEFAULT = '#000000';

export const MANDELBROT_DEFAULTS = createEffectDefaults({
  render: { backend: 'canvas2d', resolution: 0.2, smoothing: false },
  motion: { speed: 1, cycleSeconds: 28, startPhase: 0 },
  appearance: {
    palette: [
      '#80ed12', '#bfbf01', '#ed8012', '#ff4040', '#ed127f', '#bf01bf', '#8012ed',
      '#4040ff', '#127fed', '#01bfbf', '#12ed80', '#40ff40', '#7fed12'
    ],
    colorCount: 1024,
    backgroundColor: '#000000',
    interiorColor: '#000000'
  },
  camera: {
    centerX: -0.7436438870371587,
    centerY: 0.1318259042053119,
    minZoom: 1,
    maxZoom: 1_000_000
  },
  algorithm: {
    iterationBase: 80,
    iterationGrowth: 60,
    maxIterations: null,
    escapeRadius: 16
  }
});

/**
 * Validate the fully resolved mandelbrot configuration (backend, camera, algorithm).
 * @param {object} config
 */
export function validateMandelbrot(config) {
  assertString(config.render.backend, 'mandelbrot.render.backend');
  if (!['auto', 'webgl2', 'canvas2d'].includes(config.render.backend)) {
    throw new RangeError('mandelbrot.render.backend must be auto, webgl2 or canvas2d.');
  }
  assertNumber(config.motion.cycleSeconds, 'mandelbrot.motion.cycleSeconds', { min: Number.MIN_VALUE });
  assertNumber(config.motion.startPhase, 'mandelbrot.motion.startPhase', { min: 0, max: 1 });
  for (const key of ['centerX', 'centerY']) {
    assertNumber(config.camera[key], `mandelbrot.camera.${key}`);
  }
  assertNumber(config.camera.minZoom, 'mandelbrot.camera.minZoom', { min: Number.MIN_VALUE });
  assertNumber(config.camera.maxZoom, 'mandelbrot.camera.maxZoom', {
    min: config.camera.minZoom + Number.EPSILON
  });
  assertNumber(config.algorithm.iterationBase, 'mandelbrot.algorithm.iterationBase', { min: 1 });
  assertNumber(config.algorithm.iterationGrowth, 'mandelbrot.algorithm.iterationGrowth', { min: 0 });
  if (config.algorithm.maxIterations !== null) {
    assertNumber(config.algorithm.maxIterations, 'mandelbrot.algorithm.maxIterations', {
      min: 1,
      max: 10000,
      integer: true
    });
  }
  assertNumber(config.algorithm.escapeRadius, 'mandelbrot.algorithm.escapeRadius', { min: 2 });
}
