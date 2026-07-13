import { buildSinePalette, createPixelBuffer, getContext2D, packRgb, presentPixelBuffer, resizePixelBuffer } from './utils.js';

const TARGET_X = -0.7436438870371587;
const TARGET_Y = 0.1318259042053119;
export const MANDELBROT_INTERIOR_COLOR = packRgb(0, 0, 0);

function buildPalette() {
  return buildSinePalette(new Uint32Array(1024), (index) => index / 1024 * Math.PI * 2);
}

export function mandelbrotZoom(time) {
  const phase = (time / 28) % 1;
  const wave = (Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1) / 2;
  const eased = wave * wave * (3 - 2 * wave);
  return 10 ** (eased * 6);
}

export function mandelbrotScale(zoom, quality) {
  if (quality === 'preview') return 3;
  if (zoom < 100) return 3;
  if (zoom < 10_000) return 5;
  return 10;
}

function isMainInterior(real, imaginary) {
  const shifted = real - 0.25;
  const q = shifted * shifted + imaginary * imaginary;
  return q * (q + shifted) <= 0.25 * imaginary * imaginary
    || (real + 1) * (real + 1) + imaginary * imaginary <= 0.0625;
}

export function createMandelbrotRenderer({ canvas, quality }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildPalette();
  let width = 1;
  let height = 1;
  let scale = 0;

  function ensureBuffer(nextScale) {
    if (scale === nextScale && buffer.image) return;
    scale = nextScale;
    resizePixelBuffer(buffer, width / scale, height / scale);
  }

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      scale = 0;
    },
    render({ time }) {
      const zoom = mandelbrotZoom(time);
      ensureBuffer(mandelbrotScale(zoom, quality));
      const span = 3 / zoom;
      const aspect = buffer.width / buffer.height;
      const calculatedIterations = Math.floor(80 + 60 * Math.log10(zoom + 1));
      const maxIterations = quality === 'preview'
        ? Math.min(64, calculatedIterations)
        : calculatedIterations;
      const log2 = Math.log(2);
      let index = 0;

      for (let y = 0; y < buffer.height; y++) {
        const imaginary = TARGET_Y + (y / buffer.height - 0.5) * 2 * span / aspect;
        for (let x = 0; x < buffer.width; x++) {
          const real = TARGET_X + (x / buffer.width - 0.5) * 2 * span;
          if (isMainInterior(real, imaginary)) {
            buffer.pixels[index++] = MANDELBROT_INTERIOR_COLOR;
            continue;
          }

          let zReal = 0;
          let zImaginary = 0;
          let zRealSquared = 0;
          let zImaginarySquared = 0;
          let iteration = 0;
          while (zRealSquared + zImaginarySquared < 256 && iteration < maxIterations) {
            zImaginary = 2 * zReal * zImaginary + imaginary;
            zReal = zRealSquared - zImaginarySquared + real;
            zRealSquared = zReal * zReal;
            zImaginarySquared = zImaginary * zImaginary;
            iteration++;
          }

          if (iteration === maxIterations) {
            buffer.pixels[index++] = MANDELBROT_INTERIOR_COLOR;
            continue;
          }

          const logZn = Math.log(zRealSquared + zImaginarySquared) / 2;
          const nu = Math.log(logZn / log2) / log2;
          const smooth = iteration + 1 - nu;
          buffer.pixels[index++] = palette[(smooth * 8) & 1023];
        }
      }
      presentPixelBuffer(context, buffer, width, height, false);
    }
  };
}
