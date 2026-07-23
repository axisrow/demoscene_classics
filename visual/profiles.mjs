// Visual-QA surface profiles.
//
// Each profile fixes a canvas/viewport geometry AND the explicit device the
// harness resolves. The geometry here is fixture geometry only: it is the size
// of the canvas the harness renders into, and is intentionally independent of
// `render.resolution` (which only controls sampling cost, never composition).
// Passing `device` explicitly means the resolver never reads `matchMedia`, so
// `selection.resolvedDevice` is constant and filename-encodable across runs.

export const PROFILES = Object.freeze([
  {
    id: 'desktop-preview',
    label: 'desktop preview',
    surface: 'preview',
    device: 'desktop',
    width: 320,
    height: 180
  },
  {
    id: 'mobile-preview',
    label: 'mobile preview',
    surface: 'preview',
    device: 'mobile',
    width: 360,
    height: 180
  },
  {
    id: 'desktop-fullscreen',
    label: 'desktop fullscreen',
    surface: 'fullscreen',
    device: 'desktop',
    width: 1280,
    height: 720
  },
  {
    id: 'mobile-fullscreen',
    label: 'mobile fullscreen',
    surface: 'fullscreen',
    device: 'mobile',
    width: 390,
    height: 844
  }
]);

export const PROFILE_BY_ID = Object.freeze(
  Object.fromEntries(PROFILES.map((profile) => [profile.id, profile]))
);

export function getProfile(profileId) {
  const profile = PROFILE_BY_ID[profileId];
  if (!profile) {
    throw new RangeError(
      `Unknown visual profile '${profileId}'. Known: ${PROFILES.map((p) => p.id).join(', ')}.`
    );
  }
  return profile;
}
