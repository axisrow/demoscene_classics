import {
  buildGradientPalette,
  createPixelBuffer,
  createSeededRandom,
  getContext2D,
  presentPixelBuffer,
  resizePixelBuffer
} from '../utils.js';
import { paint, stepHeat } from './sim.js';

export function createFireRenderer({ canvas, config }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );

  // Heat state: normalized [0, 1] scalars in two ping-pong buffers so a step
  // can read all of `cur` and write all of `next` without traversal-order
  // feedback. Allocated in resize() once the grid size is known.
  let cur = new Float32Array(0);
  let next = new Float32Array(0);
  let random = createSeededRandom(config.simulation.seed);
  let accumulator = 0;
  let width = 1;
  let height = 1;

  const stepSeconds = 1 / config.simulation.stepHz;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resizePixelBuffer(buffer, width * config.render.resolution, height * config.render.resolution);
      // Reallocate both heat buffers to the new grid and re-seed so a resize
      // is a deterministic cold start: no stale heat from the previous grid
      // survives, and the source RNG resumes from the same seed.
      const cells = buffer.width * buffer.height;
      cur = new Float32Array(cells);
      next = new Float32Array(cells);
      random = createSeededRandom(config.simulation.seed);
      accumulator = 0;
    },
    render({ delta }) {
      // Advance the simulation with fixed, bounded substeps. The accumulator is
      // driven by wall-time delta scaled by motion.speed; each completed 1/stepHz
      // interval is one heat step, capped at maxCatchUpSteps so a stalled tab
      // cannot burst-compute an unbounded number of steps. Because stepHz is
      // constant across profiles, every profile performs the same number of
      // heat steps over a given wall-time window, keeping 24/30/60 FPS profiles
      // visually comparable (maxFps only governs the runtime frame limiter).
      accumulator += delta * config.motion.speed;
      let steps = 0;
      while (accumulator >= stepSeconds && steps < config.simulation.maxCatchUpSteps) {
        stepHeat(cur, next, buffer.width, buffer.height, config.simulation, random);
        const tmp = cur;
        cur = next;
        next = tmp;
        accumulator -= stepSeconds;
        steps++;
      }

      paint(palette, cur, buffer.pixels);
      presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
    }
  };
}
