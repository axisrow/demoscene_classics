import {
  assertNumber,
  createEffectDefaults,
  normalizeEffectConfig
} from '../config.js';
import {
  buildGradientPalette,
  createPixelBuffer,
  getContext2D,
  packHexColor,
  packRgb,
  presentPixelBuffer,
  resizePixelBuffer,
  samplePackedPalette
} from './utils.js';

const DEFAULT_BARS = [
  { yBase: 0.22, amplitude: 0.12, frequency: 0.7, phase: 0, height: 0.048, colorOffset: 0 },
  { yBase: 0.40, amplitude: 0.10, frequency: 0.9, phase: 1, height: 0.063, colorOffset: 0.2 },
  { yBase: 0.55, amplitude: 0.13, frequency: 0.6, phase: 2, height: 0.041, colorOffset: 0.4 },
  { yBase: 0.70, amplitude: 0.11, frequency: 1.0, phase: 3, height: 0.074, colorOffset: 0.65 },
  { yBase: 0.85, amplitude: 0.09, frequency: 0.8, phase: 4, height: 0.052, colorOffset: 0.85 }
];

export const COPPER_BARS_DEFAULTS = createEffectDefaults({
  render: { resolution: 0.5, smoothing: true },
  motion: { speed: 1, colorCycleSpeed: 0.06 },
  appearance: {
    palette: ['#ff244c', '#ffe844', '#28e880', '#35a8ff', '#dc4dff', '#ff244c'],
    colorCount: 360,
    backgroundColor: '#060812'
  },
  bars: DEFAULT_BARS,
  shading: {
    glossyFalloff: 0.7,
    highlightStrength: 90,
    highlightWidth: 1.5
  }
});

export function copperHue(baseHue, normalizedRow, time) {
  return (baseHue + normalizedRow * 80 + time * 40 + 360) % 360;
}

export function normalizeCopperBarsConfig(input) {
  return normalizeEffectConfig('copperBars', input, COPPER_BARS_DEFAULTS, (config) => {
    if (!Array.isArray(config.bars) || config.bars.length < 1 || config.bars.length > 64) {
      throw new RangeError('copperBars.bars must contain between 1 and 64 bars.');
    }
    config.bars.forEach((bar, index) => {
      for (const key of ['yBase', 'amplitude', 'frequency', 'phase', 'height', 'colorOffset']) {
        assertNumber(bar[key], `copperBars.bars[${index}].${key}`, {
          min: ['amplitude', 'frequency', 'height'].includes(key) ? 0 : -Infinity
        });
      }
    });
    assertNumber(config.motion.colorCycleSpeed, 'copperBars.motion.colorCycleSpeed');
    assertNumber(config.shading.glossyFalloff, 'copperBars.shading.glossyFalloff', { min: Number.MIN_VALUE });
    assertNumber(config.shading.highlightStrength, 'copperBars.shading.highlightStrength', { min: 0 });
    assertNumber(config.shading.highlightWidth, 'copperBars.shading.highlightWidth', { min: 0 });
  });
}

export function createCopperBarsRenderer({ canvas, config }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  const background = packHexColor(config.appearance.backgroundColor);
  let width = 1;
  let height = 1;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resizePixelBuffer(buffer, width * config.render.resolution, height * config.render.resolution);
    },
    render({ time }) {
      let index = 0;
      const scaledTime = time * config.motion.speed;
      for (let y = 0; y < buffer.height; y++) {
        let red = background & 255;
        let green = background >>> 8 & 255;
        let blue = background >>> 16 & 255;
        for (const bar of config.bars) {
          const center = (
            bar.yBase + bar.amplitude * Math.sin(scaledTime * bar.frequency + bar.phase)
          ) * buffer.height;
          const distance = y - center;
          const halfHeight = Math.max(2, bar.height * buffer.height);
          if (Math.abs(distance) > halfHeight) continue;
          const normalized = distance / halfHeight;
          const falloff = 1 - Math.abs(normalized);
          const glossy = falloff ** config.shading.glossyFalloff;
          const color = samplePackedPalette(
            palette,
            ((bar.colorOffset + normalized * 0.12 + scaledTime * config.motion.colorCycleSpeed) % 1 + 1) % 1
          );
          red += (color & 255) * glossy;
          green += (color >>> 8 & 255) * glossy;
          blue += (color >>> 16 & 255) * glossy;
          if (Math.abs(distance) < config.shading.highlightWidth) {
            red += config.shading.highlightStrength;
            green += config.shading.highlightStrength;
            blue += config.shading.highlightStrength;
          }
        }
        const pixel = packRgb(Math.min(255, red), Math.min(255, green), Math.min(255, blue));
        for (let x = 0; x < buffer.width; x++) buffer.pixels[index++] = pixel;
      }
      presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
    }
  };
}
