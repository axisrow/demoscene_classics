// Named visual skins for copper-bars (issue #14).
//
// A skin owns the VISUAL choices only: the background and the copper colour
// ramp. Bar count, placement, thickness, phase, motion and the shading model
// are algorithmic identity and live in config.js / profiles.js — they never
// come from a skin.
//
// 'classic' is the Amiga copper look: a near-black background and a warm copper
// ramp that runs from a dark brown body through a bright copper mid to a narrow
// warm-white peak, closing back to the mid so the colour scroll (colorCycleSpeed)
// stays cyclic and smooth. The narrow bright segment is what the renderer's
// specular highlight picks up at the bar centres; keeping it narrow prevents the
// broad white cores the legacy rainbow palette produced.
export const COPPER_BARS_SKINS = Object.freeze({
  classic: Object.freeze({
    appearance: Object.freeze({
      backgroundColor: '#0a0712',
      palette: Object.freeze(['#1a0a04', '#5e1d0a', '#b8430f', '#ff8a2a', '#ffe6c4', '#b8430f']),
      colorCount: 256
    })
  })
});
