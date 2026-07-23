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
  var SINE_PHASE_OFFSETS = [0, 2 * Math.PI / 3, 4 * Math.PI / 3];

  // src/effects/starfield/renderer.js
  function createStarfieldRenderer({ canvas, config }) {
    const output = getContext2D(canvas, { alpha: false });
    const buffer = createDrawingBuffer();
    const context = buffer.context;
    let random = createSeededRandom(config.particles.seed);
    const palette = buildGradientPalette(
      new Uint32Array(config.appearance.colorCount),
      config.appearance.palette
    );
    const stars = Array.from({ length: config.particles.particleCount }, () => ({}));
    let width = 1;
    let height = 1;
    function spawn(star, far = false) {
      star.x = (random() * 2 - 1) * width;
      star.y = (random() * 2 - 1) * height;
      star.z = far ? config.particles.depth : random() * (config.particles.depth - 1) + 1;
      star.previousX = null;
      star.previousY = null;
    }
    function resetStars() {
      stars.forEach((star) => spawn(star));
    }
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth * config.render.resolution;
        height = nextHeight * config.render.resolution;
        resizeDrawingBuffer(buffer, width, height);
        random = createSeededRandom(config.particles.seed);
        resetStars();
      },
      render({ delta }) {
        context.fillStyle = config.appearance.backgroundColor;
        context.globalAlpha = config.particles.trailFade;
        context.fillRect(0, 0, width, height);
        context.globalAlpha = 1;
        const centerX = width * config.particles.centerX;
        const centerY = height * config.particles.centerY;
        for (const star of stars) {
          star.z -= config.particles.travelSpeed * config.motion.speed * delta;
          if (star.z <= 1) {
            spawn(star, true);
            continue;
          }
          const x = star.x / star.z * config.particles.fov + centerX;
          const y = star.y / star.z * config.particles.fov + centerY;
          if (star.previousX !== null) {
            const depth = 1 - star.z / config.particles.depth;
            const intensity = depth * depth;
            const color = samplePackedPalette(palette, intensity);
            const red = color & 255;
            const green = color >>> 8 & 255;
            const blue = color >>> 16 & 255;
            const alpha = config.particles.minAlpha + intensity * (config.particles.maxAlpha - config.particles.minAlpha);
            context.strokeStyle = `rgba(${red},${green},${blue},${alpha})`;
            context.lineWidth = config.particles.minLineWidth + intensity * (config.particles.maxLineWidth - config.particles.minLineWidth);
            context.beginPath();
            context.moveTo(star.previousX, star.previousY);
            context.lineTo(x, y);
            context.stroke();
          }
          star.previousX = x;
          star.previousY = y;
        }
        presentDrawingBuffer(output, buffer, canvas.width, canvas.height, config.render.smoothing);
      }
    };
  }

  // src/effects/starfield/config.js
  var STARFIELD_DEFAULTS = createEffectDefaults({
    render: { resolution: 1, smoothing: true },
    motion: { speed: 1 },
    appearance: {
      palette: ["#b4c8ff", "#ffffff"],
      colorCount: 256,
      backgroundColor: "#000000"
    },
    particles: {
      seed: 1993,
      particleCount: 600,
      fov: 256,
      depth: 256,
      travelSpeed: 192,
      centerX: 0.5,
      centerY: 0.5,
      trailFade: 0.35,
      minAlpha: 0.25,
      maxAlpha: 0.95,
      minLineWidth: 1,
      maxLineWidth: 3
    }
  });
  function validateStarfield(config) {
    assertNumber(config.particles.seed, "starfield.particles.seed", { min: 0, max: 4294967295, integer: true });
    assertNumber(config.particles.particleCount, "starfield.particles.particleCount", { min: 1, max: 1e4, integer: true });
    for (const key of ["fov", "depth", "travelSpeed"]) {
      assertNumber(config.particles[key], `starfield.particles.${key}`, { min: Number.MIN_VALUE });
    }
    for (const key of ["centerX", "centerY", "trailFade", "minAlpha", "maxAlpha"]) {
      assertNumber(config.particles[key], `starfield.particles.${key}`, { min: 0, max: 1 });
    }
    assertNumber(config.particles.minLineWidth, "starfield.particles.minLineWidth", { min: Number.MIN_VALUE });
    assertNumber(config.particles.maxLineWidth, "starfield.particles.maxLineWidth", { min: config.particles.minLineWidth });
    if (config.particles.maxAlpha < config.particles.minAlpha) {
      throw new RangeError("starfield.particles.maxAlpha must be at least minAlpha.");
    }
  }

  // src/effects/starfield/skins.js
  var STARFIELD_SKINS = Object.freeze({
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

  // src/effects/starfield/profiles.js
  var RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
  var RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };
  var PREVIEW_BUDGET = { render: { resolution: 0.7 }, particles: { particleCount: 120 } };
  var STARFIELD_PROFILES = buildProfiles({
    "fullscreen.desktop": { ...RUNTIME_FULLSCREEN_DESKTOP },
    "fullscreen.mobile": { ...RUNTIME_FULLSCREEN_MOBILE },
    "preview.desktop": { ...RUNTIME_PREVIEW_DESKTOP, ...PREVIEW_BUDGET },
    "preview.mobile": { ...RUNTIME_PREVIEW_MOBILE, ...PREVIEW_BUDGET }
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

  // browser-entry.js
  installEffect(starfieldDefinition);
})();
