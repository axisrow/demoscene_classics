(() => {
  // src/config.js
  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (isPlainObject(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
    }
    return value;
  }
  function freezeValue(value) {
    if (Array.isArray(value)) value.forEach(freezeValue);
    else if (isPlainObject(value)) Object.values(value).forEach(freezeValue);
    return value !== null && typeof value === "object" ? Object.freeze(value) : value;
  }
  function mergeValue(defaultValue, inputValue) {
    if (inputValue === void 0) return cloneValue(defaultValue);
    if (isPlainObject(defaultValue) && isPlainObject(inputValue)) {
      const result = {};
      const keys = /* @__PURE__ */ new Set([...Object.keys(defaultValue), ...Object.keys(inputValue)]);
      for (const key of keys) {
        result[key] = mergeValue(defaultValue[key], inputValue[key]);
      }
      return result;
    }
    return cloneValue(inputValue);
  }
  function assertKnownKeys(effectName, input, defaults, path = effectName) {
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
  function assertNumber(value, path, { min = -Infinity, max = Infinity, integer = false } = {}) {
    if (!Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) {
      const kind = integer ? "an integer" : "a finite number";
      throw new RangeError(`${path} must be ${kind} between ${min} and ${max}.`);
    }
  }
  function assertBoolean(value, path) {
    if (typeof value !== "boolean") throw new TypeError(`${path} must be a boolean.`);
  }
  function assertString(value, path, { allowEmpty = false } = {}) {
    if (typeof value !== "string" || !allowEmpty && value.length === 0) {
      throw new TypeError(`${path} must be a${allowEmpty ? "" : " non-empty"} string.`);
    }
  }
  function assertPalette(palette, path, colorCount) {
    if (!Array.isArray(palette) || palette.length < 2 || palette.length > 64) {
      throw new RangeError(`${path} must contain between 2 and 64 colours.`);
    }
    palette.forEach((color, index) => {
      assertString(color, `${path}[${index}]`);
      if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) {
        throw new TypeError(`${path}[${index}] must use #rgb or #rrggbb.`);
      }
    });
    assertNumber(colorCount, path.replace(/palette$/, "colorCount"), {
      min: 2,
      max: 4096,
      integer: true
    });
  }
  function validateCommonConfig(effectName, config) {
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
  function cloneConfig(config) {
    return cloneValue(config);
  }
  function createEffectDefaults(overrides = {}) {
    return freezeValue(mergeValue({
      runtime: COMMON_DEFAULTS.runtime,
      render: COMMON_DEFAULTS.render,
      motion: COMMON_DEFAULTS.motion,
      appearance: COMMON_DEFAULTS.appearance
    }, overrides));
  }
  var COMMON_DEFAULTS = Object.freeze({
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
      palette: Object.freeze(["#000000", "#ffffff"]),
      colorCount: 256,
      backgroundColor: "#000000"
    })
  });

  // src/runtime.js
  var RUNTIME_KEY = Symbol.for("demoscene-classics.runtime");
  var MAX_DELTA_SECONDS = 0.05;
  var FRAME_INTERVAL_TOLERANCE_MS = 1;
  function resolveCanvas(target) {
    const canvas = typeof target === "string" ? globalThis.document?.querySelector(target) : target;
    if (!canvas) {
      throw new TypeError(`Demoscene target not found: ${String(target)}`);
    }
    if (typeof canvas.getContext !== "function") {
      throw new TypeError("Demoscene target must be a <canvas> element.");
    }
    return canvas;
  }
  function measureCanvas(canvas, pixelRatio = 1) {
    const rect = typeof canvas.getBoundingClientRect === "function" ? canvas.getBoundingClientRect() : null;
    const cssWidth = rect?.width || canvas.clientWidth || canvas.width || 1;
    const cssHeight = rect?.height || canvas.clientHeight || canvas.height || 1;
    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * pixelRatio));
    return { width, height };
  }
  function createScheduler() {
    const controllers = /* @__PURE__ */ new Set();
    let frameId = null;
    const requestFrame = globalThis.requestAnimationFrame?.bind(globalThis);
    const cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis);
    if (!requestFrame) {
      throw new Error("Demoscene requires requestAnimationFrame.");
    }
    function hasRunnableController() {
      for (const controller of controllers) {
        if (controller._isRunnable()) return true;
      }
      return false;
    }
    function schedule() {
      if (frameId === null && hasRunnableController()) {
        frameId = requestFrame(tick);
      }
    }
    function tick(timestamp) {
      frameId = null;
      for (const controller of controllers) {
        if (controller._isRunnable()) controller._tick(timestamp);
      }
      schedule();
    }
    return {
      add(controller) {
        controllers.add(controller);
        schedule();
      },
      remove(controller) {
        controllers.delete(controller);
        if (!hasRunnableController() && frameId !== null && cancelFrame) {
          cancelFrame(frameId);
          frameId = null;
        }
      },
      wake() {
        schedule();
      }
    };
  }
  function getScheduler() {
    if (!globalThis[RUNTIME_KEY]) {
      Object.defineProperty(globalThis, RUNTIME_KEY, {
        value: createScheduler(),
        configurable: false,
        enumerable: false,
        writable: false
      });
    }
    return globalThis[RUNTIME_KEY];
  }
  function mountEffect(target, rendererFactory, config, selection = null) {
    const canvas = resolveCanvas(target);
    const { autoStart, maxFps, pixelRatio, pauseWhenHidden } = config.runtime;
    const minimumFrameInterval = maxFps === Infinity ? 0 : 1e3 / maxFps;
    const scheduler = getScheduler();
    let renderer;
    let running = false;
    let visible = true;
    let destroyed = false;
    let elapsed = 0;
    let staticTime = null;
    let lastTimestamp = null;
    let lastRenderTimestamp = null;
    let pendingDelta = 0;
    let resizeObserver = null;
    let intersectionObserver = null;
    let fallbackResizeListener = null;
    let width = 0;
    let height = 0;
    let renderedFrames = 0;
    let lastFrameMs = 0;
    let totalFrameMs = 0;
    function renderFrame(frame) {
      const started = globalThis.performance?.now?.() ?? Date.now();
      renderer.render(frame);
      lastFrameMs = (globalThis.performance?.now?.() ?? Date.now()) - started;
      totalFrameMs += lastFrameMs;
      renderedFrames++;
    }
    function applySize(force = false) {
      if (destroyed) return;
      const size = measureCanvas(canvas, pixelRatio);
      if (!force && size.width === width && size.height === height) return;
      width = size.width;
      height = size.height;
      canvas.width = width;
      canvas.height = height;
      renderer?.resize?.(width, height);
      if (renderer && staticTime !== null && !running) {
        renderFrame({ time: staticTime, delta: 0 });
      }
    }
    applySize(true);
    renderer = rendererFactory({ canvas, config });
    if (!renderer || typeof renderer.render !== "function") {
      throw new TypeError("A Demoscene renderer must provide render().");
    }
    renderer.resize?.(width, height);
    const controller = {
      start() {
        if (destroyed || running) return controller;
        running = true;
        staticTime = null;
        lastTimestamp = null;
        lastRenderTimestamp = null;
        pendingDelta = 0;
        scheduler.add(controller);
        return controller;
      },
      stop() {
        if (!running) return controller;
        running = false;
        lastTimestamp = null;
        lastRenderTimestamp = null;
        pendingDelta = 0;
        scheduler.remove(controller);
        return controller;
      },
      resize() {
        applySize(true);
        return controller;
      },
      renderOnce(timeSeconds = 0) {
        if (destroyed) return controller;
        if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
          throw new RangeError("Demoscene renderOnce time must be a non-negative number.");
        }
        controller.stop();
        elapsed = timeSeconds;
        staticTime = timeSeconds;
        applySize(true);
        return controller;
      },
      getConfig() {
        return freezeValue(cloneConfig(config));
      },
      getSelection() {
        return selection;
      },
      getStats() {
        return {
          backend: renderer?.getStats?.().backend ?? "canvas2d",
          renderedFrames,
          lastFrameMs,
          averageFrameMs: renderedFrames ? totalFrameMs / renderedFrames : 0
        };
      },
      destroy() {
        if (destroyed) return;
        controller.stop();
        destroyed = true;
        resizeObserver?.disconnect();
        intersectionObserver?.disconnect();
        if (fallbackResizeListener && typeof globalThis.removeEventListener === "function") {
          globalThis.removeEventListener("resize", fallbackResizeListener);
        }
        if (renderer?.pointer && typeof canvas.removeEventListener === "function") {
          canvas.removeEventListener("pointermove", onPointerMove);
          canvas.removeEventListener("pointerleave", onPointerLeave);
        }
        renderer.destroy?.();
        renderer = null;
      },
      _isRunnable() {
        return running && visible && !destroyed && (typeof renderer?.isAvailable !== "function" || renderer.isAvailable());
      },
      _tick(timestamp) {
        let delta = 0;
        if (lastTimestamp !== null) {
          delta = Math.min(MAX_DELTA_SECONDS, Math.max(0, (timestamp - lastTimestamp) / 1e3));
        }
        lastTimestamp = timestamp;
        pendingDelta += delta;
        if (lastRenderTimestamp !== null && timestamp - lastRenderTimestamp + FRAME_INTERVAL_TOLERANCE_MS < minimumFrameInterval) {
          return;
        }
        lastRenderTimestamp = timestamp;
        const renderDelta = pendingDelta;
        pendingDelta = 0;
        elapsed += renderDelta;
        renderFrame({ time: elapsed, delta: renderDelta });
      }
    };
    renderer.setWake?.(() => scheduler.wake());
    function onPointerMove(event) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      renderer?.pointer?.(
        (event.clientX - rect.left) * canvas.width / rect.width,
        (event.clientY - rect.top) * canvas.height / rect.height
      );
    }
    function onPointerLeave() {
      renderer?.pointer?.(null, null);
    }
    if (typeof globalThis.ResizeObserver === "function") {
      resizeObserver = new globalThis.ResizeObserver(() => applySize());
      resizeObserver.observe(canvas);
    } else if (typeof globalThis.addEventListener === "function") {
      fallbackResizeListener = () => applySize();
      globalThis.addEventListener("resize", fallbackResizeListener);
    }
    if (pauseWhenHidden && typeof globalThis.IntersectionObserver === "function") {
      intersectionObserver = new globalThis.IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        const nextVisible = Boolean(entry?.isIntersecting);
        if (visible === nextVisible) return;
        visible = nextVisible;
        lastTimestamp = null;
        lastRenderTimestamp = null;
        pendingDelta = 0;
        if (visible) scheduler.wake();
      });
      intersectionObserver.observe(canvas);
    }
    if (renderer.pointer && typeof canvas.addEventListener === "function") {
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", onPointerLeave);
    }
    if (autoStart) controller.start();
    return controller;
  }

  // src/resolver.js
  var DESCRIPTOR_KEYS = /* @__PURE__ */ new Set(["skin", "surface", "device", "config"]);
  var V2_GROUPS = /* @__PURE__ */ new Set([
    "runtime",
    "render",
    "motion",
    "appearance",
    "field",
    "simulation",
    "particles",
    "geometry",
    "camera",
    "algorithm",
    "texture",
    "feedback",
    "bars",
    "shading",
    "text",
    "wave",
    "stars"
  ]);
  var VALID_DEVICES = ["auto", "desktop", "mobile"];
  function detectLegacy(name, input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError(`${name}: descriptor must be an object.`);
    }
    for (const key of Object.keys(input)) {
      if (V2_GROUPS.has(key)) {
        throw new TypeError(
          `${name}: the legacy v2 flat options object is no longer supported in API v3. Move '${key}' under the config escape hatch, e.g. Demoscene.${name}(canvas, { skin: 'classic', surface: 'fullscreen', device: 'auto', config: { ${key}: ... } }). See the API v3 migration guide.`
        );
      }
      if (!DESCRIPTOR_KEYS.has(key)) {
        throw new RangeError(`Unknown descriptor field: ${name}.${key}`);
      }
    }
  }
  function resolveSkin(name, skinField, skins) {
    if (skinField === void 0 || skinField === null) {
      return { requested: "classic", presetName: "classic", overrides: {} };
    }
    if (typeof skinField === "string") {
      if (!(skinField in skins)) {
        throw new RangeError(`${name}: unknown skin '${skinField}'. Known skins: ${Object.keys(skins).join(", ")}.`);
      }
      return { requested: skinField, presetName: skinField, overrides: {} };
    }
    if (isPlainObject(skinField)) {
      for (const key of Object.keys(skinField)) {
        if (key !== "preset" && key !== "overrides") {
          throw new RangeError(`Unknown skin field: ${name}.skin.${key} (use 'preset' and/or 'overrides').`);
        }
      }
      const presetName = skinField.preset ?? "classic";
      if (typeof presetName !== "string" || !(presetName in skins)) {
        throw new RangeError(`${name}: unknown skin preset '${String(presetName)}'. Known skins: ${Object.keys(skins).join(", ")}.`);
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
    const surfaceName = surfaceField ?? "fullscreen";
    if (typeof surfaceName !== "string" || !(surfaceName in surfaces)) {
      throw new RangeError(`${name}: unknown surface '${String(surfaceName)}'. Known surfaces: ${Object.keys(surfaces).join(", ")}.`);
    }
    return surfaceName;
  }
  function detectDevice(requestedDevice) {
    if (requestedDevice !== "auto") return requestedDevice;
    const matchMedia = globalThis.matchMedia;
    if (typeof matchMedia !== "function") return "desktop";
    try {
      const narrow = matchMedia("(max-width: 767px)");
      const coarse = matchMedia("(hover: none) and (pointer: coarse)");
      const isMobile = Boolean(narrow?.matches) || Boolean(coarse?.matches);
      return isMobile ? "mobile" : "desktop";
    } catch {
      return "desktop";
    }
  }
  function resolveDevice(name, deviceField, devices) {
    const requestedDevice = deviceField ?? "auto";
    if (!VALID_DEVICES.includes(requestedDevice)) {
      throw new RangeError(`${name}: unknown device '${String(requestedDevice)}'. Known devices: ${VALID_DEVICES.join(", ")}.`);
    }
    const resolvedDevice = detectDevice(requestedDevice);
    if (!(resolvedDevice in devices)) {
      throw new RangeError(`${name}: unknown resolved device '${resolvedDevice}'.`);
    }
    return { requestedDevice, resolvedDevice };
  }
  function assertSkinPaths(name, label, overlay, allow) {
    if (!isPlainObject(overlay)) return;
    for (const key of Object.keys(overlay)) {
      if (!allow.has(key)) {
        throw new RangeError(
          `${name}: skin ${label} is out of scope at '${key}'. Skins may only touch: ${[...allow].join(", ")}. To override an algorithmic field, pass it under 'config' instead.`
        );
      }
    }
  }
  function resolveDescriptor(definition, descriptor) {
    const {
      name,
      configDefaults,
      validate = () => {
      },
      skins,
      profiles,
      capabilities
    } = definition;
    const input = descriptor === void 0 ? {} : descriptor;
    detectLegacy(name, input);
    const { requested, presetName, overrides } = resolveSkin(name, input.skin, skins);
    const preset = skins[presetName] ?? {};
    const surfaceName = resolveSurface(name, input.surface, profiles.surfaces);
    const { requestedDevice, resolvedDevice } = resolveDevice(name, input.device, profiles.devices);
    const slotKey = `${surfaceName}.${resolvedDevice}`;
    const profileOverlay = profiles.slots?.[slotKey] ?? {};
    const explicit = input.config ?? {};
    if (!isPlainObject(explicit)) {
      throw new TypeError(`${name}.config must be an object.`);
    }
    const allow = capabilities?.skinAllow ?? /* @__PURE__ */ new Set();
    assertSkinPaths(name, `preset '${presetName}'`, preset, allow);
    assertSkinPaths(name, "overrides", overrides, allow);
    assertKnownKeys(name, explicit, configDefaults);
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

  // src/install.js
  function installEffect(definition) {
    const { name } = definition;
    const namespace = globalThis.Demoscene && typeof globalThis.Demoscene === "object" ? globalThis.Demoscene : {};
    namespace[name] = (target, descriptor) => {
      const { config, selection } = resolveDescriptor(definition, descriptor);
      return mountEffect(target, definition.rendererFactory, config, selection);
    };
    globalThis.Demoscene = namespace;
    return namespace[name];
  }

  // src/effects/mandelbrot/mandelbrot-core.js
  function mandelbrotZoom(time, {
    minZoom,
    maxZoom,
    cycleSeconds,
    startPhase
  }) {
    const phase = ((time / cycleSeconds + startPhase) % 1 + 1) % 1;
    const wave = (Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1) / 2;
    const eased = wave * wave * (3 - 2 * wave);
    const minimumExponent = Math.log10(minZoom);
    const maximumExponent = Math.log10(maxZoom);
    return 10 ** (minimumExponent + eased * (maximumExponent - minimumExponent));
  }
  function isMainInterior(real, imaginary) {
    const shifted = real - 0.25;
    const q = shifted * shifted + imaginary * imaginary;
    return q * (q + shifted) <= 0.25 * imaginary * imaginary || (real + 1) * (real + 1) + imaginary * imaginary <= 0.0625;
  }
  function renderMandelbrotPixels({
    pixels,
    width,
    height,
    time,
    config,
    palette,
    interiorColor
  }) {
    const zoom = mandelbrotZoom(time * config.motion.speed, {
      ...config.camera,
      ...config.motion
    });
    const span = 3 / zoom;
    const aspect = width / height;
    const calculatedIterations = Math.floor(
      config.algorithm.iterationBase + config.algorithm.iterationGrowth * Math.log10(zoom + 1)
    );
    const maxIterations = config.algorithm.maxIterations ?? calculatedIterations;
    const escapeSquared = config.algorithm.escapeRadius ** 2;
    const log2 = Math.log(2);
    const realStep = 2 * span / width;
    const imaginaryStep = 2 * span / aspect / height;
    const realStart = config.camera.centerX - span;
    const imaginaryStart = config.camera.centerY - span / aspect;
    const checkMainInterior = zoom < 100;
    let index = 0;
    for (let y = 0; y < height; y++) {
      const imaginary = imaginaryStart + y * imaginaryStep;
      for (let x = 0; x < width; x++) {
        const real = realStart + x * realStep;
        if (checkMainInterior && isMainInterior(real, imaginary)) {
          pixels[index++] = interiorColor;
          continue;
        }
        let zReal = 0;
        let zImaginary = 0;
        let zRealSquared = 0;
        let zImaginarySquared = 0;
        let iteration = 0;
        while (zRealSquared + zImaginarySquared < escapeSquared && iteration < maxIterations) {
          zImaginary = 2 * zReal * zImaginary + imaginary;
          zReal = zRealSquared - zImaginarySquared + real;
          zRealSquared = zReal * zReal;
          zImaginarySquared = zImaginary * zImaginary;
          iteration++;
        }
        if (iteration === maxIterations) {
          pixels[index++] = interiorColor;
          continue;
        }
        const logZn = Math.log(zRealSquared + zImaginarySquared) / 2;
        const nu = Math.log(logZn / log2) / log2;
        const smooth = iteration + 1 - nu;
        pixels[index++] = palette[Math.abs(Math.floor(smooth * 8)) % palette.length];
      }
    }
    return { zoom, maxIterations };
  }

  // src/effects/utils.js
  function getContext2D(canvas, options) {
    const context = canvas.getContext("2d", options);
    if (!context) throw new Error("Demoscene requires a Canvas 2D context.");
    return context;
  }
  function createPixelBuffer() {
    const canvas = globalThis.document.createElement("canvas");
    const context = getContext2D(canvas);
    return { canvas, context, image: null, pixels: null, width: 0, height: 0 };
  }
  function resizePixelBuffer(buffer, width, height) {
    buffer.width = Math.max(2, Math.floor(width));
    buffer.height = Math.max(2, Math.floor(height));
    buffer.canvas.width = buffer.width;
    buffer.canvas.height = buffer.height;
    buffer.image = buffer.context.createImageData(buffer.width, buffer.height);
    buffer.pixels = new Uint32Array(buffer.image.data.buffer);
    return buffer;
  }
  function presentPixelBuffer(context, buffer, width, height, smoothing) {
    buffer.context.putImageData(buffer.image, 0, 0);
    context.imageSmoothingEnabled = smoothing;
    context.drawImage(buffer.canvas, 0, 0, width, height);
  }
  function packRgb(red, green, blue) {
    return 255 << 24 | (blue | 0) << 16 | (green | 0) << 8 | (red | 0);
  }
  function parseHexColor(value, label = "color") {
    if (typeof value !== "string") {
      throw new TypeError(`Demoscene ${label} must be a hex color string.`);
    }
    const match = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    if (!match) {
      throw new TypeError(`Demoscene ${label} must use #rgb or #rrggbb.`);
    }
    const hex = match[1].length === 3 ? match[1].split("").map((character) => character + character).join("") : match[1];
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16)
    ];
  }
  function buildGradientPalette(target, colors) {
    if (!Array.isArray(colors) || colors.length < 2) {
      throw new RangeError("Demoscene palette must contain at least two hex colors.");
    }
    const parsed = colors.map((color, index) => parseHexColor(color, `palette[${index}]`));
    const segmentCount = parsed.length - 1;
    for (let index = 0; index < target.length; index++) {
      const position = index / Math.max(1, target.length - 1) * segmentCount;
      const leftIndex = Math.min(segmentCount - 1, Math.floor(position));
      const mix = Math.min(1, position - leftIndex);
      const left = parsed[leftIndex];
      const right = parsed[leftIndex + 1];
      target[index] = packRgb(
        Math.round(left[0] + (right[0] - left[0]) * mix),
        Math.round(left[1] + (right[1] - left[1]) * mix),
        Math.round(left[2] + (right[2] - left[2]) * mix)
      );
    }
    return target;
  }
  function packHexColor(color) {
    const [red, green, blue] = parseHexColor(color);
    return packRgb(red, green, blue);
  }
  var SINE_PHASE_OFFSETS = [0, 2 * Math.PI / 3, 4 * Math.PI / 3];

  // src/effects/mandelbrot/mandelbrot-webgl.js
  var VERTEX_SHADER = `#version 300 es
const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

void main() {
  gl_Position = vec4(POSITIONS[gl_VertexID], 0.0, 1.0);
}`;
  var FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uSpan;
uniform float uEscapeSquared;
uniform float uZoom;
uniform int uMaxIterations;
uniform int uUsePerturbation;
uniform sampler2D uReferenceOrbit;
uniform int uReferenceWidth;
uniform sampler2D uPalette;
uniform int uPaletteWidth;
uniform int uPaletteSize;
uniform vec4 uInteriorColor;

out vec4 fragmentColor;

vec2 complexSquare(vec2 value) {
  return vec2(
    value.x * value.x - value.y * value.y,
    2.0 * value.x * value.y
  );
}

vec2 complexMultiply(vec2 left, vec2 right) {
  return vec2(
    left.x * right.x - left.y * right.y,
    left.x * right.y + left.y * right.x
  );
}

vec4 referenceValue(int index) {
  return texelFetch(
    uReferenceOrbit,
    ivec2(index % uReferenceWidth, index / uReferenceWidth),
    0
  );
}

vec4 paletteValue(int index) {
  return texelFetch(
    uPalette,
    ivec2(index % uPaletteWidth, index / uPaletteWidth),
    0
  );
}

bool isMainInterior(vec2 point) {
  float shifted = point.x - 0.25;
  float q = shifted * shifted + point.y * point.y;
  return q * (q + shifted) <= 0.25 * point.y * point.y
    || (point.x + 1.0) * (point.x + 1.0) + point.y * point.y <= 0.0625;
}

void main() {
  float pixelX = gl_FragCoord.x - 0.5;
  float pixelY = uResolution.y - gl_FragCoord.y - 0.5;
  float aspect = uResolution.x / uResolution.y;
  vec2 deltaC = vec2(
    -uSpan + 2.0 * uSpan * pixelX / uResolution.x,
    -uSpan / aspect + 2.0 * uSpan * pixelY / (aspect * uResolution.y)
  );
  vec2 point = uCenter + deltaC;

  if (uZoom < 100.0 && isMainInterior(point)) {
    fragmentColor = uInteriorColor;
    return;
  }

  vec2 z = vec2(0.0);
  vec2 deltaZ = vec2(0.0);
  int iteration = 0;
  bool escaped = false;

  for (int index = 0; index < uMaxIterations; index++) {
    if (uUsePerturbation == 1) {
      vec4 packedReference = referenceValue(index);
      vec4 packedNext = referenceValue(index + 1);
      vec2 referenceHigh = packedReference.rg;
      vec2 referenceLow = packedReference.ba;
      deltaZ = complexSquare(deltaZ)
        + 2.0 * complexMultiply(referenceHigh, deltaZ)
        + 2.0 * complexMultiply(referenceLow, deltaZ)
        + deltaC;
      z = packedNext.rg + (packedNext.ba + deltaZ);
    } else {
      z = complexSquare(z) + point;
    }

    iteration = index + 1;
    if (dot(z, z) >= uEscapeSquared) {
      escaped = true;
      break;
    }
  }

  if (!escaped) {
    fragmentColor = uInteriorColor;
    return;
  }

  const float LOG_TWO = 0.6931471805599453;
  float logZn = log(dot(z, z)) * 0.5;
  float nu = log(logZn / LOG_TWO) / LOG_TWO;
  float smoothValue = float(iteration) + 1.0 - nu;
  int paletteIndex = int(abs(floor(smoothValue * 8.0))) % uPaletteSize;
  fragmentColor = paletteValue(paletteIndex);
}`;
  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Unable to create Mandelbrot WebGL2 shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Unknown shader compilation error.";
      gl.deleteShader(shader);
      throw new Error(`Mandelbrot WebGL2 shader failed: ${message}`);
    }
    return shader;
  }
  function createProgram(gl) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error("Unable to create Mandelbrot WebGL2 program.");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Unknown program link error.";
      gl.deleteProgram(program);
      throw new Error(`Mandelbrot WebGL2 program failed: ${message}`);
    }
    return program;
  }
  function isWebGL2Context(context) {
    return Boolean(context && typeof context.createShader === "function" && typeof context.drawArrays === "function" && typeof context.texImage2D === "function");
  }
  function probeMandelbrotWebGL2() {
    const canvas = globalThis.document?.createElement?.("canvas");
    const gl = canvas?.getContext?.("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false
    });
    if (!isWebGL2Context(gl)) return false;
    try {
      const program = createProgram(gl);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return true;
    } catch {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return false;
    }
  }
  function textureShape(gl, length) {
    const maximumWidth = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const width = Math.min(maximumWidth, length);
    return { width, height: Math.ceil(length / width) };
  }
  function createTexture(gl, unit) {
    const texture = gl.createTexture();
    if (!texture) throw new Error("Unable to create Mandelbrot WebGL2 texture.");
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }
  function fillReferenceOrbit(target, maximumIterations, centerX, centerY) {
    let real = 0;
    let imaginary = 0;
    let valid = true;
    function store(index) {
      const offset = index * 4;
      const highReal = Math.fround(real);
      const highImaginary = Math.fround(imaginary);
      target[offset] = highReal;
      target[offset + 1] = highImaginary;
      target[offset + 2] = real - highReal;
      target[offset + 3] = imaginary - highImaginary;
    }
    store(0);
    for (let index = 0; index < maximumIterations; index++) {
      const nextImaginary = 2 * real * imaginary + centerY;
      const nextReal = real * real - imaginary * imaginary + centerX;
      real = nextReal;
      imaginary = nextImaginary;
      if (!Number.isFinite(real) || !Number.isFinite(imaginary)) valid = false;
      store(index + 1);
    }
    return valid;
  }
  function uploadPalette(gl, texture, palette, shape) {
    const bytes = new Uint8Array(shape.width * shape.height * 4);
    for (let index = 0; index < palette.length; index++) {
      const packed = palette[index] >>> 0;
      const offset = index * 4;
      bytes[offset] = packed & 255;
      bytes[offset + 1] = packed >>> 8 & 255;
      bytes[offset + 2] = packed >>> 16 & 255;
      bytes[offset + 3] = 255;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      shape.width,
      shape.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bytes
    );
  }
  function colorChannels(packed) {
    const color = packed >>> 0;
    return [
      (color & 255) / 255,
      (color >>> 8 & 255) / 255,
      (color >>> 16 & 255) / 255,
      1
    ];
  }
  function createMandelbrotWebGLRenderer({ canvas, config }) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      // renderOnce() must remain visible after the compositor has consumed the
      // frame (notably for reduced-motion and static proof captures).
      preserveDrawingBuffer: true,
      powerPreference: "high-performance"
    });
    if (!isWebGL2Context(gl)) throw new Error("WebGL2 is not available.");
    let program = null;
    let referenceTexture = null;
    let paletteTexture = null;
    let referenceShape = null;
    let referencePixels = null;
    let referenceOrbitValid = false;
    let width = 2;
    let height = 2;
    let contextLost = false;
    let wakeScheduler = null;
    const previousImageRendering = canvas.style?.imageRendering;
    const palette = buildGradientPalette(
      new Uint32Array(config.appearance.colorCount),
      config.appearance.palette
    );
    const paletteShape = textureShape(gl, palette.length);
    const interiorColor = colorChannels(packHexColor(config.appearance.interiorColor));
    const maximumIterations = config.algorithm.maxIterations ?? Math.floor(
      config.algorithm.iterationBase + config.algorithm.iterationGrowth * Math.log10(config.camera.maxZoom + 1)
    );
    function uniforms() {
      const names = [
        "uResolution",
        "uCenter",
        "uSpan",
        "uEscapeSquared",
        "uZoom",
        "uMaxIterations",
        "uUsePerturbation",
        "uReferenceOrbit",
        "uReferenceWidth",
        "uPalette",
        "uPaletteWidth",
        "uPaletteSize",
        "uInteriorColor"
      ];
      return Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
    }
    let locations = null;
    function initialize() {
      program = createProgram(gl);
      locations = uniforms();
      referenceTexture = createTexture(gl, 0);
      paletteTexture = createTexture(gl, 1);
      referenceShape = textureShape(gl, maximumIterations + 1);
      referencePixels = new Float32Array(referenceShape.width * referenceShape.height * 4);
      referenceOrbitValid = fillReferenceOrbit(
        referencePixels,
        maximumIterations,
        config.camera.centerX,
        config.camera.centerY
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, referenceTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32F,
        referenceShape.width,
        referenceShape.height,
        0,
        gl.RGBA,
        gl.FLOAT,
        referencePixels
      );
      uploadPalette(gl, paletteTexture, palette, paletteShape);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
    }
    function disposeResources() {
      if (referenceTexture) gl.deleteTexture(referenceTexture);
      if (paletteTexture) gl.deleteTexture(paletteTexture);
      if (program) gl.deleteProgram(program);
      referenceTexture = null;
      paletteTexture = null;
      program = null;
      locations = null;
    }
    function onContextLost(event) {
      event.preventDefault?.();
      contextLost = true;
    }
    function onContextRestored() {
      contextLost = false;
      disposeResources();
      initialize();
      wakeScheduler?.();
    }
    canvas.addEventListener?.("webglcontextlost", onContextLost);
    canvas.addEventListener?.("webglcontextrestored", onContextRestored);
    initialize();
    if (canvas.style) canvas.style.imageRendering = config.render.smoothing ? "auto" : "pixelated";
    return {
      resize(nextWidth, nextHeight) {
        width = Math.max(2, Math.floor(nextWidth * config.render.resolution));
        height = Math.max(2, Math.floor(nextHeight * config.render.resolution));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        gl.viewport(0, 0, width, height);
      },
      render({ time }) {
        if (contextLost || !program) return;
        const zoom = mandelbrotZoom(time * config.motion.speed, {
          ...config.camera,
          ...config.motion
        });
        const calculatedIterations = Math.floor(
          config.algorithm.iterationBase + config.algorithm.iterationGrowth * Math.log10(zoom + 1)
        );
        const frameIterations = config.algorithm.maxIterations ?? calculatedIterations;
        const usePerturbation = zoom >= 1e3 && referenceOrbitValid;
        gl.useProgram(program);
        gl.viewport(0, 0, width, height);
        gl.uniform2f(locations.uResolution, width, height);
        gl.uniform2f(locations.uCenter, config.camera.centerX, config.camera.centerY);
        gl.uniform1f(locations.uSpan, 3 / zoom);
        gl.uniform1f(locations.uEscapeSquared, config.algorithm.escapeRadius ** 2);
        gl.uniform1f(locations.uZoom, zoom);
        gl.uniform1i(locations.uMaxIterations, frameIterations);
        gl.uniform1i(locations.uUsePerturbation, usePerturbation ? 1 : 0);
        gl.uniform1i(locations.uReferenceOrbit, 0);
        gl.uniform1i(locations.uReferenceWidth, referenceShape.width);
        gl.uniform1i(locations.uPalette, 1);
        gl.uniform1i(locations.uPaletteWidth, paletteShape.width);
        gl.uniform1i(locations.uPaletteSize, palette.length);
        gl.uniform4f(locations.uInteriorColor, ...interiorColor);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      getStats() {
        return { backend: "webgl2" };
      },
      isAvailable() {
        return !contextLost;
      },
      setWake(callback) {
        wakeScheduler = callback;
      },
      destroy() {
        canvas.removeEventListener?.("webglcontextlost", onContextLost);
        canvas.removeEventListener?.("webglcontextrestored", onContextRestored);
        if (canvas.style) canvas.style.imageRendering = previousImageRendering;
        wakeScheduler = null;
        disposeResources();
      }
    };
  }

  // src/effects/mandelbrot/renderer.js
  var MANDELBROT_INTERIOR_COLOR = packRgb(0, 0, 0);
  function createMandelbrotCanvas2DRenderer({ canvas, config }) {
    const context = getContext2D(canvas, { alpha: false });
    const buffer = createPixelBuffer();
    const palette = buildGradientPalette(
      new Uint32Array(config.appearance.colorCount),
      config.appearance.palette
    );
    const interiorColor = packHexColor(config.appearance.interiorColor);
    let width = 1;
    let height = 1;
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        resizePixelBuffer(
          buffer,
          width * config.render.resolution,
          height * config.render.resolution
        );
      },
      render({ time }) {
        renderMandelbrotPixels({
          pixels: buffer.pixels,
          width: buffer.width,
          height: buffer.height,
          time,
          config,
          palette,
          interiorColor
        });
        presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
      },
      getStats() {
        return { backend: "canvas2d" };
      }
    };
  }
  function createMandelbrotRenderer({ canvas, config }) {
    if (config.render.backend !== "canvas2d" && probeMandelbrotWebGL2()) {
      try {
        return createMandelbrotWebGLRenderer({ canvas, config });
      } catch (error) {
        globalThis.console?.warn?.("Mandelbrot WebGL2 unavailable; using Canvas 2D.", error);
      }
    }
    return createMandelbrotCanvas2DRenderer({ canvas, config });
  }

  // src/effects/mandelbrot/config.js
  var MANDELBROT_DEFAULTS = createEffectDefaults({
    render: { backend: "canvas2d", resolution: 0.2, smoothing: false },
    motion: { speed: 1, cycleSeconds: 28, startPhase: 0 },
    appearance: {
      palette: [
        "#80ed12",
        "#bfbf01",
        "#ed8012",
        "#ff4040",
        "#ed127f",
        "#bf01bf",
        "#8012ed",
        "#4040ff",
        "#127fed",
        "#01bfbf",
        "#12ed80",
        "#40ff40",
        "#7fed12"
      ],
      colorCount: 1024,
      backgroundColor: "#000000",
      interiorColor: "#000000"
    },
    camera: {
      centerX: -0.7436438870371587,
      centerY: 0.1318259042053119,
      minZoom: 1,
      maxZoom: 1e6
    },
    algorithm: {
      iterationBase: 80,
      iterationGrowth: 60,
      maxIterations: null,
      escapeRadius: 16
    }
  });
  function validateMandelbrot(config) {
    assertString(config.render.backend, "mandelbrot.render.backend");
    if (!["auto", "webgl2", "canvas2d"].includes(config.render.backend)) {
      throw new RangeError("mandelbrot.render.backend must be auto, webgl2 or canvas2d.");
    }
    assertNumber(config.motion.cycleSeconds, "mandelbrot.motion.cycleSeconds", { min: Number.MIN_VALUE });
    assertNumber(config.motion.startPhase, "mandelbrot.motion.startPhase", { min: 0, max: 1 });
    for (const key of ["centerX", "centerY"]) {
      assertNumber(config.camera[key], `mandelbrot.camera.${key}`);
    }
    assertNumber(config.camera.minZoom, "mandelbrot.camera.minZoom", { min: Number.MIN_VALUE });
    assertNumber(config.camera.maxZoom, "mandelbrot.camera.maxZoom", {
      min: config.camera.minZoom + Number.EPSILON
    });
    assertNumber(config.algorithm.iterationBase, "mandelbrot.algorithm.iterationBase", { min: 1 });
    assertNumber(config.algorithm.iterationGrowth, "mandelbrot.algorithm.iterationGrowth", { min: 0 });
    if (config.algorithm.maxIterations !== null) {
      assertNumber(config.algorithm.maxIterations, "mandelbrot.algorithm.maxIterations", {
        min: 1,
        max: 1e4,
        integer: true
      });
    }
    assertNumber(config.algorithm.escapeRadius, "mandelbrot.algorithm.escapeRadius", { min: 2 });
  }

  // src/effects/mandelbrot/skins.js
  var MANDELBROT_SKINS = Object.freeze({
    classic: Object.freeze({})
  });

  // src/effects/profiles.js
  var SURFACES = ["fullscreen", "preview"];
  var DEVICES = ["desktop", "mobile"];
  var SLOT_KEYS = ["fullscreen.desktop", "fullscreen.mobile", "preview.desktop", "preview.mobile"];
  function buildProfiles(slots) {
    if (!slots || typeof slots !== "object") {
      throw new TypeError("buildProfiles expects a slots object.");
    }
    for (const key of SLOT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(slots, key)) {
        throw new RangeError(`Profile slot '${key}' is missing; every effect must define all four slots.`);
      }
      if (!isPlainObject2(slots[key])) {
        throw new RangeError(`Profile slot '${key}' must be a plain object.`);
      }
    }
    for (const key of Object.keys(slots)) {
      if (!SLOT_KEYS.includes(key)) {
        throw new RangeError(`Unknown profile slot '${key}'. Expected one of: ${SLOT_KEYS.join(", ")}.`);
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
  function isPlainObject2(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function cloneSlots(slots) {
    const result = {};
    for (const key of SLOT_KEYS) {
      result[key] = { ...slots[key] };
    }
    return result;
  }
  var PROFILE_SURFACES = Object.freeze(SURFACES);
  var PROFILE_DEVICES = Object.freeze(DEVICES);
  var PROFILE_SLOT_KEYS = Object.freeze(SLOT_KEYS);

  // src/effects/mandelbrot/profiles.js
  var RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };
  var PREVIEW_RENDER = { render: { resolution: 0.15, smoothing: true } };
  var MANDELBROT_PROFILES = buildProfiles({
    "fullscreen.desktop": { ...RUNTIME_FULLSCREEN_DESKTOP },
    "fullscreen.mobile": { ...RUNTIME_FULLSCREEN_MOBILE },
    "preview.desktop": { ...RUNTIME_PREVIEW_DESKTOP, ...PREVIEW_RENDER },
    "preview.mobile": { ...RUNTIME_PREVIEW_MOBILE, ...PREVIEW_RENDER }
  });

  // src/effects/mandelbrot/index.js
  var mandelbrotDefinition = {
    name: "mandelbrot",
    rendererFactory: createMandelbrotRenderer,
    configDefaults: MANDELBROT_DEFAULTS,
    validate: validateMandelbrot,
    skins: MANDELBROT_SKINS,
    profiles: MANDELBROT_PROFILES,
    capabilities: {
      // Skins change presentation only. The fractal *camera* target and the
      // escape-time *algorithm* are algorithmic identity and must go through `config`.
      skinAllow: /* @__PURE__ */ new Set(["runtime", "render", "motion", "appearance"])
    }
  };

  // browser-entry.js
  installEffect(mandelbrotDefinition);
})();
