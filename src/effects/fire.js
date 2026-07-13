import { createPixelBuffer, getContext2D, packRgb, presentPixelBuffer, resizePixelBuffer } from './utils.js';

const STEP_SECONDS = 1 / 60;

export function createFireRenderer({ canvas, quality }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = new Uint32Array(256);
  const scale = quality === 'preview' ? 3 : 4;
  let heat = new Uint8Array(0);
  let accumulator = 0;
  let width = 1;
  let height = 1;

  for (let i = 0; i < 256; i++) {
    let red;
    let green;
    let blue;
    if (i < 64) {
      red = i * 4; green = 0; blue = 0;
    } else if (i < 128) {
      red = 255; green = (i - 64) * 4; blue = 0;
    } else if (i < 192) {
      red = 255; green = 255; blue = (i - 128) * 4;
    } else {
      red = 255; green = 255; blue = 255;
    }
    palette[i] = packRgb(red, green, blue);
  }

  function spread() {
    const lastRow = buffer.height - 1;
    for (let x = 0; x < buffer.width; x++) {
      heat[lastRow * buffer.width + x] = Math.random() < 0.65
        ? 255
        : Math.floor(Math.random() * 96);
    }

    for (let y = 1; y < buffer.height; y++) {
      const row = y * buffer.width;
      const previousRow = (y - 1) * buffer.width;
      for (let x = 0; x < buffer.width; x++) {
        const random = (Math.random() * 3) | 0;
        const drift = x + (random & 1) - 1 + ((random >> 1) & 1);
        const targetX = (drift + buffer.width) % buffer.width;
        heat[previousRow + targetX] = Math.max(0, heat[row + x] - random);
      }
    }
  }

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resizePixelBuffer(buffer, width / scale, height / scale);
      heat = new Uint8Array(buffer.width * buffer.height);
      accumulator = 0;
    },
    render({ delta }) {
      accumulator += delta;
      let steps = 0;
      while (accumulator >= STEP_SECONDS && steps < 3) {
        spread();
        accumulator -= STEP_SECONDS;
        steps++;
      }
      for (let i = 0; i < heat.length; i++) buffer.pixels[i] = palette[heat[i]];
      presentPixelBuffer(context, buffer, width, height, false);
    }
  };
}
