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
    if (!profiles.slots || !Object.prototype.hasOwnProperty.call(profiles.slots, slotKey)) {
      throw new RangeError(
        `${name}: profile slot '${slotKey}' is missing. Every effect must define all four slots: fullscreen.desktop, fullscreen.mobile, preview.desktop, preview.mobile.`
      );
    }
    const profileOverlay = profiles.slots[slotKey];
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
  function createDrawingBuffer() {
    const canvas = globalThis.document.createElement("canvas");
    const context = getContext2D(canvas);
    return { canvas, context, width: 1, height: 1 };
  }
  function resizeDrawingBuffer(buffer, width, height) {
    buffer.width = Math.max(2, Math.floor(width));
    buffer.height = Math.max(2, Math.floor(height));
    buffer.canvas.width = buffer.width;
    buffer.canvas.height = buffer.height;
    return buffer;
  }
  function presentDrawingBuffer(context, buffer, width, height, smoothing) {
    context.imageSmoothingEnabled = smoothing;
    context.drawImage(buffer.canvas, 0, 0, width, height);
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
  function createSeededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = state + 1831565813 | 0;
      let value = Math.imul(state ^ state >>> 15, 1 | state);
      value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }
  function samplePackedPalette(palette, normalized) {
    const index = Math.min(
      palette.length - 1,
      Math.max(0, Math.round(normalized * (palette.length - 1)))
    );
    return palette[index];
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

  // src/effects/plasma/renderer.js
  function createPlasmaRenderer({ canvas, config }) {
    const context = getContext2D(canvas, { alpha: false });
    const buffer = createPixelBuffer();
    const palette = buildGradientPalette(
      new Uint32Array(config.appearance.colorCount),
      config.appearance.palette
    );
    const { field, motion, render } = config;
    const totalAmplitude = field.amplitudes.reduce((sum, item) => sum + Math.abs(item), 0) || 1;
    let width = 1;
    let height = 1;
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        resizePixelBuffer(buffer, width * render.resolution, height * render.resolution);
      },
      render({ time }) {
        const scaledTime = time * motion.speed;
        const phase = scaledTime * 1.2;
        const paletteOffset = Math.floor(scaledTime * motion.paletteCycleSpeed * palette.length);
        const radialX = buffer.width * field.radialCenterX;
        const radialY = buffer.height * field.radialCenterY;
        let index = 0;
        for (let y = 0; y < buffer.height; y++) {
          for (let x = 0; x < buffer.width; x++) {
            let value = Math.sin(x * field.frequencies[0] + phase * field.phaseRates[0]) * field.amplitudes[0];
            value += Math.sin(y * field.frequencies[1] + phase * field.phaseRates[1]) * field.amplitudes[1];
            value += Math.sin((x + y) * field.frequencies[2] + phase * field.phaseRates[2]) * field.amplitudes[2];
            const cx = (x - radialX) * field.frequencies[0];
            const cy = (y - radialY) * field.frequencies[1];
            value += Math.sin(
              Math.sqrt(cx * cx + cy * cy + 1) * field.frequencies[3] + phase * field.phaseRates[3]
            ) * field.amplitudes[3];
            const fieldIndex = Math.min(
              palette.length - 1,
              Math.max(0, Math.floor((value + totalAmplitude) / (totalAmplitude * 2) * palette.length))
            );
            buffer.pixels[index++] = palette[(fieldIndex + paletteOffset) % palette.length];
          }
        }
        presentPixelBuffer(context, buffer, width, height, render.smoothing);
      }
    };
  }

  // src/effects/plasma/config.js
  var PLASMA_DEFAULTS = createEffectDefaults({
    render: { resolution: 0.25, smoothing: false },
    motion: { speed: 1, paletteCycleSpeed: 0.19 },
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
      colorCount: 256,
      backgroundColor: "#000000"
    },
    field: {
      frequencies: [0.04, 0.04, 0.04, 1],
      radialCenterX: 0.5,
      radialCenterY: 0.5,
      amplitudes: [1, 1, 1, 1],
      phaseRates: [1, 0.5, 0.5, 1]
    }
  });
  function validatePlasma(config) {
    assertNumber(config.motion.paletteCycleSpeed, "plasma.motion.paletteCycleSpeed", { min: 0 });
    for (const key of ["radialCenterX", "radialCenterY"]) {
      assertNumber(config.field[key], `plasma.field.${key}`);
    }
    for (const key of ["frequencies", "amplitudes", "phaseRates"]) {
      if (!Array.isArray(config.field[key]) || config.field[key].length !== 4) {
        throw new RangeError(`plasma.field.${key} must contain four numbers.`);
      }
      config.field[key].forEach((value, index) => assertNumber(
        value,
        `plasma.field.${key}[${index}]`,
        key === "frequencies" ? { min: Number.MIN_VALUE } : void 0
      ));
    }
  }

  // src/effects/plasma/skins.js
  var PLASMA_SKINS = Object.freeze({
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
      slots: Object.freeze(cloneSlots(slots, freezeValue)),
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
  function cloneSlots(slots, freezeValue2) {
    const result = {};
    for (const key of SLOT_KEYS) {
      result[key] = freezeValue2(cloneValue(slots[key]));
    }
    return result;
  }
  var PROFILE_SURFACES = Object.freeze(SURFACES);
  var PROFILE_DEVICES = Object.freeze(DEVICES);
  var PROFILE_SLOT_KEYS = Object.freeze(SLOT_KEYS);

  // src/effects/plasma/profiles.js
  var RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };
  var PREVIEW_RENDER = { render: { resolution: 0.2 } };
  var PLASMA_PROFILES = buildProfiles({
    "fullscreen.desktop": { ...RUNTIME_FULLSCREEN_DESKTOP },
    "fullscreen.mobile": { ...RUNTIME_FULLSCREEN_MOBILE },
    "preview.desktop": { ...RUNTIME_PREVIEW_DESKTOP, ...PREVIEW_RENDER },
    "preview.mobile": { ...RUNTIME_PREVIEW_MOBILE, ...PREVIEW_RENDER }
  });

  // src/effects/plasma/index.js
  var plasmaDefinition = {
    name: "plasma",
    rendererFactory: createPlasmaRenderer,
    configDefaults: PLASMA_DEFAULTS,
    validate: validatePlasma,
    skins: PLASMA_SKINS,
    profiles: PLASMA_PROFILES,
    capabilities: {
      // Skins may change presentation only. The plasma *field* (frequencies,
      // centres, amplitudes) is algorithmic identity and must go through `config`.
      skinAllow: /* @__PURE__ */ new Set(["runtime", "render", "motion", "appearance"])
    }
  };

  // src/effects/fire/sim.js
  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }
  function sourceGeometry(W, H, { sourceWidthFrac, sourceDepthFrac }) {
    const depthRows = Math.max(1, Math.round(H * sourceDepthFrac));
    const widthCells = Math.max(1, Math.round(W * sourceWidthFrac));
    const xStart = W - widthCells >> 1;
    return { depthRows, widthCells, xStart, firstSourceRow: H - depthRows };
  }
  function riseStride(H, riseFrac, stepHz) {
    return riseFrac / stepHz * H;
  }
  function coolingPerStep(H, cooling) {
    return Math.min(6 * cooling / H, 0.95);
  }
  function rowAverage(cur, W, rowOffset, x) {
    const xl = x === 0 ? W - 1 : x - 1;
    const xr = x === W - 1 ? 0 : x + 1;
    return (cur[rowOffset + xl] + cur[rowOffset + x] + cur[rowOffset + xr]) / 3;
  }
  function advect(cur, W, x, y, stride, lastRow) {
    const below = y + stride;
    let y0 = Math.floor(below);
    let y1 = y0 + 1;
    if (y0 > lastRow) y0 = lastRow;
    if (y1 > lastRow) y1 = lastRow;
    const frac = below - Math.floor(below);
    const lo = rowAverage(cur, W, y0 * W, x);
    if (frac === 0 || y0 === y1) return lo;
    const hi = rowAverage(cur, W, y1 * W, x);
    return lo + (hi - lo) * frac;
  }
  function stepHeat(cur, next, W, H, params, rng) {
    const { depthRows, widthCells, xStart, firstSourceRow } = sourceGeometry(W, H, params);
    const loss = coolingPerStep(H, params.cooling);
    const stride = riseStride(H, params.riseFrac, params.stepHz);
    const coolFactor = Math.pow(1 - loss, stride);
    const intensity = params.sourceIntensity;
    const lastRow = H - 1;
    const denom = widthCells > 1 ? widthCells - 1 : 1;
    next.fill(0);
    for (let y = firstSourceRow; y <= lastRow; y++) {
      const row = y * W;
      for (let i = 0; i < widthCells; i++) {
        const x = xStart + i;
        const xFrac = i / denom;
        const envelope = 0.5 * (1 + Math.sin(Math.PI * xFrac));
        const flicker = 0.75 + 0.25 * rng();
        next[row + x] = clamp01(intensity * envelope * flicker);
      }
    }
    for (let y = 0; y < firstSourceRow; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        next[row + x] = clamp01(advect(cur, W, x, y, stride, lastRow) * coolFactor);
      }
    }
    for (let y = firstSourceRow; y <= lastRow; y++) {
      const row = y * W;
      for (let x = 0; x < xStart; x++) {
        next[row + x] = clamp01(advect(cur, W, x, y, stride, lastRow) * coolFactor);
      }
      for (let x = xStart + widthCells; x < W; x++) {
        next[row + x] = clamp01(advect(cur, W, x, y, stride, lastRow) * coolFactor);
      }
    }
  }
  function paint(palette, heat, pixels) {
    const max = palette.length - 1;
    for (let i = 0; i < heat.length; i++) {
      pixels[i] = palette[Math.min(max, Math.max(0, Math.round(heat[i] * max)))];
    }
  }

  // src/effects/fire/renderer.js
  function createFireRenderer({ canvas, config }) {
    const context = getContext2D(canvas, { alpha: false });
    const buffer = createPixelBuffer();
    const palette = buildGradientPalette(
      new Uint32Array(config.appearance.colorCount),
      config.appearance.palette
    );
    let cur = new Float32Array(0);
    let next = new Float32Array(0);
    let random = createSeededRandom(config.simulation.seed);
    let accumulator = 0;
    let width = 1;
    let height = 1;
    const stepSeconds = 1 / config.simulation.stepHz;
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        resizePixelBuffer(buffer, width * config.render.resolution, height * config.render.resolution);
        const cells = buffer.width * buffer.height;
        cur = new Float32Array(cells);
        next = new Float32Array(cells);
        random = createSeededRandom(config.simulation.seed);
        accumulator = 0;
      },
      render({ delta }) {
        accumulator += delta * config.motion.speed;
        let steps = 0;
        while (accumulator >= stepSeconds && steps < config.simulation.maxCatchUpSteps) {
          stepHeat(cur, next, buffer.width, buffer.height, config.simulation, random);
          const tmp = cur;
          cur = next;
          next = tmp;
          accumulator -= stepSeconds;
          steps++;
        }
        paint(palette, cur, buffer.pixels);
        presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
      }
    };
  }

  // src/effects/fire/config.js
  var FIRE_DEFAULTS = createEffectDefaults({
    render: { resolution: 0.25, smoothing: false },
    motion: { speed: 1 },
    appearance: {
      // Defensive 2-colour placeholder so a skinless resolve still validates. The
      // real classic ramp (black → burgundy → orange → yellow → near-white) lives
      // in skins.js and overrides this through the resolver merge.
      palette: ["#000000", "#ff7a00"],
      colorCount: 256,
      backgroundColor: "#000000"
    },
    simulation: {
      seed: 1993,
      stepHz: 60,
      sourceWidthFrac: 0.8,
      sourceDepthFrac: 0.06,
      sourceIntensity: 1,
      cooling: 0.25,
      riseFrac: 1,
      maxCatchUpSteps: 3
    }
  });
  function validateFire(config) {
    const sim = config.simulation;
    assertNumber(sim.seed, "fire.simulation.seed", { min: 0, max: 4294967295, integer: true });
    assertNumber(sim.stepHz, "fire.simulation.stepHz", { min: 1, max: 240 });
    assertNumber(sim.sourceWidthFrac, "fire.simulation.sourceWidthFrac", { min: 0.01, max: 1 });
    assertNumber(sim.sourceDepthFrac, "fire.simulation.sourceDepthFrac", { min: 0.01, max: 0.5 });
    assertNumber(sim.sourceIntensity, "fire.simulation.sourceIntensity", { min: 0, max: 1 });
    assertNumber(sim.cooling, "fire.simulation.cooling", { min: 0, max: 1 });
    assertNumber(sim.riseFrac, "fire.simulation.riseFrac", { min: 0.05, max: 4 });
    assertNumber(sim.maxCatchUpSteps, "fire.simulation.maxCatchUpSteps", { min: 1, max: 20, integer: true });
  }

  // src/effects/fire/skins.js
  var FIRE_SKINS = Object.freeze({
    classic: Object.freeze({
      appearance: Object.freeze({
        palette: Object.freeze([
          "#000000",
          "#2b0000",
          "#8b0a0a",
          "#d83a0a",
          "#ff7a00",
          "#ffb400",
          "#ffe55c",
          "#fffff0"
        ]),
        colorCount: 256
      })
    })
  });

  // src/effects/fire/profiles.js
  var RUNTIME_FULLSCREEN_DESKTOP2 = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_FULLSCREEN_MOBILE2 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_DESKTOP2 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_MOBILE2 = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };
  var RENDER_FULLSCREEN_DESKTOP = { render: { resolution: 0.25 } };
  var RENDER_FULLSCREEN_MOBILE = { render: { resolution: 0.2 } };
  var RENDER_PREVIEW_DESKTOP = { render: { resolution: 0.2 } };
  var RENDER_PREVIEW_MOBILE = { render: { resolution: 0.15 } };
  var FIRE_PROFILES = buildProfiles({
    "fullscreen.desktop": { ...RUNTIME_FULLSCREEN_DESKTOP2, ...RENDER_FULLSCREEN_DESKTOP },
    "fullscreen.mobile": { ...RUNTIME_FULLSCREEN_MOBILE2, ...RENDER_FULLSCREEN_MOBILE },
    "preview.desktop": { ...RUNTIME_PREVIEW_DESKTOP2, ...RENDER_PREVIEW_DESKTOP },
    "preview.mobile": { ...RUNTIME_PREVIEW_MOBILE2, ...RENDER_PREVIEW_MOBILE }
  });

  // src/effects/fire/index.js
  var fireDefinition = {
    name: "fire",
    rendererFactory: createFireRenderer,
    configDefaults: FIRE_DEFAULTS,
    validate: validateFire,
    skins: FIRE_SKINS,
    profiles: FIRE_PROFILES,
    capabilities: {
      // Skins change presentation only. The heat *simulation* (seed, cooling,
      // source intensity) is algorithmic identity and must go through `config`.
      skinAllow: /* @__PURE__ */ new Set(["runtime", "render", "motion", "appearance"])
    }
  };

  // src/effects/starfield/config.js
  var STARFIELD_DEFAULTS = createEffectDefaults({
    render: { resolution: 1, smoothing: true },
    motion: { speed: 1 },
    appearance: {
      palette: ["#b4c8ff", "#ffffff"],
      colorCount: 256,
      backgroundColor: "#000000",
      // Trail appearance (skin-owned per issue #7). trailFade is the per-frame
      // background alpha used to fade the previous frame's streaks; minAlpha/
      // maxAlpha and minLineWidth/maxLineWidth map projected depth (near=bright
      // and thick, far=dim and thin). Trails stay readable and bounded at the
      // 1.5 s and 5 s captures without turning the background grey/white.
      trailFade: 0.35,
      minAlpha: 0.25,
      maxAlpha: 0.95,
      minLineWidth: 1,
      maxLineWidth: 3
    },
    particles: {
      seed: 1993,
      particleCount: 600,
      // Density budget. 'explicit' honours particleCount verbatim (default).
      // 'area' derives count = clamp(round(densityPerUnitArea * area / 1000),
      // densityMin, densityMax) where area is the CSS viewport area; the renderer
      // resolves this once at resize so the seed sequence stays stable.
      densityMode: "explicit",
      densityPerUnitArea: 0.4,
      densityMin: 80,
      densityMax: 1200,
      // Projection / motion identity.
      nearZ: 1,
      fov: 256,
      depth: 256,
      travelSpeed: 192,
      centerX: 0.5,
      centerY: 0.5,
      // A star is recycled when its projected position leaves the frame expanded
      // by this many logical pixels on every side, so streaks that graze the edge
      // are preserved but particles that have left the useful field are recycled
      // instead of accumulating off-screen.
      cullMargin: 8
    }
  });
  function validateStarfield(config) {
    assertNumber(config.particles.seed, "starfield.particles.seed", { min: 0, max: 4294967295, integer: true });
    assertNumber(config.particles.particleCount, "starfield.particles.particleCount", { min: 1, max: 1e4, integer: true });
    if (!["explicit", "area"].includes(config.particles.densityMode)) {
      throw new RangeError(`starfield.particles.densityMode must be 'explicit' or 'area'.`);
    }
    assertNumber(config.particles.densityPerUnitArea, "starfield.particles.densityPerUnitArea", { min: 0 });
    assertNumber(config.particles.densityMin, "starfield.particles.densityMin", { min: 1, max: 1e4, integer: true });
    assertNumber(config.particles.densityMax, "starfield.particles.densityMax", { min: config.particles.densityMin, integer: true });
    assertNumber(config.particles.nearZ, "starfield.particles.nearZ", { min: Number.MIN_VALUE, max: config.particles.depth });
    for (const key of ["fov", "depth", "travelSpeed"]) {
      assertNumber(config.particles[key], `starfield.particles.${key}`, { min: Number.MIN_VALUE });
    }
    for (const key of ["centerX", "centerY"]) {
      assertNumber(config.particles[key], `starfield.particles.${key}`, { min: 0, max: 1 });
    }
    assertNumber(config.particles.cullMargin, "starfield.particles.cullMargin", { min: 0 });
    assertNumber(config.appearance.trailFade, "starfield.appearance.trailFade", { min: 0, max: 1 });
    assertNumber(config.appearance.minAlpha, "starfield.appearance.minAlpha", { min: 0, max: 1 });
    assertNumber(config.appearance.maxAlpha, "starfield.appearance.maxAlpha", { min: 0, max: 1 });
    if (config.appearance.maxAlpha < config.appearance.minAlpha) {
      throw new RangeError("starfield.appearance.maxAlpha must be at least minAlpha.");
    }
    assertNumber(config.appearance.minLineWidth, "starfield.appearance.minLineWidth", { min: Number.MIN_VALUE });
    assertNumber(config.appearance.maxLineWidth, "starfield.appearance.maxLineWidth", { min: config.appearance.minLineWidth });
  }
  function resolveParticleCount(particles, area) {
    if (particles.densityMode !== "area") return particles.particleCount;
    const derived = Math.round(particles.densityPerUnitArea * Math.max(0, area) / 1e3);
    return Math.min(particles.densityMax, Math.max(particles.densityMin, derived));
  }

  // src/effects/starfield/renderer.js
  function createStarfieldRenderer({ canvas, config }) {
    const output = getContext2D(canvas, { alpha: false });
    const buffer = createDrawingBuffer();
    const context = buffer.context;
    const palette = buildGradientPalette(
      new Uint32Array(config.appearance.colorCount),
      config.appearance.palette
    );
    const { nearZ, fov, depth, centerX, centerY, cullMargin } = config.particles;
    const pixelRatio = config.runtime.pixelRatio;
    let random = createSeededRandom(config.particles.seed);
    let stars = [];
    let halfWidth = 1;
    let halfHeight = 1;
    let bufferWidth = 1;
    let bufferHeight = 1;
    let centerOffsetX = 0;
    let centerOffsetY = 0;
    let drawScale = 1;
    function spawn(star, far = false) {
      star.x = (random() * 2 - 1) * halfWidth;
      star.y = (random() * 2 - 1) * halfHeight;
      star.z = far ? depth : random() * (depth - nearZ) + nearZ;
      star.prevZ = null;
    }
    function resetStars() {
      for (const star of stars) spawn(star);
    }
    function resize(nextWidth, nextHeight) {
      halfWidth = Math.max(1, nextWidth / pixelRatio);
      halfHeight = Math.max(1, nextHeight / pixelRatio);
      bufferWidth = nextWidth * config.render.resolution;
      bufferHeight = nextHeight * config.render.resolution;
      resizeDrawingBuffer(buffer, bufferWidth, bufferHeight);
      centerOffsetX = halfWidth * centerX;
      centerOffsetY = halfHeight * centerY;
      drawScale = config.render.resolution * pixelRatio;
      const count = resolveParticleCount(config.particles, halfWidth * halfHeight);
      if (count !== stars.length) {
        stars = Array.from({ length: count }, () => ({}));
      }
      random = createSeededRandom(config.particles.seed);
      resetStars();
    }
    return {
      resize,
      render({ delta }) {
        context.fillStyle = config.appearance.backgroundColor;
        context.globalAlpha = config.appearance.trailFade;
        context.fillRect(0, 0, bufferWidth, bufferHeight);
        context.globalAlpha = 1;
        const advance = config.particles.travelSpeed * config.motion.speed * delta;
        const maxX = halfWidth + cullMargin;
        const maxY = halfHeight + cullMargin;
        const minX = -cullMargin;
        const minY = -cullMargin;
        for (const star of stars) {
          star.z -= advance;
          if (!Number.isFinite(star.z) || star.z <= nearZ) {
            spawn(star, true);
            continue;
          }
          const px = star.x / star.z * fov + centerOffsetX;
          const py = star.y / star.z * fov + centerOffsetY;
          if (px < minX || px > maxX || py < minY || py > maxY) {
            spawn(star, true);
            continue;
          }
          if (star.prevZ !== null) {
            const prevPx = star.x / star.prevZ * fov + centerOffsetX;
            const prevPy = star.y / star.prevZ * fov + centerOffsetY;
            const depthFactor = 1 - star.z / depth;
            const intensity = depthFactor * depthFactor;
            const color = samplePackedPalette(palette, intensity);
            const red = color & 255;
            const green = color >>> 8 & 255;
            const blue = color >>> 16 & 255;
            const alpha = config.appearance.minAlpha + intensity * (config.appearance.maxAlpha - config.appearance.minAlpha);
            context.strokeStyle = `rgba(${red},${green},${blue},${alpha})`;
            context.lineWidth = config.appearance.minLineWidth + intensity * (config.appearance.maxLineWidth - config.appearance.minLineWidth);
            context.beginPath();
            context.moveTo(prevPx * drawScale, prevPy * drawScale);
            context.lineTo(px * drawScale, py * drawScale);
            context.stroke();
          }
          star.prevZ = star.z;
        }
        presentDrawingBuffer(output, buffer, canvas.width, canvas.height, config.render.smoothing);
      }
    };
  }

  // src/effects/starfield/skins.js
  var STARFIELD_SKINS = Object.freeze({
    classic: Object.freeze({
      appearance: Object.freeze({
        backgroundColor: "#000000",
        palette: Object.freeze(["#b4c8ff", "#ffffff"]),
        trailFade: 0.35,
        minAlpha: 0.25,
        maxAlpha: 0.95,
        minLineWidth: 1,
        maxLineWidth: 3
      })
    })
  });

  // src/effects/starfield/profiles.js
  var RUNTIME_FULLSCREEN_DESKTOP3 = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_FULLSCREEN_MOBILE3 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_DESKTOP3 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_MOBILE3 = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };
  var FULLSCREEN_DESKTOP_BUDGET = {
    particles: { densityMode: "explicit", particleCount: 600 }
  };
  var FULLSCREEN_MOBILE_BUDGET = {
    particles: { densityMode: "area", densityPerUnitArea: 0.55, densityMin: 200, densityMax: 450 }
  };
  var PREVIEW_DESKTOP_BUDGET = {
    render: { resolution: 0.7 },
    particles: { densityMode: "explicit", particleCount: 120 }
  };
  var PREVIEW_MOBILE_BUDGET = {
    render: { resolution: 0.7 },
    particles: { densityMode: "explicit", particleCount: 90 }
  };
  var STARFIELD_PROFILES = buildProfiles({
    "fullscreen.desktop": { ...RUNTIME_FULLSCREEN_DESKTOP3, ...FULLSCREEN_DESKTOP_BUDGET },
    "fullscreen.mobile": { ...RUNTIME_FULLSCREEN_MOBILE3, ...FULLSCREEN_MOBILE_BUDGET },
    "preview.desktop": { ...RUNTIME_PREVIEW_DESKTOP3, ...PREVIEW_DESKTOP_BUDGET },
    "preview.mobile": { ...RUNTIME_PREVIEW_MOBILE3, ...PREVIEW_MOBILE_BUDGET }
  });

  // src/effects/starfield/index.js
  var starfieldDefinition = {
    name: "starfield",
    rendererFactory: createStarfieldRenderer,
    configDefaults: STARFIELD_DEFAULTS,
    validate: validateStarfield,
    skins: STARFIELD_SKINS,
    profiles: STARFIELD_PROFILES,
    capabilities: {
      // Skins change presentation only. The particle projection (seed, count,
      // fov, depth, travel) is algorithmic identity and must go through `config`.
      skinAllow: /* @__PURE__ */ new Set(["runtime", "render", "motion", "appearance"])
    }
  };

  // src/effects/metaballs/renderer.js
  function createMetaballsRenderer({ canvas, config }) {
    const context = getContext2D(canvas, { alpha: false });
    const buffer = createPixelBuffer();
    const palette = buildGradientPalette(
      new Uint32Array(config.appearance.colorCount),
      config.appearance.palette
    );
    const points = config.field.points ?? Array.from(
      { length: config.field.pointCount },
      (_, index) => generatedPoint(index)
    );
    const pointX = new Float32Array(points.length);
    const pointY = new Float32Array(points.length);
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
        const phase = time * 0.72 * config.motion.speed;
        for (let i = 0; i < points.length; i++) {
          const point = points[i];
          pointX[i] = (Math.sin(phase * point.frequencyX + point.phaseX) * point.amplitudeX + 1) * 0.5 * buffer.width;
          pointY[i] = (Math.sin(phase * point.frequencyY + point.phaseY) * point.amplitudeY + 1) * 0.5 * buffer.height;
        }
        let index = 0;
        for (let y = 0; y < buffer.height; y++) {
          for (let x = 0; x < buffer.width; x++) {
            let value = 0;
            for (let i = 0; i < points.length; i++) {
              const dx = x - pointX[i];
              const dy = y - pointY[i];
              value += points[i].strength * config.field.fieldStrength / (dx * dx + dy * dy + 1);
            }
            value = value < config.field.threshold ? value * config.field.lowScale : config.field.lowScale + (value - config.field.threshold) * config.field.highScale;
            const paletteIndex = Math.min(
              palette.length - 1,
              Math.max(0, Math.floor(value / 512 * palette.length))
            );
            buffer.pixels[index++] = palette[paletteIndex];
          }
        }
        presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
      }
    };
  }
  function generatedPoint(index) {
    return {
      amplitudeX: 0.6 + index * 0.13,
      amplitudeY: 0.8 + index * 0.11,
      frequencyX: 0.8 + index * 0.27,
      frequencyY: 1.1 + index * 0.21,
      phaseX: 0.7 + index * 1.7,
      phaseY: 1.3 + index * 1.3,
      strength: 240 + index * 60
    };
  }

  // src/effects/metaballs/config.js
  var POINT_KEYS = /* @__PURE__ */ new Set([
    "amplitudeX",
    "amplitudeY",
    "frequencyX",
    "frequencyY",
    "phaseX",
    "phaseY",
    "strength"
  ]);
  var METABALLS_DEFAULTS = createEffectDefaults({
    render: { resolution: 1 / 3, smoothing: false },
    motion: { speed: 1 },
    appearance: {
      palette: ["#050014", "#0a2878", "#00aac8", "#3ce678", "#f0e628", "#ffffff"],
      colorCount: 512,
      backgroundColor: "#050014"
    },
    field: {
      pointCount: 5,
      points: null,
      fieldStrength: 1,
      threshold: 1,
      lowScale: 60,
      highScale: 420
    }
  });
  function validateMetaballsInput(name, explicit) {
    if (explicit?.field?.points !== void 0 && explicit?.field?.pointCount !== void 0) {
      throw new RangeError(`${name}.field.pointCount and ${name}.field.points cannot be used together.`);
    }
  }
  function validateMetaballs(config) {
    assertNumber(config.field.pointCount, "metaballs.field.pointCount", { min: 1, max: 64, integer: true });
    for (const key of ["fieldStrength", "threshold", "lowScale", "highScale"]) {
      assertNumber(config.field[key], `metaballs.field.${key}`, { min: Number.MIN_VALUE });
    }
    if (config.field.points !== null) {
      if (!Array.isArray(config.field.points) || config.field.points.length < 1 || config.field.points.length > 64) {
        throw new RangeError("metaballs.field.points must contain between 1 and 64 points.");
      }
      config.field.points.forEach((point, index) => {
        if (point === null || typeof point !== "object" || Array.isArray(point)) {
          throw new TypeError(`metaballs.field.points[${index}] must be an object.`);
        }
        for (const key of Object.keys(point)) {
          if (!POINT_KEYS.has(key)) throw new RangeError(`Unknown option: metaballs.field.points[${index}].${key}`);
        }
        for (const key of POINT_KEYS) {
          assertNumber(point[key], `metaballs.field.points[${index}].${key}`, {
            min: key === "strength" ? Number.MIN_VALUE : -Infinity
          });
        }
      });
      config.field.pointCount = config.field.points.length;
    }
  }

  // src/effects/metaballs/skins.js
  var METABALLS_SKINS = Object.freeze({
    classic: Object.freeze({})
  });

  // src/effects/metaballs/profiles.js
  var RUNTIME_FULLSCREEN_DESKTOP4 = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_FULLSCREEN_MOBILE4 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_DESKTOP4 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_MOBILE4 = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };
  var PREVIEW_BUDGET = { render: { resolution: 0.2 }, field: { pointCount: 3 } };
  var METABALLS_PROFILES = buildProfiles({
    "fullscreen.desktop": { ...RUNTIME_FULLSCREEN_DESKTOP4 },
    "fullscreen.mobile": { ...RUNTIME_FULLSCREEN_MOBILE4 },
    "preview.desktop": { ...RUNTIME_PREVIEW_DESKTOP4, ...PREVIEW_BUDGET },
    "preview.mobile": { ...RUNTIME_PREVIEW_MOBILE4, ...PREVIEW_BUDGET }
  });

  // src/effects/metaballs/index.js
  var metaballsDefinition = {
    name: "metaballs",
    rendererFactory: createMetaballsRenderer,
    configDefaults: METABALLS_DEFAULTS,
    validate: validateMetaballs,
    validateInput: validateMetaballsInput,
    skins: METABALLS_SKINS,
    profiles: METABALLS_PROFILES,
    capabilities: {
      // Skins change presentation only. The scalar *field* (point count, paths,
      // threshold) is algorithmic identity and must go through `config`.
      skinAllow: /* @__PURE__ */ new Set(["runtime", "render", "motion", "appearance"])
    }
  };

  // src/effects/tunnel/renderer.js
  function createTunnelRenderer({ canvas, config }) {
    const context = getContext2D(canvas, { alpha: false });
    const buffer = createPixelBuffer();
    const palette = buildGradientPalette(
      new Uint32Array(config.appearance.colorCount),
      config.appearance.palette
    );
    const pixelRatio = config.runtime.pixelRatio;
    const [fogR, fogG, fogB] = parseHexColor(config.appearance.fogColor, "tunnel.appearance.fogColor");
    let width = 1;
    let height = 1;
    let bw = 1;
    let bh = 1;
    let vpBufX = 0;
    let vpBufY = 0;
    let refRBuf = 1;
    let epsBuf = 1;
    let accumShift = 0;
    let accumTwist = 0;
    let accumColor = 0;
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        bw = Math.max(2, Math.floor(nextWidth * config.render.resolution));
        bh = Math.max(2, Math.floor(nextHeight * config.render.resolution));
        resizePixelBuffer(buffer, bw, bh);
        const cssW = nextWidth / pixelRatio;
        const cssH = nextHeight / pixelRatio;
        const vpCssX = config.geometry.centerX * cssW;
        const vpCssY = config.geometry.centerY * cssH;
        const refR = Math.max(1, Math.min(vpCssX, cssW - vpCssX, vpCssY, cssH - vpCssY));
        const cssToBuf = config.render.resolution;
        vpBufX = vpCssX * cssToBuf;
        vpBufY = vpCssY * cssToBuf;
        refRBuf = refR * cssToBuf;
        epsBuf = config.geometry.nearEpsilon * refRBuf;
      },
      render({ delta }) {
        const dt = Number.isFinite(delta) && delta > 0 ? delta : 0;
        const speed = config.motion.speed;
        accumShift = (accumShift + speed * config.motion.forwardSpeed * dt) % 1;
        accumTwist = (accumTwist + speed * config.motion.rotationSpeed * dt) % 1;
        accumColor = (accumColor + speed * config.motion.colorCycleSpeed * dt) % 1;
        const wallFreq = config.geometry.wallFrequency;
        const angFreq = config.geometry.angularFrequency / Math.PI;
        const farClamp = config.geometry.farClamp;
        const fogNear = config.geometry.fogNear;
        const fogFar = config.geometry.fogFar;
        const fogStrength = config.geometry.fogStrength;
        const invFogRange = 1 / (fogFar - fogNear);
        const pal = palette;
        const palLen = palette.length;
        const shift = accumShift;
        const twist = accumTwist;
        const colorCycle = accumColor;
        const pixels = buffer.pixels;
        let index = 0;
        for (let y = 0; y < bh; y++) {
          const dy = y - vpBufY;
          for (let x = 0; x < bw; x++) {
            const dx = x - vpBufX;
            const rBuf = Math.sqrt(dx * dx + dy * dy);
            let depth;
            if (rBuf <= epsBuf) {
              depth = 1;
            } else {
              const raw = epsBuf / rBuf;
              depth = raw < farClamp ? raw : farClamp;
            }
            const u = rBuf / refRBuf;
            const textureU = wallFreq * depth + shift;
            const textureV = Math.atan2(dy, dx) * angFreq + twist;
            const pattern = 0.5 + 0.5 * (Math.sin(textureU) * Math.cos(textureV));
            const depthShade = 1 - 0.35 * (depth / farClamp);
            let colorPos = (pattern + colorCycle) % 1;
            if (colorPos < 0) colorPos += 1;
            let colorIndex = colorPos * palLen | 0;
            if (colorIndex >= palLen) colorIndex = palLen - 1;
            const color = pal[colorIndex];
            let fogT = (fogFar - u) * invFogRange;
            if (fogT < 0) fogT = 0;
            else if (fogT > 1) fogT = 1;
            fogT = fogT * fogT * (3 - 2 * fogT);
            const fogFactor = fogT * fogStrength;
            const invFog = 1 - fogFactor;
            const wallR = (color & 255) * depthShade;
            const wallG = (color >>> 8 & 255) * depthShade;
            const wallB = (color >>> 16 & 255) * depthShade;
            const fr = wallR * invFog + fogR * fogFactor;
            const fg = wallG * invFog + fogG * fogFactor;
            const fb = wallB * invFog + fogB * fogFactor;
            pixels[index++] = 255 << 24 | (fb | 0) << 16 | (fg | 0) << 8 | (fr | 0);
          }
        }
        presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
      }
    };
  }

  // src/effects/tunnel/config.js
  var TUNNEL_DEFAULTS = createEffectDefaults({
    render: { resolution: 1 / 3, smoothing: false },
    motion: { speed: 1, forwardSpeed: 0.9, rotationSpeed: 0.25, colorCycleSpeed: 0.12 },
    appearance: {
      palette: ["#ff80ee", "#60dfff", "#ffe86b", "#ff80ee"],
      colorCount: 256,
      backgroundColor: "#000000",
      // Fog tint toward which the receding centre blends (skin-owned). Dark navy
      // so the centre reads as the corridor receding into shadow, not blanking.
      fogColor: "#05030f"
    },
    geometry: {
      // Vanishing point in [0,1] of the CSS viewport.
      centerX: 0.5,
      centerY: 0.5,
      // Wall texture: cycles per unit depth (dimensionless) and half-cycle lobes
      // around the ring. Low frequencies to resist shimmer at coarse sampling.
      wallFrequency: 2.4,
      angularFrequency: 3,
      // Guarded inverse-radius depth. nearEpsilon in units of u; farClamp >= 1 is
      // the documented hard upper bound on depth (safety; the clamp already caps
      // depth at 1 on the central disk).
      nearEpsilon: 0.12,
      farClamp: 6,
      // Fog band, in units of u. Fog is at full strength for u <= fogNear (the
      // deep centre) and zero for u >= fogFar (the clear near wall).
      fogNear: 0.12,
      fogFar: 0.9,
      // [0,1] maximum fog blend. < 1 keeps the centre tinted toward fogColor
      // rather than blanking, so the vanishing region never collapses to a flat
      // pastel.
      fogStrength: 0.85
    }
  });
  function validateTunnel(config) {
    for (const key of ["forwardSpeed", "rotationSpeed", "colorCycleSpeed"]) {
      assertNumber(config.motion[key], `tunnel.motion.${key}`, { min: 0 });
    }
    for (const key of ["centerX", "centerY"]) {
      assertNumber(config.geometry[key], `tunnel.geometry.${key}`, { min: 0, max: 1 });
    }
    assertNumber(config.geometry.wallFrequency, "tunnel.geometry.wallFrequency", { min: 0, max: 8 });
    assertNumber(config.geometry.angularFrequency, "tunnel.geometry.angularFrequency", { min: 0, max: 12 });
    assertNumber(config.geometry.nearEpsilon, "tunnel.geometry.nearEpsilon", { min: Number.MIN_VALUE, max: 2 });
    assertNumber(config.geometry.farClamp, "tunnel.geometry.farClamp", { min: 1 });
    assertNumber(config.geometry.fogNear, "tunnel.geometry.fogNear", { min: 0, max: 2 });
    assertNumber(config.geometry.fogFar, "tunnel.geometry.fogFar", { min: 0, max: 2 });
    if (config.geometry.fogFar <= config.geometry.fogNear) {
      throw new RangeError("tunnel.geometry.fogFar must be greater than fogNear.");
    }
    assertNumber(config.geometry.fogStrength, "tunnel.geometry.fogStrength", { min: 0, max: 1 });
    assertString(config.appearance.fogColor, "tunnel.appearance.fogColor");
    if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(config.appearance.fogColor)) {
      throw new TypeError("tunnel.appearance.fogColor must use #rgb or #rrggbb.");
    }
  }

  // src/effects/tunnel/skins.js
  var TUNNEL_SKINS = Object.freeze({
    classic: Object.freeze({
      appearance: Object.freeze({
        backgroundColor: "#000000",
        palette: Object.freeze(["#ff80ee", "#60dfff", "#ffe86b", "#ff80ee"]),
        fogColor: "#05030f"
      })
    })
  });

  // src/effects/tunnel/profiles.js
  var RUNTIME_FULLSCREEN_DESKTOP5 = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_FULLSCREEN_MOBILE5 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_DESKTOP5 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_MOBILE5 = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };
  var PREVIEW_RENDER2 = { render: { resolution: 0.2 } };
  var TUNNEL_PROFILES = buildProfiles({
    "fullscreen.desktop": { ...RUNTIME_FULLSCREEN_DESKTOP5 },
    "fullscreen.mobile": { ...RUNTIME_FULLSCREEN_MOBILE5 },
    "preview.desktop": { ...RUNTIME_PREVIEW_DESKTOP5, ...PREVIEW_RENDER2 },
    "preview.mobile": { ...RUNTIME_PREVIEW_MOBILE5, ...PREVIEW_RENDER2 }
  });

  // src/effects/tunnel/index.js
  var tunnelDefinition = {
    name: "tunnel",
    rendererFactory: createTunnelRenderer,
    configDefaults: TUNNEL_DEFAULTS,
    validate: validateTunnel,
    skins: TUNNEL_SKINS,
    profiles: TUNNEL_PROFILES,
    capabilities: {
      // Skins change presentation only. The polar *geometry* (centre, frequencies,
      // fog) is algorithmic identity and must go through `config`.
      skinAllow: /* @__PURE__ */ new Set(["runtime", "render", "motion", "appearance"])
    }
  };

  // src/effects/mandelbrot/mandelbrot-core.js
  var LOG2 = Math.log(2);
  var DEFAULT_COLOR_SCALE = 1;
  var DEFAULT_COLOR_CURVE = 1;
  var DEFAULT_COLOR_OFFSET = 0;
  var DEFAULT_CYCLE_SPEED = 0;
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
  function mandelbrotPaletteIndex({
    iteration,
    mag2,
    colorScale,
    colorCurve,
    cyclePhase,
    paletteLength
  }) {
    const guardedMag2 = mag2 < 1.0001 ? 1.0001 : mag2;
    const logZn = Math.log(guardedMag2) / 2;
    const ratio = logZn / LOG2;
    const nu = Math.log(ratio < 1e-12 ? 1e-12 : ratio) / LOG2;
    const rawSmooth = iteration + 1 - nu;
    let colorCoord = rawSmooth * colorScale + cyclePhase;
    colorCoord -= Math.floor(colorCoord);
    const gamma = colorCurve < 0.01 ? 0.01 : colorCurve > 100 ? 100 : colorCurve;
    const shaped = colorCoord ** (1 / gamma);
    const lastIndex = paletteLength - 1;
    const index = Math.floor(shaped * lastIndex + 0.5);
    return index < 0 ? 0 : index > lastIndex ? lastIndex : index;
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
    const appearance = config.appearance ?? {};
    const colorScale = appearance.colorScale ?? DEFAULT_COLOR_SCALE;
    const colorCurve = appearance.colorCurve ?? DEFAULT_COLOR_CURVE;
    const colorOffset = appearance.colorOffset ?? DEFAULT_COLOR_OFFSET;
    const cycleSpeed = appearance.cycleSpeed ?? DEFAULT_CYCLE_SPEED;
    const cyclePhase = time * (config.motion?.speed ?? 1) * cycleSpeed + colorOffset;
    const paletteLength = palette.length;
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
        const mag2 = zRealSquared + zImaginarySquared;
        if (mag2 < escapeSquared) {
          pixels[index++] = interiorColor;
          continue;
        }
        pixels[index++] = palette[mandelbrotPaletteIndex({
          iteration,
          mag2,
          colorScale,
          colorCurve,
          cyclePhase,
          paletteLength
        })];
      }
    }
    return { zoom, maxIterations };
  }

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
  var MANDELBROT_FRAGMENT_SHADER = `#version 300 es
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
uniform float uColorScale;
uniform float uColorCurve;
uniform float uCyclePhase;

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

  // Continuous normalized escape colouring — mirrors mandelbrot-core.js
  // mandelbrotPaletteIndex line for line (same guards, same LOG2, same ramp
  // wrap). The parity test asserts the guarded expressions below appear
  // verbatim in this shader source. The perturbation path above only changes
  // how z is iterated; once escaped, dot(z,z) feeds this identical formula, so
  // the Canvas2D and WebGL outputs agree.
  const float LOG_TWO = 0.6931471805599453;
  float mag2 = max(dot(z, z), 1.0001);
  float logZn = log(mag2) * 0.5;
  float ratio = logZn / LOG_TWO;
  float nu = log(max(ratio, 1e-12)) / LOG_TWO;
  float rawSmooth = float(iteration) + 1.0 - nu;
  float colorCoord = rawSmooth * uColorScale + uCyclePhase;
  colorCoord = colorCoord - floor(colorCoord);
  float shaped = pow(colorCoord, 1.0 / clamp(uColorCurve, 0.01, 100.0));
  float paletteCoord = shaped * (float(uPaletteSize) - 1.0);
  int paletteIndex = int(clamp(floor(paletteCoord + 0.5), 0.0, float(uPaletteSize) - 1.0));
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
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, MANDELBROT_FRAGMENT_SHADER);
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
        "uInteriorColor",
        "uColorScale",
        "uColorCurve",
        "uCyclePhase"
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
        const cyclePhase = time * config.motion.speed * config.appearance.cycleSpeed + config.appearance.colorOffset;
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
        gl.uniform1f(locations.uColorScale, config.appearance.colorScale);
        gl.uniform1f(locations.uColorCurve, config.appearance.colorCurve);
        gl.uniform1f(locations.uCyclePhase, cyclePhase);
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
  var HEX_COLOR_PATTERN = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;
  function assertHexColor(value, path) {
    assertString(value, path);
    if (!HEX_COLOR_PATTERN.test(value)) {
      throw new TypeError(`${path} must use #rgb or #rrggbb.`);
    }
  }
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
      interiorColor: "#000000",
      // Continuous escape-coloring visual knobs (issue #10). These are
      // presentation only — the fractal geometry (camera, bailout, iteration
      // ceiling) lives in `camera`/`algorithm`. The defaults below are the
      // identity baseline; the `classic` skin (skins.js) overrides them with the
      // authored continuous ramp. `colorScale` is the tunable replacement for the
      // old hard-coded `*8` band factor; `colorCurve` is contrast/gamma on the
      // normalized palette coordinate; `colorOffset`+`cycleSpeed` give a slow
      // continuous drift of the palette coordinate WITHOUT changing geometry.
      colorScale: 1,
      colorCurve: 1,
      colorOffset: 0,
      cycleSpeed: 0
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
    assertHexColor(config.appearance.interiorColor, "mandelbrot.appearance.interiorColor");
    assertHexColor(config.appearance.backgroundColor, "mandelbrot.appearance.backgroundColor");
    assertNumber(config.appearance.colorScale, "mandelbrot.appearance.colorScale", { min: 0 });
    assertNumber(config.appearance.colorCurve, "mandelbrot.appearance.colorCurve", { min: 0 });
    assertNumber(config.appearance.colorOffset, "mandelbrot.appearance.colorOffset");
    assertNumber(config.appearance.cycleSpeed, "mandelbrot.appearance.cycleSpeed", { min: 0 });
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
    classic: Object.freeze({
      appearance: {
        // ~0.06 palette-widths per unit smooth-iteration: a slow, continuous ramp
        // instead of the old eight-hard-bands-per-iteration modulo stripe.
        colorScale: 0.06,
        colorCurve: 1,
        colorOffset: 0,
        // One full palette traversal every ~50 s — a gentle continuous shimmer
        // that does not alter the auto-zoom geometry.
        cycleSpeed: 0.02
      }
    })
  });

  // src/effects/mandelbrot/profiles.js
  var RUNTIME_FULLSCREEN_DESKTOP6 = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_FULLSCREEN_MOBILE6 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_DESKTOP6 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_MOBILE6 = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };
  var PREVIEW_RENDER3 = { render: { resolution: 0.19, smoothing: true } };
  var CAMERA_LANDSCAPE = {
    camera: {
      centerX: -0.7436438870371587,
      centerY: 0.1318259042053119,
      minZoom: 1,
      maxZoom: 1e6
    }
  };
  var CAMERA_PORTRAIT = {
    camera: {
      centerX: -0.7436438870371587,
      centerY: 0.1318259042053119,
      minZoom: 2.4,
      maxZoom: 8e5
    }
  };
  var MANDELBROT_PROFILES = buildProfiles({
    "fullscreen.desktop": { ...RUNTIME_FULLSCREEN_DESKTOP6, ...CAMERA_LANDSCAPE },
    "fullscreen.mobile": { ...RUNTIME_FULLSCREEN_MOBILE6, ...CAMERA_PORTRAIT },
    "preview.desktop": { ...RUNTIME_PREVIEW_DESKTOP6, ...PREVIEW_RENDER3, ...CAMERA_LANDSCAPE },
    "preview.mobile": { ...RUNTIME_PREVIEW_MOBILE6, ...PREVIEW_RENDER3, ...CAMERA_PORTRAIT }
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

  // src/effects/sine-scroller/renderer.js
  function createSineScrollerRenderer({ canvas, config }) {
    const output = getContext2D(canvas, { alpha: false });
    const buffer = createDrawingBuffer();
    const context = buffer.context;
    let random = createSeededRandom(config.stars.seed);
    const palette = buildGradientPalette(
      new Uint32Array(config.appearance.colorCount),
      config.appearance.palette
    );
    const stars = Array.from({ length: config.stars.count }, () => ({}));
    let width = 1;
    let height = 1;
    function resetStars() {
      for (const star of stars) {
        star.x = random() * width;
        star.y = random() * height;
        star.z = config.stars.minDepth + random() * (config.stars.maxDepth - config.stars.minDepth);
        star.size = config.stars.minSize + random() * (config.stars.maxSize - config.stars.minSize);
      }
    }
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth * config.render.resolution;
        height = nextHeight * config.render.resolution;
        resizeDrawingBuffer(buffer, width, height);
        random = createSeededRandom(config.stars.seed);
        resetStars();
      },
      render({ time, delta }) {
        context.fillStyle = config.appearance.backgroundColor;
        context.fillRect(0, 0, width, height);
        for (const star of stars) {
          star.x -= star.z * config.stars.speed * config.motion.speed * delta;
          if (star.x < 0) {
            star.x = width;
            star.y = random() * height;
          }
          const depthRange = Math.max(Number.EPSILON, config.stars.maxDepth - config.stars.minDepth);
          const normalized = (star.z - config.stars.minDepth) / depthRange;
          const alpha = config.stars.minAlpha + normalized * (config.stars.maxAlpha - config.stars.minAlpha);
          context.globalAlpha = alpha;
          context.fillStyle = config.appearance.starColor;
          context.fillRect(star.x, star.y, star.size, star.size);
        }
        context.globalAlpha = 1;
        const fontSize = Math.min(config.text.maxFontSize, height * config.text.fontSizeRatio);
        context.font = `${config.text.fontWeight} ${fontSize}px ${config.text.fontFamily}`;
        context.textBaseline = "middle";
        context.textAlign = "left";
        const baseline = height * config.wave.baseline;
        const amplitude = height * config.wave.amplitude;
        const characterWidth = fontSize * config.text.characterWidthRatio;
        const totalWidth = config.text.content.length * characterWidth;
        const scaledTime = time * config.motion.speed;
        const offset = scaledTime * config.motion.scrollSpeed % totalWidth;
        const passes = Math.ceil((width + offset) / totalWidth) + 1;
        const phase = scaledTime * config.motion.phaseSpeed;
        for (let pass = 0; pass < passes; pass++) {
          const startX = -offset + pass * totalWidth;
          for (let index = 0; index < config.text.content.length; index++) {
            const x = startX + index * characterWidth + characterWidth / 2;
            if (x < -characterWidth || x > width + characterWidth) continue;
            const y = baseline + Math.sin(x * config.wave.frequency + phase) * amplitude;
            context.globalAlpha = config.appearance.shadowAlpha;
            context.fillStyle = config.appearance.shadowColor;
            context.fillText(
              config.text.content[index],
              x - fontSize * 0.5 + config.text.shadowOffsetX,
              y + config.text.shadowOffsetY
            );
            const color = samplePackedPalette(
              palette,
              (index / config.text.content.length + scaledTime * config.motion.colorCycleSpeed) % 1
            );
            context.globalAlpha = 1;
            context.fillStyle = `rgb(${color & 255},${color >>> 8 & 255},${color >>> 16 & 255})`;
            context.fillText(config.text.content[index], x - fontSize * 0.5, y);
          }
        }
        presentDrawingBuffer(output, buffer, canvas.width, canvas.height, config.render.smoothing);
      }
    };
  }

  // src/effects/sine-scroller/config.js
  var DEFAULT_TEXT = "  GREETZ TO ALL DEMOSCENERS  ***  PLASMA  FIRE  METABALLS  TUNNEL  FRACTALS  ROTOZOOM  FEEDBACK  COPPER BARS  ***  JS DEMO PACK 2026  ***  KEEP IT REAL  ***  ";
  var SINE_SCROLLER_DEFAULTS = createEffectDefaults({
    render: { resolution: 1, smoothing: true },
    motion: { speed: 1, scrollSpeed: 132, phaseSpeed: 3, colorCycleSpeed: 0.33 },
    appearance: {
      palette: ["#78a0ff", "#70f0ff", "#f080ff", "#ffe66d", "#78a0ff"],
      colorCount: 360,
      backgroundColor: "#04040a",
      shadowColor: "#000000",
      shadowAlpha: 0.6,
      starColor: "#78a0ff"
    },
    text: {
      content: DEFAULT_TEXT,
      fontFamily: "Courier New, monospace",
      fontWeight: 900,
      fontSizeRatio: 0.13,
      maxFontSize: 72,
      characterWidthRatio: 0.62,
      shadowOffsetX: 4,
      shadowOffsetY: 4
    },
    wave: { baseline: 0.62, amplitude: 0.12, frequency: 0.018 },
    stars: {
      seed: 1993,
      count: 220,
      speed: 36,
      minDepth: 0.2,
      maxDepth: 2.2,
      minSize: 0.3,
      maxSize: 1.9,
      minAlpha: 0.3,
      maxAlpha: 1
    }
  });
  function validateSineScroller(config) {
    for (const key of ["content", "fontFamily"]) assertString(config.text[key], `sineScroller.text.${key}`);
    assertNumber(config.text.fontWeight, "sineScroller.text.fontWeight", { min: 100, max: 1e3, integer: true });
    for (const key of ["fontSizeRatio", "maxFontSize", "characterWidthRatio"]) {
      assertNumber(config.text[key], `sineScroller.text.${key}`, { min: Number.MIN_VALUE });
    }
    for (const key of ["shadowOffsetX", "shadowOffsetY"]) assertNumber(config.text[key], `sineScroller.text.${key}`);
    assertNumber(config.wave.baseline, "sineScroller.wave.baseline", { min: 0, max: 1 });
    assertNumber(config.wave.amplitude, "sineScroller.wave.amplitude", { min: 0, max: 1 });
    assertNumber(config.wave.frequency, "sineScroller.wave.frequency", { min: Number.MIN_VALUE });
    for (const key of ["scrollSpeed", "phaseSpeed", "colorCycleSpeed"]) {
      assertNumber(config.motion[key], `sineScroller.motion.${key}`);
    }
    assertNumber(config.appearance.shadowAlpha, "sineScroller.appearance.shadowAlpha", { min: 0, max: 1 });
    assertString(config.appearance.shadowColor, "sineScroller.appearance.shadowColor");
    assertString(config.appearance.starColor, "sineScroller.appearance.starColor");
    assertNumber(config.stars.seed, "sineScroller.stars.seed", { min: 0, max: 4294967295, integer: true });
    assertNumber(config.stars.count, "sineScroller.stars.count", { min: 0, max: 5e3, integer: true });
    for (const key of ["speed", "minDepth", "maxDepth", "minSize", "maxSize", "minAlpha", "maxAlpha"]) {
      assertNumber(config.stars[key], `sineScroller.stars.${key}`, { min: 0 });
    }
    for (const [minimum, maximum] of [["minDepth", "maxDepth"], ["minSize", "maxSize"], ["minAlpha", "maxAlpha"]]) {
      if (config.stars[maximum] < config.stars[minimum]) {
        throw new RangeError(`sineScroller.stars.${maximum} must be at least ${minimum}.`);
      }
    }
    if (config.stars.maxAlpha > 1) throw new RangeError("sineScroller.stars.maxAlpha must be at most 1.");
  }

  // src/effects/sine-scroller/skins.js
  var SINE_SCROLLER_SKINS = Object.freeze({
    classic: Object.freeze({})
  });

  // src/effects/sine-scroller/profiles.js
  var RUNTIME_FULLSCREEN_DESKTOP7 = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_FULLSCREEN_MOBILE7 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_DESKTOP7 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_MOBILE7 = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };
  var PREVIEW_BUDGET2 = { render: { resolution: 0.7 }, stars: { count: 60 } };
  var SINE_SCROLLER_PROFILES = buildProfiles({
    "fullscreen.desktop": { ...RUNTIME_FULLSCREEN_DESKTOP7 },
    "fullscreen.mobile": { ...RUNTIME_FULLSCREEN_MOBILE7 },
    "preview.desktop": { ...RUNTIME_PREVIEW_DESKTOP7, ...PREVIEW_BUDGET2 },
    "preview.mobile": { ...RUNTIME_PREVIEW_MOBILE7, ...PREVIEW_BUDGET2 }
  });

  // src/effects/sine-scroller/index.js
  var sineScrollerDefinition = {
    name: "sineScroller",
    rendererFactory: createSineScrollerRenderer,
    configDefaults: SINE_SCROLLER_DEFAULTS,
    validate: validateSineScroller,
    skins: SINE_SCROLLER_SKINS,
    profiles: SINE_SCROLLER_PROFILES,
    capabilities: {
      // Skins change presentation only. The scroller *text*, *wave* shape, and
      // *stars* field are algorithmic identity and must go through `config`.
      skinAllow: /* @__PURE__ */ new Set(["runtime", "render", "motion", "appearance"])
    }
  };

  // src/effects/rotozoom/renderer.js
  function createRotozoomRenderer({ canvas, config }) {
    const context = getContext2D(canvas, { alpha: false });
    const buffer = createPixelBuffer();
    const palette = buildGradientPalette(
      new Uint32Array(config.appearance.colorCount),
      config.appearance.palette
    );
    const texture = buildTexture(config, palette);
    const textureSize = config.texture.size;
    let width = 1;
    let height = 1;
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        resizePixelBuffer(buffer, width * config.render.resolution, height * config.render.resolution);
      },
      render({ time }) {
        const scaledTime = time * config.motion.speed;
        const angle = scaledTime * config.motion.rotationSpeed;
        const zoom = Math.max(
          0.01,
          config.motion.zoomBase + Math.sin(scaledTime * config.motion.zoomSpeed) * config.motion.zoomAmplitude
        );
        const inverseZoom = 1 / zoom;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const centerX = buffer.width / 2;
        const centerY = buffer.height / 2;
        let index = 0;
        for (let y = 0; y < buffer.height; y++) {
          const dy = y - centerY;
          for (let x = 0; x < buffer.width; x++) {
            const dx = x - centerX;
            const rotatedX = (cosine * dx + sine * dy) * inverseZoom;
            const rotatedY = (-sine * dx + cosine * dy) * inverseZoom;
            const textureX = Math.floor(rotatedX + textureSize / 2) % textureSize;
            const textureY = Math.floor(rotatedY + textureSize / 2) % textureSize;
            const wrappedX = (textureX + textureSize) % textureSize;
            const wrappedY = (textureY + textureSize) % textureSize;
            buffer.pixels[index++] = texture[wrappedY * textureSize + wrappedX];
          }
        }
        presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
      }
    };
  }
  function buildTexture(config, palette) {
    const size = config.texture.size;
    const texture = new Uint32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const checker = (Math.floor(x / config.texture.checkerSize) + Math.floor(y / config.texture.checkerSize) & 1) === 0;
        const centerX = x - size / 2;
        const centerY = y - size / 2;
        const radius = Math.sqrt(centerX * centerX + centerY * centerY);
        const rings = Math.sin(radius * config.texture.ringFrequency) * 0.5 + 0.5;
        const spokes = Math.sin(Math.atan2(centerY, centerX) * config.texture.spokeCount) * 0.5 + 0.5;
        let position = checker ? rings * 0.4 : 0.4 + spokes * 0.4;
        if (radius < config.texture.centerRadius) position = 0.85;
        else if (radius < config.texture.borderRadius) position = 1;
        texture[y * size + x] = samplePackedPalette(palette, position);
      }
    }
    return texture;
  }

  // src/effects/rotozoom/config.js
  var ROTOZOOM_DEFAULTS = createEffectDefaults({
    render: { resolution: 0.5, smoothing: true },
    motion: {
      speed: 1,
      rotationSpeed: 0.8,
      zoomBase: 1.2,
      zoomAmplitude: 0.7,
      zoomSpeed: 0.5
    },
    appearance: {
      palette: ["#141e28", "#284d68", "#d47832", "#f0b050", "#00f0c8", "#000000"],
      colorCount: 256,
      backgroundColor: "#000000"
    },
    texture: {
      size: 256,
      checkerSize: 32,
      ringFrequency: 0.12,
      spokeCount: 8,
      centerRadius: 26,
      borderRadius: 30
    }
  });
  function validateRotozoom(config) {
    for (const key of ["rotationSpeed", "zoomAmplitude", "zoomSpeed"]) {
      assertNumber(config.motion[key], `rotozoom.motion.${key}`);
    }
    assertNumber(config.motion.zoomBase, "rotozoom.motion.zoomBase", { min: Number.MIN_VALUE });
    assertNumber(config.texture.size, "rotozoom.texture.size", { min: 16, max: 1024, integer: true });
    assertNumber(config.texture.checkerSize, "rotozoom.texture.checkerSize", { min: 1, max: 512, integer: true });
    assertNumber(config.texture.ringFrequency, "rotozoom.texture.ringFrequency", { min: 0 });
    assertNumber(config.texture.spokeCount, "rotozoom.texture.spokeCount", { min: 1, max: 64, integer: true });
    assertNumber(config.texture.centerRadius, "rotozoom.texture.centerRadius", { min: 0 });
    assertNumber(config.texture.borderRadius, "rotozoom.texture.borderRadius", { min: config.texture.centerRadius });
  }

  // src/effects/rotozoom/skins.js
  var ROTOZOOM_SKINS = Object.freeze({
    classic: Object.freeze({})
  });

  // src/effects/rotozoom/profiles.js
  var RUNTIME_FULLSCREEN_DESKTOP8 = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_FULLSCREEN_MOBILE8 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_DESKTOP8 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_MOBILE8 = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };
  var PREVIEW_RENDER4 = { render: { resolution: 0.25 } };
  var ROTOZOOM_PROFILES = buildProfiles({
    "fullscreen.desktop": { ...RUNTIME_FULLSCREEN_DESKTOP8 },
    "fullscreen.mobile": { ...RUNTIME_FULLSCREEN_MOBILE8 },
    "preview.desktop": { ...RUNTIME_PREVIEW_DESKTOP8, ...PREVIEW_RENDER4 },
    "preview.mobile": { ...RUNTIME_PREVIEW_MOBILE8, ...PREVIEW_RENDER4 }
  });

  // src/effects/rotozoom/index.js
  var rotozoomDefinition = {
    name: "rotozoom",
    rendererFactory: createRotozoomRenderer,
    configDefaults: ROTOZOOM_DEFAULTS,
    validate: validateRotozoom,
    skins: ROTOZOOM_SKINS,
    profiles: ROTOZOOM_PROFILES,
    capabilities: {
      // Skins change presentation only. The procedural *texture* (checker, rings,
      // spokes, radii) is algorithmic identity and must go through `config`.
      skinAllow: /* @__PURE__ */ new Set(["runtime", "render", "motion", "appearance"])
    }
  };

  // src/effects/feedback/renderer.js
  function createFeedbackRenderer({ canvas, config }) {
    const output = getContext2D(canvas);
    const buffer = createDrawingBuffer();
    const context = buffer.context;
    const palette = buildGradientPalette(
      new Uint32Array(config.appearance.colorCount),
      config.appearance.palette
    );
    let width = 1;
    let height = 1;
    let pointerX = null;
    let pointerY = null;
    let hasRendered = false;
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth * config.render.resolution;
        height = nextHeight * config.render.resolution;
        resizeDrawingBuffer(buffer, width, height);
        hasRendered = false;
      },
      pointer(x, y) {
        pointerX = x === null ? null : x * config.render.resolution;
        pointerY = y === null ? null : y * config.render.resolution;
      },
      render({ time, delta }) {
        if (hasRendered && delta === 0) return;
        const frameFactor = delta * 60 * config.motion.speed;
        if (hasRendered) {
          context.globalCompositeOperation = "lighter";
          context.globalAlpha = config.feedback.alphaDecay ** frameFactor;
          context.save();
          context.translate(width / 2, height / 2);
          context.rotate(config.feedback.rotation * frameFactor);
          context.scale(config.feedback.scale ** frameFactor, config.feedback.scale ** frameFactor);
          context.translate(-width / 2, -height / 2);
          context.drawImage(buffer.canvas, 0, 0);
          context.restore();
          context.globalCompositeOperation = "source-over";
          context.globalAlpha = 1;
          context.fillStyle = config.appearance.backgroundColor;
          context.globalAlpha = 1 - config.feedback.fade ** frameFactor;
          context.fillRect(0, 0, width, height);
          context.globalAlpha = 1;
        } else {
          context.fillStyle = config.appearance.backgroundColor;
          context.fillRect(0, 0, width, height);
        }
        const scaledTime = time * config.motion.speed;
        const centerX = pointerX ?? width / 2 + Math.cos(scaledTime * config.motion.orbitSpeedX) * width * config.geometry.orbitX;
        const centerY = pointerY ?? height / 2 + Math.sin(scaledTime * config.motion.orbitSpeedY) * height * config.geometry.orbitY;
        const radius = config.geometry.radius + Math.sin(scaledTime * config.geometry.radiusOscillationSpeed) * config.geometry.radiusOscillation;
        context.globalCompositeOperation = "lighter";
        for (let pass = 0; pass < config.geometry.passes; pass++) {
          context.beginPath();
          const passRadius = radius + pass * config.geometry.passSpacing;
          for (let point = 0; point <= config.geometry.sides; point++) {
            const angle = point / config.geometry.sides * Math.PI * 2 + scaledTime * (config.motion.polygonRotationSpeed + pass * config.motion.passRotationStep);
            const x = centerX + Math.cos(angle) * passRadius;
            const y = centerY + Math.sin(angle) * passRadius;
            if (point === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
          const color = samplePackedPalette(
            palette,
            (scaledTime * config.motion.colorCycleSpeed + pass / config.geometry.passes) % 1
          );
          const red = color & 255;
          const green = color >>> 8 & 255;
          const blue = color >>> 16 & 255;
          context.lineWidth = config.geometry.strokeWidth;
          context.strokeStyle = `rgba(${red},${green},${blue},${config.appearance.strokeAlpha})`;
          context.shadowColor = context.strokeStyle;
          context.shadowBlur = config.geometry.shadowBlur;
          context.stroke();
        }
        context.shadowBlur = 0;
        context.globalAlpha = 1;
        context.globalCompositeOperation = "source-over";
        hasRendered = true;
        presentDrawingBuffer(output, buffer, canvas.width, canvas.height, config.render.smoothing);
      }
    };
  }

  // src/effects/feedback/config.js
  var FEEDBACK_DEFAULTS = createEffectDefaults({
    render: { resolution: 1, smoothing: true },
    motion: {
      speed: 1,
      orbitSpeedX: 0.6,
      orbitSpeedY: 0.7,
      polygonRotationSpeed: 1,
      passRotationStep: 0.3,
      colorCycleSpeed: 0.17
    },
    appearance: {
      palette: ["#ff58d6", "#5ca8ff", "#60ffd0", "#ffe66d", "#ff58d6"],
      colorCount: 360,
      backgroundColor: "#000005",
      strokeAlpha: 0.9
    },
    geometry: {
      sides: 5,
      passes: 3,
      radius: 40,
      radiusOscillation: 14,
      radiusOscillationSpeed: 3,
      passSpacing: 8,
      strokeWidth: 2,
      shadowBlur: 18,
      orbitX: 0.18,
      orbitY: 0.18
    },
    feedback: {
      alphaDecay: 0.93,
      scale: 0.985,
      rotation: 0.012,
      fade: 0.96
    }
  });
  function validateFeedback(config) {
    for (const key of ["orbitSpeedX", "orbitSpeedY", "polygonRotationSpeed", "passRotationStep", "colorCycleSpeed"]) {
      assertNumber(config.motion[key], `feedback.motion.${key}`);
    }
    assertNumber(config.appearance.strokeAlpha, "feedback.appearance.strokeAlpha", { min: 0, max: 1 });
    assertNumber(config.geometry.sides, "feedback.geometry.sides", { min: 3, max: 64, integer: true });
    assertNumber(config.geometry.passes, "feedback.geometry.passes", { min: 1, max: 32, integer: true });
    for (const key of ["radius", "radiusOscillation", "radiusOscillationSpeed", "passSpacing", "strokeWidth", "shadowBlur"]) {
      assertNumber(config.geometry[key], `feedback.geometry.${key}`, { min: 0 });
    }
    for (const key of ["orbitX", "orbitY"]) {
      assertNumber(config.geometry[key], `feedback.geometry.${key}`, { min: 0, max: 1 });
    }
    for (const key of ["alphaDecay", "scale", "fade"]) {
      assertNumber(config.feedback[key], `feedback.feedback.${key}`, { min: 0, max: 1 });
    }
    assertNumber(config.feedback.rotation, "feedback.feedback.rotation");
  }

  // src/effects/feedback/skins.js
  var FEEDBACK_SKINS = Object.freeze({
    classic: Object.freeze({})
  });

  // src/effects/feedback/profiles.js
  var RUNTIME_FULLSCREEN_DESKTOP9 = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_FULLSCREEN_MOBILE9 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_DESKTOP9 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_MOBILE9 = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };
  var PREVIEW_RENDER5 = { render: { resolution: 0.7 } };
  var FEEDBACK_PROFILES = buildProfiles({
    "fullscreen.desktop": { ...RUNTIME_FULLSCREEN_DESKTOP9 },
    "fullscreen.mobile": { ...RUNTIME_FULLSCREEN_MOBILE9 },
    "preview.desktop": { ...RUNTIME_PREVIEW_DESKTOP9, ...PREVIEW_RENDER5 },
    "preview.mobile": { ...RUNTIME_PREVIEW_MOBILE9, ...PREVIEW_RENDER5 }
  });

  // src/effects/feedback/index.js
  var feedbackDefinition = {
    name: "feedback",
    rendererFactory: createFeedbackRenderer,
    configDefaults: FEEDBACK_DEFAULTS,
    validate: validateFeedback,
    skins: FEEDBACK_SKINS,
    profiles: FEEDBACK_PROFILES,
    capabilities: {
      // Skins change presentation only. The polygon *geometry* and the recursive
      // *feedback* loop are algorithmic identity and must go through `config`.
      skinAllow: /* @__PURE__ */ new Set(["runtime", "render", "motion", "appearance"])
    }
  };

  // src/effects/copper-bars/renderer.js
  function createCopperBarsRenderer({ canvas, config }) {
    const context = getContext2D(canvas, { alpha: false });
    const buffer = createPixelBuffer();
    const palette = buildGradientPalette(
      new Uint32Array(config.appearance.colorCount),
      config.appearance.palette
    );
    const background = packHexColor(config.appearance.backgroundColor);
    let width = 1;
    let height = 1;
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        resizePixelBuffer(buffer, width * config.render.resolution, height * config.render.resolution);
      },
      render({ time }) {
        let index = 0;
        const scaledTime = time * config.motion.speed;
        for (let y = 0; y < buffer.height; y++) {
          let red = background & 255;
          let green = background >>> 8 & 255;
          let blue = background >>> 16 & 255;
          for (const bar of config.bars) {
            const center = (bar.yBase + bar.amplitude * Math.sin(scaledTime * bar.frequency + bar.phase)) * buffer.height;
            const distance = y - center;
            const halfHeight = Math.max(2, bar.height * buffer.height);
            if (Math.abs(distance) > halfHeight) continue;
            const normalized = distance / halfHeight;
            const falloff = 1 - Math.abs(normalized);
            const glossy = falloff ** config.shading.glossyFalloff;
            const color = samplePackedPalette(
              palette,
              ((bar.colorOffset + normalized * 0.12 + scaledTime * config.motion.colorCycleSpeed) % 1 + 1) % 1
            );
            red += (color & 255) * glossy;
            green += (color >>> 8 & 255) * glossy;
            blue += (color >>> 16 & 255) * glossy;
            if (Math.abs(distance) < config.shading.highlightWidth) {
              red += config.shading.highlightStrength;
              green += config.shading.highlightStrength;
              blue += config.shading.highlightStrength;
            }
          }
          const pixel = packRgb(Math.min(255, red), Math.min(255, green), Math.min(255, blue));
          for (let x = 0; x < buffer.width; x++) buffer.pixels[index++] = pixel;
        }
        presentPixelBuffer(context, buffer, width, height, config.render.smoothing);
      }
    };
  }

  // src/effects/copper-bars/config.js
  var DEFAULT_BARS = [
    { yBase: 0.22, amplitude: 0.12, frequency: 0.7, phase: 0, height: 0.048, colorOffset: 0 },
    { yBase: 0.4, amplitude: 0.1, frequency: 0.9, phase: 1, height: 0.063, colorOffset: 0.2 },
    { yBase: 0.55, amplitude: 0.13, frequency: 0.6, phase: 2, height: 0.041, colorOffset: 0.4 },
    { yBase: 0.7, amplitude: 0.11, frequency: 1, phase: 3, height: 0.074, colorOffset: 0.65 },
    { yBase: 0.85, amplitude: 0.09, frequency: 0.8, phase: 4, height: 0.052, colorOffset: 0.85 }
  ];
  var COPPER_BARS_DEFAULTS = createEffectDefaults({
    render: { resolution: 0.5, smoothing: true },
    motion: { speed: 1, colorCycleSpeed: 0.06 },
    appearance: {
      palette: ["#ff244c", "#ffe844", "#28e880", "#35a8ff", "#dc4dff", "#ff244c"],
      colorCount: 360,
      backgroundColor: "#060812"
    },
    bars: DEFAULT_BARS,
    shading: {
      glossyFalloff: 0.7,
      highlightStrength: 90,
      highlightWidth: 1.5
    }
  });
  function validateCopperBars(config) {
    if (!Array.isArray(config.bars) || config.bars.length < 1 || config.bars.length > 64) {
      throw new RangeError("copperBars.bars must contain between 1 and 64 bars.");
    }
    config.bars.forEach((bar, index) => {
      for (const key of ["yBase", "amplitude", "frequency", "phase", "height", "colorOffset"]) {
        assertNumber(bar[key], `copperBars.bars[${index}].${key}`, {
          min: ["amplitude", "frequency", "height"].includes(key) ? 0 : -Infinity
        });
      }
    });
    assertNumber(config.motion.colorCycleSpeed, "copperBars.motion.colorCycleSpeed");
    assertNumber(config.shading.glossyFalloff, "copperBars.shading.glossyFalloff", { min: Number.MIN_VALUE });
    assertNumber(config.shading.highlightStrength, "copperBars.shading.highlightStrength", { min: 0 });
    assertNumber(config.shading.highlightWidth, "copperBars.shading.highlightWidth", { min: 0 });
  }

  // src/effects/copper-bars/skins.js
  var COPPER_BARS_SKINS = Object.freeze({
    classic: Object.freeze({})
  });

  // src/effects/copper-bars/profiles.js
  var RUNTIME_FULLSCREEN_DESKTOP10 = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_FULLSCREEN_MOBILE10 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_DESKTOP10 = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_MOBILE10 = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };
  var PREVIEW_RENDER6 = { render: { resolution: 0.3 } };
  var COPPER_BARS_PROFILES = buildProfiles({
    "fullscreen.desktop": { ...RUNTIME_FULLSCREEN_DESKTOP10 },
    "fullscreen.mobile": { ...RUNTIME_FULLSCREEN_MOBILE10 },
    "preview.desktop": { ...RUNTIME_PREVIEW_DESKTOP10, ...PREVIEW_RENDER6 },
    "preview.mobile": { ...RUNTIME_PREVIEW_MOBILE10, ...PREVIEW_RENDER6 }
  });

  // src/effects/copper-bars/index.js
  var copperBarsDefinition = {
    name: "copperBars",
    rendererFactory: createCopperBarsRenderer,
    configDefaults: COPPER_BARS_DEFAULTS,
    validate: validateCopperBars,
    skins: COPPER_BARS_SKINS,
    profiles: COPPER_BARS_PROFILES,
    capabilities: {
      // Skins change presentation only. The bar *layout* and *shading* model are
      // algorithmic identity and must go through `config`.
      skinAllow: /* @__PURE__ */ new Set(["runtime", "render", "motion", "appearance"])
    }
  };

  // browser-entry.js
  installEffect(plasmaDefinition);
  installEffect(fireDefinition);
  installEffect(starfieldDefinition);
  installEffect(metaballsDefinition);
  installEffect(tunnelDefinition);
  installEffect(mandelbrotDefinition);
  installEffect(sineScrollerDefinition);
  installEffect(rotozoomDefinition);
  installEffect(feedbackDefinition);
  installEffect(copperBarsDefinition);
})();
