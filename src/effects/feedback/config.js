import { assertNumber, createEffectDefaults } from '../../config.js';

// Feedback config (API v3, issue #13).
//
// The feedback loop is a BOUNDED two-buffer ping-pong: each step reads the
// previous frame from one offscreen buffer, writes the next frame to the other,
// then swaps them. The previous frame is composited back under a bounded
// `source-over` alpha so its contribution can never exceed the frame's own
// alpha; additive (`lighter`) blending is reserved for the newly drawn polygon
// geometry only. This replaces the legacy self-additive recursion that read from
// and drew into the same canvas under `lighter` and saturated the background.
//
// Frame-rate independence: every per-step feedback coefficient is derived from a
// PER-SECOND quantity exponentiated by the elapsed `delta` (seconds), so a 24,
// 30, or 60 FPS schedule that advances the same wall-clock time produces
// comparable trail persistence. The renderer never samples by frame count.
//
// Normalization: pointer/touch positions and the orbit centre are stored in
// normalized viewport coordinates [0, 1]; polygon radius, blur width, stroke
// width, and orbit displacement are expressed as fractions of the buffer's short
// side, so geometry is independent of `render.resolution` and backing-pixel
// dimensions. Profiles may lower `render.resolution` (sampling cost) and tune
// runtime budgets without changing the composition.

export const FEEDBACK_DEFAULTS = createEffectDefaults({
  render: { resolution: 1, smoothing: true },
  motion: {
    speed: 1,
    orbitSpeedX: 0.6,
    orbitSpeedY: 0.7,
    polygonRotationSpeed: 1,
    passRotationStep: 0.3,
    colorCycleSpeed: 0.17
  },
  appearance: {
    palette: ['#ff58d6', '#5ca8ff', '#60ffd0', '#ffe66d', '#ff58d6'],
    colorCount: 360,
    backgroundColor: '#000005',
    strokeAlpha: 0.9
  },
  geometry: {
    sides: 5,
    passes: 3,
    // Radius of the polygon ring, as a fraction of the buffer short side.
    radius: 0.085,
    radiusOscillation: 0.03,
    radiusOscillationSpeed: 3,
    passSpacing: 0.02,
    // Stroke and glow widths, as fractions of the buffer short side.
    strokeWidth: 0.004,
    shadowBlur: 0.04,
    // Orbit displacement of the input centre, as fractions of short side.
    orbitX: 0.18,
    orbitY: 0.18
  },
  feedback: {
    // Fraction of the previous frame's luminance retained after one second of
    // decay. Exponentiated by `delta` per step, so persistence is comparable
    // across FPS schedules. Below 1 this strictly bounds accumulation: a pixel
    // can never grow brighter than its source contributions allow.
    decayPerSecond: 0.45,
    // Scale of the previous frame after one second of zoom (per-second).
    scalePerSecond: 0.9,
    // Rotation applied to the previous frame over one second, in radians.
    rotationPerSecond: 0.7,
    // How much of the dim background tint survives into the next frame, in
    // [0, 1]. Bounds the darkest the trail can settle to without forcing an
    // exact pixel value.
    backgroundRetention: 0.0
  }
});

/**
 * Validate the fully resolved feedback configuration (polygon geometry + the
 * bounded ping-pong feedback loop). Geometric quantities are normalized short-
 * side fractions in [0, 1]; decay/scale coefficients are per-second bounds.
 * @param {object} config
 */
export function validateFeedback(config) {
  for (const key of ['orbitSpeedX', 'orbitSpeedY', 'polygonRotationSpeed', 'passRotationStep', 'colorCycleSpeed']) {
    assertNumber(config.motion[key], `feedback.motion.${key}`);
  }
  assertNumber(config.appearance.strokeAlpha, 'feedback.appearance.strokeAlpha', { min: 0, max: 1 });
  assertNumber(config.geometry.sides, 'feedback.geometry.sides', { min: 3, max: 64, integer: true });
  assertNumber(config.geometry.passes, 'feedback.geometry.passes', { min: 1, max: 32, integer: true });
  // Normalized short-side fractions: strictly positive and capped at 1.
  for (const key of ['radius', 'radiusOscillation', 'passSpacing', 'strokeWidth', 'shadowBlur']) {
    assertNumber(config.geometry[key], `feedback.geometry.${key}`, { min: 0, max: 1 });
  }
  // Oscillation speed is a per-second angular rate, not a normalized fraction.
  assertNumber(config.geometry.radiusOscillationSpeed, 'feedback.geometry.radiusOscillationSpeed', { min: 0 });
  for (const key of ['orbitX', 'orbitY']) {
    assertNumber(config.geometry[key], `feedback.geometry.${key}`, { min: 0, max: 1 });
  }
  // Bounded per-second feedback coefficients. decayPerSecond/scalePerSecond
  // live in (0, 1]: 0 would blank every frame and > 1 reintroduces unbounded
  // accumulation, so the validation rejects both.
  assertNumber(config.feedback.decayPerSecond, 'feedback.feedback.decayPerSecond', { min: Number.MIN_VALUE, max: 1 });
  assertNumber(config.feedback.scalePerSecond, 'feedback.feedback.scalePerSecond', { min: Number.MIN_VALUE, max: 1 });
  assertNumber(config.feedback.rotationPerSecond, 'feedback.feedback.rotationPerSecond');
  assertNumber(config.feedback.backgroundRetention, 'feedback.feedback.backgroundRetention', { min: 0, max: 1 });
}
