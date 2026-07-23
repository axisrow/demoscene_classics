// Mandelbrot skins (issue #10). Skins own PRESENTATION only — the visual
// appearance of the continuous escape-time colouring. The fractal geometry
// (camera, bailout, iteration ceiling, zoom) is algorithmic identity and lives
// in config.js / profiles.js, never here.
//
// `appearance` is one of the skinAllow groups (see index.js), so a skin may
// override the continuous-coloring knobs added in config.js:
//   colorScale   — ramp density (replaces the old hard-coded `*8` band factor)
//   colorCurve   — contrast/gamma on the normalised palette coordinate
//   colorOffset  — base phase (palette-width units)
//   cycleSpeed   — slow continuous drift of the palette coordinate. The drift
//                  shifts the continuous coordinate only; it never touches the
//                  complex plane, so the fractal geometry is unchanged.
//
// The resolver applies the skin preset BEFORE the matched profile slot and any
// explicit `config`, so a caller may still override any of these via
// `config.appearance.*`.

export const MANDELBROT_SKINS = Object.freeze({
  classic: Object.freeze({
    appearance: {
      // ~0.06 palette-widths per unit smooth-iteration: a slow, continuous ramp
      // instead of the old eight-hard-bands-per-iteration modulo stripe.
      colorScale: 0.06,
      colorCurve: 1,
      colorOffset: 0,
      // One full palette traversal every ~50 s — a gentle continuous shimmer
      // that does not alter the auto-zoom geometry.
      cycleSpeed: 0.02
    }
  })
});
