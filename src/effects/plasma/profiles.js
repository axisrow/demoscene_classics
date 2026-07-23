// Surface and device partial configurations for plasma. These overlays are
// intentionally empty in the API v3 foundation: they establish the resolver
// shape without altering classic visuals. Responsive preview/mobile budgets
// are tuned in a follow-up (#3).
export const PLASMA_PROFILES = Object.freeze({
  surfaces: Object.freeze({
    fullscreen: Object.freeze({}),
    preview: Object.freeze({})
  }),
  devices: Object.freeze({
    desktop: Object.freeze({}),
    mobile: Object.freeze({})
  })
});
