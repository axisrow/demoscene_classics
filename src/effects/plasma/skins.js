// Named visual skins for plasma. In API v3 a skin only carries *visual* choices
// (palette, background, contrast/curve, render quality, motion tempo); the
// plasma *field* (frequencies, centres, amplitudes, aspect correction) is
// algorithmic identity and lives in config.js, never here.
//
// 'classic' replaces the old full-spectrum rainbow default with a restrained,
// coherent demoscene palette: deep indigo shadows → magenta/rose midtones → a
// warm amber highlight, with white only as a small crest accent. The stops are
// chosen so dark, midtone, and highlight bands all stay present at 1.5 s and
// 5 s (the field's value distribution sweeps the whole palette). `contrast`
// reshapes the value→palette-index mapping via a soft gamma curve so the field
// never collapses into a near-flat wash; it is appearance-only and does not
// touch the field geometry.

const CLASSIC_PALETTE = Object.freeze([
  '#05030f', // near-black indigo shadow
  '#1b0d3a', // deep violet
  '#3a1078', // indigo
  '#6a1b9a', // purple
  '#a8176b', // magenta-rose
  '#d6336c', // rose
  '#f25c54', // warm coral
  '#ffa94d', // amber
  '#ffe066', // pale gold highlight
  '#ffffff'  // crest white accent (small share only)
]);

export const PLASMA_SKINS = Object.freeze({
  classic: Object.freeze({
    appearance: {
      palette: CLASSIC_PALETTE,
      colorCount: 256,
      backgroundColor: '#05030f',
      // Soft gamma applied to the normalized field value before palette lookup.
      // <1 opens up the shadow band (more dark structure visible); the field
      // value never clips to flat because the curve is bounded on (0,1].
      contrast: 0.85
    }
  })
});
