import {
  buildGradientPalette,
  createDrawingBuffer,
  createSeededRandom,
  getContext2D,
  presentDrawingBuffer,
  resizeDrawingBuffer,
  samplePackedPalette
} from '../utils.js';

const DEFAULT_TEXT = '  GREETZ TO ALL DEMOSCENERS  ***  PLASMA  FIRE  METABALLS  TUNNEL  FRACTALS  ROTOZOOM  FEEDBACK  COPPER BARS  ***  JS DEMO PACK 2026  ***  KEEP IT REAL  ***  ';

export { DEFAULT_TEXT };

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
