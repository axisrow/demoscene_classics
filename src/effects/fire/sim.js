// Pure, DOM-free heat simulation for the fire effect (issue #6).
//
// This module is the algorithm only. It holds no canvas, no rAF, and no module
// state: every function takes its inputs and returns/writes its outputs, so the
// heat field is unit-testable without a browser. The renderer (renderer.js)
// owns the cur/next buffers and drives these functions once per simulation
// step.
//
// The simulation replaces the old noisy rule (heat cells overwritten from
// random targets, in-place writes that depended on loop traversal order) with a
// deterministic, bounded, neighbourhood-based update:
//
//   - Heat is a unitless scalar clamped to [0, 1].
//   - A seeded heat source fills the lower edge each step. The source is the
//     ONLY consumer of the effect's deterministic RNG, and it is consumed in a
//     fixed raster (y, x) order so the source is reproducible.
//   - Above the source, heat is propagated by averaging the three cells in the
//     row directly below (classic DOOM-style fire advection) and then applying
//     a height-normalized cooling loss. Propagation reads ONLY the current
//     buffer and writes ONLY the next buffer at disjoint indices, so the result
//     never depends on loop traversal order.
//
// Cooling is normalized to grid height: `coolingPerStep = min(cooling / H, 0.9)`.
// A cell leaving the source cools as h_n = h_{n-1} * (1 - cooling/H), so the
// number of rows heat survives scales with H — the flame occupies roughly the
// same VERTICAL FRACTION of the grid at every resolution. `render.resolution`
// therefore changes only the sampling cost, not the apparent flame height or
// cooling speed.

import { createSeededRandom } from '../utils.js';

/** Clamp a value into the documented finite heat range [0, 1]. */
export function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Resolve the seeded-source geometry for a grid.
 *
 * Source width and depth are FRACTIONS of the grid so the silhouette is
 * resolution-independent. The source is horizontally centered.
 *
 * @param {number} W grid width
 * @param {number} H grid height
 * @param {{ sourceWidthFrac: number, sourceDepthFrac: number }} params
 * @returns {{ depthRows: number, widthCells: number, xStart: number, firstSourceRow: number }}
 */
export function sourceGeometry(W, H, { sourceWidthFrac, sourceDepthFrac }) {
  const depthRows = Math.max(1, Math.round(H * sourceDepthFrac));
  const widthCells = Math.max(1, Math.round(W * sourceWidthFrac));
  const xStart = (W - widthCells) >> 1;
  return { depthRows, widthCells, xStart, firstSourceRow: H - depthRows };
}

/**
 * Height-normalized per-step cooling loss.
 *
 * Stationary heat `y` rows above the source decays as `source·(1−loss)^y`, so
 * the flame is visible (heat > ~0.05) up to `y_max = ln(0.05)/ln(1−loss)` rows.
 * With `loss = (K·cooling)/H` (K=6 below), `y_max/H` is approximately constant
 * across grid heights — the flame occupies the same VERTICAL FRACTION of the
 * grid at every resolution, so `render.resolution` changes only the sampling
 * cost, never the apparent flame height. Empirically `cooling=0.5` ⇒ flame ≈
 * 0.95–0.99 of grid height; `cooling` scales that fraction smoothly in [0,1].
 *
 * The clamp keeps the (1 − loss) factor in [0.05, 1] on very short grids
 * (H < ~6), so the simulation stays bounded and stable everywhere.
 *
 * @param {number} H grid height
 * @param {number} cooling cooling strength in [0, 1]
 * @returns {number}
 */
export function coolingPerStep(H, cooling) {
  return Math.min((6 * cooling) / H, 0.95);
}

// Average the three cells in the row directly below (x-1, x, x+1) of (x, y),
// reading from `cur`. Wraps horizontally so the flame has no hard side walls.
function advect(cur, W, base, below, x) {
  const xl = x === 0 ? W - 1 : x - 1;
  const xr = x === W - 1 ? 0 : x + 1;
  return (cur[below + xl] + cur[below + x] + cur[below + xr]) / 3;
}

/**
 * Advance the heat field by exactly one step.
 *
 * Reads `cur`, writes `next`, returns nothing. `rng` is the ONLY nondeterminism
 * and is consumed in fixed raster order over the source band. Because the
 * diffusion sweep reads only `cur` and writes only `next` at disjoint indices,
 * the result is independent of any traversal reordering.
 *
 * @param {Float32Array} cur current heat field (read)
 * @param {Float32Array} next next heat field (written)
 * @param {number} W grid width
 * @param {number} H grid height
 * @param {object} params `{ sourceWidthFrac, sourceDepthFrac, sourceIntensity, cooling }`
 * @param {() => number} rng deterministic seeded RNG (consumed over the source band)
 */
export function stepHeat(cur, next, W, H, params, rng) {
  const { depthRows, widthCells, xStart, firstSourceRow } = sourceGeometry(W, H, params);
  const loss = coolingPerStep(H, params.cooling);
  const intensity = params.sourceIntensity;
  const lastRow = H - 1;
  const denom = widthCells > 1 ? widthCells - 1 : 1;

  // Start from a clean slate: every cell that is not explicitly written below
  // (e.g. the floor row outside the source columns) is cold. This makes a
  // cur/next reference swap after the step safe — no stale heat leaks across
  // steps through cells the sweep does not touch.
  next.fill(0);

  // 1. Source band (lower edge): seeded envelope + flicker. This is the
  //    boundary condition that feeds the flame, and the only RNG consumer.
  //    The envelope is a smooth, center-weighted sinusoid; the seeded jitter
  //    varies the detail without changing the overall composition.
  for (let y = firstSourceRow; y <= lastRow; y++) {
    const row = y * W;
    for (let i = 0; i < widthCells; i++) {
      const x = xStart + i;
      const xFrac = i / denom;
      const envelope = 0.5 * (1 + Math.sin(Math.PI * xFrac));
      const flicker = 0.75 + 0.25 * rng();
      next[row + x] = clamp01(intensity * envelope * flicker);
    }
  }

  // 2. Diffusion/advection above the source band: average the three cells in
  //    the row directly below, cool, clamp. No RNG — fully deterministic.
  for (let y = 0; y < firstSourceRow; y++) {
    const row = y * W;
    const below = (y + 1) * W;
    for (let x = 0; x < W; x++) {
      next[row + x] = clamp01(advect(cur, W, row, below, x) * (1 - loss));
    }
  }

  // 3. Cells inside source rows but OUTSIDE source columns still advect from
  //    below (otherwise the flame would be clipped to a hard rectangle at the
  //    source edges). The lowest row has nothing below it, so those off-source
  //    cells stay cold.
  for (let y = firstSourceRow; y <= lastRow; y++) {
    if (y === lastRow) continue; // nothing below the floor
    const row = y * W;
    const below = (y + 1) * W;
    for (let x = 0; x < xStart; x++) {
      next[row + x] = clamp01(advect(cur, W, row, below, x) * (1 - loss));
    }
    for (let x = xStart + widthCells; x < W; x++) {
      next[row + x] = clamp01(advect(cur, W, row, below, x) * (1 - loss));
    }
  }
}

/**
 * Map a normalized heat field onto a packed-rgba palette buffer.
 *
 * @param {Uint32Array} palette packed colours (e.g. from buildGradientPalette)
 * @param {Float32Array} heat heat field in [0, 1]
 * @param {Uint32Array} pixels destination pixel buffer (same length as heat)
 */
export function paint(palette, heat, pixels) {
  const max = palette.length - 1;
  for (let i = 0; i < heat.length; i++) {
    pixels[i] = palette[Math.min(max, Math.max(0, Math.round(heat[i] * max)))];
  }
}

/**
 * Convenience: run `steps` simulation steps from a zeroed grid and return the
 * final heat field. Used by tests and the renderer's cold-start path.
 *
 * @param {number} W grid width
 * @param {number} H grid height
 * @param {object} params simulation params (see stepHeat)
 * @param {number} steps number of steps to advance
 * @param {number} [seed] seed for the source RNG
 * @returns {Float32Array} the final heat field
 */
export function runSteps(W, H, params, steps, seed = params.seed ?? 1993) {
  let cur = new Float32Array(W * H);
  let next = new Float32Array(W * H);
  const rng = createSeededRandom(seed);
  for (let i = 0; i < steps; i++) {
    stepHeat(cur, next, W, H, params, rng);
    const tmp = cur;
    cur = next;
    next = tmp;
  }
  return cur;
}
