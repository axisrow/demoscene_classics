import { readFileSync } from 'node:fs';
import { decodePng } from './png.mjs';

// Pixel comparison of two PNG buffers with a bounded max-diff-pixel-ratio.
//
// A pixel "differs" when any channel differs by more than `channelTolerance`
// (default 0: exact). The fraction of differing pixels must not exceed
// `maxDiffPixelRatio`. The ratio is always bounded, so unconstrained
// differences always fail — there is no silent "close enough" path.
//
// Returns { match, diffPixelRatio, diffPixels, totalPixels, dimensionMismatch }.

export function comparePngBuffers(actual, expected, {
  maxDiffPixelRatio = 0,
  channelTolerance = 0
} = {}) {
  const a = decodePng(actual);
  const e = decodePng(expected);
  if (a.width !== e.width || a.height !== e.height) {
    return {
      match: false,
      dimensionMismatch: true,
      actual: { width: a.width, height: a.height },
      expected: { width: e.width, height: e.height },
      diffPixelRatio: 1,
      diffPixels: -1,
      totalPixels: -1
    };
  }
  const total = a.width * a.height;
  let diff = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (
      Math.abs(a.rgba[i] - e.rgba[i]) > channelTolerance
      || Math.abs(a.rgba[i + 1] - e.rgba[i + 1]) > channelTolerance
      || Math.abs(a.rgba[i + 2] - e.rgba[i + 2]) > channelTolerance
    ) {
      diff++;
    }
  }
  const ratio = total === 0 ? 0 : diff / total;
  return {
    match: ratio <= maxDiffPixelRatio,
    dimensionMismatch: false,
    diffPixelRatio: ratio,
    diffPixels: diff,
    totalPixels: total,
    width: a.width,
    height: a.height
  };
}

// Build a magnified diff PNG (differing pixels red, others dimmed) for human
// review. Used when a comparison fails so the failure is debuggable.
export function buildDiffImage(actual, expected) {
  const a = decodePng(actual);
  const e = decodePng(expected);
  const width = Math.max(a.width, e.width);
  const height = Math.max(a.height, e.height);
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inA = x < a.width && y < a.height;
      const inE = x < e.width && y < e.height;
      if (!inA || !inE
        || a.rgba[(y * a.width + x) * 4] !== e.rgba[(y * e.width + x) * 4]
        || a.rgba[(y * a.width + x) * 4 + 1] !== e.rgba[(y * e.width + x) * 4 + 1]
        || a.rgba[(y * a.width + x) * 4 + 2] !== e.rgba[(y * e.width + x) * 4 + 2]) {
        rgba[i] = 255; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 255;
      } else {
        const g = inA ? a.rgba[(y * a.width + x) * 4] : 0;
        rgba[i] = g; rgba[i + 1] = g; rgba[i + 2] = g; rgba[i + 3] = 255;
      }
    }
  }
  return { width, height, rgba };
}

export function readPng(path) {
  return readFileSync(path);
}
