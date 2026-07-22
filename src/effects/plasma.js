import {
  assertNumber,
  createEffectDefaults,
  normalizeEffectConfig
} from '../config.js';
import {
  buildGradientPalette,
  createPixelBuffer,
  getContext2D,
  presentPixelBuffer,
  resizePixelBuffer
} from './utils.js';

export const PLASMA_DEFAULTS = createEffectDefaults({
  render: { resolution: 0.25, smoothing: false },
  motion: { speed: 1, paletteCycleSpeed: 0.19 },
  appearance: {
    palette: [
      '#80ed12', '#bfbf01', '#ed8012', '#ff4040', '#ed127f', '#bf01bf', '#8012ed',
      '#4040ff', '#127fed', '#01bfbf', '#12ed80', '#40ff40', '#7fed12'
    ],
    colorCount: 256,
    backgroundColor: '#000000'
  },
  field: {
    frequencies: [0.04, 0.04, 0.04, 1],
    radialCenterX: 0.5,
    radialCenterY: 0.5,
    amplitudes: [1, 1, 1, 1],
    phaseRates: [1, 0.5, 0.5, 1]
  }
});

export function normalizePlasmaConfig(input) {
  return normalizeEffectConfig('plasma', input, PLASMA_DEFAULTS, (config) => {
    assertNumber(config.motion.paletteCycleSpeed, 'plasma.motion.paletteCycleSpeed', { min: 0 });
    for (const key of ['radialCenterX', 'radialCenterY']) {
      assertNumber(config.field[key], `plasma.field.${key}`);
    }
    for (const key of ['frequencies', 'amplitudes', 'phaseRates']) {
      if (!Array.isArray(config.field[key]) || config.field[key].length !== 4) {
        throw new RangeError(`plasma.field.${key} must contain four numbers.`);
      }
      config.field[key].forEach((value, index) => assertNumber(
        value,
        `plasma.field.${key}[${index}]`,
        key === 'frequencies' ? { min: Number.MIN_VALUE } : undefined
      ));
    }
  });
}

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
