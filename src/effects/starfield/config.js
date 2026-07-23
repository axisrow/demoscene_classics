import { assertNumber, createEffectDefaults } from '../../config.js';

// Starfield simulation geometry (issue #7).
//
// The simulation lives in a documented, finite, NORMALIZED 3D volume measured
// in logical (CSS) units — NOT in render-buffer pixels:
//
//   x ∈ [-halfWidth,  halfWidth]      (logical px, halfWidth == CSS width)
//   y ∈ [-halfHeight, halfHeight]     (logical px, halfHeight == CSS height)
//   z ∈ (nearZ, depth]                (world depth units)
//
// Only z changes between (re)spawns: it advances by `travelSpeed` WORLD units
// per second (time-based, independent of frame rate and of the backing-store
// resolution). x and y are sampled once at spawn and held until recycle. The
// render buffer's resolution only changes how many device pixels a projected
// star is rasterised into — never where it sits in the composition.
//
// Projection is a pinhole camera with an ISOTROPIC focal length `fov` measured
// in logical pixels:
//
//   px = x / z * fov + halfWidth  * centerX
//   py = y / z * fov + halfHeight * centerY
//
// Isotropic focal length means the corridor does NOT stretch with aspect ratio:
// the same star cluster stays the same shape in landscape and portrait; only
// the cropped frame changes. The horizontal and vertical full FOVs therefore
// differ on a non-square frame (2·atan(halfExtent / (fov·nearZ))), exactly like
// a real camera. This deliberately rejects an "equal H+V angular FOV" model,
// which would distort the corridor into an ellipse.
//
// `particleCount` is an explicit absolute cap. `densityMode: 'area'` optionally
// derives the count from the viewport area and clamps it to
// [densityMin, densityMax]; see resolveParticleCount() in renderer.js. The
// default profile keeps `densityMode: 'explicit'` with `particleCount: 600`, so
// the fullscreen/desktop budget is explicit and benchmarked.
export const STARFIELD_DEFAULTS = createEffectDefaults({
  render: { resolution: 1, smoothing: true },
  motion: { speed: 1 },
  appearance: {
    palette: ['#b4c8ff', '#ffffff'],
    colorCount: 256,
    backgroundColor: '#000000',
    // Trail appearance (skin-owned per issue #7). trailFade is the per-frame
    // background alpha used to fade the previous frame's streaks; minAlpha/
    // maxAlpha and minLineWidth/maxLineWidth map projected depth (near=bright
    // and thick, far=dim and thin). Trails stay readable and bounded at the
    // 1.5 s and 5 s captures without turning the background grey/white.
    trailFade: 0.35,
    minAlpha: 0.25,
    maxAlpha: 0.95,
    minLineWidth: 1,
    maxLineWidth: 3
  },
  particles: {
    seed: 1993,
    particleCount: 600,
    // Density budget. 'explicit' honours particleCount verbatim (default).
    // 'area' derives count = clamp(round(densityPerUnitArea * area / 1000),
    // densityMin, densityMax) where area is the CSS viewport area; the renderer
    // resolves this once at resize so the seed sequence stays stable.
    densityMode: 'explicit',
    densityPerUnitArea: 0.4,
    densityMin: 80,
    densityMax: 1200,
    // Projection / motion identity.
    nearZ: 1,
    fov: 256,
    depth: 256,
    travelSpeed: 192,
    centerX: 0.5,
    centerY: 0.5,
    // A star is recycled when its projected position leaves the frame expanded
    // by this many logical pixels on every side, so streaks that graze the edge
    // are preserved but particles that have left the useful field are recycled
    // instead of accumulating off-screen.
    cullMargin: 8
  }
});

/**
 * Validate the fully resolved starfield configuration.
 * @param {object} config
 */
export function validateStarfield(config) {
  assertNumber(config.particles.seed, 'starfield.particles.seed', { min: 0, max: 0xffffffff, integer: true });
  assertNumber(config.particles.particleCount, 'starfield.particles.particleCount', { min: 1, max: 10000, integer: true });
  if (!['explicit', 'area'].includes(config.particles.densityMode)) {
    throw new RangeError(`starfield.particles.densityMode must be 'explicit' or 'area'.`);
  }
  assertNumber(config.particles.densityPerUnitArea, 'starfield.particles.densityPerUnitArea', { min: 0 });
  assertNumber(config.particles.densityMin, 'starfield.particles.densityMin', { min: 1, max: 10000, integer: true });
  assertNumber(config.particles.densityMax, 'starfield.particles.densityMax', { min: config.particles.densityMin, integer: true });
  assertNumber(config.particles.nearZ, 'starfield.particles.nearZ', { min: Number.MIN_VALUE, max: config.particles.depth });
  for (const key of ['fov', 'depth', 'travelSpeed']) {
    assertNumber(config.particles[key], `starfield.particles.${key}`, { min: Number.MIN_VALUE });
  }
  for (const key of ['centerX', 'centerY']) {
    assertNumber(config.particles[key], `starfield.particles.${key}`, { min: 0, max: 1 });
  }
  assertNumber(config.particles.cullMargin, 'starfield.particles.cullMargin', { min: 0 });

  // Trail appearance (skin-owned).
  assertNumber(config.appearance.trailFade, 'starfield.appearance.trailFade', { min: 0, max: 1 });
  assertNumber(config.appearance.minAlpha, 'starfield.appearance.minAlpha', { min: 0, max: 1 });
  assertNumber(config.appearance.maxAlpha, 'starfield.appearance.maxAlpha', { min: 0, max: 1 });
  if (config.appearance.maxAlpha < config.appearance.minAlpha) {
    throw new RangeError('starfield.appearance.maxAlpha must be at least minAlpha.');
  }
  assertNumber(config.appearance.minLineWidth, 'starfield.appearance.minLineWidth', { min: Number.MIN_VALUE });
  assertNumber(config.appearance.maxLineWidth, 'starfield.appearance.maxLineWidth', { min: config.appearance.minLineWidth });
}

/**
 * Resolve the active particle budget from the resolved config and the CSS
 * viewport area. 'explicit' returns particleCount unchanged; 'area' derives the
 * count from area and clamps it to [densityMin, densityMax]. Pure and
 * deterministic: the same (config, area) always yields the same count.
 * @param {object} particles - the resolved config.particles group.
 * @param {number} area - the CSS viewport area (logicalWidth * logicalHeight).
 * @returns {number}
 */
export function resolveParticleCount(particles, area) {
  if (particles.densityMode !== 'area') return particles.particleCount;
  const derived = Math.round(particles.densityPerUnitArea * Math.max(0, area) / 1000);
  return Math.min(particles.densityMax, Math.max(particles.densityMin, derived));
}
