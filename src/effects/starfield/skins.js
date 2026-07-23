// Named visual skins for starfield (issue #7).
//
// A skin owns the VISUAL choices only: the background, the star colour ramp,
// and the trail appearance (fade, brightness/falloff, line-width range). The
// projection, velocity, density and respawn behaviour live in config.js /
// profiles.js and are algorithmic identity — they never come from a skin.
//
// 'classic' is the warp-speed look: a near-black void, a cool white-blue star
// ramp, and bounded translucent streaks that read at both 1.5 s and 5 s without
// washing the background grey. These appearance values are the skin's contract;
// the renderer reads them from the resolved config after the skin overlay is
// merged on top of the effect defaults.
export const STARFIELD_SKINS = Object.freeze({
  classic: Object.freeze({
    appearance: Object.freeze({
      backgroundColor: '#000000',
      palette: Object.freeze(['#b4c8ff', '#ffffff']),
      trailFade: 0.35,
      minAlpha: 0.25,
      maxAlpha: 0.95,
      minLineWidth: 1,
      maxLineWidth: 3
    })
  })
});
