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
  const log2 = Math.log(2);
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

      if (iteration === maxIterations) {
        pixels[index++] = interiorColor;
        continue;
      }

      const logZn = Math.log(zRealSquared + zImaginarySquared) / 2;
      const nu = Math.log(logZn / log2) / log2;
      const smooth = iteration + 1 - nu;
      pixels[index++] = palette[Math.abs(Math.floor(smooth * 8)) % palette.length];
    }
  }
  return { zoom, maxIterations };
}
