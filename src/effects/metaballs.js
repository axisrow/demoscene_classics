import { createPixelBuffer, getContext2D, packRgb, presentPixelBuffer, resizePixelBuffer } from './utils.js';

const BALLS = Array.from({ length: 5 }, (_, index) => ({
  amplitudeX: 0.6 + index * 0.13,
  amplitudeY: 0.8 + index * 0.11,
  frequencyX: 0.8 + index * 0.27,
  frequencyY: 1.1 + index * 0.21,
  phaseX: 0.7 + index * 1.7,
  phaseY: 1.3 + index * 1.3,
  strength: 240 + index * 60
}));

function buildPalette() {
  const palette = new Uint32Array(512);
  const stops = [
    [0, [5, 0, 20]],
    [0.25, [10, 40, 120]],
    [0.45, [0, 170, 200]],
    [0.65, [60, 230, 120]],
    [0.85, [240, 230, 40]],
    [1, [255, 255, 255]]
  ];

  let segment = 0;
  for (let i = 0; i < palette.length; i++) {
    const position = i / (palette.length - 1);
    while (segment < stops.length - 2 && position > stops[segment + 1][0]) segment++;
    const left = stops[segment];
    const right = stops[segment + 1];
    const mix = (position - left[0]) / (right[0] - left[0] || 1);
    palette[i] = packRgb(
      Math.round(left[1][0] + (right[1][0] - left[1][0]) * mix),
      Math.round(left[1][1] + (right[1][1] - left[1][1]) * mix),
      Math.round(left[1][2] + (right[1][2] - left[1][2]) * mix)
    );
  }
  return palette;
}

export function createMetaballsRenderer({ canvas, quality }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildPalette();
  const scale = 3;
  const balls = BALLS.slice(0, quality === 'preview' ? 3 : BALLS.length);
  const ballX = new Float32Array(balls.length);
  const ballY = new Float32Array(balls.length);
  let width = 1;
  let height = 1;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resizePixelBuffer(buffer, width / scale, height / scale);
    },
    render({ time }) {
      const phase = time * 0.72;
      for (let i = 0; i < balls.length; i++) {
        const ball = balls[i];
        ballX[i] = (Math.sin(phase * ball.frequencyX + ball.phaseX) * ball.amplitudeX + 1) * 0.5 * buffer.width;
        ballY[i] = (Math.sin(phase * ball.frequencyY + ball.phaseY) * ball.amplitudeY + 1) * 0.5 * buffer.height;
      }

      let index = 0;
      for (let y = 0; y < buffer.height; y++) {
        for (let x = 0; x < buffer.width; x++) {
          let field = 0;
          for (let i = 0; i < balls.length; i++) {
            const dx = x - ballX[i];
            const dy = y - ballY[i];
            field += balls[i].strength / (dx * dx + dy * dy + 1);
          }
          let value = field < 1 ? field * 60 : 60 + (field - 1) * 420;
          value = Math.min(511, value);
          buffer.pixels[index++] = palette[value | 0];
        }
      }
      presentPixelBuffer(context, buffer, width, height, false);
    }
  };
}
