import {
  buildGradientPalette,
  createDrawingBuffer,
  createSeededRandom,
  getContext2D,
  presentDrawingBuffer,
  resizeDrawingBuffer,
  samplePackedPalette
} from '../utils.js';
import { resolveStarCount } from './config.js';

const DEFAULT_TEXT = '  GREETZ TO ALL DEMOSCENERS  ***  PLASMA  FIRE  METABALLS  TUNNEL  FRACTALS  ROTOZOOM  FEEDBACK  COPPER BARS  ***  JS DEMO PACK 2026  ***  KEEP IT REAL  ***  ';

export { DEFAULT_TEXT };

// Sine-scroller renderer (issue #11).
//
// EVERY geometric quantity is expressed in NORMALIZED VIEWPORT terms measured
// against the LOGICAL (CSS) canvas size — never against the backing-store buffer
// pixels. render.resolution (and pixelRatio) only change how many device pixels
// the same composition is rasterised into, so lowering resolution resamples the
// SAME picture and never changes type scale, wave frequency, amplitude, or star
// count.
//
// Coordinate basis (all LOGICAL / CSS units):
//
//   shortSide   = min(logicalWidth, logicalHeight)
//   fontSize    = clamp(shortSide * text.fontSizeRatio, text.fontSizeMin, text.fontSizeMax)
//   baseline    = logicalHeight * wave.baseline            (fraction of height)
//   amplitude   = shortSide   * wave.amplitude             (fraction of short side)
//   glyphAdvance= MEASURED per glyph via measureText()      (actual glyph bounds)
//   pathWidth   = sum of glyph advances across the phrase  (the text path length)
//
// WAVE FREQUENCY is expressed as CYCLES ACROSS THE TEXT PATH, never as a pixel
// divisor. A glyph whose left edge sits at path-fraction `t` (distance along the
// unscrolled phrase / pathWidth) is placed at
//
//   y = baseline + sin(t * 2π · wave.cycles + phase) * amplitude
//
// Because the argument is `t * 2π · cycles` and `t ∈ [0,1]`, the number of sine
// humps across the phrase is exactly `wave.cycles` regardless of how wide the
// canvas or path is — wave frequency does NOT change with canvas width. (Phase
// advances with scaled time so the wave animates.)
//
// SCROLL is TIME-BASED and normalized: motion.scrollSpeed is in VIEWPORT-WIDTHS
// PER SECOND. The phrase advances `scrollSpeed * logicalWidth * delta` logical
// units each frame, so the same elapsed time scrolls the same fraction of the
// viewport at 24 / 30 / 60 FPS. The wrap offset is taken modulo pathWidth so the
// phrase re-enters seamlessly (reset/wrap continuity, no duplicate jump).
//
// STARS are generated deterministically in NORMALIZED coordinates (x,y ∈ [0,1])
// and scaled into logical space for drawing. The target count is resolved once
// per resize from the resolved star budget (explicit `count`, or area-density
// clamped to [densityMin, densityMax]); the seeded RNG is consumed in fixed
// array order so the spawn sequence is fully deterministic for a given
// (config, count). Recycling a star that has drifted off the left edge reseeds
// only its x to the right edge and consumes the shared RNG stream for a fresh y
// — so the recycle sequence stays deterministic for a given frame budget.
//
// TYPOGRAPHY SAFETY: baseline is chosen (via wave.baseline) and the amplitude /
// font-size derived so the glyph ink stays inside [safeMargin, logicalHeight -
// safeMargin] at every phase. The per-glyph advance is measured once per resize
// (measureText) so the path width reflects the real font; glyph heights are
// conservatively the font size when computing the safe band in tests.
export function createSineScrollerRenderer({ canvas, config }) {
  const output = getContext2D(canvas, { alpha: false });
  const buffer = createDrawingBuffer();
  const context = buffer.context;
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  const pixelRatio = config.runtime.pixelRatio;

  let stars = [];
  let random = createSeededRandom(config.stars.seed);
  // LOGICAL (CSS) viewport extents — the normalized basis.
  let logicalWidth = 1;
  let logicalHeight = 1;
  let shortSide = 1;
  // Backing-store (rasterisation) extents.
  let bufferWidth = 1;
  let bufferHeight = 1;
  // drawScale maps a LOGICAL drawing coordinate into backing-buffer space so
  // text/stars land correctly on a resolution-scaled offscreen canvas. Equals
  // resolution * pixelRatio (1 at the default profile), so the default
  // composition is unchanged; only lower-resolution buffers sample the same
  // composition into fewer pixels.
  let drawScale = 1;
  // Measured per-glyph advances and the full text-path width. These depend ONLY
  // on the font (family + weight + size) and the phrase, all of which are fixed
  // between resizes, so they are measured ONCE in resize and reused every frame
  // — measureText is not free on a real Canvas 2D backend, and calling it for
  // every glyph every frame (158 calls/frame) is wasteful when nothing changed.
  let advances = [];
  let pathWidth = 1;

  function spawnStar(star, atRight = false) {
    star.x = atRight ? 1 : random();
    star.y = random();
    star.z = config.stars.minDepth + random() * (config.stars.maxDepth - config.stars.minDepth);
    star.a = config.stars.minAlpha + random() * (config.stars.maxAlpha - config.stars.minAlpha);
  }

  function resetStars(count) {
    stars = new Array(count);
    for (let index = 0; index < count; index++) {
      stars[index] = {};
      spawnStar(stars[index]);
    }
  }

  // Measure every glyph's advance and the total text-path width for the current
  // font + phrase. Pure of viewport geometry beyond the font size; called once
  // per resize so render() reuses the cached `advances` / `pathWidth`.
  function measurePhrase(fontSize) {
    context.font = `${config.appearance.fontWeight} ${fontSize}px ${config.appearance.fontFamily}`;
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    const content = config.text.content;
    const measured = new Array(content.length);
    let total = 0;
    for (let index = 0; index < content.length; index++) {
      const metrics = context.measureText(content[index]);
      const advance = metrics.width || fontSize * config.text.characterWidthRatio;
      measured[index] = advance;
      total += advance;
    }
    return { advances: measured, pathWidth: Math.max(1, total) };
  }

  return {
    resize(nextWidth, nextHeight) {
      // nextWidth/nextHeight arrive as CSS px * pixelRatio (see runtime
      // measureCanvas). Recover the LOGICAL (CSS) size for the normalized
      // basis, and use the resolution-scaled size only for the backing buffer.
      logicalWidth = Math.max(1, nextWidth / pixelRatio);
      logicalHeight = Math.max(1, nextHeight / pixelRatio);
      shortSide = Math.min(logicalWidth, logicalHeight);
      bufferWidth = nextWidth * config.render.resolution;
      bufferHeight = nextHeight * config.render.resolution;
      resizeDrawingBuffer(buffer, bufferWidth, bufferHeight);
      drawScale = config.render.resolution * pixelRatio;

      // Resolve the star budget for this viewport area and (re)seed so the
      // spawn sequence is stable for a given (config, geometry). The density
      // budget is recomputed on resize, but the seed sequence is identical for
      // an identical resolved count.
      const count = resolveStarCount(config.stars, logicalWidth * logicalHeight);
      random = createSeededRandom(config.stars.seed);
      resetStars(count);

      // Cache the measured per-glyph advances + path width for this font size.
      // They depend only on font + phrase, both fixed between resizes.
      const fontSize = Math.min(
        config.text.fontSizeMax,
        Math.max(config.text.fontSizeMin, shortSide * config.text.fontSizeRatio)
      );
      const phrase = measurePhrase(fontSize);
      advances = phrase.advances;
      pathWidth = phrase.pathWidth;
    },
    render({ time, delta }) {
      context.fillStyle = config.appearance.backgroundColor;
      context.fillRect(0, 0, bufferWidth, bufferHeight);

      // --- star field (normalized coordinates, scaled to logical then buffer) ---
      // Drift is in NORMALIZED x per frame: viewport-widths/sec * delta. Near
      // stars (small z) drift faster than far stars (parallax).
      const depthRange = Math.max(Number.EPSILON, config.stars.maxDepth - config.stars.minDepth);
      const baseDrift = (config.stars.speed * config.motion.speed * delta) / logicalWidth;
      for (const star of stars) {
        const depthFactor = (star.z - config.stars.minDepth) / depthRange; // 0 (near)..1 (far)
        const driftFactor = 1 - depthFactor; // near stars drift faster
        star.x -= baseDrift * (0.4 + driftFactor);
        if (star.x < 0) {
          // Recycle to the right edge with a fresh seeded y so the recycle
          // sequence is deterministic given the frame budget.
          spawnStar(star, true);
        }
        const sx = star.x * logicalWidth;
        const sy = star.y * logicalHeight;
        const size = (config.stars.minSize + depthFactor * (config.stars.maxSize - config.stars.minSize)) * shortSide;
        context.globalAlpha = star.a;
        context.fillStyle = config.appearance.starColor;
        const sz = Math.max(1, size * drawScale);
        context.fillRect(sx * drawScale, sy * drawScale, sz, sz);
      }
      context.globalAlpha = 1;

      // --- typography + wave (all LOGICAL units) ---
      const fontSize = Math.min(
        config.text.fontSizeMax,
        Math.max(config.text.fontSizeMin, shortSide * config.text.fontSizeRatio)
      );
      // Glyph POSITIONS are mapped into backing-buffer space with `drawScale`
      // (leftX * drawScale, y * drawScale). The glyph RASTER must scale by the
      // SAME factor, or the buffer (rendered at a smaller resolution) is upscaled
      // by presentDrawingBuffer and the glyphs grow out of proportion to their
      // spacing and overlap. So the render font size is `fontSize * drawScale`
      // while the cached advances stay in LOGICAL units (used for logical scroll
      // math and path-fraction wave placement).
      context.font = `${config.appearance.fontWeight} ${fontSize * drawScale}px ${config.appearance.fontFamily}`;
      context.textBaseline = 'middle';
      context.textAlign = 'left';

      // Per-glyph advances + path width are measured once per resize (above) and
      // reused here; measureText is not called per frame.
      const content = config.text.content;
      const localAdvances = advances;
      const localPathWidth = pathWidth;

      const baseline = logicalHeight * config.wave.baseline;
      const amplitude = shortSide * config.wave.amplitude;

      // SCROLL: motion.scrollSpeed is viewport-widths per second. The phrase
      // advances that fraction of logicalWidth each second; offset is wrapped
      // modulo pathWidth so the phrase re-enters seamlessly.
      const scaledTime = time * config.motion.speed;
      const advance = scaledTime * config.motion.scrollSpeed * logicalWidth;
      const offset = ((advance % localPathWidth) + localPathWidth) % localPathWidth;

      // How many copies of the phrase tile [0, logicalWidth] given the offset.
      // +1 on each side so glyphs entering/leaving are fully drawn (no pop).
      const passes = Math.ceil((logicalWidth + localPathWidth) / localPathWidth) + 1;

      // WAVE PHASE advances with scaled time (radians per scaled-second).
      const phase = scaledTime * config.motion.phaseSpeed;
      const cycles2Pi = 2 * Math.PI * config.wave.cycles;
      const shadowOffsetX = config.text.shadowOffsetX * shortSide;
      const shadowOffsetY = config.text.shadowOffsetY * shortSide;

      for (let pass = 0; pass < passes; pass++) {
        let cursor = pass * localPathWidth - offset;
        for (let index = 0; index < content.length; index++) {
          const advanceGlyph = localAdvances[index];
          const leftX = cursor;
          const centerX = cursor + advanceGlyph / 2;
          cursor += advanceGlyph;
          if (centerX < -advanceGlyph || centerX > logicalWidth + advanceGlyph) continue;
          // Wave: cycles across the PATH, not across the canvas. The path
          // fraction t is measured along the unscrolled phrase so frequency
          // does not change with canvas width or scroll position. `pass` tiles
          // the phrase; only the within-phrase fraction matters, so the wave
          // repeats identically on every tiled copy.
          const t = (leftX + offset) / localPathWidth - pass;
          const pathFraction = t - Math.floor(t);
          const y = baseline + Math.sin(pathFraction * cycles2Pi + phase) * amplitude;
          context.globalAlpha = config.appearance.shadowAlpha;
          context.fillStyle = config.appearance.shadowColor;
          context.fillText(
            content[index],
            (leftX + shadowOffsetX) * drawScale,
            (y + shadowOffsetY) * drawScale
          );
          const color = samplePackedPalette(
            palette,
            ((index / content.length) + scaledTime * config.motion.colorCycleSpeed) % 1
          );
          context.globalAlpha = 1;
          context.fillStyle = `rgb(${color & 255},${color >>> 8 & 255},${color >>> 16 & 255})`;
          context.fillText(content[index], leftX * drawScale, y * drawScale);
        }
      }
      context.globalAlpha = 1;

      presentDrawingBuffer(output, buffer, canvas.width, canvas.height, config.render.smoothing);
    }
  };
}
