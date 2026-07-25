// Named visual skins for metaballs (issue #8).
//
// A skin owns the VISUAL choices only: the colour ramp and the interior
// shading depth (how many palette stops resolve the gradient). The scalar-field
// geometry — radius, strength, threshold, mergeBand, the Lissajous trajectories
// — is algorithmic identity and lives in config.js / profiles.js; it never
// comes from a skin.
//
// 'classic' is the gooey-liquid look: a deep indigo void (the palette's first
// stop doubles as the background) and a six-stop ramp from dark indigo through
// teal/green/yellow to white. The renderer reads these appearance values from
// the resolved config after the skin overlay is merged on top of the effect
// defaults; the smoothstep field→colour band is applied to this ramp, so the
// white stop is reached only at the densest merged core (no broad clipped-white
// interiors).
export const METABALLS_SKINS = Object.freeze({
  classic: Object.freeze({
    appearance: Object.freeze({
      palette: Object.freeze([
        '#050014', '#0a2878', '#00aac8', '#3ce678', '#f0e628', '#ffffff'
      ]),
      colorCount: 512
    })
  })
});
