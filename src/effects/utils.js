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

export function createDrawingBuffer() {
  const canvas = globalThis.document.createElement('canvas');
  const context = getContext2D(canvas);
  return { canvas, context, width: 1, height: 1 };
}

export function resizeDrawingBuffer(buffer, width, height) {
  buffer.width = Math.max(2, Math.floor(width));
  buffer.height = Math.max(2, Math.floor(height));
  buffer.canvas.width = buffer.width;
  buffer.canvas.height = buffer.height;
  return buffer;
}

export function presentDrawingBuffer(context, buffer, width, height, smoothing) {
  context.imageSmoothingEnabled = smoothing;
  context.drawImage(buffer.canvas, 0, 0, width, height);
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

export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function samplePackedPalette(palette, normalized) {
  const index = Math.min(
    palette.length - 1,
    Math.max(0, Math.round(normalized * (palette.length - 1)))
  );
  return palette[index];
}

/**
 * Parse a CSS-style hex colour used by the public effect options.
 * Supports #rgb and #rrggbb so the browser-script API stays beginner-friendly.
 * @param {string} value
 * @param {string} [label]
 * @returns {[number, number, number]}
 */
export function parseHexColor(value, label = 'color') {
  if (typeof value !== 'string') {
    throw new TypeError(`Demoscene ${label} must be a hex color string.`);
  }
  const match = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) {
    throw new TypeError(`Demoscene ${label} must use #rgb or #rrggbb.`);
  }
  const hex = match[1].length === 3
    ? match[1].split('').map((character) => character + character).join('')
    : match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ];
}

/**
 * Fill a packed-colour palette by interpolating evenly between hex colours.
 * @param {Uint32Array} target
 * @param {string[]} colors
 * @returns {Uint32Array}
 */
export function buildGradientPalette(target, colors) {
  if (!Array.isArray(colors) || colors.length < 2) {
    throw new RangeError('Demoscene palette must contain at least two hex colors.');
  }
  const parsed = colors.map((color, index) => parseHexColor(color, `palette[${index}]`));
  const segmentCount = parsed.length - 1;
  for (let index = 0; index < target.length; index++) {
    const position = index / Math.max(1, target.length - 1) * segmentCount;
    const leftIndex = Math.min(segmentCount - 1, Math.floor(position));
    const mix = Math.min(1, position - leftIndex);
    const left = parsed[leftIndex];
    const right = parsed[leftIndex + 1];
    target[index] = packRgb(
      Math.round(left[0] + (right[0] - left[0]) * mix),
      Math.round(left[1] + (right[1] - left[1]) * mix),
      Math.round(left[2] + (right[2] - left[2]) * mix)
    );
  }
  return target;
}

/** @param {string} color */
export function packHexColor(color) {
  const [red, green, blue] = parseHexColor(color);
  return packRgb(red, green, blue);
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
