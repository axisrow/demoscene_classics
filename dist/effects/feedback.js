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

  // src/effects/feedback.js
  function createFeedbackRenderer({ canvas }) {
    const context = getContext2D(canvas);
    let width = 1;
    let height = 1;
    let pointerX = null;
    let pointerY = null;
    let hasRendered = false;
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        hasRendered = false;
      },
      pointer(x, y) {
        pointerX = x;
        pointerY = y;
      },
      render({ time, delta }) {
        if (hasRendered && delta === 0) return;
        const frameFactor = delta * 60;
        if (hasRendered) {
          context.globalCompositeOperation = "lighter";
          context.globalAlpha = 0.93 ** frameFactor;
          context.save();
          context.translate(width / 2, height / 2);
          context.rotate(0.012 * frameFactor);
          context.scale(0.985 ** frameFactor, 0.985 ** frameFactor);
          context.translate(-width / 2, -height / 2);
          context.drawImage(canvas, 0, 0);
          context.restore();
          context.globalCompositeOperation = "source-over";
          context.globalAlpha = 1;
          context.fillStyle = `rgba(0,0,5,${1 - 0.96 ** frameFactor})`;
          context.fillRect(0, 0, width, height);
        }
        const centerX = pointerX === null ? width / 2 + Math.cos(time * 0.6) * width * 0.18 : pointerX;
        const centerY = pointerY === null ? height / 2 + Math.sin(time * 0.7) * height * 0.18 : pointerY;
        context.globalCompositeOperation = "lighter";
        const hue = time * 60 % 360;
        const sides = 5;
        const radius = 40 + Math.sin(time * 3) * 14;
        for (let pass = 0; pass < 3; pass++) {
          context.beginPath();
          const passRadius = radius + pass * 8;
          for (let point = 0; point <= sides; point++) {
            const angle = point / sides * Math.PI * 2 + time * (1 + pass * 0.3);
            const x = centerX + Math.cos(angle) * passRadius;
            const y = centerY + Math.sin(angle) * passRadius;
            if (point === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
          context.lineWidth = 2;
          context.strokeStyle = `hsla(${(hue + pass * 60) % 360},100%,65%,0.9)`;
          context.shadowColor = context.strokeStyle;
          context.shadowBlur = 18;
          context.stroke();
        }
        context.shadowBlur = 0;
        context.globalAlpha = 1;
        context.globalCompositeOperation = "source-over";
        hasRendered = true;
      }
    };
  }

  // browser-entry.js
  installEffect("feedback", createFeedbackRenderer);
})();
