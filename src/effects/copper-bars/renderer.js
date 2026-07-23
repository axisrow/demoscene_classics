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

// Copper Bars renderer (issue #14).
//
// The composition is one-dimensional and vertical: every bar is a horizontal
// stripe, so each buffer ROW is independent and fully described by the bars
// that touch it. Bar placement (yBase, amplitude, height) and the shading model
// are fractions of the buffer height and live in config/profiles; the palette,
// background, and color count are skin-owned (appearance).
//
// COMPOSITION IS RESOLUTION-STABLE BY CONSTRUCTION: center = yBase*height and
// halfHeight = height*height are fractions of the buffer height, and the whole
// buffer is upscaled to the visible canvas with one drawImage, so lowering
// render.resolution only resamples the SAME composition into fewer rows — it
// never changes apparent placement or thickness. (This is the difference from
// the starfield path: copper is 1D-vertical, so no logical/`drawScale` recovery
// is needed.)
//
// OVERLAP MODEL — bounded source-over blend (replaces the legacy additive
// `red += color*glossy; min(255)` clip). Each row starts as the opaque
// background; bars blend over it in array order (= front-to-back z-order) with
// the standard source-over formula for an opaque destination:
//
//   barAlpha = glossy * shading.barAlphaScale           // bounded in [0, barAlphaScale]
//   acc{R,G,B} = bar{R,G,B} * barAlpha + acc{R,G,B} * (1 - barAlpha)
//
// The destination stays opaque (alpha is never tracked). Because each blend is a
// convex combination, the accumulator can NEVER exceed the channel range or sum
// without bound: a bar shifts the row colour toward its own colour by at most
// `barAlphaScale`, so crossings brighten toward the bar colour predictably and
// never clip to flat white. Bars later in the array composite on top of earlier
// ones, so the front of the stack wins proportionally — the classic stacked
// copper-bar hierarchy.
//
// HIGHLIGHT — narrow specular expressed as a FRACTION of halfHeight (resolution-
// stable), added to the bar color and clamped per-bar BEFORE the composite, so
// saturation is deterministic per bar rather than accumulating across crossings.
//
// MOTION — pure `sin(time)`: no delta dependency, no RNG, no retained state.
// The same logical time always yields the same frame, regardless of frame rate.
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
  // Background channels as 0..255 floats for the row accumulator seed.
  const bgR = background & 255;
  const bgG = background >>> 8 & 255;
  const bgB = background >>> 16 & 255;
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
      const colorCycleSpeed = config.motion.colorCycleSpeed;
      const { glossyFalloff, barAlphaScale, specularWidth, specularFalloff, specularGain } = config.shading;

      let index = 0;
      for (let y = 0; y < buffer.height; y++) {
        // Row accumulator: opaque background seed. Each bar blends over it with
        // source-over (convex combination), so the row colour is always bounded.
        let accR = bgR;
        let accG = bgG;
        let accB = bgB;
        for (const bar of config.bars) {
          const center = (
            bar.yBase + bar.amplitude * Math.sin(scaledTime * bar.frequency + bar.phase)
          ) * buffer.height;
          const distance = y - center;
          const halfHeight = Math.max(2, bar.height * buffer.height);
          if (distance > halfHeight || distance < -halfHeight) continue;
          const normalized = distance / halfHeight;
          const absNormalized = normalized < 0 ? -normalized : normalized;
          const falloff = 1 - absNormalized;
          const glossy = falloff ** glossyFalloff;
          const barAlpha = glossy * barAlphaScale;
          const color = samplePackedPalette(
            palette,
            ((bar.colorOffset + normalized * 0.12 + scaledTime * colorCycleSpeed) % 1 + 1) % 1
          );
          let barR = color & 255;
          let barG = color >>> 8 & 255;
          let barB = color >>> 16 & 255;
          // Narrow bounded specular, a fraction of halfHeight, added per-bar
          // and clamped BEFORE the composite.
          if (absNormalized < specularWidth) {
            const specularN = 1 - absNormalized / specularWidth;
            const specular = (specularN ** specularFalloff) * specularGain;
            barR += specular;
            barG += specular;
            barB += specular;
            if (barR > 255) barR = 255;
            if (barG > 255) barG = 255;
            if (barB > 255) barB = 255;
          }
          // Source-over blend: convex combination, bounded by construction.
          accR += (barR - accR) * barAlpha;
          accG += (barG - accG) * barAlpha;
          accB += (barB - accB) * barAlpha;
        }
        const pixel = packRgb(accR | 0, accG | 0, accB | 0);
        for (let x = 0; x < buffer.width; x++) buffer.pixels[index++] = pixel;
      }
      presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
    }
  };
}
