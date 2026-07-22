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

const POINT_KEYS = new Set([
  'amplitudeX', 'amplitudeY', 'frequencyX', 'frequencyY',
  'phaseX', 'phaseY', 'strength'
]);

export const METABALLS_DEFAULTS = createEffectDefaults({
  render: { resolution: 1 / 3, smoothing: false },
  motion: { speed: 1 },
  appearance: {
    palette: ['#050014', '#0a2878', '#00aac8', '#3ce678', '#f0e628', '#ffffff'],
    colorCount: 512,
    backgroundColor: '#050014'
  },
  field: {
    pointCount: 5,
    points: null,
    fieldStrength: 1,
    threshold: 1,
    lowScale: 60,
    highScale: 420
  }
});

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

export function normalizeMetaballsConfig(input) {
  if (input?.field?.points !== undefined && input?.field?.pointCount !== undefined) {
    throw new RangeError('metaballs.field.pointCount and metaballs.field.points cannot be used together.');
  }
  const config = normalizeEffectConfig('metaballs', input, METABALLS_DEFAULTS, (next) => {
    assertNumber(next.field.pointCount, 'metaballs.field.pointCount', { min: 1, max: 64, integer: true });
    for (const key of ['fieldStrength', 'threshold', 'lowScale', 'highScale']) {
      assertNumber(next.field[key], `metaballs.field.${key}`, { min: Number.MIN_VALUE });
    }
    if (next.field.points !== null) {
      if (!Array.isArray(next.field.points) || next.field.points.length < 1 || next.field.points.length > 64) {
        throw new RangeError('metaballs.field.points must contain between 1 and 64 points.');
      }
      next.field.points.forEach((point, index) => {
        if (point === null || typeof point !== 'object' || Array.isArray(point)) {
          throw new TypeError(`metaballs.field.points[${index}] must be an object.`);
        }
        for (const key of Object.keys(point)) {
          if (!POINT_KEYS.has(key)) throw new RangeError(`Unknown option: metaballs.field.points[${index}].${key}`);
        }
        for (const key of POINT_KEYS) {
          assertNumber(point[key], `metaballs.field.points[${index}].${key}`, {
            min: key === 'strength' ? Number.MIN_VALUE : -Infinity
          });
        }
      });
      next.field.pointCount = next.field.points.length;
    }
  });
  return config;
}

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
