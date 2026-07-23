import {
  buildGradientPalette,
  createDrawingBuffer,
  createSeededRandom,
  getContext2D,
  presentDrawingBuffer,
  resizeDrawingBuffer,
  samplePackedPalette
} from '../utils.js';

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
