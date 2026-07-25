import {
  buildGradientPalette,
  createPixelBuffer,
  getContext2D,
  parseHexColor,
  presentPixelBuffer,
  resizePixelBuffer
} from '../utils.js';

// Aspect-correct normalized-polar tunnel renderer (issue #9).
//
// The renderer maps each sample into a NORMALIZED polar frame centred on a
// configurable vanishing point, decoupled from the render-buffer pixel count:
//
//   - CSS viewport is recovered from the device pixels the runtime hands over
//     (`cssW = deviceWidth / pixelRatio`), exactly like the starfield effect.
//   - `refR` is the CSS distance from the vanishing point to the nearest frame
//     edge; `u = cssDistance(refR) / refR` is the dimensionless, isotropic,
//     aspect-correct normalized radius (0 at the vanishing point, ~1 at the
//     nearest edge). `u` does not depend on `render.resolution` or `pixelRatio`,
//     so lowering the sampling buffer resamples the identical composition.
//   - Depth is a GUARDED bounded inverse: `depth = r<=eps ? 1 :
//     min(farClamp, eps/r)`. Finite everywhere, monotonic toward the centre,
//     and capped on the central disk so the inverse-radius singularity never
//     strobes.
//
// Motion advances three accumulators by `delta` (seconds), never by `time`, so
// 24/30/60 FPS schedules reach the identical travel/rotation/colour state for a
// given elapsed time. The first frame carries `delta = 0` (the runtime seeds
// `lastTimestamp = null`), so the static composed tunnel is shown immediately.
//
// `render.resolution` enters ONLY as the sample count (BW, BH) and as a sub-pixel
// grid-snap of the epsilon disk (`epsBuf`). Wall bands, the vanishing point and
// the fog are stable across resolutions.

export function createTunnelRenderer({ canvas, config }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  const pixelRatio = config.runtime.pixelRatio;

  const [fogR, fogG, fogB] = parseHexColor(config.appearance.fogColor, 'tunnel.appearance.fogColor');

  let width = 1;
  let height = 1;

  // Per-resize precompute (everything that depends only on geometry/CSS, not on
  // time). Held in closure locals so the hot loop allocates nothing per pixel.
  let bw = 1;
  let bh = 1;
  let vpBufX = 0;
  let vpBufY = 0;
  let refRBuf = 1;
  let epsBuf = 1;

  // Forward motion accumulators (seconds-based). wrap to [0,1) on a large cycle
  // to bound floating-point growth over very long runs without changing the
  // rendered phase (the texture reads are periodic).
  let accumShift = 0;
  let accumTwist = 0;
  let accumColor = 0;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      bw = Math.max(2, Math.floor(nextWidth * config.render.resolution));
      bh = Math.max(2, Math.floor(nextHeight * config.render.resolution));
      resizePixelBuffer(buffer, bw, bh);

      // Recover the CSS viewport (starfield precedent) and build the normalized
      // polar frame in CSS pixels, then map it into buffer-pixel space for the
      // sample grid.
      const cssW = nextWidth / pixelRatio;
      const cssH = nextHeight / pixelRatio;
      const vpCssX = config.geometry.centerX * cssW;
      const vpCssY = config.geometry.centerY * cssH;

      // Reference radius: CSS distance to the nearest viewport edge from the
      // vanishing point. Guards an off-edge vanishing point with max(1, ...).
      const refR = Math.max(1, Math.min(vpCssX, cssW - vpCssX, vpCssY, cssH - vpCssY));

      // CSS -> buffer-pixel scale. The runtime resizes the canvas to DEVICE
      // pixels (`nextWidth = cssExtent * pixelRatio`) and the sample buffer is
      // `floor(nextWidth * render.resolution)`, so the buffer spans
      // `pixelRatio * render.resolution` device px per CSS px. The geometry
      // (vanishing point, reference radius, near-centre epsilon) must map from
      // CSS px through that SAME scale, or a pixelRatio override (1.5/2) would
      // displace the vanishing point toward the upper-left and shrink the
      // composition — breaking the aspect/scale invariant. `render.resolution`
      // and `pixelRatio` both cancel out of every ratio used below
      // (u = rBuf/refRBuf, depth = epsBuf/rBuf, polarAngle), so the composition
      // is still identical across sampling resolutions AND pixel ratios.
      const cssToBuf = pixelRatio * config.render.resolution;
      vpBufX = vpCssX * cssToBuf;
      vpBufY = vpCssY * cssToBuf;
      refRBuf = refR * cssToBuf;

      // Near-centre epsilon in buffer pixels. Kept as a float (NOT grid-snapped)
      // so the bounded-inverse depth ratio `epsBuf / rBuf` is exactly
      // resolution-independent: both `epsBuf` and `rBuf` scale with `cssToBuf`,
      // so the ratio — and therefore depth, textureU, fog and the final colour —
      // is invariant across sampling resolutions. The central disk (r <= epsBuf)
      // is still capped to depth 1, so the singularity never strobes.
      epsBuf = config.geometry.nearEpsilon * refRBuf;
    },
    render({ delta }) {
      // Guard against non-finite deltas defensively (a caller could feed
      // Infinity/NaN): never advance the accumulators with garbage, and never
      // render a NaN frame.
      const dt = Number.isFinite(delta) && delta > 0 ? delta : 0;

      const speed = config.motion.speed;
      accumShift = (accumShift + speed * config.motion.forwardSpeed * dt) % 1;
      accumTwist = (accumTwist + speed * config.motion.rotationSpeed * dt) % 1;
      accumColor = (accumColor + speed * config.motion.colorCycleSpeed * dt) % 1;

      const wallFreq = config.geometry.wallFrequency;
      const angFreq = config.geometry.angularFrequency / Math.PI;
      const farClamp = config.geometry.farClamp;
      const fogNear = config.geometry.fogNear;
      const fogFar = config.geometry.fogFar;
      const fogStrength = config.geometry.fogStrength;
      const invFogRange = 1 / (fogFar - fogNear);

      const pal = palette;
      const palLen = palette.length;
      const shift = accumShift;
      const twist = accumTwist;
      const colorCycle = accumColor;

      const pixels = buffer.pixels;
      let index = 0;

      for (let y = 0; y < bh; y++) {
        const dy = y - vpBufY;
        for (let x = 0; x < bw; x++) {
          const dx = x - vpBufX;
          const rBuf = Math.sqrt(dx * dx + dy * dy);

          // Guarded bounded-inverse depth. rBuf === 0 (exact centre) -> depth 1.
          let depth;
          if (rBuf <= epsBuf) {
            depth = 1;
          } else {
            const raw = epsBuf / rBuf; // in (0, 1)
            depth = raw < farClamp ? raw : farClamp;
          }
          const u = rBuf / refRBuf;

          // Texture coordinates (depth scroll + angular twist).
          const textureU = wallFreq * depth + shift;
          const textureV = Math.atan2(dy, dx) * angFreq + twist;

          // Low-frequency wall pattern with both depth and angular structure,
          // so forward motion and rotation both read; alias-resistant.
          const pattern = 0.5 + 0.5 * (Math.sin(textureU) * Math.cos(textureV));

          // Fake lighting: near wall (small depth) brighter, deep centre dimmer.
          const depthShade = 1 - 0.35 * (depth / farClamp);

          // Palette lookup, deterministic in time.
          let colorPos = (pattern + colorCycle) % 1;
          if (colorPos < 0) colorPos += 1;
          let colorIndex = (colorPos * palLen) | 0;
          if (colorIndex >= palLen) colorIndex = palLen - 1;
          const color = pal[colorIndex];

          // Meaningful depth fog, increasing toward the vanishing point.
          let fogT = (fogFar - u) * invFogRange;
          if (fogT < 0) fogT = 0;
          else if (fogT > 1) fogT = 1;
          fogT = fogT * fogT * (3 - 2 * fogT); // smoothstep
          const fogFactor = fogT * fogStrength; // < 1 keeps centre structure visible
          const invFog = 1 - fogFactor;

          // Blend shaded wall -> fog colour (wall shaded before fog so the fog
          // tint stays pure). Inline packRgb (little-endian RGBA Uint32).
          const wallR = (color & 255) * depthShade;
          const wallG = (color >>> 8 & 255) * depthShade;
          const wallB = (color >>> 16 & 255) * depthShade;
          const fr = wallR * invFog + fogR * fogFactor;
          const fg = wallG * invFog + fogG * fogFactor;
          const fb = wallB * invFog + fogB * fogFactor;
          pixels[index++] = (0xff << 24) | ((fb | 0) << 16) | ((fg | 0) << 8) | (fr | 0);
        }
      }
      presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
    }
  };
}
