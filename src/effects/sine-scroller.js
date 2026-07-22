import {
  assertNumber,
  assertString,
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

const DEFAULT_TEXT = '  GREETZ TO ALL DEMOSCENERS  ***  PLASMA  FIRE  METABALLS  TUNNEL  FRACTALS  ROTOZOOM  FEEDBACK  COPPER BARS  ***  JS DEMO PACK 2026  ***  KEEP IT REAL  ***  ';

export const SINE_SCROLLER_DEFAULTS = createEffectDefaults({
  render: { resolution: 1, smoothing: true },
  motion: { speed: 1, scrollSpeed: 132, phaseSpeed: 3, colorCycleSpeed: 0.33 },
  appearance: {
    palette: ['#78a0ff', '#70f0ff', '#f080ff', '#ffe66d', '#78a0ff'],
    colorCount: 360,
    backgroundColor: '#04040a',
    shadowColor: '#000000',
    shadowAlpha: 0.6,
    starColor: '#78a0ff'
  },
  text: {
    content: DEFAULT_TEXT,
    fontFamily: 'Courier New, monospace',
    fontWeight: 900,
    fontSizeRatio: 0.13,
    maxFontSize: 72,
    characterWidthRatio: 0.62,
    shadowOffsetX: 4,
    shadowOffsetY: 4
  },
  wave: { baseline: 0.62, amplitude: 0.12, frequency: 0.018 },
  stars: {
    seed: 1993,
    count: 220,
    speed: 36,
    minDepth: 0.2,
    maxDepth: 2.2,
    minSize: 0.3,
    maxSize: 1.9,
    minAlpha: 0.3,
    maxAlpha: 1
  }
});

export function normalizeSineScrollerConfig(input) {
  return normalizeEffectConfig('sineScroller', input, SINE_SCROLLER_DEFAULTS, (config) => {
    for (const key of ['content', 'fontFamily']) assertString(config.text[key], `sineScroller.text.${key}`);
    assertNumber(config.text.fontWeight, 'sineScroller.text.fontWeight', { min: 100, max: 1000, integer: true });
    for (const key of ['fontSizeRatio', 'maxFontSize', 'characterWidthRatio']) {
      assertNumber(config.text[key], `sineScroller.text.${key}`, { min: Number.MIN_VALUE });
    }
    for (const key of ['shadowOffsetX', 'shadowOffsetY']) assertNumber(config.text[key], `sineScroller.text.${key}`);
    assertNumber(config.wave.baseline, 'sineScroller.wave.baseline', { min: 0, max: 1 });
    assertNumber(config.wave.amplitude, 'sineScroller.wave.amplitude', { min: 0, max: 1 });
    assertNumber(config.wave.frequency, 'sineScroller.wave.frequency', { min: Number.MIN_VALUE });
    for (const key of ['scrollSpeed', 'phaseSpeed', 'colorCycleSpeed']) {
      assertNumber(config.motion[key], `sineScroller.motion.${key}`);
    }
    assertNumber(config.appearance.shadowAlpha, 'sineScroller.appearance.shadowAlpha', { min: 0, max: 1 });
    assertString(config.appearance.shadowColor, 'sineScroller.appearance.shadowColor');
    assertString(config.appearance.starColor, 'sineScroller.appearance.starColor');
    assertNumber(config.stars.seed, 'sineScroller.stars.seed', { min: 0, max: 0xffffffff, integer: true });
    assertNumber(config.stars.count, 'sineScroller.stars.count', { min: 0, max: 5000, integer: true });
    for (const key of ['speed', 'minDepth', 'maxDepth', 'minSize', 'maxSize', 'minAlpha', 'maxAlpha']) {
      assertNumber(config.stars[key], `sineScroller.stars.${key}`, { min: 0 });
    }
    for (const [minimum, maximum] of [['minDepth', 'maxDepth'], ['minSize', 'maxSize'], ['minAlpha', 'maxAlpha']]) {
      if (config.stars[maximum] < config.stars[minimum]) {
        throw new RangeError(`sineScroller.stars.${maximum} must be at least ${minimum}.`);
      }
    }
    if (config.stars.maxAlpha > 1) throw new RangeError('sineScroller.stars.maxAlpha must be at most 1.');
  });
}

export function createSineScrollerRenderer({ canvas, config }) {
  const output = getContext2D(canvas, { alpha: false });
  const buffer = createDrawingBuffer();
  const context = buffer.context;
  let random = createSeededRandom(config.stars.seed);
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  const stars = Array.from({ length: config.stars.count }, () => ({}));
  let width = 1;
  let height = 1;

  function resetStars() {
    for (const star of stars) {
      star.x = random() * width;
      star.y = random() * height;
      star.z = config.stars.minDepth + random() * (config.stars.maxDepth - config.stars.minDepth);
      star.size = config.stars.minSize + random() * (config.stars.maxSize - config.stars.minSize);
    }
  }

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth * config.render.resolution;
      height = nextHeight * config.render.resolution;
      resizeDrawingBuffer(buffer, width, height);
      random = createSeededRandom(config.stars.seed);
      resetStars();
    },
    render({ time, delta }) {
      context.fillStyle = config.appearance.backgroundColor;
      context.fillRect(0, 0, width, height);
      for (const star of stars) {
        star.x -= star.z * config.stars.speed * config.motion.speed * delta;
        if (star.x < 0) {
          star.x = width;
          star.y = random() * height;
        }
        const depthRange = Math.max(Number.EPSILON, config.stars.maxDepth - config.stars.minDepth);
        const normalized = (star.z - config.stars.minDepth) / depthRange;
        const alpha = config.stars.minAlpha + normalized * (config.stars.maxAlpha - config.stars.minAlpha);
        context.globalAlpha = alpha;
        context.fillStyle = config.appearance.starColor;
        context.fillRect(star.x, star.y, star.size, star.size);
      }
      context.globalAlpha = 1;

      const fontSize = Math.min(config.text.maxFontSize, height * config.text.fontSizeRatio);
      context.font = `${config.text.fontWeight} ${fontSize}px ${config.text.fontFamily}`;
      context.textBaseline = 'middle';
      context.textAlign = 'left';
      const baseline = height * config.wave.baseline;
      const amplitude = height * config.wave.amplitude;
      const characterWidth = fontSize * config.text.characterWidthRatio;
      const totalWidth = config.text.content.length * characterWidth;
      const scaledTime = time * config.motion.speed;
      const offset = scaledTime * config.motion.scrollSpeed % totalWidth;
      const passes = Math.ceil((width + offset) / totalWidth) + 1;
      const phase = scaledTime * config.motion.phaseSpeed;

      for (let pass = 0; pass < passes; pass++) {
        const startX = -offset + pass * totalWidth;
        for (let index = 0; index < config.text.content.length; index++) {
          const x = startX + index * characterWidth + characterWidth / 2;
          if (x < -characterWidth || x > width + characterWidth) continue;
          const y = baseline + Math.sin(x * config.wave.frequency + phase) * amplitude;
          context.globalAlpha = config.appearance.shadowAlpha;
          context.fillStyle = config.appearance.shadowColor;
          context.fillText(
            config.text.content[index],
            x - fontSize * 0.5 + config.text.shadowOffsetX,
            y + config.text.shadowOffsetY
          );
          const color = samplePackedPalette(
            palette,
            ((index / config.text.content.length) + scaledTime * config.motion.colorCycleSpeed) % 1
          );
          context.globalAlpha = 1;
          context.fillStyle = `rgb(${color & 255},${color >>> 8 & 255},${color >>> 16 & 255})`;
          context.fillText(config.text.content[index], x - fontSize * 0.5, y);
        }
      }
      presentDrawingBuffer(output, buffer, canvas.width, canvas.height, config.render.smoothing);
    }
  };
}
