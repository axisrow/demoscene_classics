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
  resizePixelBuffer,
  samplePackedPalette
} from './utils.js';

export const ROTOZOOM_DEFAULTS = createEffectDefaults({
  render: { resolution: 0.5, smoothing: true },
  motion: {
    speed: 1,
    rotationSpeed: 0.8,
    zoomBase: 1.2,
    zoomAmplitude: 0.7,
    zoomSpeed: 0.5
  },
  appearance: {
    palette: ['#141e28', '#284d68', '#d47832', '#f0b050', '#00f0c8', '#000000'],
    colorCount: 256,
    backgroundColor: '#000000'
  },
  texture: {
    size: 256,
    checkerSize: 32,
    ringFrequency: 0.12,
    spokeCount: 8,
    centerRadius: 26,
    borderRadius: 30
  }
});

export function normalizeRotozoomConfig(input) {
  return normalizeEffectConfig('rotozoom', input, ROTOZOOM_DEFAULTS, (config) => {
    for (const key of ['rotationSpeed', 'zoomAmplitude', 'zoomSpeed']) {
      assertNumber(config.motion[key], `rotozoom.motion.${key}`);
    }
    assertNumber(config.motion.zoomBase, 'rotozoom.motion.zoomBase', { min: Number.MIN_VALUE });
    assertNumber(config.texture.size, 'rotozoom.texture.size', { min: 16, max: 1024, integer: true });
    assertNumber(config.texture.checkerSize, 'rotozoom.texture.checkerSize', { min: 1, max: 512, integer: true });
    assertNumber(config.texture.ringFrequency, 'rotozoom.texture.ringFrequency', { min: 0 });
    assertNumber(config.texture.spokeCount, 'rotozoom.texture.spokeCount', { min: 1, max: 64, integer: true });
    assertNumber(config.texture.centerRadius, 'rotozoom.texture.centerRadius', { min: 0 });
    assertNumber(config.texture.borderRadius, 'rotozoom.texture.borderRadius', { min: config.texture.centerRadius });
  });
}

function buildTexture(config, palette) {
  const size = config.texture.size;
  const texture = new Uint32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const checker = (
        (Math.floor(x / config.texture.checkerSize) + Math.floor(y / config.texture.checkerSize)) & 1
      ) === 0;
      const centerX = x - size / 2;
      const centerY = y - size / 2;
      const radius = Math.sqrt(centerX * centerX + centerY * centerY);
      const rings = Math.sin(radius * config.texture.ringFrequency) * 0.5 + 0.5;
      const spokes = Math.sin(Math.atan2(centerY, centerX) * config.texture.spokeCount) * 0.5 + 0.5;
      let position = checker ? rings * 0.4 : 0.4 + spokes * 0.4;
      if (radius < config.texture.centerRadius) position = 0.85;
      else if (radius < config.texture.borderRadius) position = 1;
      texture[y * size + x] = samplePackedPalette(palette, position);
    }
  }
  return texture;
}

export function createRotozoomRenderer({ canvas, config }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  const texture = buildTexture(config, palette);
  const textureSize = config.texture.size;
  let width = 1;
  let height = 1;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resizePixelBuffer(buffer, width * config.render.resolution, height * config.render.resolution);
    },
    render({ time }) {
      const scaledTime = time * config.motion.speed;
      const angle = scaledTime * config.motion.rotationSpeed;
      const zoom = Math.max(
        0.01,
        config.motion.zoomBase + Math.sin(scaledTime * config.motion.zoomSpeed) * config.motion.zoomAmplitude
      );
      const inverseZoom = 1 / zoom;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const centerX = buffer.width / 2;
      const centerY = buffer.height / 2;
      let index = 0;
      for (let y = 0; y < buffer.height; y++) {
        const dy = y - centerY;
        for (let x = 0; x < buffer.width; x++) {
          const dx = x - centerX;
          const rotatedX = (cosine * dx + sine * dy) * inverseZoom;
          const rotatedY = (-sine * dx + cosine * dy) * inverseZoom;
          const textureX = Math.floor(rotatedX + textureSize / 2) % textureSize;
          const textureY = Math.floor(rotatedY + textureSize / 2) % textureSize;
          const wrappedX = (textureX + textureSize) % textureSize;
          const wrappedY = (textureY + textureSize) % textureSize;
          buffer.pixels[index++] = texture[wrappedY * textureSize + wrappedX];
        }
      }
      presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
    }
  };
}
