import { assertNumber, assertString, createEffectDefaults } from '../../config.js';

// Tunnel polar/depth geometry (issue #9).
//
// The tunnel is sampled in an aspect-correct, resolution-independent NORMALIZED
// polar frame. The renderer recovers the CSS viewport from the device pixels
// the runtime hands it (`cssW = deviceWidth / pixelRatio`) and derives every
// geometric quantity from a single dimensionless master coordinate:
//
//   u = normalized radius = (Euclidean CSS distance from vanishing point)
//                            / refR
//
// where `refR` is the CSS distance from the vanishing point to the NEAREST
// viewport edge. `u ~= 0` at the vanishing point (the far end of the corridor)
// and `u ~= 1` at the nearest frame edge. Because the numerator is an isotropic
// CSS distance and `refR` is a single CSS length, a wall band at a given `u` is
// a true circle in both landscape and portrait -- only the cropped frame
// differs. `render.resolution` and `pixelRatio` cancel out of `u`, so changing
// them resamples the identical composition into a different pixel count and
// never moves a wall band or the vanishing point.
//
// Depth is a GUARDED bounded inverse of radius:
//
//   depth = r <= nearEpsilon*refR ? 1 : min(farClamp, (nearEpsilon*refR) / r)
//
// It is finite everywhere (capped to 1 on the central disk so the singularity
// never strobes), monotonic toward the centre (bands compress toward the
// vanishing point = correct perspective), and bounded by `farClamp`.
// `nearEpsilon` is the explicit near-centre epsilon. The renderer keeps it as a
// float in buffer pixels so the depth ratio `epsBuf / rBuf` is exactly
// resolution-independent (both terms scale with the sampling buffer); the
// central disk (r <= epsBuf) is capped to depth 1 so the singularity never
// strobes.
//
// Every value below is SEMANTIC: wallFrequency is dimensionless cycles (not
// per-pixel), fogNear/fogFar are in `u`, fogStrength in [0,1]. forwardSpeed,
// rotationSpeed and colorCycleSpeed are per-second and drive `delta`-based
// accumulators, so lower FPS never changes depth or speeds up travel.

export const TUNNEL_DEFAULTS = createEffectDefaults({
  render: { resolution: 1 / 3, smoothing: false },
  motion: { speed: 1, forwardSpeed: 0.9, rotationSpeed: 0.25, colorCycleSpeed: 0.12 },
  appearance: {
    palette: ['#ff80ee', '#60dfff', '#ffe86b', '#ff80ee'],
    colorCount: 256,
    backgroundColor: '#000000',
    // Fog tint toward which the receding centre blends (skin-owned). Dark navy
    // so the centre reads as the corridor receding into shadow, not blanking.
    fogColor: '#05030f'
  },
  geometry: {
    // Vanishing point in [0,1] of the CSS viewport.
    centerX: 0.5,
    centerY: 0.5,
    // Wall texture: cycles per unit depth (dimensionless) and half-cycle lobes
    // around the ring. Low frequencies to resist shimmer at coarse sampling.
    wallFrequency: 2.4,
    angularFrequency: 3,
    // Guarded inverse-radius depth. nearEpsilon in units of u; farClamp >= 1 is
    // the documented hard upper bound on depth (safety; the clamp already caps
    // depth at 1 on the central disk).
    nearEpsilon: 0.12,
    farClamp: 6.0,
    // Fog band, in units of u. Fog is at full strength for u <= fogNear (the
    // deep centre) and zero for u >= fogFar (the clear near wall).
    fogNear: 0.12,
    fogFar: 0.9,
    // [0,1] maximum fog blend. < 1 keeps the centre tinted toward fogColor
    // rather than blanking, so the vanishing region never collapses to a flat
    // pastel.
    fogStrength: 0.85
  }
});

/**
 * Validate the fully resolved tunnel configuration (normalized polar/depth +
 * motion fields). Mirrors the starfield validation style.
 * @param {object} config
 */
export function validateTunnel(config) {
  for (const key of ['forwardSpeed', 'rotationSpeed', 'colorCycleSpeed']) {
    assertNumber(config.motion[key], `tunnel.motion.${key}`, { min: 0 });
  }
  for (const key of ['centerX', 'centerY']) {
    assertNumber(config.geometry[key], `tunnel.geometry.${key}`, { min: 0, max: 1 });
  }
  assertNumber(config.geometry.wallFrequency, 'tunnel.geometry.wallFrequency', { min: 0, max: 8 });
  assertNumber(config.geometry.angularFrequency, 'tunnel.geometry.angularFrequency', { min: 0, max: 12 });
  assertNumber(config.geometry.nearEpsilon, 'tunnel.geometry.nearEpsilon', { min: Number.MIN_VALUE, max: 2 });
  assertNumber(config.geometry.farClamp, 'tunnel.geometry.farClamp', { min: 1 });
  assertNumber(config.geometry.fogNear, 'tunnel.geometry.fogNear', { min: 0, max: 2 });
  assertNumber(config.geometry.fogFar, 'tunnel.geometry.fogFar', { min: 0, max: 2 });
  if (config.geometry.fogFar <= config.geometry.fogNear) {
    throw new RangeError('tunnel.geometry.fogFar must be greater than fogNear.');
  }
  assertNumber(config.geometry.fogStrength, 'tunnel.geometry.fogStrength', { min: 0, max: 1 });
  assertString(config.appearance.fogColor, 'tunnel.appearance.fogColor');
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(config.appearance.fogColor)) {
    throw new TypeError('tunnel.appearance.fogColor must use #rgb or #rrggbb.');
  }
}
