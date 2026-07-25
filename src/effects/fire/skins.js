// Named visual skins for fire. In API v3 a skin carries *visual* choices only
// (palette, brightness, glow); algorithmic identity (seed, cooling, source
// geometry) lives in config.js and is overridden through the explicit `config`
// escape hatch.
//
// 'classic' is the default fire look: a continuous black → burgundy → orange →
// yellow ramp with near-white reserved for the small hottest highlights. White
// never occupies a broad region because it appears only at the very top stop of
// the ramp, so only the most intense cells (the core of the source band) reach
// it. The 256-entry ramp is interpolated evenly between these stops by
// buildGradientPalette, so the warm colours dominate the middle of the range.

export const FIRE_SKINS = Object.freeze({
  classic: Object.freeze({
    appearance: Object.freeze({
      palette: Object.freeze([
        '#000000',
        '#2b0000',
        '#8b0a0a',
        '#d83a0a',
        '#ff7a00',
        '#ffb400',
        '#ffe55c',
        '#fffff0'
      ]),
      colorCount: 256
    })
  })
});
