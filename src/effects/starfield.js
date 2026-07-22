import {
  assertNumber,
  createEffectDefaults,
  normalizeEffectConfig
} from '../config.js';
import {
  buildGradientPalette,
  createDrawingBuffer,
  createSeededRandom,
  getContext2D,
  presentDrawingBuffer,
  resizeDrawingBuffer,
  samplePackedPalette
} from './utils.js';

export const STARFIELD_DEFAULTS = createEffectDefaults({
  render: { resolution: 1, smoothing: true },
  motion: { speed: 1 },
  appearance: {
    palette: ['#b4c8ff', '#ffffff'],
    colorCount: 256,
    backgroundColor: '#000000'
  },
  particles: {
    seed: 1993,
    particleCount: 600,
    fov: 256,
    depth: 256,
    travelSpeed: 192,
    centerX: 0.5,
    centerY: 0.5,
    trailFade: 0.35,
    minAlpha: 0.25,
    maxAlpha: 0.95,
    minLineWidth: 1,
    maxLineWidth: 3
  }
});

export function normalizeStarfieldConfig(input) {
  return normalizeEffectConfig('starfield', input, STARFIELD_DEFAULTS, (config) => {
    assertNumber(config.particles.seed, 'starfield.particles.seed', { min: 0, max: 0xffffffff, integer: true });
    assertNumber(config.particles.particleCount, 'starfield.particles.particleCount', { min: 1, max: 10000, integer: true });
    for (const key of ['fov', 'depth', 'travelSpeed']) {
      assertNumber(config.particles[key], `starfield.particles.${key}`, { min: Number.MIN_VALUE });
    }
    for (const key of ['centerX', 'centerY', 'trailFade', 'minAlpha', 'maxAlpha']) {
      assertNumber(config.particles[key], `starfield.particles.${key}`, { min: 0, max: 1 });
    }
    assertNumber(config.particles.minLineWidth, 'starfield.particles.minLineWidth', { min: Number.MIN_VALUE });
    assertNumber(config.particles.maxLineWidth, 'starfield.particles.maxLineWidth', { min: config.particles.minLineWidth });
    if (config.particles.maxAlpha < config.particles.minAlpha) {
      throw new RangeError('starfield.particles.maxAlpha must be at least minAlpha.');
    }
  });
}

export function createStarfieldRenderer({ canvas, config }) {
  const output = getContext2D(canvas, { alpha: false });
  const buffer = createDrawingBuffer();
  const context = buffer.context;
  let random = createSeededRandom(config.particles.seed);
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  const stars = Array.from({ length: config.particles.particleCount }, () => ({}));
  let width = 1;
  let height = 1;

  function spawn(star, far = false) {
    star.x = (random() * 2 - 1) * width;
    star.y = (random() * 2 - 1) * height;
    star.z = far ? config.particles.depth : random() * (config.particles.depth - 1) + 1;
    star.previousX = null;
    star.previousY = null;
  }

  function resetStars() {
    stars.forEach((star) => spawn(star));
  }

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth * config.render.resolution;
      height = nextHeight * config.render.resolution;
      resizeDrawingBuffer(buffer, width, height);
      random = createSeededRandom(config.particles.seed);
      resetStars();
    },
    render({ delta }) {
      context.fillStyle = config.appearance.backgroundColor;
      context.globalAlpha = config.particles.trailFade;
      context.fillRect(0, 0, width, height);
      context.globalAlpha = 1;
      const centerX = width * config.particles.centerX;
      const centerY = height * config.particles.centerY;

      for (const star of stars) {
        star.z -= config.particles.travelSpeed * config.motion.speed * delta;
        if (star.z <= 1) {
          spawn(star, true);
          continue;
        }
        const x = star.x / star.z * config.particles.fov + centerX;
        const y = star.y / star.z * config.particles.fov + centerY;
        if (star.previousX !== null) {
          const depth = 1 - star.z / config.particles.depth;
          const intensity = depth * depth;
          const color = samplePackedPalette(palette, intensity);
          const red = color & 255;
          const green = color >>> 8 & 255;
          const blue = color >>> 16 & 255;
          const alpha = config.particles.minAlpha
            + intensity * (config.particles.maxAlpha - config.particles.minAlpha);
          context.strokeStyle = `rgba(${red},${green},${blue},${alpha})`;
          context.lineWidth = config.particles.minLineWidth
            + intensity * (config.particles.maxLineWidth - config.particles.minLineWidth);
          context.beginPath();
          context.moveTo(star.previousX, star.previousY);
          context.lineTo(x, y);
          context.stroke();
        }
        star.previousX = x;
        star.previousY = y;
      }
      presentDrawingBuffer(output, buffer, canvas.width, canvas.height, config.render.smoothing);
    }
  };
}
