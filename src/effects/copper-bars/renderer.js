import {
  buildGradientPalette,
  createPixelBuffer,
  getContext2D,
  packHexColor,
  packRgb,
  presentPixelBuffer,
  resizePixelBuffer,
  samplePackedPalette
} from '../utils.js';

export function copperHue(baseHue, normalizedRow, time) {
  return (baseHue + normalizedRow * 80 + time * 40 + 360) % 360;
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
