import { createPixelBuffer, getContext2D, hslToRgb, packRgb, presentPixelBuffer, resizePixelBuffer } from './utils.js';

const BARS = [
  { yBase: 0.22, amplitude: 0.12, frequency: 0.7, phase: 0, height: 0.048, hue: 0 },
  { yBase: 0.40, amplitude: 0.10, frequency: 0.9, phase: 1, height: 0.063, hue: 60 },
  { yBase: 0.55, amplitude: 0.13, frequency: 0.6, phase: 2, height: 0.041, hue: 120 },
  { yBase: 0.70, amplitude: 0.11, frequency: 1.0, phase: 3, height: 0.074, hue: 200 },
  { yBase: 0.85, amplitude: 0.09, frequency: 0.8, phase: 4, height: 0.052, hue: 290 }
];

export function copperHue(baseHue, normalizedRow, time) {
  return (baseHue + normalizedRow * 80 + time * 40 + 360) % 360;
}

export function createCopperBarsRenderer({ canvas, quality }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
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
      let index = 0;

      for (let y = 0; y < buffer.height; y++) {
        let red = 6;
        let green = 8;
        let blue = 18;
        for (const bar of BARS) {
          const center = (bar.yBase + bar.amplitude * Math.sin(time * bar.frequency + bar.phase)) * buffer.height;
          const distance = y - center;
          const halfHeight = Math.max(2, bar.height * buffer.height);
          if (Math.abs(distance) > halfHeight) continue;
          const normalized = distance / halfHeight;
          const falloff = 1 - Math.abs(normalized);
          const glossy = falloff ** 0.7;
          const color = hslToRgb(copperHue(bar.hue, normalized, time), 100, 55);
          red += color[0] * glossy;
          green += color[1] * glossy;
          blue += color[2] * glossy;
          if (Math.abs(distance) < 1.5) {
            red += 90; green += 90; blue += 90;
          }
        }
        const pixel = packRgb(Math.min(255, red), Math.min(255, green), Math.min(255, blue));
        for (let x = 0; x < buffer.width; x++) buffer.pixels[index++] = pixel;
      }
      presentPixelBuffer(context, buffer, width, height, true);
    }
  };
}
