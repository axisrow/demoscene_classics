import { buildSinePalette, createPixelBuffer, getContext2D, presentPixelBuffer, resizePixelBuffer } from './utils.js';

export function createPlasmaRenderer({ canvas, quality }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = new Uint32Array(256);
  const scale = quality === 'preview' ? 3 : 4;
  let width = 1;
  let height = 1;

  function buildPalette(phase) {
    buildSinePalette(palette, (index) => Math.PI * 2 * index / 256 + phase);
  }

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resizePixelBuffer(buffer, width / scale, height / scale);
    },
    render({ time }) {
      const phase = time * 1.2;
      buildPalette(phase);
      const offsetX = buffer.width * 0.02;
      const offsetY = buffer.height * 0.02;
      let index = 0;
      for (let y = 0; y < buffer.height; y++) {
        for (let x = 0; x < buffer.width; x++) {
          const nx = x * 0.04;
          const ny = y * 0.04;
          let value = Math.sin(nx + phase);
          value += Math.sin((ny + phase) * 0.5);
          value += Math.sin((nx + ny + phase) * 0.5);
          const cx = nx - offsetX;
          const cy = ny - offsetY;
          value += Math.sin(Math.sqrt(cx * cx + cy * cy + 1) + phase);
          const colorIndex = ((value + 4) / 8 * 255) & 255;
          buffer.pixels[index++] = palette[colorIndex];
        }
      }
      presentPixelBuffer(context, buffer, width, height, false);
    }
  };
}
