// Continuous escape-time colouring for the Mandelbrot set (issue #10).
//
// This module owns the algorithmic identity shared by BOTH render backends
// (Canvas 2D in renderer.js and WebGL2 in mandelbrot-webgl.js):
//   - the camera/auto-zoom function `mandelbrotZoom`,
//   - the complex-plane pixel→point mapping,
//   - the escape-time iteration loop and bailout,
//   - the continuous normalized escape value + palette-coordinate formula.
//
// The WebGL fragment shader in mandelbrot-webgl.js mirrors the smooth-iteration
// and palette-coordinate math here EXACTLY (same guards, same constants, same
// ramp wrap). When you change the formula, update the GLSL too — the parity
// test in tests/library.test.js asserts the guarded expressions appear verbatim
// in the shader source.

const LOG2 = Math.log(2);

// Defaults for the continuous-coloring appearance knobs. The renderer reads
// these from `config.appearance`, but `renderMandelbrotPixels` is also called
// directly by tests/benchmark with a hand-built config that may omit them, so
// every read falls back to these identity values.
const DEFAULT_COLOR_SCALE = 1;
const DEFAULT_COLOR_CURVE = 1;
const DEFAULT_COLOR_OFFSET = 0;
const DEFAULT_CYCLE_SPEED = 0;

export function mandelbrotZoom(time, {
  minZoom,
  maxZoom,
  cycleSeconds,
  startPhase
}) {
  const phase = ((time / cycleSeconds + startPhase) % 1 + 1) % 1;
  const wave = (Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1) / 2;
  const eased = wave * wave * (3 - 2 * wave);
  const minimumExponent = Math.log10(minZoom);
  const maximumExponent = Math.log10(maxZoom);
  return 10 ** (minimumExponent + eased * (maximumExponent - minimumExponent));
}

function isMainInterior(real, imaginary) {
  const shifted = real - 0.25;
  const q = shifted * shifted + imaginary * imaginary;
  return q * (q + shifted) <= 0.25 * imaginary * imaginary
    || (real + 1) * (real + 1) + imaginary * imaginary <= 0.0625;
}

/**
 * Map a continuous normalized escape value to a gradient-palette index. This is
 * the SINGLE source of truth for the colouring formula shared by Canvas 2D and
 * WebGL (the GLSL fragment shader mirrors it line for line).
 *
 * The old code did `palette[abs(floor(smooth * 8)) % palette.length]`, which
 * chopped the continuous escape value into eight hard repeating bands per
 * iteration unit. The replacement here is a continuous ramp:
 *   - `logZn`/`nu` are GUARDED so a degenerate escape magnitude can never feed
 *     a NaN/`-Infinity` into the palette lookup. With the default escapeRadius
 *     of 16 the escaped `mag2 ≥ 256`, so both guards are inert; they exist to
 *     keep the lookup NaN-proof if a caller lowers the escape radius or if the
 *     perturbation path (WebGL) lands an imprecise magnitude.
 *   - the only remaining "modulo" is `coord - floor(coord)`, a continuous
 *     fractional wrap into [0,1) that walks the gradient palette as a smooth
 *     cyclic ramp (the palette itself is a continuous gradient), not a band chop.
 *
 * @param {object} args
 * @param {number} args.iteration      iterations spent before escape (1-based)
 * @param {number} args.mag2           final escaped |z|^2 = zr^2 + zi^2
 * @param {number} args.colorScale     ramp density (replaces the old `*8`)
 * @param {number} args.colorCurve     contrast/gamma on the normalised coordinate
 * @param {number} args.cyclePhase     colour cycling phase (offset + time drift)
 * @param {number} args.paletteLength  gradient palette width
 * @returns {number} finite index into the gradient palette, in [0, paletteLength-1]
 */
export function mandelbrotPaletteIndex({
  iteration,
  mag2,
  colorScale,
  colorCurve,
  cyclePhase,
  paletteLength
}) {
  // GUARD against log(≤0): clamp the magnitude just above 1 so logZn stays
  // finite and positive. Inert at the default escapeRadius but keeps the lookup
  // NaN-proof for low bailouts / perturbation precision loss.
  const guardedMag2 = mag2 < 1.0001 ? 1.0001 : mag2;
  const logZn = Math.log(guardedMag2) / 2;
  // GUARD the inner log argument: logZn/LOG2 must be > 0.
  const ratio = logZn / LOG2;
  const nu = Math.log(ratio < 1e-12 ? 1e-12 : ratio) / LOG2;
  const rawSmooth = iteration + 1 - nu;

  // Continuous palette coordinate: density (scale) + phase (offset + slow
  // time-driven drift), then a single fractional wrap into [0,1). This is a
  // smooth cyclic ramp walk, NOT the old eight-band chop.
  let colorCoord = rawSmooth * colorScale + cyclePhase;
  colorCoord -= Math.floor(colorCoord);

  // Contrast / curve (gamma). gamma of 1 is identity.
  const gamma = colorCurve < 0.01 ? 0.01 : (colorCurve > 100 ? 100 : colorCurve);
  const shaped = colorCoord ** (1 / gamma);

  const lastIndex = paletteLength - 1;
  const index = Math.floor(shaped * lastIndex + 0.5);
  return index < 0 ? 0 : (index > lastIndex ? lastIndex : index);
}

export function renderMandelbrotPixels({
  pixels,
  width,
  height,
  time,
  config,
  palette,
  interiorColor
}) {
  const zoom = mandelbrotZoom(time * config.motion.speed, {
    ...config.camera,
    ...config.motion
  });
  const span = 3 / zoom;
  const aspect = width / height;
  const calculatedIterations = Math.floor(
    config.algorithm.iterationBase
      + config.algorithm.iterationGrowth * Math.log10(zoom + 1)
  );
  const maxIterations = config.algorithm.maxIterations ?? calculatedIterations;
  const escapeSquared = config.algorithm.escapeRadius ** 2;

  // Continuous-coloring knobs (issue #10). Fall back to identity defaults so a
  // direct caller (tests, benchmark) that omits them still renders correctly.
  const appearance = config.appearance ?? {};
  const colorScale = appearance.colorScale ?? DEFAULT_COLOR_SCALE;
  const colorCurve = appearance.colorCurve ?? DEFAULT_COLOR_CURVE;
  const colorOffset = appearance.colorOffset ?? DEFAULT_COLOR_OFFSET;
  const cycleSpeed = appearance.cycleSpeed ?? DEFAULT_CYCLE_SPEED;
  // The cycling phase advances the palette coordinate slowly over time WITHOUT
  // touching the complex plane (the fractal geometry, zoom and bailout are
  // computed above and are independent of this value).
  const cyclePhase = time * (config.motion?.speed ?? 1) * cycleSpeed + colorOffset;
  const paletteLength = palette.length;

  // Complex-plane mapping. `span` is a HALF-extent in the real axis; the
  // vertical extent is `span / aspect`, so the window adapts to the buffer's
  // aspect ratio. Bounds come from `zoom` + `center` + aspect ONLY — never from
  // the sampling resolution, so changing render.resolution changes cost, not
  // composition.
  const realStep = 2 * span / width;
  const imaginaryStep = 2 * span / aspect / height;
  const realStart = config.camera.centerX - span;
  const imaginaryStart = config.camera.centerY - span / aspect;
  const checkMainInterior = zoom < 100;
  let index = 0;

  for (let y = 0; y < height; y++) {
    const imaginary = imaginaryStart + y * imaginaryStep;
    for (let x = 0; x < width; x++) {
      const real = realStart + x * realStep;
      if (checkMainInterior && isMainInterior(real, imaginary)) {
        pixels[index++] = interiorColor;
        continue;
      }

      let zReal = 0;
      let zImaginary = 0;
      let zRealSquared = 0;
      let zImaginarySquared = 0;
      let iteration = 0;
      while (zRealSquared + zImaginarySquared < escapeSquared && iteration < maxIterations) {
        zImaginary = 2 * zReal * zImaginary + imaginary;
        zReal = zRealSquared - zImaginarySquared + real;
        zRealSquared = zReal * zReal;
        zImaginarySquared = zImaginary * zImaginary;
        iteration++;
      }

      // Interior iff the orbit never escaped — i.e. its magnitude is still
      // below the escape radius after the iteration budget is spent. This
      // matches the WebGL shader's `escaped` flag rather than treating
      // `iteration === maxIterations` as a blanket interior signal: a point
      // that crosses the escape radius ON the final iteration is escaped, not
      // interior (issue #10 backend-parity requirement).
      const mag2 = zRealSquared + zImaginarySquared;
      if (mag2 < escapeSquared) {
        pixels[index++] = interiorColor;
        continue;
      }

      pixels[index++] = palette[mandelbrotPaletteIndex({
        iteration,
        mag2,
        colorScale,
        colorCurve,
        cyclePhase,
        paletteLength
      })];
    }
  }
  return { zoom, maxIterations };
}
