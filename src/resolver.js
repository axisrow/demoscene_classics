import {
  assertKnownKeys,
  cloneValue,
  freezeValue,
  isPlainObject,
  mergeValue,
  validateCommonConfig
} from './config.js';

// API v3 descriptor field names. Anything outside this set is either a legacy
// v2 flat-options group (rejected with a migration hint) or an unknown field.
const DESCRIPTOR_KEYS = new Set(['skin', 'surface', 'device', 'config']);

// Top-level option groups from the legacy API v2 flat-options object. Their
// presence at the descriptor root means the caller is using the old API and
// must migrate into the `config` escape hatch.
const V2_GROUPS = new Set([
  'runtime', 'render', 'motion', 'appearance',
  'field', 'simulation', 'particles', 'geometry', 'camera', 'algorithm',
  'texture', 'feedback', 'bars', 'shading', 'text', 'wave', 'stars'
]);

const VALID_DEVICES = ['auto', 'desktop', 'mobile'];

function detectLegacy(name, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`${name}: descriptor must be an object.`);
  }
  for (const key of Object.keys(input)) {
    if (V2_GROUPS.has(key)) {
      throw new TypeError(
        `${name}: the legacy v2 flat options object is no longer supported in API v3. `
        + `Move '${key}' under the config escape hatch, e.g. `
        + `Demoscene.${name}(canvas, { skin: 'classic', surface: 'fullscreen', device: 'auto', config: { ${key}: ... } }). `
        + `See the API v3 migration guide.`
      );
    }
    if (!DESCRIPTOR_KEYS.has(key)) {
      throw new RangeError(`Unknown descriptor field: ${name}.${key}`);
    }
  }
}

function resolveSkin(name, skinField, skins) {
  if (skinField === undefined || skinField === null) {
    return { requested: 'classic', presetName: 'classic', overrides: {} };
  }
  if (typeof skinField === 'string') {
    if (!(skinField in skins)) {
      throw new RangeError(`${name}: unknown skin '${skinField}'. Known skins: ${Object.keys(skins).join(', ')}.`);
    }
    return { requested: skinField, presetName: skinField, overrides: {} };
  }
  if (isPlainObject(skinField)) {
    for (const key of Object.keys(skinField)) {
      if (key !== 'preset' && key !== 'overrides') {
        throw new RangeError(`Unknown skin field: ${name}.skin.${key} (use 'preset' and/or 'overrides').`);
      }
    }
    const presetName = skinField.preset ?? 'classic';
    if (typeof presetName !== 'string' || !(presetName in skins)) {
      throw new RangeError(`${name}: unknown skin preset '${String(presetName)}'. Known skins: ${Object.keys(skins).join(', ')}.`);
    }
    const overrides = skinField.overrides ?? {};
    if (!isPlainObject(overrides)) {
      throw new TypeError(`${name}.skin.overrides must be an object.`);
    }
    return { requested: skinField, presetName, overrides };
  }
  throw new TypeError(`${name}.skin must be a string or { preset, overrides }.`);
}

function resolveSurface(name, surfaceField, surfaces) {
  const surfaceName = surfaceField ?? 'fullscreen';
  if (typeof surfaceName !== 'string' || !(surfaceName in surfaces)) {
    throw new RangeError(`${name}: unknown surface '${String(surfaceName)}'. Known surfaces: ${Object.keys(surfaces).join(', ')}.`);
  }
  return surfaceName;
}

function detectDevice(requestedDevice) {
  if (requestedDevice !== 'auto') return requestedDevice;
  const matchMedia = globalThis.matchMedia;
  if (typeof matchMedia !== 'function') return 'desktop';
  try {
    const narrow = matchMedia('(max-width: 767px)');
    const coarse = matchMedia('(hover: none) and (pointer: coarse)');
    const isMobile = Boolean(narrow?.matches) || Boolean(coarse?.matches);
    return isMobile ? 'mobile' : 'desktop';
  } catch {
    return 'desktop';
  }
}

function resolveDevice(name, deviceField, devices) {
  const requestedDevice = deviceField ?? 'auto';
  if (!VALID_DEVICES.includes(requestedDevice)) {
    throw new RangeError(`${name}: unknown device '${String(requestedDevice)}'. Known devices: ${VALID_DEVICES.join(', ')}.`);
  }
  const resolvedDevice = detectDevice(requestedDevice);
  if (!(resolvedDevice in devices)) {
    throw new RangeError(`${name}: unknown resolved device '${resolvedDevice}'.`);
  }
  return { requestedDevice, resolvedDevice };
}

// Skins may only touch the effect's declared visual groups. Algorithmic
// groups (field/simulation/geometry/...) are out of scope for a skin and must
// be changed through the explicit `config` escape hatch instead.
function assertSkinPaths(name, label, overlay, allow) {
  if (!isPlainObject(overlay)) return;
  for (const key of Object.keys(overlay)) {
    if (!allow.has(key)) {
      throw new RangeError(
        `${name}: skin ${label} is out of scope at '${key}'. `
        + `Skins may only touch: ${[...allow].join(', ')}. `
        + `To override an algorithmic field, pass it under 'config' instead.`
      );
    }
  }
}

/**
 * Resolve an API v3 descriptor against an effect definition.
 *
 * Merge order (exact): effect defaults -> skin preset -> skin overrides
 * -> matched (surface × resolved-device) profile slot -> explicit config. The
 * matched slot is the four-slot profile layer from #3 (it composes the surface
 * and device axes into one overlay so per-(surface,device) budgets such as
 * maxFps are representable). The result is deeply frozen; neither caller input
 * nor exported presets are mutated.
 *
 * @param {object} definition - effect definition (name, configDefaults, validate, skins, profiles, capabilities).
 * @param {object} [descriptor] - { skin, surface, device, config }.
 * @returns {{ config: object, selection: object }}
 */
export function resolveDescriptor(definition, descriptor) {
  const {
    name,
    configDefaults,
    validate = () => {},
    skins,
    profiles,
    capabilities
  } = definition;

  const input = descriptor === undefined ? {} : descriptor;
  detectLegacy(name, input);

  const { requested, presetName, overrides } = resolveSkin(name, input.skin, skins);
  const preset = skins[presetName] ?? {};

  const surfaceName = resolveSurface(name, input.surface, profiles.surfaces);
  const { requestedDevice, resolvedDevice } = resolveDevice(name, input.device, profiles.devices);

  // The profile overlay for the matched (surface × resolved-device) combination.
  // Profiles are declared as four complete, effect-owned slots (#3). A slot may
  // carry budgets that depend on BOTH axes at once (e.g. maxFps differs across
  // preview/desktop vs fullscreen/desktop), which two independent surface and
  // device overlays cannot express. We therefore apply the single composite
  // matched slot rather than merging a surface overlay and a device overlay
  // separately. Conceptually this is the same "surface profile → device profile"
  // step from #2, but expressed as one composite overlay so per-(surface,device)
  // budgets are representable.
  const slotKey = `${surfaceName}.${resolvedDevice}`;
  // Every effect must declare all four (surface × device) slots (#3): no
  // implicit, undocumented fallbacks. If the matched slot is missing we fail
  // loud rather than silently substituting an empty overlay, which would drop
  // the effect's runtime budgets (maxFps/pixelRatio/pauseWhenHidden) and render
  // resolution for this surface/device pair without any diagnostic.
  if (!profiles.slots || !Object.prototype.hasOwnProperty.call(profiles.slots, slotKey)) {
    throw new RangeError(
      `${name}: profile slot '${slotKey}' is missing. Every effect must define all four slots: `
      + 'fullscreen.desktop, fullscreen.mobile, preview.desktop, preview.mobile.'
    );
  }
  const profileOverlay = profiles.slots[slotKey];

  const explicit = input.config ?? {};
  if (!isPlainObject(explicit)) {
    throw new TypeError(`${name}.config must be an object.`);
  }

  const allow = capabilities?.skinAllow ?? new Set();
  assertSkinPaths(name, `preset '${presetName}'`, preset, allow);
  assertSkinPaths(name, 'overrides', overrides, allow);

  // Explicit config is caller input: reject typos with full paths, but allow
  // it to cross the skin/profile boundary (it is the expert escape hatch).
  assertKnownKeys(name, explicit, configDefaults);
  // Optional pre-merge validation of the raw caller input, for effect-specific
  // constraints that cannot be checked on the merged config (e.g. mutually
  // exclusive options). Runs on the untouched caller object before any merge.
  definition.validateInput?.(name, explicit);

  let config = cloneValue(configDefaults);
  config = mergeValue(config, preset);
  config = mergeValue(config, overrides);
  config = mergeValue(config, profileOverlay);
  config = mergeValue(config, explicit);

  validateCommonConfig(name, config);
  validate(config);
  config = freezeValue(config);

  const selection = Object.freeze({
    requestedSkin: requested,
    preset: presetName,
    surface: surfaceName,
    requestedDevice,
    resolvedDevice
  });

  return { config, selection };
}
