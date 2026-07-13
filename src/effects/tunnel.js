import { createPixelBuffer, getContext2D, packRgb, presentPixelBuffer, resizePixelBuffer } from './utils.js';

function buildPalette() {
  const palette = new Uint32Array(256);
  for (let i = 0; i < palette.length; i++) {
    palette[i] = packRgb(
      Math.floor(128 + 127 * Math.sin(0.06 * i)),
      Math.floor(128 + 127 * Math.sin(0.06 * i + 2)),
      Math.floor(128 + 127 * Math.sin(0.06 * i + 4))
    );
  }
  return palette;
}

export function createTunnelRenderer({ canvas }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildPalette();
  let width = 1;
  let height = 1;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resizePixelBuffer(buffer, width / 3, height / 3);
    },
    render({ time }) {
      const centerX = buffer.width / 2;
      const centerY = buffer.height / 2;
      const shift = time * 84;
      const angle = time * 1.26;
      let index = 0;

      for (let y = 0; y < buffer.height; y++) {
        for (let x = 0; x < buffer.width; x++) {
          const dx = x - centerX;
          const dy = y - centerY;
          const distance = Math.max(0.0001, Math.sqrt(dx * dx + dy * dy));
          const polarAngle = Math.atan2(dy, dx) / Math.PI;
          const textureU = 60 / distance + shift;
          const textureV = polarAngle * 6 + angle;
          const texture = Math.sin(textureU) * Math.cos(textureV);
          const fog = Math.min(1, distance / (Math.min(buffer.width, buffer.height) * 0.5));
          const colorIndex = ((texture + 1) * 100 + time * 63) & 255;
          const fade = 0.15 + fog * 0.85;
          const color = palette[colorIndex];
          buffer.pixels[index++] = packRgb(
            (color & 255) * fade,
            ((color >> 8) & 255) * fade,
            ((color >> 16) & 255) * fade
          );
        }
      }
      presentPixelBuffer(context, buffer, width, height, false);
    }
  };
}
