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
  function buildSinePalette(palette, phaseForIndex) {
    for (let i = 0; i < palette.length; i++) {
      const phase = phaseForIndex(i);
      palette[i] = packRgb(
        Math.floor(128 + 127 * Math.sin(phase + SINE_PHASE_OFFSETS[0])),
        Math.floor(128 + 127 * Math.sin(phase + SINE_PHASE_OFFSETS[1])),
        Math.floor(128 + 127 * Math.sin(phase + SINE_PHASE_OFFSETS[2]))
      );
    }
    return palette;
  }

  // src/effects/mandelbrot.js
  var TARGET_X = -0.7436438870371587;
  var TARGET_Y = 0.1318259042053119;
  var MANDELBROT_INTERIOR_COLOR = packRgb(0, 0, 0);
  function buildPalette() {
    return buildSinePalette(new Uint32Array(1024), (index) => index / 1024 * Math.PI * 2);
  }
  function mandelbrotZoom(time) {
    const phase = time / 28 % 1;
    const wave = (Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1) / 2;
    const eased = wave * wave * (3 - 2 * wave);
    return 10 ** (eased * 6);
  }
  function mandelbrotScale(zoom, quality) {
    if (quality === "preview") return 3;
    if (zoom < 100) return 3;
    if (zoom < 1e4) return 5;
    return 10;
  }
  function isMainInterior(real, imaginary) {
    const shifted = real - 0.25;
    const q = shifted * shifted + imaginary * imaginary;
    return q * (q + shifted) <= 0.25 * imaginary * imaginary || (real + 1) * (real + 1) + imaginary * imaginary <= 0.0625;
  }
  function createMandelbrotRenderer({ canvas, quality }) {
    const context = getContext2D(canvas, { alpha: false });
    const buffer = createPixelBuffer();
    const palette = buildPalette();
    let width = 1;
    let height = 1;
    let scale = 0;
    function ensureBuffer(nextScale) {
      if (scale === nextScale && buffer.image) return;
      scale = nextScale;
      resizePixelBuffer(buffer, width / scale, height / scale);
    }
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        scale = 0;
      },
      render({ time }) {
        const zoom = mandelbrotZoom(time);
        ensureBuffer(mandelbrotScale(zoom, quality));
        const span = 3 / zoom;
        const aspect = buffer.width / buffer.height;
        const calculatedIterations = Math.floor(80 + 60 * Math.log10(zoom + 1));
        const maxIterations = quality === "preview" ? Math.min(64, calculatedIterations) : calculatedIterations;
        const log2 = Math.log(2);
        let index = 0;
        for (let y = 0; y < buffer.height; y++) {
          const imaginary = TARGET_Y + (y / buffer.height - 0.5) * 2 * span / aspect;
          for (let x = 0; x < buffer.width; x++) {
            const real = TARGET_X + (x / buffer.width - 0.5) * 2 * span;
            if (isMainInterior(real, imaginary)) {
              buffer.pixels[index++] = MANDELBROT_INTERIOR_COLOR;
              continue;
            }
            let zReal = 0;
            let zImaginary = 0;
            let zRealSquared = 0;
            let zImaginarySquared = 0;
            let iteration = 0;
            while (zRealSquared + zImaginarySquared < 256 && iteration < maxIterations) {
              zImaginary = 2 * zReal * zImaginary + imaginary;
              zReal = zRealSquared - zImaginarySquared + real;
              zRealSquared = zReal * zReal;
              zImaginarySquared = zImaginary * zImaginary;
              iteration++;
            }
            if (iteration === maxIterations) {
              buffer.pixels[index++] = MANDELBROT_INTERIOR_COLOR;
              continue;
            }
            const logZn = Math.log(zRealSquared + zImaginarySquared) / 2;
            const nu = Math.log(logZn / log2) / log2;
            const smooth = iteration + 1 - nu;
            buffer.pixels[index++] = palette[smooth * 8 & 1023];
          }
        }
        presentPixelBuffer(context, buffer, width, height, false);
      }
    };
  }

  // browser-entry.js
  installEffect("mandelbrot", createMandelbrotRenderer);
})();
