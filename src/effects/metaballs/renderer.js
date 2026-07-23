import {
  buildGradientPalette,
  createPixelBuffer,
  getContext2D,
  presentPixelBuffer,
  resizePixelBuffer
} from '../utils.js';

export function createMetaballsRenderer({ canvas, config }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  const points = config.field.points ?? Array.from(
    { length: config.field.pointCount },
    (_, index) => generatedPoint(index)
  );
  const pointX = new Float32Array(points.length);
  const pointY = new Float32Array(points.length);
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
      const phase = time * 0.72 * config.motion.speed;
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        pointX[i] = (Math.sin(phase * point.frequencyX + point.phaseX) * point.amplitudeX + 1) * 0.5 * buffer.width;
        pointY[i] = (Math.sin(phase * point.frequencyY + point.phaseY) * point.amplitudeY + 1) * 0.5 * buffer.height;
      }

      let index = 0;
      for (let y = 0; y < buffer.height; y++) {
        for (let x = 0; x < buffer.width; x++) {
          let value = 0;
          for (let i = 0; i < points.length; i++) {
            const dx = x - pointX[i];
            const dy = y - pointY[i];
            value += points[i].strength * config.field.fieldStrength / (dx * dx + dy * dy + 1);
          }
          value = value < config.field.threshold
            ? value * config.field.lowScale
            : config.field.lowScale + (value - config.field.threshold) * config.field.highScale;
          const paletteIndex = Math.min(
            palette.length - 1,
            Math.max(0, Math.floor(value / 512 * palette.length))
          );
          buffer.pixels[index++] = palette[paletteIndex];
        }
      }
      presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
    }
  };
}

function generatedPoint(index) {
  return {
    amplitudeX: 0.6 + index * 0.13,
    amplitudeY: 0.8 + index * 0.11,
    frequencyX: 0.8 + index * 0.27,
    frequencyY: 1.1 + index * 0.21,
    phaseX: 0.7 + index * 1.7,
    phaseY: 1.3 + index * 1.3,
    strength: 240 + index * 60
  };
}
