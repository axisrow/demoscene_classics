import {
  buildGradientPalette,
  createPixelBuffer,
  getContext2D,
  presentPixelBuffer,
  resizePixelBuffer
} from '../utils.js';

export function createPlasmaRenderer({ canvas, config }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  const { field, motion, render } = config;
  const totalAmplitude = field.amplitudes.reduce((sum, item) => sum + Math.abs(item), 0) || 1;
  let width = 1;
  let height = 1;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resizePixelBuffer(buffer, width * render.resolution, height * render.resolution);
    },
    render({ time }) {
      const scaledTime = time * motion.speed;
      const phase = scaledTime * 1.2;
      const paletteOffset = Math.floor(scaledTime * motion.paletteCycleSpeed * palette.length);
      const radialX = buffer.width * field.radialCenterX;
      const radialY = buffer.height * field.radialCenterY;
      let index = 0;
      for (let y = 0; y < buffer.height; y++) {
        for (let x = 0; x < buffer.width; x++) {
          let value = Math.sin(x * field.frequencies[0] + phase * field.phaseRates[0]) * field.amplitudes[0];
          value += Math.sin(y * field.frequencies[1] + phase * field.phaseRates[1]) * field.amplitudes[1];
          value += Math.sin((x + y) * field.frequencies[2] + phase * field.phaseRates[2]) * field.amplitudes[2];
          const cx = (x - radialX) * field.frequencies[0];
          const cy = (y - radialY) * field.frequencies[1];
          value += Math.sin(
            Math.sqrt(cx * cx + cy * cy + 1) * field.frequencies[3]
              + phase * field.phaseRates[3]
          ) * field.amplitudes[3];
          const fieldIndex = Math.min(
            palette.length - 1,
            Math.max(0, Math.floor((value + totalAmplitude) / (totalAmplitude * 2) * palette.length))
          );
          buffer.pixels[index++] = palette[(fieldIndex + paletteOffset) % palette.length];
        }
      }
      presentPixelBuffer(context, buffer, width, height, render.smoothing);
    }
  };
}
