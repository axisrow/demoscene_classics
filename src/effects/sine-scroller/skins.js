// Named visual skins for sine-scroller (issue #11).
//
// A skin owns the VISUAL choices only: the background, the text/glyph colour
// ramp, the drop-shadow, the star colour, and the font family/weight. The text
// LAYOUT (font SIZE ratio, spacing, baseline, safe margin), the WAVE geometry
// (amplitude, cycles, phase), the MOTION (scroll speed), and the star DENSITY
// (count / area budget) are algorithmic identity and live in config.js /
// profiles.js — they never come from a skin.
//
// 'classic' is the Amiga-style scroller look: a near-black background, a bold
// monospace banner cycling through a cool→warm→cool ramp (so the colour scroll
// stays cyclic and smooth), a soft black drop-shadow for separation from the
// star field, and pale-blue stars. The shadow alpha is kept well below opaque
// and the glow narrow (config.text.glowWidth) so letter shapes stay crisp — the
// issue calls out that broad glow must not destroy glyph readability.
export const SINE_SCROLLER_SKINS = Object.freeze({
  classic: Object.freeze({
    appearance: Object.freeze({
      backgroundColor: '#04040a',
      palette: Object.freeze(['#78a0ff', '#70f0ff', '#f080ff', '#ffe66d', '#78a0ff']),
      colorCount: 360,
      shadowColor: '#000000',
      shadowAlpha: 0.6,
      starColor: '#78a0ff',
      fontFamily: 'Courier New, monospace',
      fontWeight: 900
    })
  })
});
