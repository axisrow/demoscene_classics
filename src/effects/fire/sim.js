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
//   - Vertical RISE is height-normalized too: each step the advection samples
//     the row `stride = (riseFrac / stepHz) * H` rows below, bilinearly
//     interpolated between the two nearest integer rows. Heat therefore rises a
//     fixed FRACTION of the grid per second, so warm-up timing — not just the
//     steady-state flame height — is resolution-independent.
//
// Cooling is normalized to grid height: `coolingPerStep = min((6·cooling) / H, 0.95)`,
// and stepHeat scales the per-step loss by the rise stride (`(1−loss)^stride`) so
// heat decaying over a fractional height u reaches `source·(1−loss)^(u·H)` — the
// same VERTICAL FRACTION of the grid at every resolution, for both the steady-state
// flame height and the warm-up transient. `render.resolution` therefore changes
// only the sampling cost, not the apparent flame height, cooling speed, or warm-up.

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
 * Per-step vertical rise in grid rows, height-normalized so heat rises a fixed
 * FRACTION of the grid per second. `stride = (riseFrac / stepHz) * H`; it is
 * fractional and consumed by bilinear interpolation in stepHeat. At riseFrac=1
 * and stepHz=60, heat traverses the full grid height in one second at any
 * resolution, so the warm-up transient (not just steady state) matches across
 * render.resolutions.
 *
 * @param {number} H grid height
 * @param {number} riseFrac fraction of grid height risen per second
 * @param {number} stepHz simulation steps per second
 * @returns {number}
 */
export function riseStride(H, riseFrac, stepHz) {
  return (riseFrac / stepHz) * H;
}

/**
 * Height-normalized per-step cooling loss (before stride-scaling).
 *
 * With `loss = (K·cooling)/H` (K=6 below), heat decaying over a fractional
 * height `u` (in grid-height units) reaches `source·(1−loss)^(u·H)`, which is
 * independent of H — so the steady-state flame height is the same VERTICAL
 * FRACTION of the grid at every resolution. stepHeat raises this base loss to
 * the power of the rise stride (`coolFactor = (1−loss)^stride`) so a stride
 * jump cools as if it traversed every virtual sub-row; the product stays
 * `(1−loss)^(u·H)` regardless of stride.
 *
 * The clamp keeps the base factor in [0.05, 1] on very short grids (H < ~6),
 * so the simulation stays bounded and stable everywhere.
 *
 * @param {number} H grid height
 * @param {number} cooling cooling strength in [0, 1]
 * @returns {number}
 */
export function coolingPerStep(H, cooling) {
  return Math.min((6 * cooling) / H, 0.95);
}

// Three-tap horizontal average (x-1, x, x+1) of one integer row, reading from
// `cur`. Wraps horizontally so the flame has no hard side walls.
function rowAverage(cur, W, rowOffset, x) {
  const xl = x === 0 ? W - 1 : x - 1;
  const xr = x === W - 1 ? 0 : x + 1;
  return (cur[rowOffset + xl] + cur[rowOffset + x] + cur[rowOffset + xr]) / 3;
}

// Bilinear vertical interpolation of the 3-tap horizontal average at the
// fractional row `below = y + stride`. Sampling rows are clamped only to the
// grid bounds `[0, lastRow]`: heat must travel up step by step through real
// cells (a cold region stays cold until the rising wavefront reaches it), so
// we never redirect a sample into the source band. A sample that falls past
// the floor re-reads the bottom row (the source boundary). The (1 - loss)
// cooling applied by the caller then governs the steady-state flame height.
function advect(cur, W, x, y, stride, lastRow) {
  const below = y + stride;
  let y0 = Math.floor(below);
  let y1 = y0 + 1;
  if (y0 > lastRow) y0 = lastRow;
  if (y1 > lastRow) y1 = lastRow;
  const frac = below - Math.floor(below);
  const lo = rowAverage(cur, W, y0 * W, x);
  if (frac === 0 || y0 === y1) return lo;
  const hi = rowAverage(cur, W, y1 * W, x);
  return lo + (hi - lo) * frac;
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
 * @param {object} params `{ sourceWidthFrac, sourceDepthFrac, sourceIntensity, cooling, riseFrac, stepHz }`
 * @param {() => number} rng deterministic seeded RNG (consumed over the source band)
 */
export function stepHeat(cur, next, W, H, params, rng) {
  const { depthRows, widthCells, xStart, firstSourceRow } = sourceGeometry(W, H, params);
  const loss = coolingPerStep(H, params.cooling);
  const stride = riseStride(H, params.riseFrac, params.stepHz);
  // Scale the per-step cooling by the stride: when heat jumps `stride` rows in
  // one step it must cool as if it passed through all `stride` virtual sub-rows,
  // so the decay to a fractional height u is (1-loss)^(u·H) regardless of stride
  // — steady-state flame height stays resolution-independent, while the
  // height-scaled stride keeps warm-up timing resolution-independent too.
  const coolFactor = Math.pow(1 - loss, stride);
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

  // 2. Diffusion/advection above the source band: pull heat from `stride` rows
  //    below (bilinearly interpolated across the fractional offset), cool, and
  //    clamp. No RNG — fully deterministic. The height-scaled stride makes the
  //    flame rise a fixed fraction of the grid per second (resolution-independent
  //    warm-up); the cooling loss makes the steady-state flame height a fixed
  //    fraction of the grid (resolution-independent steady state).
  for (let y = 0; y < firstSourceRow; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      next[row + x] = clamp01(advect(cur, W, x, y, stride, lastRow) * coolFactor);
    }
  }

  // 3. Cells inside source rows but OUTSIDE source columns still advect from
  //    below (otherwise the flame would be clipped to a hard rectangle at the
  //    source edges). The lowest row samples itself (clamped), which is the
  //    off-source cold floor.
  for (let y = firstSourceRow; y <= lastRow; y++) {
    const row = y * W;
    for (let x = 0; x < xStart; x++) {
      next[row + x] = clamp01(advect(cur, W, x, y, stride, lastRow) * coolFactor);
    }
    for (let x = xStart + widthCells; x < W; x++) {
      next[row + x] = clamp01(advect(cur, W, x, y, stride, lastRow) * coolFactor);
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
