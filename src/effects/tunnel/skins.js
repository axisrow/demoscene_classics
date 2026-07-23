// Named visual skins for tunnel (issue #9).
//
// A skin owns the VISUAL choices only: the wall palette, the background, and
// the fog tint toward which the receding centre blends. The polar/depth
// geometry (vanishing point, wall/angular frequencies, near epsilon, fog band
// and strength), travel speed, twist rate and colour-cycle rate live in
// config.js / profiles.js and are algorithmic identity -- they never come from
// a skin.
//
// 'classic' is the neon-pastel rotating tunnel: a pink/cyan/yellow wall ramp,
// a black canvas, and a dark-navy fog so the centre recedes into shadow
// instead of blanking. These appearance values are the skin's contract; the
// renderer reads them from the resolved config after the skin overlay is merged
// on top of the effect defaults.
export const TUNNEL_SKINS = Object.freeze({
  classic: Object.freeze({
    appearance: Object.freeze({
      backgroundColor: '#000000',
      palette: Object.freeze(['#ff80ee', '#60dfff', '#ffe86b', '#ff80ee']),
      fogColor: '#05030f'
    })
  })
});
