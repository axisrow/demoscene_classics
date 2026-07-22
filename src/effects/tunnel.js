import {
  assertNumber,
  createEffectDefaults,
  normalizeEffectConfig
} from '../config.js';
import {
  buildGradientPalette,
  createPixelBuffer,
  getContext2D,
  packRgb,
  presentPixelBuffer,
  resizePixelBuffer
} from './utils.js';

export const TUNNEL_DEFAULTS = createEffectDefaults({
  render: { resolution: 1 / 3, smoothing: false },
  motion: { speed: 1, forwardSpeed: 84, rotationSpeed: 1.26, colorCycleSpeed: 63 },
  appearance: {
    palette: ['#ff80ee', '#60dfff', '#ffe86b', '#ff80ee'],
    colorCount: 256,
    backgroundColor: '#000000'
  },
  geometry: {
    centerX: 0.5,
    centerY: 0.5,
    radialFrequency: 60,
    angularFrequency: 6,
    fogDistance: 0.5,
    fogMinimum: 0.15
  }
});

export function normalizeTunnelConfig(input) {
  return normalizeEffectConfig('tunnel', input, TUNNEL_DEFAULTS, (config) => {
    for (const key of ['forwardSpeed', 'rotationSpeed', 'colorCycleSpeed']) {
      assertNumber(config.motion[key], `tunnel.motion.${key}`);
    }
    for (const key of ['centerX', 'centerY']) {
      assertNumber(config.geometry[key], `tunnel.geometry.${key}`);
    }
    for (const key of ['radialFrequency', 'angularFrequency', 'fogDistance']) {
      assertNumber(config.geometry[key], `tunnel.geometry.${key}`, { min: Number.MIN_VALUE });
    }
    assertNumber(config.geometry.fogMinimum, 'tunnel.geometry.fogMinimum', { min: 0, max: 1 });
  });
}

export function createTunnelRenderer({ canvas, config }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  let width = 1;
  let height = 1;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resizePixelBuffer(buffer, width * config.render.resolution, height * config.render.resolution);
    },
    render({ time }) {
      const centerX = buffer.width * config.geometry.centerX;
      const centerY = buffer.height * config.geometry.centerY;
      const shift = time * config.motion.speed * config.motion.forwardSpeed;
      const angle = time * config.motion.speed * config.motion.rotationSpeed;
      let index = 0;
      for (let y = 0; y < buffer.height; y++) {
        for (let x = 0; x < buffer.width; x++) {
          const dx = x - centerX;
          const dy = y - centerY;
          const distance = Math.max(0.0001, Math.sqrt(dx * dx + dy * dy));
          const polarAngle = Math.atan2(dy, dx) / Math.PI;
          const textureU = config.geometry.radialFrequency / distance + shift;
          const textureV = polarAngle * config.geometry.angularFrequency + angle;
          const texture = Math.sin(textureU) * Math.cos(textureV);
          const fog = Math.min(
            1,
            distance / (Math.min(buffer.width, buffer.height) * config.geometry.fogDistance)
          );
          const colorPosition = (
            (texture + 1) * 0.5
              + time * config.motion.speed * config.motion.colorCycleSpeed / palette.length
          ) % 1;
          const color = palette[Math.floor((colorPosition + 1) % 1 * palette.length)];
          const fade = config.geometry.fogMinimum + fog * (1 - config.geometry.fogMinimum);
          buffer.pixels[index++] = packRgb(
            (color & 255) * fade,
            (color >>> 8 & 255) * fade,
            (color >>> 16 & 255) * fade
          );
        }
      }
      presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
    }
  };
}
