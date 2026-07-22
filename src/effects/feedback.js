import {
  assertNumber,
  createEffectDefaults,
  normalizeEffectConfig
} from '../config.js';
import {
  buildGradientPalette,
  createDrawingBuffer,
  getContext2D,
  presentDrawingBuffer,
  resizeDrawingBuffer,
  samplePackedPalette
} from './utils.js';

export const FEEDBACK_DEFAULTS = createEffectDefaults({
  render: { resolution: 1, smoothing: true },
  motion: {
    speed: 1,
    orbitSpeedX: 0.6,
    orbitSpeedY: 0.7,
    polygonRotationSpeed: 1,
    passRotationStep: 0.3,
    colorCycleSpeed: 0.17
  },
  appearance: {
    palette: ['#ff58d6', '#5ca8ff', '#60ffd0', '#ffe66d', '#ff58d6'],
    colorCount: 360,
    backgroundColor: '#000005',
    strokeAlpha: 0.9
  },
  geometry: {
    sides: 5,
    passes: 3,
    radius: 40,
    radiusOscillation: 14,
    radiusOscillationSpeed: 3,
    passSpacing: 8,
    strokeWidth: 2,
    shadowBlur: 18,
    orbitX: 0.18,
    orbitY: 0.18
  },
  feedback: {
    alphaDecay: 0.93,
    scale: 0.985,
    rotation: 0.012,
    fade: 0.96
  }
});

export function normalizeFeedbackConfig(input) {
  return normalizeEffectConfig('feedback', input, FEEDBACK_DEFAULTS, (config) => {
    for (const key of ['orbitSpeedX', 'orbitSpeedY', 'polygonRotationSpeed', 'passRotationStep', 'colorCycleSpeed']) {
      assertNumber(config.motion[key], `feedback.motion.${key}`);
    }
    assertNumber(config.appearance.strokeAlpha, 'feedback.appearance.strokeAlpha', { min: 0, max: 1 });
    assertNumber(config.geometry.sides, 'feedback.geometry.sides', { min: 3, max: 64, integer: true });
    assertNumber(config.geometry.passes, 'feedback.geometry.passes', { min: 1, max: 32, integer: true });
    for (const key of ['radius', 'radiusOscillation', 'radiusOscillationSpeed', 'passSpacing', 'strokeWidth', 'shadowBlur']) {
      assertNumber(config.geometry[key], `feedback.geometry.${key}`, { min: 0 });
    }
    for (const key of ['orbitX', 'orbitY']) {
      assertNumber(config.geometry[key], `feedback.geometry.${key}`, { min: 0, max: 1 });
    }
    for (const key of ['alphaDecay', 'scale', 'fade']) {
      assertNumber(config.feedback[key], `feedback.feedback.${key}`, { min: 0, max: 1 });
    }
    assertNumber(config.feedback.rotation, 'feedback.feedback.rotation');
  });
}

export function createFeedbackRenderer({ canvas, config }) {
  const output = getContext2D(canvas);
  const buffer = createDrawingBuffer();
  const context = buffer.context;
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  let width = 1;
  let height = 1;
  let pointerX = null;
  let pointerY = null;
  let hasRendered = false;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth * config.render.resolution;
      height = nextHeight * config.render.resolution;
      resizeDrawingBuffer(buffer, width, height);
      hasRendered = false;
    },
    pointer(x, y) {
      pointerX = x === null ? null : x * config.render.resolution;
      pointerY = y === null ? null : y * config.render.resolution;
    },
    render({ time, delta }) {
      if (hasRendered && delta === 0) return;
      const frameFactor = delta * 60 * config.motion.speed;
      if (hasRendered) {
        context.globalCompositeOperation = 'lighter';
        context.globalAlpha = config.feedback.alphaDecay ** frameFactor;
        context.save();
        context.translate(width / 2, height / 2);
        context.rotate(config.feedback.rotation * frameFactor);
        context.scale(config.feedback.scale ** frameFactor, config.feedback.scale ** frameFactor);
        context.translate(-width / 2, -height / 2);
        context.drawImage(buffer.canvas, 0, 0);
        context.restore();
        context.globalCompositeOperation = 'source-over';
        context.globalAlpha = 1;
        context.fillStyle = config.appearance.backgroundColor;
        context.globalAlpha = 1 - config.feedback.fade ** frameFactor;
        context.fillRect(0, 0, width, height);
        context.globalAlpha = 1;
      } else {
        context.fillStyle = config.appearance.backgroundColor;
        context.fillRect(0, 0, width, height);
      }

      const scaledTime = time * config.motion.speed;
      const centerX = pointerX ?? width / 2 + Math.cos(scaledTime * config.motion.orbitSpeedX) * width * config.geometry.orbitX;
      const centerY = pointerY ?? height / 2 + Math.sin(scaledTime * config.motion.orbitSpeedY) * height * config.geometry.orbitY;
      const radius = config.geometry.radius
        + Math.sin(scaledTime * config.geometry.radiusOscillationSpeed) * config.geometry.radiusOscillation;
      context.globalCompositeOperation = 'lighter';
      for (let pass = 0; pass < config.geometry.passes; pass++) {
        context.beginPath();
        const passRadius = radius + pass * config.geometry.passSpacing;
        for (let point = 0; point <= config.geometry.sides; point++) {
          const angle = point / config.geometry.sides * Math.PI * 2
            + scaledTime * (config.motion.polygonRotationSpeed + pass * config.motion.passRotationStep);
          const x = centerX + Math.cos(angle) * passRadius;
          const y = centerY + Math.sin(angle) * passRadius;
          if (point === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        const color = samplePackedPalette(
          palette,
          (scaledTime * config.motion.colorCycleSpeed + pass / config.geometry.passes) % 1
        );
        const red = color & 255;
        const green = color >>> 8 & 255;
        const blue = color >>> 16 & 255;
        context.lineWidth = config.geometry.strokeWidth;
        context.strokeStyle = `rgba(${red},${green},${blue},${config.appearance.strokeAlpha})`;
        context.shadowColor = context.strokeStyle;
        context.shadowBlur = config.geometry.shadowBlur;
        context.stroke();
      }
      context.shadowBlur = 0;
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      hasRendered = true;
      presentDrawingBuffer(output, buffer, canvas.width, canvas.height, config.render.smoothing);
    }
  };
}
