import {
  buildGradientPalette,
  createPixelBuffer,
  getContext2D,
  presentPixelBuffer,
  resizePixelBuffer
} from '../utils.js';

// Plasma evaluates its field in NORMALIZED VIEWPORT COORDINATES (issue #5), not
// in render-buffer pixels. Each buffer cell is mapped to a viewport-space sample
// point, the four field components are summed there, and the result indexes the
// palette. Because the field is a pure function of (u, v, time), changing
// `render.resolution` (which only changes how many cells sample the field) can
// never alter the field's scale, centre, wavelength, or animation speed.
export function createPlasmaRenderer({ canvas, config }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  const { field, motion, render, appearance } = config;

  // Sum of absolute amplitudes normalises the field into [-1, +1] for palette
  // lookup. It depends only on geometry (config), never on resolution.
  const totalAmplitude = field.amplitudes.reduce((sum, item) => sum + Math.abs(item), 0) || 1;

  // Appearance-only contrast curve (gamma), applied to the normalised field
  // value before palette indexing; it reshapes tonal distribution and never
  // touches the field geometry. The value is always in [0, 1], so raising it to
  // any positive power keeps it in [0, 1] — it can never clip to a single flat
  // band. gamma < 1 opens up the shadow band; gamma > 1 compresses midtones
  // toward the highlights. The validator admits (0, 4]; we honour the whole
  // range (a finite positive fallback of 1 guards a malformed value).
  const contrast = Number.isFinite(appearance.contrast) && appearance.contrast > 0
    ? appearance.contrast
    : 1;
  const twoPi = Math.PI * 2;
  const motionPhaseScale = 1.2;

  let width = 1;
  let height = 1;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resizePixelBuffer(buffer, width * render.resolution, height * render.resolution);
    },
    render({ time }) {
      const scaledTime = time * motion.speed;
      const phase = scaledTime * motionPhaseScale;
      // Palette scroll is time-based, so the cycle is deterministic and
      // frame-rate independent (same time → same offset).
      const paletteOffset = Math.floor(scaledTime * motion.paletteCycleSpeed * palette.length);
      const paletteLen = palette.length;

      const w = buffer.width;
      const h = buffer.height;
      const aspect = w / h;
      const aspectU = field.aspectCorrection ? aspect : 1;
      const radialCx = field.radialCenterX;
      const radialCy = field.radialCenterY;

      const f0 = field.frequencies[0] * twoPi;
      const f1 = field.frequencies[1] * twoPi;
      const f2 = field.frequencies[2] * twoPi;
      const f3 = field.frequencies[3] * twoPi;
      const a0 = field.amplitudes[0];
      const a1 = field.amplitudes[1];
      const a2 = field.amplitudes[2];
      const a3 = field.amplitudes[3];
      const pr0 = phase * field.phaseRates[0];
      const pr1 = phase * field.phaseRates[1];
      const pr2 = phase * field.phaseRates[2];
      const pr3 = phase * field.phaseRates[3];

      // Precompute the per-column u coordinate (aspect-corrected viewport x).
      // u and v are in viewport-height units: v spans [-0.5, +0.5] over the
      // height; u spans [-aspect/2, +aspect/2] so Euclidean radius is true.
      const uColumn = new Float64Array(w);
      for (let x = 0; x < w; x++) {
        uColumn[x] = ((x + 0.5) / w - 0.5) * aspectU;
      }

      const normScale = 1 / (totalAmplitude * 2);
      let index = 0;
      for (let y = 0; y < h; y++) {
        const v = (y + 0.5) / h - 0.5;
        for (let x = 0; x < w; x++) {
          const u = uColumn[x];

          // Axis wave (horizontal), axis wave (vertical).
          let value = Math.sin(f0 * u + pr0) * a0;
          value += Math.sin(f1 * v + pr1) * a1;
          // Diagonal / interference term.
          value += Math.sin(f2 * (u + v) + pr2) * a2;
          // Radial term, centred at the normalized radial origin. The radius is
          // a true Euclidean distance (viewport-height units) so the rings stay
          // circular across aspect ratios.
          const dx = u + (0.5 - radialCx) * aspectU;
          const dy = v + (0.5 - radialCy);
          value += Math.sin(f3 * Math.sqrt(dx * dx + dy * dy) + pr3) * a3;

          // Normalise to [0, 1] then apply the appearance-only contrast curve.
          let normalized = (value + totalAmplitude) * normScale;
          if (contrast !== 1 && normalized > 0) {
            normalized = Math.pow(normalized, contrast);
          }
          const fieldIndex = normalized <= 0
            ? 0
            : normalized >= 1
              ? paletteLen - 1
              : (normalized * paletteLen) | 0;

          buffer.pixels[index++] = palette[(fieldIndex + paletteOffset) % paletteLen];
        }
      }
      presentPixelBuffer(context, buffer, width, height, render.smoothing);
    }
  };
}
