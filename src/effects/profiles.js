// Responsive profile layer shared by every effect (issue #3).
//
// Each effect owns FOUR explicit, effect-owned profile slots — one per
// (surface × device) combination — declared in its own profiles.js. A slot is a
// complete partial-config overlay applied by the resolver for that exact
// (surface, resolved-device) pair. Slots are the source of truth for runtime
// budgets (maxFps), render resolution, pixel ratio, viewport scheduling, and
// density/particle budgets.
//
// Why four slots instead of a surface axis + a device axis: the API v3 resolver
// (#2) applied a surface overlay then a device overlay as two deep merges. With
// leaf-replacement semantics that cannot express a budget that depends on BOTH
// axes at once — e.g. maxFps is 60 for fullscreen/desktop but 30 for
// preview/desktop (same device, different surface). The four-slot form makes
// every per-(surface,device) budget representable. Conceptually a slot is still
// "the surface profile composed with the device profile"; it is just declared
// as one composite overlay so the merge result is unambiguous.
//
// `surfaces` and `devices` remain on the registry as enumerations of the valid
// surface/device values (consumed by scripts/build.mjs for the manifest and by
// the resolver to validate the requested surface/device), but the resolver no
// longer merges them as separate overlays — it merges the one matched slot.

const SURFACES = ['fullscreen', 'preview'];
const DEVICES = ['desktop', 'mobile'];
const SLOT_KEYS = ['fullscreen.desktop', 'fullscreen.mobile', 'preview.desktop', 'preview.mobile'];

/**
 * Build the effect profile registry from four explicit complete slots.
 *
 * Each slot value is a partial-config overlay (runtime/render/motion/... etc.)
 * applied verbatim for that (surface.device) combination. Shared budget values
 * may be factored into a local const in the effect's profiles.js and spread
 * into multiple slots; the registry itself never duplicates data the effect
 * did not author.
 *
 * @param {Record<string, object>} slots - the four complete slot overlays.
 * @returns {{ slots: object, surfaces: object, devices: object }}
 */
export function buildProfiles(slots) {
  if (!slots || typeof slots !== 'object') {
    throw new TypeError('buildProfiles expects a slots object.');
  }
  for (const key of SLOT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(slots, key)) {
      throw new RangeError(`Profile slot '${key}' is missing; every effect must define all four slots.`);
    }
    if (!isPlainObject(slots[key])) {
      throw new RangeError(`Profile slot '${key}' must be a plain object.`);
    }
  }
  for (const key of Object.keys(slots)) {
    if (!SLOT_KEYS.includes(key)) {
      throw new RangeError(`Unknown profile slot '${key}'. Expected one of: ${SLOT_KEYS.join(', ')}.`);
    }
  }

  return Object.freeze({
    slots: Object.freeze(cloneSlots(slots)),
    surfaces: Object.freeze({
      fullscreen: Object.freeze({}),
      preview: Object.freeze({})
    }),
    devices: Object.freeze({
      desktop: Object.freeze({}),
      mobile: Object.freeze({})
    })
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Shallow clone each slot so the frozen registry never aliases caller-owned
// objects (an effect's profiles.js may reuse the same factored const across
// slots). Deep immutability of the merged config is still enforced by the
// resolver's freezeValue step.
function cloneSlots(slots) {
  const result = {};
  for (const key of SLOT_KEYS) {
    result[key] = { ...slots[key] };
  }
  return result;
}

export const PROFILE_SURFACES = Object.freeze(SURFACES);
export const PROFILE_DEVICES = Object.freeze(DEVICES);
export const PROFILE_SLOT_KEYS = Object.freeze(SLOT_KEYS);
