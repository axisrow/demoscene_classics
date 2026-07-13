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
  var SINE_PHASE_OFFSETS = [0, 2 * Math.PI / 3, 4 * Math.PI / 3];

  // src/effects/sine-scroller.js
  var TEXT = "  GREETZ TO ALL DEMOSCENERS  ***  PLASMA  FIRE  METABALLS  TUNNEL  FRACTALS  ROTOZOOM  FEEDBACK  COPPER BARS  ***  JS DEMO PACK 2026  ***  KEEP IT REAL  ***  ";
  function createSineScrollerRenderer({ canvas, quality }) {
    const context = getContext2D(canvas, { alpha: false });
    const starCount = quality === "preview" ? 40 : 220;
    const stars = Array.from({ length: starCount }, () => ({}));
    let width = 1;
    let height = 1;
    function resetStars() {
      for (const star of stars) {
        star.x = Math.random() * width;
        star.y = Math.random() * height;
        star.z = Math.random() * 2 + 0.2;
        star.size = Math.random() * 1.6 + 0.3;
      }
    }
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        resetStars();
      },
      render({ time, delta }) {
        context.fillStyle = "#04040a";
        context.fillRect(0, 0, width, height);
        for (const star of stars) {
          star.x -= star.z * 36 * delta;
          if (star.x < 0) {
            star.x = width;
            star.y = Math.random() * height;
          }
          const alpha = 0.3 + star.z / 2.2 * 0.7;
          context.fillStyle = `rgba(120,160,255,${alpha})`;
          context.fillRect(star.x, star.y, star.size, star.size);
        }
        const fontSize = Math.min(72, height * 0.13);
        context.font = `900 ${fontSize}px 'Courier New', monospace`;
        context.textBaseline = "middle";
        context.textAlign = "left";
        const baseline = height * 0.62;
        const amplitude = height * 0.12;
        const frequency = 0.018;
        const characterWidth = fontSize * 0.62;
        const totalWidth = TEXT.length * characterWidth;
        const offset = time * 132 % totalWidth;
        const passes = Math.ceil((width + offset) / totalWidth) + 1;
        const phase = time * 3;
        for (let pass = 0; pass < passes; pass++) {
          const startX = -offset + pass * totalWidth;
          for (let index = 0; index < TEXT.length; index++) {
            const x = startX + index * characterWidth + characterWidth / 2;
            if (x < -characterWidth || x > width + characterWidth) continue;
            const y = baseline + Math.sin(x * frequency + phase) * amplitude;
            const hue = (index * 18 + time * 120) % 360;
            context.fillStyle = "rgba(0,0,0,0.6)";
            context.fillText(TEXT[index], x - fontSize * 0.5 + 4, y + 4);
            context.fillStyle = `hsl(${hue},100%,${62 + Math.sin(x * frequency * 2 + phase) * 12}%)`;
            context.fillText(TEXT[index], x - fontSize * 0.5, y);
          }
        }
      }
    };
  }

  // browser-entry.js
  installEffect("sineScroller", createSineScrollerRenderer);
})();
