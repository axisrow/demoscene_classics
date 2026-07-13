import { createPixelBuffer, getContext2D, packRgb, presentPixelBuffer, resizePixelBuffer } from './utils.js';

const TEXTURE_SIZE = 256;

function buildTexture() {
  const texture = new Uint32Array(TEXTURE_SIZE * TEXTURE_SIZE);
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const checker = (((x >> 5) + (y >> 5)) & 1) === 0;
      const centerX = x - TEXTURE_SIZE / 2;
      const centerY = y - TEXTURE_SIZE / 2;
      const radius = Math.sqrt(centerX * centerX + centerY * centerY);
      const rings = Math.sin(radius * 0.12) * 0.5 + 0.5;
      const spokes = Math.sin(Math.atan2(centerY, centerX) * 8) * 0.5 + 0.5;
      let red = checker ? 20 + rings * 60 : 200 * spokes + 40;
      let green = checker ? 30 + rings * 90 : 120 * spokes + 20;
      let blue = checker ? 40 + rings * 120 : 30 * spokes + 10;
      if (radius < 26) {
        red = 0; green = 240; blue = 200;
      } else if (radius < 30) {
        red = 0; green = 0; blue = 0;
      }
      texture[y * TEXTURE_SIZE + x] = packRgb(red, green, blue);
    }
  }
  return texture;
}

export function createRotozoomRenderer({ canvas, quality }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const texture = buildTexture();
  const scale = quality === 'preview' ? 3 : 2;
  let width = 1;
  let height = 1;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resizePixelBuffer(buffer, width / scale, height / scale);
    },
    render({ time }) {
      const angle = time * 0.8;
      const zoom = 1.2 + Math.sin(time * 0.5) * 0.7;
      const inverseZoom = 1 / zoom;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const centerX = buffer.width / 2;
      const centerY = buffer.height / 2;
      let index = 0;

      for (let y = 0; y < buffer.height; y++) {
        const dy = y - centerY;
        for (let x = 0; x < buffer.width; x++) {
          const dx = x - centerX;
          const rotatedX = (cosine * dx + sine * dy) * inverseZoom;
          const rotatedY = (-sine * dx + cosine * dy) * inverseZoom;
          const textureX = ((rotatedX + TEXTURE_SIZE / 2) | 0) & 255;
          const textureY = ((rotatedY + TEXTURE_SIZE / 2) | 0) & 255;
          buffer.pixels[index++] = texture[(textureY << 8) + textureX];
        }
      }
      presentPixelBuffer(context, buffer, width, height, true);
    }
  };
}
