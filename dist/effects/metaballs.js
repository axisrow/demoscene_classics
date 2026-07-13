(() => {
  // src/runtime.js
  var RUNTIME_KEY = Symbol.for("demoscene-classics.runtime");
  var MAX_DELTA_SECONDS = 0.05;
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
  function measureCanvas(canvas) {
    const rect = typeof canvas.getBoundingClientRect === "function" ? canvas.getBoundingClientRect() : null;
    const width = Math.max(1, Math.round(rect?.width || canvas.clientWidth || canvas.width || 1));
    const height = Math.max(1, Math.round(rect?.height || canvas.clientHeight || canvas.height || 1));
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
  function mountEffect(target, rendererFactory, options = {}) {
    const canvas = resolveCanvas(target);
    const quality = options.quality ?? "full";
    if (quality !== "full" && quality !== "preview") {
      throw new RangeError('Demoscene quality must be "full" or "preview".');
    }
    const scheduler = getScheduler();
    let renderer;
    let running = false;
    let visible = true;
    let destroyed = false;
    let elapsed = 0;
    let lastTimestamp = null;
    let resizeObserver = null;
    let intersectionObserver = null;
    let fallbackResizeListener = null;
    let width = 0;
    let height = 0;
    function applySize(force = false) {
      if (destroyed) return;
      const size = measureCanvas(canvas);
      if (!force && size.width === width && size.height === height) return;
      width = size.width;
      height = size.height;
      canvas.width = width;
      canvas.height = height;
      renderer?.resize?.(width, height);
    }
    applySize(true);
    renderer = rendererFactory({ canvas, quality });
    if (!renderer || typeof renderer.render !== "function") {
      throw new TypeError("A Demoscene renderer must provide render().");
    }
    renderer.resize?.(width, height);
    const controller = {
      start() {
        if (destroyed || running) return controller;
        running = true;
        lastTimestamp = null;
        scheduler.add(controller);
        return controller;
      },
      stop() {
        if (!running) return controller;
        running = false;
        lastTimestamp = null;
        scheduler.remove(controller);
        return controller;
      },
      resize() {
        applySize(true);
        return controller;
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
        return running && visible && !destroyed;
      },
      _tick(timestamp) {
        let delta = 0;
        if (lastTimestamp !== null) {
          delta = Math.min(MAX_DELTA_SECONDS, Math.max(0, (timestamp - lastTimestamp) / 1e3));
        }
        lastTimestamp = timestamp;
        elapsed += delta;
        renderer.render({ time: elapsed, delta });
      }
    };
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
    if (quality === "preview" && typeof globalThis.IntersectionObserver === "function") {
      intersectionObserver = new globalThis.IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        const nextVisible = Boolean(entry?.isIntersecting);
        if (visible === nextVisible) return;
        visible = nextVisible;
        lastTimestamp = null;
        if (visible) scheduler.wake();
      });
      intersectionObserver.observe(canvas);
    }
    if (renderer.pointer && typeof canvas.addEventListener === "function") {
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", onPointerLeave);
    }
    if (options.autoStart !== false) controller.start();
    return controller;
  }

  // src/install.js
  function installEffect(name, rendererFactory) {
    const namespace = globalThis.Demoscene && typeof globalThis.Demoscene === "object" ? globalThis.Demoscene : {};
    namespace[name] = (target, options) => mountEffect(target, rendererFactory, options);
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
  var SINE_PHASE_OFFSETS = [0, 2 * Math.PI / 3, 4 * Math.PI / 3];

  // src/effects/metaballs.js
  var BALLS = Array.from({ length: 5 }, (_, index) => ({
    amplitudeX: 0.6 + index * 0.13,
    amplitudeY: 0.8 + index * 0.11,
    frequencyX: 0.8 + index * 0.27,
    frequencyY: 1.1 + index * 0.21,
    phaseX: 0.7 + index * 1.7,
    phaseY: 1.3 + index * 1.3,
    strength: 240 + index * 60
  }));
  function buildPalette() {
    const palette = new Uint32Array(512);
    const stops = [
      [0, [5, 0, 20]],
      [0.25, [10, 40, 120]],
      [0.45, [0, 170, 200]],
      [0.65, [60, 230, 120]],
      [0.85, [240, 230, 40]],
      [1, [255, 255, 255]]
    ];
    let segment = 0;
    for (let i = 0; i < palette.length; i++) {
      const position = i / (palette.length - 1);
      while (segment < stops.length - 2 && position > stops[segment + 1][0]) segment++;
      const left = stops[segment];
      const right = stops[segment + 1];
      const mix = (position - left[0]) / (right[0] - left[0] || 1);
      palette[i] = packRgb(
        Math.round(left[1][0] + (right[1][0] - left[1][0]) * mix),
        Math.round(left[1][1] + (right[1][1] - left[1][1]) * mix),
        Math.round(left[1][2] + (right[1][2] - left[1][2]) * mix)
      );
    }
    return palette;
  }
  function createMetaballsRenderer({ canvas, quality }) {
    const context = getContext2D(canvas, { alpha: false });
    const buffer = createPixelBuffer();
    const palette = buildPalette();
    const scale = 3;
    const balls = BALLS.slice(0, quality === "preview" ? 3 : BALLS.length);
    const ballX = new Float32Array(balls.length);
    const ballY = new Float32Array(balls.length);
    let width = 1;
    let height = 1;
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        resizePixelBuffer(buffer, width / scale, height / scale);
      },
      render({ time }) {
        const phase = time * 0.72;
        for (let i = 0; i < balls.length; i++) {
          const ball = balls[i];
          ballX[i] = (Math.sin(phase * ball.frequencyX + ball.phaseX) * ball.amplitudeX + 1) * 0.5 * buffer.width;
          ballY[i] = (Math.sin(phase * ball.frequencyY + ball.phaseY) * ball.amplitudeY + 1) * 0.5 * buffer.height;
        }
        let index = 0;
        for (let y = 0; y < buffer.height; y++) {
          for (let x = 0; x < buffer.width; x++) {
            let field = 0;
            for (let i = 0; i < balls.length; i++) {
              const dx = x - ballX[i];
              const dy = y - ballY[i];
              field += balls[i].strength / (dx * dx + dy * dy + 1);
            }
            let value = field < 1 ? field * 60 : 60 + (field - 1) * 420;
            value = Math.min(511, value);
            buffer.pixels[index++] = palette[value | 0];
          }
        }
        presentPixelBuffer(context, buffer, width, height, false);
      }
    };
  }

  // browser-entry.js
  installEffect("metaballs", createMetaballsRenderer);
})();
