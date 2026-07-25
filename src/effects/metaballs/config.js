import { assertNumber, createEffectDefaults } from '../../config.js';

// Metaballs scalar-field geometry (issue #8).
//
// The simulation lives in a documented, finite, NORMALIZED viewport space —
// NOT in render-buffer pixels:
//
//   centres   cx, cy ∈ [0, 1]   along Lissajous-style phase trajectories
//   radius    ∈ (0, 1]          normalized blob radius (relative size survives
//                               resolution/aspect changes)
//   strength  ∈ (0, ∞)          peak scalar contribution at a centre
//
// The render buffer's resolution only changes how many device pixels the field
// is SAMPLED into — never where a centre sits, never a relative radius, never
// the merge timing. At a fixed timestamp, lowering render.resolution must
// produce the same normalized composition, only coarser.
//
// Aspect-correct distance (a configured blob stays circular in portrait and
// landscape AND keeps the same relative size across aspect ratios). Every
// normalized sample and centre is mapped into ISOTROPIC (u, v) space measured
// in fractions of the SHORTER viewport side, with minD = min(W, H):
//
//   sx = W / minD     sy = H / minD
//   u = nx * sx       v = ny * sy       (sample)
//   u = cx * sx       v = cy * sy       (centre)
//   r = sqrt(du*du + dv*dv)             (in min-side fractions — isotropic)
//
// Measuring in min-side fractions (not y-fractions) keeps the relative blob
// size stable when the aspect ratio flips: a blob of radius R is R*minD pixels
// across on BOTH axes, so it is circular and a fixed fraction of the shorter
// side in every orientation. This is the isotropic-distance idea the plasma
// effect (issue #5) and starfield (issue #7) also rely on. The scale is applied
// at evaluation time, so centres are stored in raw [0, 1] and the distance is
// resolution-independent (it depends only on the aspect ratio, never pixel count).
//
// Finite scalar contribution (epsilon / near-centre guard — no infinities, no
// resolution-dependent constants):
//
//   contribution(r) = strength / (1 + (r / radius)^2)
//
// The `1 +` makes the value FINITE at the centre r = 0 (it equals `strength`)
// and the radius scaling is unitless. Summing contributions over all balls
// yields the field f, which is then mapped through a smooth threshold band.

export const METABALLS_DEFAULTS = createEffectDefaults({
  render: { resolution: 1 / 3, smoothing: false },
  motion: { speed: 1 },
  field: {
    pointCount: 5,
    points: null,
    // Normalized field geometry. These four values are the algorithmic identity
    // of the effect: they define relative blob size, peak field, where a body
    // begins, and how softly two balls merge. Profiles may change pointCount /
    // sampling, but must NOT override these (so relative radius + trajectory
    // envelope are identical across all four responsive slots).
    radius: 0.18,        // normalized blob radius
    strength: 1,         // peak scalar contribution at a centre
    threshold: 1,        // field level where a body begins (smoothstep edge)
    mergeBand: 0.6       // smoothstep half-width → neck/merge softness
  }
});

// Trajectory keys accepted per point. Amplitudes are normalized offsets from
// the viewport centre (0.5) so a centre stays in [0, 1]
// (centre = 0.5 + amplitude * sin(...)); per-point strength is an optional
// multiplier on field.strength.
const POINT_KEYS = new Set([
  'amplitudeX', 'amplitudeY', 'frequencyX', 'frequencyY',
  'phaseX', 'phaseY', 'strength'
]);

/**
 * Pre-merge check on raw caller input: pointCount and points are mutually
 * exclusive (the renderer derives pointCount from points when both are given).
 * @param {string} name
 * @param {object} explicit
 */
export function validateMetaballsInput(name, explicit) {
  if (explicit?.field?.points !== undefined && explicit?.field?.pointCount !== undefined) {
    throw new RangeError(`${name}.field.pointCount and ${name}.field.points cannot be used together.`);
  }
}

/**
 * Validate the fully resolved metaballs configuration (normalized scalar-field
 * geometry). Note: pointCount/points mutual exclusion is checked at the
 * descriptor level (caller input), while here we normalise the resolved shape.
 * @param {object} config
 */
export function validateMetaballs(config) {
  assertNumber(config.field.pointCount, 'metaballs.field.pointCount', { min: 1, max: 64, integer: true });
  // Normalized geometry: radius in (0,1], strength/threshold/band strictly
  // positive so the field is non-degenerate and the smoothstep band is open.
  assertNumber(config.field.radius, 'metaballs.field.radius', { min: Number.MIN_VALUE, max: 1 });
  for (const key of ['strength', 'threshold', 'mergeBand']) {
    assertNumber(config.field[key], `metaballs.field.${key}`, { min: Number.MIN_VALUE });
  }
  if (config.field.points !== null) {
    if (!Array.isArray(config.field.points) || config.field.points.length < 1 || config.field.points.length > 64) {
      throw new RangeError('metaballs.field.points must contain between 1 and 64 points.');
    }
    config.field.points.forEach((point, index) => {
      if (point === null || typeof point !== 'object' || Array.isArray(point)) {
        throw new TypeError(`metaballs.field.points[${index}] must be an object.`);
      }
      for (const key of Object.keys(point)) {
        if (!POINT_KEYS.has(key)) throw new RangeError(`Unknown option: metaballs.field.points[${index}].${key}`);
      }
      // Amplitudes are normalized offsets from centre (0.5); keep them in
      // [0, 1] so a trajectory stays within the viewport.
      for (const key of ['amplitudeX', 'amplitudeY']) {
        assertNumber(point[key], `metaballs.field.points[${index}].${key}`, { min: 0, max: 1 });
      }
      for (const key of ['frequencyX', 'frequencyY', 'phaseX', 'phaseY']) {
        assertNumber(point[key], `metaballs.field.points[${index}].${key}`, { min: -Infinity });
      }
      assertNumber(point.strength, `metaballs.field.points[${index}].strength`, { min: Number.MIN_VALUE });
    });
    config.field.pointCount = config.field.points.length;
  }
}

/**
 * Smoothstep over [edgeLow, edgeHigh]: continuous, monotonic, bounded to [0, 1].
 * Used by the renderer to map the summed scalar field to a palette position so
 * nearby balls visibly attract/merge through a shared field instead of popping
 * in as separate disks. Exposed for unit tests of the threshold mapping.
 * @param {number} edgeLow
 * @param {number} edgeHigh
 * @param {number} value
 * @returns {number}
 */
export function smoothstep(edgeLow, edgeHigh, value) {
  if (edgeHigh <= edgeLow) return value >= edgeHigh ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - edgeLow) / (edgeHigh - edgeLow)));
  return t * t * (3 - 2 * t);
}

/**
 * A single ball's scalar contribution at normalized aspect-corrected distance
 * `r`. Documented and finite at every r (including r = 0): the `1 +` in the
 * denominator bounds the peak to `strength`. Exposed for unit tests.
 * @param {number} r       distance in normalized aspect-corrected units
 * @param {number} radius  normalized blob radius
 * @param {number} strength peak contribution
 * @returns {number}
 */
export function scalarContribution(r, radius, strength) {
  const k = r / radius;
  return strength / (1 + k * k);
}

/**
 * Default per-point Lissajous trajectory parameters. Amplitudes are normalized
 * offsets from the viewport centre (0.5), kept ≤ 0.5 so each trajectory stays
 * on-screen; frequencies/phases spread the balls across the field; per-point
 * strength is uniform (relative radii preserved). Deterministic in `index` —
 * no randomness, no time-of-day, no pixel sizes.
 * @param {number} index
 * @returns {object}
 */
export function defaultPoint(index) {
  return {
    amplitudeX: 0.30 + Math.min(0.18, index * 0.06),
    amplitudeY: 0.36 + Math.min(0.12, index * 0.05),
    frequencyX: 0.8 + index * 0.27,
    frequencyY: 1.1 + index * 0.21,
    phaseX: 0.7 + index * 1.7,
    phaseY: 1.3 + index * 1.3,
    strength: 1
  };
}
