import { readFileSync } from 'node:fs';
import { decodePng } from './png.mjs';

// Foreground ratio: the fraction of pixels that are both visible (alpha above
// `alphaThreshold`) AND deviate in colour from the image's dominant background
// colour. A sparse effect on a dark canvas (starfield's stars) has a small but
// nonzero foreground ratio; a completely blank render (the effect drew nothing)
// has a foreground ratio of ~0 regardless of the intended content. Used as a
// semantic blank guard so a regression that empties an effect cannot hide inside
// a permissive diff-pixel-ratio tolerance.
//
// Alpha matters: a capture whose RGB matches the baseline but whose alpha
// collapsed to 0 is visually blank (fully transparent), so it must count as
// background here even if its RGB still differs from the dominant colour.
//
// `channelTolerance` is the per-channel deviation that still counts as
// "background-ish" (small AA noise against the dominant colour is ignored).
export function foregroundRatio(decoded, channelTolerance = 16, alphaThreshold = 128) {
  const { rgba } = decoded;
  const n = rgba.length / 4;
  if (n === 0) return 0;
  // Dominant colour via a coarse 4-bit/channel histogram (12-bit buckets), over
  // VISIBLE pixels only. This is robust to per-pixel AA noise and cheap; exact
  // dominant-colour detection is not needed for a blank/empty guard.
  const buckets = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < alphaThreshold) continue;
    const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  let domKey = 0;
  let domCount = 0;
  for (const [key, count] of buckets) {
    if (count > domCount) { domCount = count; domKey = key; }
  }
  const dr = (domKey >> 8) << 4;
  const dg = ((domKey >> 4) & 0xf) << 4;
  const db = (domKey & 0xf) << 4;
  let fg = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < alphaThreshold) continue; // transparent pixels are not foreground
    if (
      Math.abs(rgba[i] - dr) > channelTolerance
      || Math.abs(rgba[i + 1] - dg) > channelTolerance
      || Math.abs(rgba[i + 2] - db) > channelTolerance
    ) {
      fg++;
    }
  }
  return fg / n;
}

// Pixel comparison of two PNG buffers with a bounded max-diff-pixel-ratio.
//
// A pixel "differs" when any channel — R, G, B, or A — differs by more than
// `channelTolerance` (default 0: exact, all four channels). The fraction of
// differing pixels must not exceed `maxDiffPixelRatio`. The ratio is always
// bounded, so unconstrained differences always fail — there is no silent
// "close enough" path. Counting alpha prevents a fully-transparent render with
// byte-identical RGB from comparing equal to an opaque baseline.
//
// `minForegroundRatio` is a semantic blank guard: the actual capture must keep
// at least this fraction of visible foreground (non-background, alpha-visible)
// pixels, computed independently from each image's own dominant colour. A
// capture that drops to ~0 foreground (the effect rendered nothing, or became
// fully transparent) fails even when its diff-pixel ratio is small — which
// matters for sparse vector effects (starfield) whose intended content is a
// small fraction of the frame. Defaults to 0 (off).
//
// Returns { match, diffPixelRatio, diffPixels, totalPixels, dimensionMismatch,
//           foregroundActual, foregroundFloor }.

export function comparePngBuffers(actual, expected, {
  maxDiffPixelRatio = 0,
  channelTolerance = 0,
  minForegroundRatio = 0
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
      totalPixels: -1,
      foregroundActual: 0,
      foregroundFloor: minForegroundRatio
    };
  }
  const total = a.width * a.height;
  let diff = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (
      Math.abs(a.rgba[i] - e.rgba[i]) > channelTolerance
      || Math.abs(a.rgba[i + 1] - e.rgba[i + 1]) > channelTolerance
      || Math.abs(a.rgba[i + 2] - e.rgba[i + 2]) > channelTolerance
      // Alpha is part of the pixel: a capture whose RGB matches the baseline
      // but whose alpha collapsed is visually different (transparent vs opaque)
      // and must count as a diff. Without this, a fully-transparent render with
      // byte-identical RGB would compare equal to an opaque baseline.
      || Math.abs(a.rgba[i + 3] - e.rgba[i + 3]) > channelTolerance
    ) {
      diff++;
    }
  }
  const ratio = total === 0 ? 0 : diff / total;
  const foregroundActual = foregroundRatio(a);
  const match = ratio <= maxDiffPixelRatio && foregroundActual >= minForegroundRatio;
  return {
    match,
    dimensionMismatch: false,
    diffPixelRatio: ratio,
    diffPixels: diff,
    totalPixels: total,
    width: a.width,
    height: a.height,
    foregroundActual,
    foregroundFloor: minForegroundRatio
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
