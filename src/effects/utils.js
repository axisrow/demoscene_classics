export function getContext2D(canvas, options) {
  const context = canvas.getContext('2d', options);
  if (!context) throw new Error('Demoscene requires a Canvas 2D context.');
  return context;
}

export function createPixelBuffer() {
  const canvas = globalThis.document.createElement('canvas');
  const context = getContext2D(canvas);
  return { canvas, context, image: null, pixels: null, width: 0, height: 0 };
}

export function resizePixelBuffer(buffer, width, height) {
  buffer.width = Math.max(2, Math.floor(width));
  buffer.height = Math.max(2, Math.floor(height));
  buffer.canvas.width = buffer.width;
  buffer.canvas.height = buffer.height;
  buffer.image = buffer.context.createImageData(buffer.width, buffer.height);
  buffer.pixels = new Uint32Array(buffer.image.data.buffer);
  return buffer;
}

export function presentPixelBuffer(context, buffer, width, height, smoothing) {
  buffer.context.putImageData(buffer.image, 0, 0);
  context.imageSmoothingEnabled = smoothing;
  context.drawImage(buffer.canvas, 0, 0, width, height);
}

export function packRgb(red, green, blue) {
  return (0xff << 24) | ((blue | 0) << 16) | ((green | 0) << 8) | (red | 0);
}

export function hslToRgb(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export function hslToPacked(hue, saturation, lightness) {
  const [red, green, blue] = hslToRgb(hue, saturation, lightness);
  return packRgb(Math.round(red), Math.round(green), Math.round(blue));
}

const SINE_PHASE_OFFSETS = [0, 2 * Math.PI / 3, 4 * Math.PI / 3];

/**
 * Fill a palette of packed RGBA colors with a cyclic sine-rainbow. Each
 * channel follows `128 + 127 * sin(phase)` with the three channels offset
 * by 120°. Writes into `palette` in place so callers can reuse one buffer.
 * @param {Uint32Array} palette
 * @param {(index: number) => number} phaseForIndex
 * @returns {Uint32Array}
 */
export function buildSinePalette(palette, phaseForIndex) {
  for (let i = 0; i < palette.length; i++) {
    const phase = phaseForIndex(i);
    palette[i] = packRgb(
      Math.floor(128 + 127 * Math.sin(phase + SINE_PHASE_OFFSETS[0])),
      Math.floor(128 + 127 * Math.sin(phase + SINE_PHASE_OFFSETS[1])),
      Math.floor(128 + 127 * Math.sin(phase + SINE_PHASE_OFFSETS[2]))
    );
  }
  return palette;
}
