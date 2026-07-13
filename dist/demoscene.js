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
  function hslToRgb(hue, saturation, lightness) {
    const s = saturation / 100;
    const l = lightness / 100;
    const k = (n) => (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255];
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

  // src/effects/plasma.js
  function createPlasmaRenderer({ canvas, quality }) {
    const context = getContext2D(canvas, { alpha: false });
    const buffer = createPixelBuffer();
    const palette = new Uint32Array(256);
    const scale = quality === "preview" ? 3 : 4;
    let width = 1;
    let height = 1;
    function buildPalette4(phase) {
      buildSinePalette(palette, (index) => Math.PI * 2 * index / 256 + phase);
    }
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        resizePixelBuffer(buffer, width / scale, height / scale);
      },
      render({ time }) {
        const phase = time * 1.2;
        buildPalette4(phase);
        const offsetX = buffer.width * 0.02;
        const offsetY = buffer.height * 0.02;
        let index = 0;
        for (let y = 0; y < buffer.height; y++) {
          for (let x = 0; x < buffer.width; x++) {
            const nx = x * 0.04;
            const ny = y * 0.04;
            let value = Math.sin(nx + phase);
            value += Math.sin((ny + phase) * 0.5);
            value += Math.sin((nx + ny + phase) * 0.5);
            const cx = nx - offsetX;
            const cy = ny - offsetY;
            value += Math.sin(Math.sqrt(cx * cx + cy * cy + 1) + phase);
            const colorIndex = (value + 4) / 8 * 255 & 255;
            buffer.pixels[index++] = palette[colorIndex];
          }
        }
        presentPixelBuffer(context, buffer, width, height, false);
      }
    };
  }

  // src/effects/fire.js
  var STEP_SECONDS = 1 / 60;
  function createFireRenderer({ canvas, quality }) {
    const context = getContext2D(canvas, { alpha: false });
    const buffer = createPixelBuffer();
    const palette = new Uint32Array(256);
    const scale = quality === "preview" ? 3 : 4;
    let heat = new Uint8Array(0);
    let accumulator = 0;
    let width = 1;
    let height = 1;
    for (let i = 0; i < 256; i++) {
      let red;
      let green;
      let blue;
      if (i < 64) {
        red = i * 4;
        green = 0;
        blue = 0;
      } else if (i < 128) {
        red = 255;
        green = (i - 64) * 4;
        blue = 0;
      } else if (i < 192) {
        red = 255;
        green = 255;
        blue = (i - 128) * 4;
      } else {
        red = 255;
        green = 255;
        blue = 255;
      }
      palette[i] = packRgb(red, green, blue);
    }
    function spread() {
      const lastRow = buffer.height - 1;
      for (let x = 0; x < buffer.width; x++) {
        heat[lastRow * buffer.width + x] = Math.random() < 0.65 ? 255 : Math.floor(Math.random() * 96);
      }
      for (let y = 1; y < buffer.height; y++) {
        const row = y * buffer.width;
        const previousRow = (y - 1) * buffer.width;
        for (let x = 0; x < buffer.width; x++) {
          const random = Math.random() * 3 | 0;
          const drift = x + (random & 1) - 1 + (random >> 1 & 1);
          const targetX = (drift + buffer.width) % buffer.width;
          heat[previousRow + targetX] = Math.max(0, heat[row + x] - random);
        }
      }
    }
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        resizePixelBuffer(buffer, width / scale, height / scale);
        heat = new Uint8Array(buffer.width * buffer.height);
        accumulator = 0;
      },
      render({ delta }) {
        accumulator += delta;
        let steps = 0;
        while (accumulator >= STEP_SECONDS && steps < 3) {
          spread();
          accumulator -= STEP_SECONDS;
          steps++;
        }
        for (let i = 0; i < heat.length; i++) buffer.pixels[i] = palette[heat[i]];
        presentPixelBuffer(context, buffer, width, height, false);
      }
    };
  }

  // src/effects/starfield.js
  var FOV = 256;
  function createStarfieldRenderer({ canvas, quality }) {
    const context = getContext2D(canvas, { alpha: false });
    const count = quality === "preview" ? 30 : 600;
    const stars = Array.from({ length: count }, () => ({}));
    let width = 1;
    let height = 1;
    let centerX = 0.5;
    let centerY = 0.5;
    function spawn(star, far = false) {
      star.x = (Math.random() * 2 - 1) * width;
      star.y = (Math.random() * 2 - 1) * height;
      star.z = far ? 256 : Math.random() * 255 + 1;
      star.previousX = null;
      star.previousY = null;
    }
    function resetStars() {
      for (const star of stars) spawn(star);
    }
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        centerX = width / 2;
        centerY = height / 2;
        resetStars();
      },
      render({ delta }) {
        context.fillStyle = "rgba(0,0,0,0.35)";
        context.fillRect(0, 0, width, height);
        for (const star of stars) {
          star.z -= 192 * delta;
          if (star.z <= 1) {
            spawn(star, true);
            continue;
          }
          const x = star.x / star.z * FOV + centerX;
          const y = star.y / star.z * FOV + centerY;
          if (star.previousX !== null) {
            const depth = 1 - star.z / 256;
            const speed = depth * depth;
            context.strokeStyle = `rgba(${180 + speed * 75 | 0},${200 + speed * 55 | 0},255,${0.25 + speed * 0.7})`;
            context.lineWidth = 1 + speed * 2;
            context.beginPath();
            context.moveTo(star.previousX, star.previousY);
            context.lineTo(x, y);
            context.stroke();
          }
          star.previousX = x;
          star.previousY = y;
        }
      }
    };
  }

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

  // src/effects/tunnel.js
  function buildPalette2() {
    const palette = new Uint32Array(256);
    for (let i = 0; i < palette.length; i++) {
      palette[i] = packRgb(
        Math.floor(128 + 127 * Math.sin(0.06 * i)),
        Math.floor(128 + 127 * Math.sin(0.06 * i + 2)),
        Math.floor(128 + 127 * Math.sin(0.06 * i + 4))
      );
    }
    return palette;
  }
  function createTunnelRenderer({ canvas }) {
    const context = getContext2D(canvas, { alpha: false });
    const buffer = createPixelBuffer();
    const palette = buildPalette2();
    let width = 1;
    let height = 1;
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        resizePixelBuffer(buffer, width / 3, height / 3);
      },
      render({ time }) {
        const centerX = buffer.width / 2;
        const centerY = buffer.height / 2;
        const shift = time * 84;
        const angle = time * 1.26;
        let index = 0;
        for (let y = 0; y < buffer.height; y++) {
          for (let x = 0; x < buffer.width; x++) {
            const dx = x - centerX;
            const dy = y - centerY;
            const distance = Math.max(1e-4, Math.sqrt(dx * dx + dy * dy));
            const polarAngle = Math.atan2(dy, dx) / Math.PI;
            const textureU = 60 / distance + shift;
            const textureV = polarAngle * 6 + angle;
            const texture = Math.sin(textureU) * Math.cos(textureV);
            const fog = Math.min(1, distance / (Math.min(buffer.width, buffer.height) * 0.5));
            const colorIndex = (texture + 1) * 100 + time * 63 & 255;
            const fade = 0.15 + fog * 0.85;
            const color = palette[colorIndex];
            buffer.pixels[index++] = packRgb(
              (color & 255) * fade,
              (color >> 8 & 255) * fade,
              (color >> 16 & 255) * fade
            );
          }
        }
        presentPixelBuffer(context, buffer, width, height, false);
      }
    };
  }

  // src/effects/mandelbrot.js
  var TARGET_X = -0.7436438870371587;
  var TARGET_Y = 0.1318259042053119;
  var MANDELBROT_INTERIOR_COLOR = packRgb(0, 0, 0);
  function buildPalette3() {
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
    const palette = buildPalette3();
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

  // src/effects/rotozoom.js
  var TEXTURE_SIZE = 256;
  function buildTexture() {
    const texture = new Uint32Array(TEXTURE_SIZE * TEXTURE_SIZE);
    for (let y = 0; y < TEXTURE_SIZE; y++) {
      for (let x = 0; x < TEXTURE_SIZE; x++) {
        const checker = ((x >> 5) + (y >> 5) & 1) === 0;
        const centerX = x - TEXTURE_SIZE / 2;
        const centerY = y - TEXTURE_SIZE / 2;
        const radius = Math.sqrt(centerX * centerX + centerY * centerY);
        const rings = Math.sin(radius * 0.12) * 0.5 + 0.5;
        const spokes = Math.sin(Math.atan2(centerY, centerX) * 8) * 0.5 + 0.5;
        let red = checker ? 20 + rings * 60 : 200 * spokes + 40;
        let green = checker ? 30 + rings * 90 : 120 * spokes + 20;
        let blue = checker ? 40 + rings * 120 : 30 * spokes + 10;
        if (radius < 26) {
          red = 0;
          green = 240;
          blue = 200;
        } else if (radius < 30) {
          red = 0;
          green = 0;
          blue = 0;
        }
        texture[y * TEXTURE_SIZE + x] = packRgb(red, green, blue);
      }
    }
    return texture;
  }
  function createRotozoomRenderer({ canvas, quality }) {
    const context = getContext2D(canvas, { alpha: false });
    const buffer = createPixelBuffer();
    const texture = buildTexture();
    const scale = quality === "preview" ? 3 : 2;
    let width = 1;
    let height = 1;
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        resizePixelBuffer(buffer, width / scale, height / scale);
      },
      render({ time }) {
        const angle = time * 0.8;
        const zoom = 1.2 + Math.sin(time * 0.5) * 0.7;
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
            const textureX = (rotatedX + TEXTURE_SIZE / 2 | 0) & 255;
            const textureY = (rotatedY + TEXTURE_SIZE / 2 | 0) & 255;
            buffer.pixels[index++] = texture[(textureY << 8) + textureX];
          }
        }
        presentPixelBuffer(context, buffer, width, height, true);
      }
    };
  }

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

  // src/effects/copper-bars.js
  var BARS = [
    { yBase: 0.22, amplitude: 0.12, frequency: 0.7, phase: 0, height: 0.048, hue: 0 },
    { yBase: 0.4, amplitude: 0.1, frequency: 0.9, phase: 1, height: 0.063, hue: 60 },
    { yBase: 0.55, amplitude: 0.13, frequency: 0.6, phase: 2, height: 0.041, hue: 120 },
    { yBase: 0.7, amplitude: 0.11, frequency: 1, phase: 3, height: 0.074, hue: 200 },
    { yBase: 0.85, amplitude: 0.09, frequency: 0.8, phase: 4, height: 0.052, hue: 290 }
  ];
  function copperHue(baseHue, normalizedRow, time) {
    return (baseHue + normalizedRow * 80 + time * 40 + 360) % 360;
  }
  function createCopperBarsRenderer({ canvas, quality }) {
    const context = getContext2D(canvas, { alpha: false });
    const buffer = createPixelBuffer();
    const scale = quality === "preview" ? 3 : 2;
    let width = 1;
    let height = 1;
    return {
      resize(nextWidth, nextHeight) {
        width = nextWidth;
        height = nextHeight;
        resizePixelBuffer(buffer, width / scale, height / scale);
      },
      render({ time }) {
        let index = 0;
        for (let y = 0; y < buffer.height; y++) {
          let red = 6;
          let green = 8;
          let blue = 18;
          for (const bar of BARS) {
            const center = (bar.yBase + bar.amplitude * Math.sin(time * bar.frequency + bar.phase)) * buffer.height;
            const distance = y - center;
            const halfHeight = Math.max(2, bar.height * buffer.height);
            if (Math.abs(distance) > halfHeight) continue;
            const normalized = distance / halfHeight;
            const falloff = 1 - Math.abs(normalized);
            const glossy = falloff ** 0.7;
            const color = hslToRgb(copperHue(bar.hue, normalized, time), 100, 55);
            red += color[0] * glossy;
            green += color[1] * glossy;
            blue += color[2] * glossy;
            if (Math.abs(distance) < 1.5) {
              red += 90;
              green += 90;
              blue += 90;
            }
          }
          const pixel = packRgb(Math.min(255, red), Math.min(255, green), Math.min(255, blue));
          for (let x = 0; x < buffer.width; x++) buffer.pixels[index++] = pixel;
        }
        presentPixelBuffer(context, buffer, width, height, true);
      }
    };
  }

  // browser-entry.js
  installEffect("plasma", createPlasmaRenderer);
  installEffect("fire", createFireRenderer);
  installEffect("starfield", createStarfieldRenderer);
  installEffect("metaballs", createMetaballsRenderer);
  installEffect("tunnel", createTunnelRenderer);
  installEffect("mandelbrot", createMandelbrotRenderer);
  installEffect("sineScroller", createSineScrollerRenderer);
  installEffect("rotozoom", createRotozoomRenderer);
  installEffect("feedback", createFeedbackRenderer);
  installEffect("copperBars", createCopperBarsRenderer);
})();
