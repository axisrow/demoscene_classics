import {
  assertNumber,
  assertString,
  createEffectDefaults,
  normalizeEffectConfig
} from '../config.js';
import { mandelbrotZoom, renderMandelbrotPixels } from './mandelbrot-core.js';
import {
  createMandelbrotWebGLRenderer,
  probeMandelbrotWebGL2
} from './mandelbrot-webgl.js';
import {
  buildGradientPalette,
  createPixelBuffer,
  getContext2D,
  packHexColor,
  packRgb,
  presentPixelBuffer,
  resizePixelBuffer
} from './utils.js';

export const MANDELBROT_INTERIOR_COLOR = packRgb(0, 0, 0);

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

export function normalizeMandelbrotConfig(input) {
  return normalizeEffectConfig('mandelbrot', input, MANDELBROT_DEFAULTS, (config) => {
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
  });
}

export { mandelbrotZoom, renderMandelbrotPixels };

export function createMandelbrotCanvas2DRenderer({ canvas, config }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  const interiorColor = packHexColor(config.appearance.interiorColor);
  let width = 1;
  let height = 1;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resizePixelBuffer(
        buffer,
        width * config.render.resolution,
        height * config.render.resolution
      );
    },
    render({ time }) {
      renderMandelbrotPixels({
        pixels: buffer.pixels,
        width: buffer.width,
        height: buffer.height,
        time,
        config,
        palette,
        interiorColor
      });
      presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
    },
    getStats() {
      return { backend: 'canvas2d' };
    }
  };
}

export function createMandelbrotRenderer({ canvas, config }) {
  if (config.render.backend !== 'canvas2d' && probeMandelbrotWebGL2()) {
    try {
      return createMandelbrotWebGLRenderer({ canvas, config });
    } catch (error) {
      globalThis.console?.warn?.('Mandelbrot WebGL2 unavailable; using Canvas 2D.', error);
    }
  }
  return createMandelbrotCanvas2DRenderer({ canvas, config });
}
