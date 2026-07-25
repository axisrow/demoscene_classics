import { assertNumber, createEffectDefaults } from '../../config.js';

// Normalized, resolution-independent heat-simulation defaults (issue #6).
//
// Heat is a unitless scalar in [0, 1] everywhere. Cooling, source geometry,
// and flame height are expressed as FRACTIONS of the grid (or seconds) so a
// different `render.resolution` changes only the sampling COST — the number of
// grid cells — never the apparent flame height, silhouette, or cooling speed.
//
//   cooling           canonical public override (height-normalized). The base
//                     per-step loss is `min((6·cooling) / H, 0.95)` (H = grid
//                     height in rows), raised to the rise stride so the flame
//                     occupies roughly the same VERTICAL FRACTION of the grid at
//                     every resolution (≈0.78 of grid height at cooling 0.25).
//   riseFrac          fraction of grid height heat rises per SECOND. The
//                     advection stride per step is `(riseFrac / stepHz) * H`
//                     rows (fractional, bilinearly interpolated), so warm-up
//                     timing — not just steady state — is resolution-independent.
//   sourceWidthFrac   fraction of grid width the seeded heat source spans.
//   sourceDepthFrac   fraction of grid height the heat source fills.
//   sourceIntensity   normalized source heat in (0, 1].
//
// The seeded source is the ONLY consumer of the effect's deterministic RNG;
// heat propagation (neighbour averaging + advection) is fully deterministic
// and contains no randomness.
export const FIRE_DEFAULTS = createEffectDefaults({
  render: { resolution: 0.25, smoothing: false },
  motion: { speed: 1 },
  appearance: {
    // Defensive 2-colour placeholder so a skinless resolve still validates. The
    // real classic ramp (black → burgundy → orange → yellow → near-white) lives
    // in skins.js and overrides this through the resolver merge.
    palette: ['#000000', '#ff7a00'],
    colorCount: 256,
    backgroundColor: '#000000'
  },
  simulation: {
    seed: 1993,
    stepHz: 60,
    sourceWidthFrac: 0.8,
    sourceDepthFrac: 0.06,
    sourceIntensity: 1.0,
    cooling: 0.25,
    riseFrac: 1.0,
    maxCatchUpSteps: 3
  }
});

/**
 * Validate the fully resolved fire configuration (heat-simulation fields).
 * Every field is normalized so the simulation stays resolution-independent.
 * @param {object} config
 */
export function validateFire(config) {
  const sim = config.simulation;
  assertNumber(sim.seed, 'fire.simulation.seed', { min: 0, max: 0xffffffff, integer: true });
  assertNumber(sim.stepHz, 'fire.simulation.stepHz', { min: 1, max: 240 });
  assertNumber(sim.sourceWidthFrac, 'fire.simulation.sourceWidthFrac', { min: 0.01, max: 1 });
  assertNumber(sim.sourceDepthFrac, 'fire.simulation.sourceDepthFrac', { min: 0.01, max: 0.5 });
  assertNumber(sim.sourceIntensity, 'fire.simulation.sourceIntensity', { min: 0, max: 1 });
  assertNumber(sim.cooling, 'fire.simulation.cooling', { min: 0, max: 1 });
  assertNumber(sim.riseFrac, 'fire.simulation.riseFrac', { min: 0.05, max: 4 });
  assertNumber(sim.maxCatchUpSteps, 'fire.simulation.maxCatchUpSteps', { min: 1, max: 20, integer: true });
}
