import { assertBoolean, assertNumber, createEffectDefaults } from '../../config.js';

// Rotozoom texture + transform geometry is expressed in NORMALIZED TEXTURE /
// VIEWPORT coordinates, never in render-buffer pixels (issue #12). The renderer
// maps each buffer cell to a normalized viewport point (nx, ny) in [0,1]²,
// applies an aspect-corrected rotation/zoom around a documented centre, scales
// the result into texture-tile units, and takes the fractional part to wrap
// seamlessly across an INTENTIONALLY TILEABLE periodic texture.
//
// Because the texture is a pure function of the wrapped texture coordinate
// (tu, tv) and the transform is a pure function of (nx, ny, time), changing
// `render.resolution` — which only changes how many buffer cells sample the
// transform — can never alter the texture scale, transform centre, rotation
// speed, or zoom phase. Resolution is sampling density only.
//
// Texture identity (tile count, lattice frequencies, transform centre, rotation
// and zoom motion) lives HERE in config.js. Palette / background / tonal curve
// live in skins.js (appearance only). Profiles tune `render.resolution` only.
//
// The texture lattice is INTENTIONALLY TILEABLE: each component is a sinusoid
// evaluated at INTEGER cycle counts across one tile period, so the field is
// seamless at the u=0/u=1 and v=0/v=1 edges (and everywhere the fractional
// coordinate wraps). There is deliberately NO radial term pinned to the texture
// centre — that is what produced the old accidental centre disk / bullseye.
export const ROTOZOOM_DEFAULTS = createEffectDefaults({
  render: { resolution: 0.5, smoothing: true },
  motion: {
    speed: 1,
    // Rotation in TURNS PER SECOND (one turn = 2π). Time-based, so the angle at
    // elapsed time t is speed·rotationSpeed·t regardless of FPS.
    rotationSpeed: 0.12,
    // Zoom is a bounded time-based sinusoid: zoomBase ± zoomAmplitude, clamped
    // to [zoomMin, ∞). It never touches frame count or buffer size.
    zoomBase: 1.0,
    zoomAmplitude: 0.55,
    zoomSpeed: 0.28,
    zoomMin: 0.25
  },
  appearance: {
    // `contrast` is an appearance-only gamma applied to the normalized texture
    // value before palette lookup (see renderer.js). The classic skin overrides
    // it; the default here is a neutral 1.0 (no reshaping).
    contrast: 1
  },
  transform: {
    // Centre of rotation/zoom in normalized viewport [0,1]². (0.5, 0.5) is the
    // geometric centre. A documented landmark — not derived from buffer pixels.
    centerX: 0.5,
    centerY: 0.5,
    // Correct the horizontal axis by the viewport aspect so the tile motif
    // stays square (not stretched) across landscape and portrait.
    aspectCorrection: true
  },
  texture: {
    // Number of whole texture tiles repeated across one viewport HEIGHT. The
    // transform maps viewport units to texture-tile units by `tiles`, so the
    // tile scale depends on viewport extent (a composition choice), never on
    // backing-buffer pixels.
    tiles: 5,
    // INTEGER cycle counts of the sine lattice across one tile. Integer counts
    // guarantee seamlessness at the tile wrap. Two near-odd coprime frequencies
    // produce a diagonal interference lattice that reads at many orientations
    // without a dominant centre.
    frequencyU: 3,
    frequencyV: 2,
    // Relative weight of the three lattice components: horizontal, vertical,
    // and the diagonal sum (u+v). All in [0,1]; they shape the motif only.
    weightU: 1,
    weightV: 1,
    weightDiag: 0.6
  }
});

/**
 * Validate the fully resolved rotozoom configuration (transform + texture
 * geometry + motion). Appearance (palette, background, contrast) lives in
 * skins.js and is validated by the shared appearance validator.
 * @param {object} config
 */
export function validateRotozoom(config) {
  for (const key of ['rotationSpeed', 'zoomSpeed', 'zoomAmplitude']) {
    assertNumber(config.motion[key], `rotozoom.motion.${key}`, { min: 0 });
  }
  assertNumber(config.motion.zoomBase, 'rotozoom.motion.zoomBase', { min: 0 });
  assertNumber(config.motion.zoomMin, 'rotozoom.motion.zoomMin', { min: Number.MIN_VALUE, max: 1 });
  assertNumber(config.appearance.contrast, 'rotozoom.appearance.contrast', { min: Number.MIN_VALUE, max: 4 });
  assertBoolean(config.transform.aspectCorrection, 'rotozoom.transform.aspectCorrection');
  for (const key of ['centerX', 'centerY']) {
    assertNumber(config.transform[key], `rotozoom.transform.${key}`, { min: 0, max: 1 });
  }
  assertNumber(config.texture.tiles, 'rotozoom.texture.tiles', { min: 0.5 });
  // Integer frequencies guarantee a seamless tile; reject fractional counts so
  // a misconfigured skin cannot silently introduce a wrap seam.
  for (const key of ['frequencyU', 'frequencyV']) {
    assertNumber(config.texture[key], `rotozoom.texture.${key}`, { min: 1, max: 32, integer: true });
  }
  for (const key of ['weightU', 'weightV', 'weightDiag']) {
    assertNumber(config.texture[key], `rotozoom.texture.${key}`, { min: 0, max: 1 });
  }
}
