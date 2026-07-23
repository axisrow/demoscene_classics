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
} from '../utils.js';

export const MANDELBROT_INTERIOR_COLOR = packRgb(0, 0, 0);

export { mandelbrotZoom, renderMandelbrotPixels };

function createMandelbrotCanvas2DRenderer({ canvas, config }) {
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
