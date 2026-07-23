export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

export function freezeValue(value) {
  if (Array.isArray(value)) value.forEach(freezeValue);
  else if (isPlainObject(value)) Object.values(value).forEach(freezeValue);
  return value !== null && typeof value === 'object' ? Object.freeze(value) : value;
}

export function mergeValue(defaultValue, inputValue) {
  if (inputValue === undefined) return cloneValue(defaultValue);
  if (isPlainObject(defaultValue) && isPlainObject(inputValue)) {
    const result = {};
    const keys = new Set([...Object.keys(defaultValue), ...Object.keys(inputValue)]);
    for (const key of keys) {
      result[key] = mergeValue(defaultValue[key], inputValue[key]);
    }
    return result;
  }
  return cloneValue(inputValue);
}

export function assertKnownKeys(effectName, input, defaults, path = effectName) {
  if (!isPlainObject(input)) throw new TypeError(`${path} must be an object.`);
  for (const [key, value] of Object.entries(input)) {
    if (!(key in defaults)) throw new RangeError(`Unknown option: ${path}.${key}`);
    const template = defaults[key];
    if (isPlainObject(value) && isPlainObject(template)) {
      assertKnownKeys(effectName, value, template, `${path}.${key}`);
    } else if (Array.isArray(value) && Array.isArray(template) && isPlainObject(template[0])) {
      value.forEach((item, index) => assertKnownKeys(
        effectName,
        item,
        template[0],
        `${path}.${key}[${index}]`
      ));
    }
  }
}

export function assertNumber(value, path, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    const kind = integer ? 'an integer' : 'a finite number';
    throw new RangeError(`${path} must be ${kind} between ${min} and ${max}.`);
  }
}

export function assertBoolean(value, path) {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean.`);
}

export function assertString(value, path, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${path} must be a${allowEmpty ? '' : ' non-empty'} string.`);
  }
}

export function assertPalette(palette, path, colorCount) {
  if (!Array.isArray(palette) || palette.length < 2 || palette.length > 64) {
    throw new RangeError(`${path} must contain between 2 and 64 colours.`);
  }
  palette.forEach((color, index) => {
    assertString(color, `${path}[${index}]`);
    if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) {
      throw new TypeError(`${path}[${index}] must use #rgb or #rrggbb.`);
    }
  });
  assertNumber(colorCount, path.replace(/palette$/, 'colorCount'), {
    min: 2,
    max: 4096,
    integer: true
  });
}

export function validateCommonConfig(effectName, config) {
  const { runtime, render, motion, appearance } = config;
  assertBoolean(runtime.autoStart, `${effectName}.runtime.autoStart`);
  assertNumber(runtime.maxFps, `${effectName}.runtime.maxFps`, { min: 1, max: 240 });
  assertNumber(runtime.pixelRatio, `${effectName}.runtime.pixelRatio`, { min: 1, max: 2 });
  assertBoolean(runtime.pauseWhenHidden, `${effectName}.runtime.pauseWhenHidden`);
  assertNumber(render.resolution, `${effectName}.render.resolution`, { min: 0.1, max: 1 });
  assertBoolean(render.smoothing, `${effectName}.render.smoothing`);
  assertNumber(motion.speed, `${effectName}.motion.speed`, { min: Number.MIN_VALUE });
  assertPalette(appearance.palette, `${effectName}.appearance.palette`, appearance.colorCount);
  assertString(appearance.backgroundColor, `${effectName}.appearance.backgroundColor`);
}

export function normalizeEffectConfig(effectName, input, defaults, validate = () => {}) {
  const supplied = input === undefined ? {} : input;
  assertKnownKeys(effectName, supplied, defaults);
  const config = mergeValue(defaults, supplied);
  validateCommonConfig(effectName, config);
  validate(config);
  return freezeValue(config);
}

export function cloneConfig(config) {
  return cloneValue(config);
}

export function createEffectDefaults(overrides = {}) {
  return freezeValue(mergeValue({
    runtime: COMMON_DEFAULTS.runtime,
    render: COMMON_DEFAULTS.render,
    motion: COMMON_DEFAULTS.motion,
    appearance: COMMON_DEFAULTS.appearance
  }, overrides));
}

export const COMMON_DEFAULTS = Object.freeze({
  runtime: Object.freeze({
    autoStart: true,
    maxFps: 60,
    pixelRatio: 1,
    pauseWhenHidden: true
  }),
  render: Object.freeze({
    resolution: 1,
    smoothing: false
  }),
  motion: Object.freeze({ speed: 1 }),
  appearance: Object.freeze({
    palette: Object.freeze(['#000000', '#ffffff']),
    colorCount: 256,
    backgroundColor: '#000000'
  })
});
