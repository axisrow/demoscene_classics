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
  var SINE_PHASE_OFFSETS = [0, 2 * Math.PI / 3, 4 * Math.PI / 3];

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
      drift: 0,
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
    assertNumber(sim.drift, "fire.simulation.drift", { min: 0, max: 1 });
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

  // src/effects/fire/profiles.js
  var RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };
  var RENDER_FULLSCREEN_DESKTOP = { render: { resolution: 0.25 } };
  var RENDER_FULLSCREEN_MOBILE = { render: { resolution: 0.2 } };
  var RENDER_PREVIEW_DESKTOP = { render: { resolution: 0.2 } };
  var RENDER_PREVIEW_MOBILE = { render: { resolution: 0.15 } };
  var FIRE_PROFILES = buildProfiles({
    "fullscreen.desktop": { ...RUNTIME_FULLSCREEN_DESKTOP, ...RENDER_FULLSCREEN_DESKTOP },
    "fullscreen.mobile": { ...RUNTIME_FULLSCREEN_MOBILE, ...RENDER_FULLSCREEN_MOBILE },
    "preview.desktop": { ...RUNTIME_PREVIEW_DESKTOP, ...RENDER_PREVIEW_DESKTOP },
    "preview.mobile": { ...RUNTIME_PREVIEW_MOBILE, ...RENDER_PREVIEW_MOBILE }
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

  // browser-entry.js
  installEffect(fireDefinition);
})();
