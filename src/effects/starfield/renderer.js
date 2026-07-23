import {
  buildGradientPalette,
  createDrawingBuffer,
  createSeededRandom,
  getContext2D,
  presentDrawingBuffer,
  resizeDrawingBuffer,
  samplePackedPalette
} from '../utils.js';
import { resolveParticleCount } from './config.js';

// Normalized 3D starfield renderer (issue #7).
//
// Simulation volume (documented, finite, normalized to LOGICAL/CSS units):
//   x ∈ [-halfWidth,  halfWidth],  y ∈ [-halfHeight, halfHeight],  z ∈ (nearZ, depth]
// x/y are sampled at spawn and held; only z advances, by travelSpeed WORLD
// units per second (time-based, frame-rate- and resolution-independent).
//
// Aspect-correct pinhole projection (isotropic focal length `fov` in logical px):
//   px = x / z * fov + halfWidth  * centerX
//   py = y / z * fov + halfHeight * centerY
// Isotropic focal length keeps the corridor from stretching with aspect ratio.
//
// Trails are drawn from the star's PREVIOUS projected position, recomputed each
// frame from the held (x, y) and the previous z (star.prevZ) — no pixel
// coordinates are retained as simulation state. A freshly (re)spawned star has
// prevZ === null and draws no streak on its first frame.
//
// Visibility / deterministic recycling:
//   - near plane:        z <= nearZ, or z non-finite  -> respawn at far plane
//   - viewport bounds:   projected point outside the frame expanded by
//                         cullMargin on every side -> respawn at far plane
//   Stars leave the useful field flying outward (|x/z| grows as z shrinks), so
//   a culled star never re-enters; respawning at the far plane puts it back in
//   the useful field. The stars array is iterated in fixed order and the seeded
//   random stream is consumed in that same order, so the recycle sequence is
//   fully deterministic and produces no one-frame burst.
export function createStarfieldRenderer({ canvas, config }) {
  const output = getContext2D(canvas, { alpha: false });
  const buffer = createDrawingBuffer();
  const context = buffer.context;
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );

  const { nearZ, fov, depth, centerX, centerY, cullMargin } = config.particles;
  const pixelRatio = config.runtime.pixelRatio;

  let random = createSeededRandom(config.particles.seed);
  let stars = [];
  // halfWidth/halfHeight are the LOGICAL (CSS) half-extents of the spawn
  // volume; bufferWidth/bufferHeight are the backing-store dims used only for
  // rasterisation. Decoupling them is what makes the volume resolution-
  // independent (lowering render.resolution no longer shrinks the corridor).
  let halfWidth = 1;
  let halfHeight = 1;
  let bufferWidth = 1;
  let bufferHeight = 1;
  let centerOffsetX = 0;
  let centerOffsetY = 0;
  // drawScale maps a LOGICAL (CSS) projected coordinate into backing-buffer
  // space so streaks land in the right place on a resolution-scaled offscreen
  // canvas. It equals resolution * pixelRatio (1 at the default profile), so
  // the default composition is unchanged; only lower-resolution buffers sample
  // the same composition into fewer pixels.
  let drawScale = 1;

  function spawn(star, far = false) {
    star.x = (random() * 2 - 1) * halfWidth;
    star.y = (random() * 2 - 1) * halfHeight;
    star.z = far ? depth : random() * (depth - nearZ) + nearZ;
    star.prevZ = null;
  }

  function resetStars() {
    for (const star of stars) spawn(star);
  }

  function resize(nextWidth, nextHeight) {
    // nextWidth/nextHeight arrive as CSS px * pixelRatio (see runtime
    // measureCanvas). Recover the logical (CSS) size for the volume, and use
    // the resolution-scaled size only for the backing buffer.
    halfWidth = Math.max(1, nextWidth / pixelRatio);
    halfHeight = Math.max(1, nextHeight / pixelRatio);
    bufferWidth = nextWidth * config.render.resolution;
    bufferHeight = nextHeight * config.render.resolution;
    resizeDrawingBuffer(buffer, bufferWidth, bufferHeight);
    centerOffsetX = halfWidth * centerX;
    centerOffsetY = halfHeight * centerY;
    drawScale = config.render.resolution * pixelRatio;

    // Resolve the particle budget for this viewport area and (re)seed so the
    // spawn sequence is stable for a given (config, geometry). A density budget
    // is recomputed on resize, but the seed sequence is identical for an
    // identical resolved count.
    const count = resolveParticleCount(config.particles, halfWidth * halfHeight);
    if (count !== stars.length) {
      stars = Array.from({ length: count }, () => ({}));
    }
    random = createSeededRandom(config.particles.seed);
    resetStars();
  }

  return {
    resize,
    render({ delta }) {
      context.fillStyle = config.appearance.backgroundColor;
      context.globalAlpha = config.appearance.trailFade;
      context.fillRect(0, 0, bufferWidth, bufferHeight);
      context.globalAlpha = 1;

      const advance = config.particles.travelSpeed * config.motion.speed * delta;
      const maxX = halfWidth + cullMargin;
      const maxY = halfHeight + cullMargin;
      const minX = -cullMargin;
      const minY = -cullMargin;

      for (const star of stars) {
        star.z -= advance;
        // Near-plane / invalid recycle.
        if (!Number.isFinite(star.z) || star.z <= nearZ) {
          spawn(star, true);
          continue;
        }
        const px = star.x / star.z * fov + centerOffsetX;
        const py = star.y / star.z * fov + centerOffsetY;
        // Viewport-bounds recycle: the star has left the useful projected
        // field (it only flies further outward), so recycle it now rather than
        // accumulate an invisible particle. prevZ === null means this is the
        // first frame after spawn: skip drawing but still cull, so a star that
        // spawned outside the field is recycled immediately without a streak.
        if (px < minX || px > maxX || py < minY || py > maxY) {
          spawn(star, true);
          continue;
        }
        if (star.prevZ !== null) {
          const prevPx = star.x / star.prevZ * fov + centerOffsetX;
          const prevPy = star.y / star.prevZ * fov + centerOffsetY;
          const depthFactor = 1 - star.z / depth;
          const intensity = depthFactor * depthFactor;
          const color = samplePackedPalette(palette, intensity);
          const red = color & 255;
          const green = color >>> 8 & 255;
          const blue = color >>> 16 & 255;
          const alpha = config.appearance.minAlpha
            + intensity * (config.appearance.maxAlpha - config.appearance.minAlpha);
          context.strokeStyle = `rgba(${red},${green},${blue},${alpha})`;
          context.lineWidth = config.appearance.minLineWidth
            + intensity * (config.appearance.maxLineWidth - config.appearance.minLineWidth);
          // Map logical projected coords into backing-buffer space for drawing.
          context.beginPath();
          context.moveTo(prevPx * drawScale, prevPy * drawScale);
          context.lineTo(px * drawScale, py * drawScale);
          context.stroke();
        }
        star.prevZ = star.z;
      }
      presentDrawingBuffer(output, buffer, canvas.width, canvas.height, config.render.smoothing);
    }
  };
}
