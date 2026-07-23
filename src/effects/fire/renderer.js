import {
  buildGradientPalette,
  createPixelBuffer,
  createSeededRandom,
  getContext2D,
  presentPixelBuffer,
  resizePixelBuffer
} from '../utils.js';

export function createFireRenderer({ canvas, config }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  let random = createSeededRandom(config.simulation.seed);
  let heat = new Uint8Array(0);
  let accumulator = 0;
  let width = 1;
  let height = 1;

  function spread() {
    const lastRow = buffer.height - 1;
    for (let x = 0; x < buffer.width; x++) {
      heat[lastRow * buffer.width + x] = random() < config.simulation.sourceDensity
        ? config.simulation.sourceIntensity
        : Math.floor(random() * config.simulation.sourceVariance);
    }
    for (let y = 1; y < buffer.height; y++) {
      const row = y * buffer.width;
      const previousRow = (y - 1) * buffer.width;
      for (let x = 0; x < buffer.width; x++) {
        const cooling = Math.floor(random() * (config.simulation.cooling + 1));
        const drift = Math.floor((random() * 2 - 1) * (config.simulation.horizontalDrift + 1));
        const targetX = (x + drift + buffer.width) % buffer.width;
        heat[previousRow + targetX] = Math.max(0, heat[row + x] - cooling);
      }
    }
  }

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resizePixelBuffer(buffer, width * config.render.resolution, height * config.render.resolution);
      random = createSeededRandom(config.simulation.seed);
      heat = new Uint8Array(buffer.width * buffer.height);
      accumulator = 0;
    },
    render({ delta }) {
      accumulator += delta * config.motion.speed;
      const stepSeconds = 1 / config.simulation.stepHz;
      let steps = 0;
      while (accumulator >= stepSeconds && steps < config.simulation.maxCatchUpSteps) {
        spread();
        accumulator -= stepSeconds;
        steps++;
      }
      for (let i = 0; i < heat.length; i++) {
        const paletteIndex = Math.round(heat[i] / 255 * (palette.length - 1));
        buffer.pixels[i] = palette[paletteIndex];
      }
      presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
    }
  };
}
