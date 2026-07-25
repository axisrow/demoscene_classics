import {
  buildGradientPalette,
  createPixelBuffer,
  getContext2D,
  presentPixelBuffer,
  resizePixelBuffer
} from '../utils.js';
import { defaultPoint, scalarContribution, smoothstep } from './config.js';

// Normalized metaballs renderer (issue #8).
//
// Geometry is NORMALIZED to [0, 1] viewport units (centres, radii, strengths);
// see config.js for the documented scalar-field model. The render buffer's
// resolution changes only how many samples the field is evaluated at — never
// where a centre sits or a relative radius.
//
// Aspect-correct distance: centres are stored as raw [0, 1] fractions, then
// mapped into ISOTROPIC (u, v) space measured in fractions of the SHORTER
// viewport side, so a configured circle stays circular in portrait AND
// landscape AND keeps the same relative size across aspect ratios:
//
//   minD = min(W, H)             sx = W / minD     sy = H / minD
//   u(sample) = nx * sx          v(sample) = ny * sy
//   u(centre) = cx * sx          v(centre) = cy * sy
//   r = sqrt(du*du + dv*dv)      // in min-side fractions — isotropic
//
// A blob of radius R is R*minD pixels across on BOTH axes, so it is circular
// (isotropic metric) and a fixed fraction of the shorter side in every
// orientation. Measuring in min-side fractions (not y-fractions) is what keeps
// the relative blob size stable when the aspect ratio flips. The per-sample
// u/v are precomputed once per resize (they depend only on buffer size + aspect).
//
// Field -> colour uses a SMOOTHSTEP THRESHOLD BAND (not a hard/saturating
// ramp): the summed field between two nearby balls rises continuously through
// the band, so they visibly form a neck and merge instead of staying separate
// bright disks. The band is bounded to [0, 1] regardless of strength, so large
// custom strengths clip gracefully (no broad clipped-white interiors).
export function createMetaballsRenderer({ canvas, config }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  const points = config.field.points ?? Array.from(
    { length: config.field.pointCount },
    (_, index) => defaultPoint(index)
  );
  // Isotropic centres for the current frame: uCentre = cx * sx, vCentre = cy * sy
  // (sx, sy = per-axis scales into min-side fractions). Recomputed each render
  // from the normalized trajectories.
  const uCentre = new Float32Array(points.length);
  const vCentre = new Float32Array(points.length);
  const pointStrength = new Float32Array(points.length);
  for (let i = 0; i < points.length; i++) {
    pointStrength[i] = points[i].strength * config.field.strength;
  }
  // Per-sample u/v grids, rebuilt on resize. They depend only on buffer size
  // and aspect (never on time), so lowering render.resolution resamples the
  // SAME normalized composition into fewer columns/rows.
  let uGrid = new Float32Array(0);
  let vGrid = new Float32Array(0);
  let sx = 1;
  let sy = 1;
  let outputWidth = 1;
  let outputHeight = 1;

  return {
    resize(nextWidth, nextHeight) {
      outputWidth = nextWidth;
      outputHeight = nextHeight;
      resizePixelBuffer(
        buffer,
        nextWidth * config.render.resolution,
        nextHeight * config.render.resolution
      );
      const w = buffer.width;
      const h = buffer.height;
      // Scale each axis into fractions of the SHORTER side so the metric is
      // isotropic and a radius is a fixed fraction of the shorter side in any
      // orientation. Cell-centre sampling (+0.5) keeps a blob centred in its
      // grid cell symmetrically.
      const minD = Math.min(w, h);
      sx = w / minD;
      sy = h / minD;
      uGrid = new Float32Array(w);
      vGrid = new Float32Array(h);
      for (let x = 0; x < w; x++) uGrid[x] = ((x + 0.5) / w) * sx;
      for (let y = 0; y < h; y++) vGrid[y] = ((y + 0.5) / h) * sy;
    },
    render({ time }) {
      const phase = time * 0.72 * config.motion.speed;
      const radius = config.field.radius;
      const edgeLow = config.field.threshold - config.field.mergeBand;
      const edgeHigh = config.field.threshold + config.field.mergeBand;

      // Normalized centres are pure functions of `time` (time-based, frame-rate
      // independent). centre = 0.5 + amplitude * sin(phase * freq + phase0),
      // mapped into isotropic (u, v).
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const cx = 0.5 + point.amplitudeX * Math.sin(phase * point.frequencyX + point.phaseX);
        const cy = 0.5 + point.amplitudeY * Math.sin(phase * point.frequencyY + point.phaseY);
        uCentre[i] = cx * sx;
        vCentre[i] = cy * sy;
      }

      const paletteMax = palette.length - 1;
      const n = points.length;
      let index = 0;
      for (let y = 0; y < buffer.height; y++) {
        const v = vGrid[y];
        for (let x = 0; x < buffer.width; x++) {
          const u = uGrid[x];
          // Sum the finite scalar contributions. The contribution is bounded at
          // every r (strength at r=0, decaying to 0), so `field` is always
          // finite — no infinities, no NaN, regardless of centre proximity.
          let field = 0;
          for (let i = 0; i < n; i++) {
            const du = u - uCentre[i];
            const dv = v - vCentre[i];
            field += scalarContribution(Math.sqrt(du * du + dv * dv), radius, pointStrength[i]);
          }
          // Smooth threshold band: continuous, monotonic, bounded to [0, 1].
          const t = smoothstep(edgeLow, edgeHigh, field);
          const paletteIndex = Math.min(paletteMax, Math.max(0, Math.round(t * paletteMax)));
          buffer.pixels[index++] = palette[paletteIndex];
        }
      }
      presentPixelBuffer(context, buffer, outputWidth, outputHeight, config.render.smoothing);
    }
  };
}
