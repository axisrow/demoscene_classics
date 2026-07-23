import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGradientPalette, createSeededRandom } from '../src/effects/utils.js';
import {
  clamp01,
  coolingPerStep,
  paint,
  runSteps,
  sourceGeometry,
  stepHeat
} from '../src/effects/fire/sim.js';
import { FIRE_DEFAULTS } from '../src/effects/fire/config.js';

// The classic skin ramp, mirrored here so the palette tests assert the real
// shipped ramp rather than a hand-picked test fixture.
const CLASSIC_PALETTE = ['#000000', '#2b0000', '#8b0a0a', '#d83a0a', '#ff7a00', '#ffb400', '#ffe55c', '#fffff0'];

const DEFAULT_PARAMS = FIRE_DEFAULTS.simulation;

function makeBuffers(W, H) {
  return { cur: new Float32Array(W * H), next: new Float32Array(W * H) };
}

// Occupied-area ratio: fraction of cells above a visibility threshold.
function occupiedRatio(heat, threshold = 0.05) {
  let count = 0;
  for (let i = 0; i < heat.length; i++) if (heat[i] > threshold) count++;
  return count / heat.length;
}

// Flame-height fraction: topmost row containing any cell above the threshold,
// expressed as a fraction of grid height (0 = empty, 1 = reaches the top).
function flameHeightFraction(heat, W, H, threshold = 0.3) {
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (heat[row + x] > threshold) return (H - y) / H;
    }
  }
  return 0;
}

test('stepHeat reads current state and writes next state with no traversal-order dependence', () => {
  // A complete step must depend only on `cur`, never on partially-written
  // `next`. The proof: run the step forward, then run it again from the SAME
  // `cur` but with a `next` pre-filled with garbage — the result is identical,
  // because the sweep writes every cell of `next` from `cur` alone.
  const W = 48;
  const H = 32;
  const cur = runSteps(W, H, DEFAULT_PARAMS, 10); // a non-trivial current field

  const nextA = new Float32Array(W * H);
  const nextB = new Float32Array(W * H).fill(0.777); // garbage, would corrupt an in-place update
  const rngA = createSeededRandom(DEFAULT_PARAMS.seed);
  const rngB = createSeededRandom(DEFAULT_PARAMS.seed);
  stepHeat(cur, nextA, W, H, DEFAULT_PARAMS, rngA);
  stepHeat(cur, nextB, W, H, DEFAULT_PARAMS, rngB);

  assert.deepEqual(Array.from(nextB), Array.from(nextA));
});

test('same seed, config, and step count produce identical heat fields', () => {
  const a = runSteps(320, 180, DEFAULT_PARAMS, 300, 1993);
  const b = runSteps(320, 180, DEFAULT_PARAMS, 300, 1993);
  assert.deepEqual(Array.from(a), Array.from(b));
});

test('different seeds change source detail without changing overall composition', () => {
  const a = runSteps(320, 180, DEFAULT_PARAMS, 300, 1993);
  const b = runSteps(320, 180, DEFAULT_PARAMS, 300, 1994);

  // Detail must change: a non-trivial fraction of cells differ.
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 0.01) differing++;
  }
  assert.ok(differing / a.length > 0.05, 'different seeds must change a measurable fraction of cells');

  // Composition must stay the same: occupied area and flame height within 15%.
  const occA = occupiedRatio(a);
  const occB = occupiedRatio(b);
  assert.ok(Math.abs(occA - occB) / occA < 0.15, `occupied ratio drift ${occA} vs ${occB}`);
  const fhA = flameHeightFraction(a, 320, 180);
  const fhB = flameHeightFraction(b, 320, 180);
  assert.ok(Math.abs(fhA - fhB) < 0.15, `flame height drift ${fhA} vs ${fhB}`);
});

test('heat stays within the documented finite range [0, 1] across grids and steps', () => {
  for (const [W, H] of [[320, 180], [160, 90], [80, 45], [20, 15]]) {
    const heat = runSteps(W, H, DEFAULT_PARAMS, 300, 1993);
    for (let i = 0; i < heat.length; i++) {
      assert.ok(heat[i] >= 0 && heat[i] <= 1, `out-of-range heat ${heat[i]} at ${W}x${H} index ${i}`);
      assert.ok(!Number.isNaN(heat[i]));
    }
  }
});

test('flame height is resolution-independent: stable fraction across grid heights', () => {
  // The headline test for the height-normalized cooling model. The same params
  // at three resolutions of the same aspect must yield a flame-height fraction
  // within 10% of each other.
  const fracs = [180, 90, 45].map((H) => {
    const W = Math.round((H * 16) / 9);
    return flameHeightFraction(runSteps(W, H, DEFAULT_PARAMS, 300, 1993), W, H);
  });
  const min = Math.min(...fracs);
  const max = Math.max(...fracs);
  assert.ok((max - min) / min < 0.10, `flame-height fraction not stable: ${fracs.join(', ')}`);
});

test('normalized cooling: doubling cooling roughly halves the flame height', () => {
  // From the decay model h_n = source·(1−loss)^n, flame height ∝ 1/cooling, so
  // doubling cooling should roughly halve the height. Verified at threshold 0.3
  // (the visible orange/yellow core), which tracks the model more tightly than
  // the near-black visibility threshold.
  const W = 320;
  const H = 180;
  const fLow = flameHeightFraction(runSteps(W, H, { ...DEFAULT_PARAMS, cooling: 0.25 }, 300, 1993), W, H);
  const fHigh = flameHeightFraction(runSteps(W, H, { ...DEFAULT_PARAMS, cooling: 0.5 }, 300, 1993), W, H);
  assert.ok(fHigh < fLow, `higher cooling must shorten the flame: ${fHigh} vs ${fLow}`);
  const ratio = fHigh / fLow;
  assert.ok(ratio > 0.3 && ratio < 0.75, `cooling 2x should give ~half height, ratio=${ratio.toFixed(3)}`);
});

test('small-grid boundary stays bounded and stable (coolingPerStep clamp)', () => {
  // H=6 with cooling=1 would compute loss = 6·1/6 = 1.0 without the clamp,
  // inverting the (1−loss) factor. The clamp holds it at 0.95.
  assert.ok(coolingPerStep(6, 1) <= 0.95);
  const heat = runSteps(12, 6, { ...DEFAULT_PARAMS, cooling: 1 }, 50, 1993);
  for (let i = 0; i < heat.length; i++) {
    assert.ok(heat[i] >= 0 && heat[i] <= 1 && !Number.isNaN(heat[i]));
  }
});

test('resize/reset leaves no stale buffer: a cold start is deterministic', () => {
  // Simulate the renderer's resize() path: reallocate both buffers to a new
  // size, zero them, re-seed. The first steps after a resize must not carry
  // residual heat from the previous grid.
  const W = 48;
  const H = 32;
  let { cur, next } = makeBuffers(W, H);
  let rng = createSeededRandom(DEFAULT_PARAMS.seed);
  for (let i = 0; i < 20; i++) {
    stepHeat(cur, next, W, H, DEFAULT_PARAMS, rng);
    [cur, next] = [next, cur];
  }
  const beforeResize = Array.from(cur);

  // Resize to a different grid: fresh zeroed buffers, re-seeded RNG.
  const W2 = 64;
  const H2 = 48;
  ({ cur, next } = makeBuffers(W2, H2));
  rng = createSeededRandom(DEFAULT_PARAMS.seed);
  assert.equal(cur.length, W2 * H2);
  for (let i = 0; i < cur.length; i++) assert.equal(cur[i], 0, 'cold-start buffer must be zeroed');

  // The new grid's first steps must match a fresh cold start of the same size,
  // independent of whatever `beforeResize` held.
  const freshCold = runSteps(W2, H2, DEFAULT_PARAMS, 20, DEFAULT_PARAMS.seed);
  for (let i = 0; i < 20; i++) {
    stepHeat(cur, next, W2, H2, DEFAULT_PARAMS, rng);
    [cur, next] = [next, cur];
  }
  assert.deepEqual(Array.from(cur), Array.from(freshCold));
  // And it must not equal the old grid's state (sanity: buffers are distinct).
  assert.notDeepEqual(Array.from(cur).slice(0, beforeResize.length), beforeResize);
});

test('seeded source is persistent: the source band is a deterministic function of seed and column', () => {
  // The source band must be reproducible from the seed alone, independent of
  // any prior simulation history (not path-dependent). Two independent cold
  // first steps with the same seed produce identical source rows even though
  // the cells above are computed from the (identical, zero) current buffer.
  const W = 80;
  const H = 45;
  const { firstSourceRow } = sourceGeometry(W, H, DEFAULT_PARAMS);

  const runA = makeBuffers(W, H);
  const runB = makeBuffers(W, H);
  stepHeat(runA.cur, runA.next, W, H, DEFAULT_PARAMS, createSeededRandom(DEFAULT_PARAMS.seed));
  stepHeat(runB.cur, runB.next, W, H, DEFAULT_PARAMS, createSeededRandom(DEFAULT_PARAMS.seed));

  const rowA = Array.from(runA.next.subarray(firstSourceRow * W, (firstSourceRow + 1) * W));
  const rowB = Array.from(runB.next.subarray(firstSourceRow * W, (firstSourceRow + 1) * W));
  assert.deepEqual(rowB, rowA);

  // A different seed must change the source band (it drives the flicker).
  const runC = makeBuffers(W, H);
  stepHeat(runC.cur, runC.next, W, H, DEFAULT_PARAMS, createSeededRandom(DEFAULT_PARAMS.seed + 1));
  const rowC = Array.from(runC.next.subarray(firstSourceRow * W, (firstSourceRow + 1) * W));
  assert.notDeepEqual(rowC, rowA);
});

test('palette: near-white is confined to a small top band, never a broad region', () => {
  const palette = buildGradientPalette(new Uint32Array(256), CLASSIC_PALETTE);
  // White/near-white (bright, low blue-shift) may appear only in the top slice.
  let nearWhite = 0;
  for (let i = 0; i < 256; i++) {
    const r = palette[i] & 0xff;
    const g = (palette[i] >> 8) & 0xff;
    const b = (palette[i] >> 16) & 0xff;
    if (r > 240 && g > 220 && b > 180) nearWhite++;
  }
  assert.ok(nearWhite / 256 <= 0.15, `near-white occupies ${(nearWhite / 256 * 100).toFixed(1)}% — too broad`);
  // The bulk of the ramp must be warm (orange/yellow): R dominant, G in range.
  let warm = 0;
  for (let i = 64; i < 200; i++) {
    const r = palette[i] & 0xff;
    const g = (palette[i] >> 8) & 0xff;
    if (r > 180 && g >= 40 && g < 240) warm++;
  }
  assert.ok(warm > 100, `middle of ramp should be warm orange/yellow, only ${warm} cells qualify`);
});

test('maturity at 5 seconds: non-empty and vertically coherent', () => {
  // 300 steps = 5 s at stepHz 60, motion.speed 1. The flame must be mature:
  // non-empty (occupied area above a floor) and vertically coherent (a column
  // of heat rising from the source past half the grid, not a short strip).
  const W = 320;
  const H = 180;
  const heat = runSteps(W, H, DEFAULT_PARAMS, 300, 1993);

  assert.ok(occupiedRatio(heat) > 0.1, '5s flame must be non-empty');

  // Find the tallest connected vertical run of heat from the source upward.
  // Scan each column from the source row toward the top, counting consecutive
  // heated cells (heat > 0.1) until a gap. The best column must reach > 0.5·H.
  const sourceRow = H - Math.max(1, Math.round(H * DEFAULT_PARAMS.sourceDepthFrac));
  let bestRun = 0;
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = sourceRow; y >= 0; y--) {
      if (heat[y * W + x] > 0.1) {
        run++;
      } else {
        bestRun = Math.max(bestRun, run);
        run = 0;
      }
    }
    bestRun = Math.max(bestRun, run);
  }
  assert.ok(bestRun / H > 0.5, `flame must rise past half the grid; best vertical run ${bestRun}/${H}`);
});

test('paint maps heat 0 → palette[0], heat 1 → palette[last], monotonically', () => {
  const palette = buildGradientPalette(new Uint32Array(256), CLASSIC_PALETTE);
  const heat = new Float32Array([0, 0.25, 0.5, 0.75, 1]);
  const pixels = new Uint32Array(heat.length);
  paint(palette, heat, pixels);
  assert.equal(pixels[0], palette[0]);
  assert.equal(pixels[heat.length - 1], palette[palette.length - 1]);
  // Monotonic non-decreasing palette index for non-decreasing heat.
  const indices = Array.from(heat, (h) => Math.min(255, Math.max(0, Math.round(h * 255))));
  for (let i = 1; i < indices.length; i++) {
    assert.ok(indices[i] >= indices[i - 1], 'paint must be monotonic in heat');
    assert.equal(pixels[i], palette[indices[i]]);
  }
});

test('startup is non-empty immediately and matures deterministically over time', () => {
  // The very first painted frame (after one step) already shows heat in the
  // source band; it must not be fully blank. Warm-up is real simulation
  // behaviour, not hidden test state.
  const W = 320;
  const H = 180;
  const step1 = runSteps(W, H, DEFAULT_PARAMS, 1, 1993);
  assert.ok(occupiedRatio(step1) > 0, 'first step must seed the source band (non-empty)');
  // And the flame grows monotonically taller as steps accumulate.
  const early = flameHeightFraction(runSteps(W, H, DEFAULT_PARAMS, 30, 1993), W, H);
  const mature = flameHeightFraction(runSteps(W, H, DEFAULT_PARAMS, 300, 1993), W, H);
  assert.ok(mature >= early, 'flame must not shrink as it matures');
});
