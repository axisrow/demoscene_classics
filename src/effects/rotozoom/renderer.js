import {
  buildGradientPalette,
  createPixelBuffer,
  getContext2D,
  presentPixelBuffer,
  resizePixelBuffer
} from '../utils.js';

// Rotozoom samples an INTENTIONALLY TILEABLE procedural texture in NORMALIZED
// TEXTURE SPACE (issue #12). The pipeline is resolution-independent:
//
//   1. each buffer cell (bx, by) -> normalized viewport point
//        nx = (bx + 0.5) / W ,  ny = (by + 0.5) / H        // [0,1]²
//   2. translate to the documented transform centre and aspect-correct x:
//        px = (nx - centerX) ,  py = (ny - centerY)
//        pxA = aspectCorrection ? px * aspect : px          // viewport-height units
//      sqrt(pxA² + py²) is now a true Euclidean distance, so the tile motif
//      stays square (not stretched) in landscape and portrait.
//   3. rotate around the centre by θ and scale by zoom (both time-based):
//        rx = ( cosθ·pxA + sinθ·py ) / zoom
//        ry = (-sinθ·pxA + cosθ·py ) / zoom
//   4. map to texture-tile units and wrap seamlessly:
//        tu = frac(rx * tiles) ,  tv = frac(ry * tiles)     // [0,1)
//   5. sample the periodic lattice f(tu, tv) and index the palette.
//
// Because the transform is a pure function of (nx, ny, time) and the texture is
// a pure function of (tu, tv), changing `render.resolution` — which only changes
// how many cells sample step 1 — can never alter the tile scale, transform
// centre, rotation speed, or zoom phase. Resolution is sampling density only.
//
// The texture lattice is INTENTIONALLY TILEABLE: each component is a sinusoid
// evaluated at INTEGER cycle counts across one tile, so the field is seamless
// at tu/tv wrap boundaries. There is deliberately NO radial term tied to the
// texture centre — that is what produced the old accidental centre disk /
// bullseye. The motif is a diagonal interference lattice readable at many
// orientations.
export function createRotozoomRenderer({ canvas, config }) {
  const context = getContext2D(canvas, { alpha: false });
  const buffer = createPixelBuffer();
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  const { motion, render, appearance, transform, texture } = config;
  const paletteLen = palette.length;

  const twoPi = Math.PI * 2;
  // Integer cycle counts per tile — seamlessness is structural.
  const fU = texture.frequencyU * twoPi;
  const fV = texture.frequencyV * twoPi;
  // Diagonal band shares an integer frequency so it is also seamless at the wrap.
  const fD = texture.frequencyU * twoPi;
  const wSum = (texture.weightU + texture.weightV + texture.weightDiag) || 1;
  const wU = texture.weightU / wSum;
  const wV = texture.weightV / wSum;
  const wD = texture.weightDiag / wSum;
  const tiles = texture.tiles;
  const aspectCorrection = transform.aspectCorrection;
  const cx = transform.centerX;
  const cy = transform.centerY;

  // Appearance-only contrast curve (gamma), applied to the normalized texture
  // value before palette indexing. The value is always in [0,1]; raising it to
  // any positive power keeps it there — it can never clip to a flat band.
  const contrast = Number.isFinite(appearance.contrast) && appearance.contrast > 0
    ? appearance.contrast
    : 1;

  let width = 1;
  let height = 1;

  // Sample the periodic lattice at a wrapped texture coordinate in [0,1)². All
  // three components are integer-cycle sinusoids, so the value is identical at
  // tu=0 and tu=1 (seamless). Returns a value in [0,1].
  function textureValue(tu, tv) {
    const horizontal = Math.sin(fU * tu);
    const vertical = Math.sin(fV * tv);
    const diagonal = Math.sin(fD * (tu + tv));
    // Weighted sum is in [-1, +1] (weights sum to 1); remap to [0,1].
    let value = horizontal * wU + vertical * wV + diagonal * wD;
    value = value * 0.5 + 0.5;
    if (contrast !== 1 && value > 0) {
      value = Math.pow(value, contrast);
    }
    return value;
  }

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      resizePixelBuffer(buffer, width * render.resolution, height * render.resolution);
    },
    render({ time }) {
      const scaledTime = time * motion.speed;
      // Rotation in turns/sec -> radians. Time-based, FPS-independent.
      const angle = scaledTime * motion.rotationSpeed * twoPi;
      // Bounded time-based zoom: never below zoomMin, never non-finite.
      const zoom = Math.max(
        motion.zoomMin,
        motion.zoomBase + Math.sin(scaledTime * motion.zoomSpeed) * motion.zoomAmplitude
      );
      const inverseZoom = 1 / zoom;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);

      const w = buffer.width;
      const h = buffer.height;
      const aspect = w / h;
      const aspectU = aspectCorrection ? aspect : 1;
      const paletteLocal = palette;
      const len = paletteLen;

      let index = 0;
      for (let y = 0; y < h; y++) {
        const ny = (y + 0.5) / h - cy;
        for (let x = 0; x < w; x++) {
          const nx = (x + 0.5) / w - cx;
          const pxA = nx * aspectU;
          // Rotate around the centre and scale by zoom (viewport-height units).
          const rx = (cosine * pxA + sine * ny) * inverseZoom;
          const ry = (-sine * pxA + cosine * ny) * inverseZoom;
          // Map to texture-tile units and wrap seamlessly into [0,1).
          const tu = rx * tiles - Math.floor(rx * tiles);
          const tv = ry * tiles - Math.floor(ry * tiles);
          // Index the palette from the periodic lattice value.
          const value = textureValue(tu, tv);
          const fieldIndex = value <= 0
            ? 0
            : value >= 1
              ? len - 1
              : (value * len) | 0;
          buffer.pixels[index++] = paletteLocal[fieldIndex];
        }
      }
      presentPixelBuffer(context, buffer, width, height, render.smoothing);
    }
  };
}
