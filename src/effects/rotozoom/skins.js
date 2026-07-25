// Named visual skins for rotozoom. In API v3 a skin only carries *visual*
// choices (palette, background, tonal curve); the rotozoom *texture* (tile
// count, lattice frequencies) and *transform* (centre, rotation/zoom motion)
// are algorithmic identity and live in config.js, never here.
//
// 'classic' is a coherent, restrained demoscene palette tuned for a tiled
// diagonal lattice under continuous rotation and zoom: deep navy shadow → teal
// → cyan midtone → amber highlight, so dark, mid, and bright bands all stay
// present at 0 s, 1.5 s, and 5 s without collapsing to a near-flat frame. The
// `contrast` curve reshapes the value→palette-index mapping via a soft gamma so
// the lattice stays readable (it is appearance-only; it never touches geometry).

const CLASSIC_PALETTE = Object.freeze([
  '#04060a', // near-black navy shadow
  '#0a1a2a', // deep navy
  '#0f3b4a', // dark teal
  '#136b6e', // teal
  '#1bb6c4', // cyan midtone
  '#7fe3d8', // pale aqua
  '#f2c14e', // warm amber
  '#fbe7c0', // pale gold highlight
  '#fffdf5'  // near-white crest accent (small share only)
]);

export const ROTOZOOM_SKINS = Object.freeze({
  classic: Object.freeze({
    appearance: {
      palette: CLASSIC_PALETTE,
      colorCount: 256,
      backgroundColor: '#04060a',
      // Soft gamma applied to the normalized texture value before palette
      // lookup. <1 opens up the shadow band so the lattice stays readable as it
      // rotates; the value never clips to flat because the curve is bounded on
      // (0,1].
      contrast: 0.82
    }
  })
});
