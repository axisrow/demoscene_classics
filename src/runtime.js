const RUNTIME_KEY = Symbol.for('demoscene-classics.runtime');
const MAX_DELTA_SECONDS = 0.05;

function resolveCanvas(target) {
  const canvas = typeof target === 'string'
    ? globalThis.document?.querySelector(target)
    : target;

  if (!canvas) {
    throw new TypeError(`Demoscene target not found: ${String(target)}`);
  }
  if (typeof canvas.getContext !== 'function') {
    throw new TypeError('Demoscene target must be a <canvas> element.');
  }
  return canvas;
}

function measureCanvas(canvas) {
  const rect = typeof canvas.getBoundingClientRect === 'function'
    ? canvas.getBoundingClientRect()
    : null;
  const width = Math.max(1, Math.round(rect?.width || canvas.clientWidth || canvas.width || 1));
  const height = Math.max(1, Math.round(rect?.height || canvas.clientHeight || canvas.height || 1));
  return { width, height };
}

function createScheduler() {
  const controllers = new Set();
  let frameId = null;

  const requestFrame = globalThis.requestAnimationFrame?.bind(globalThis);
  const cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis);

  if (!requestFrame) {
    throw new Error('Demoscene requires requestAnimationFrame.');
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

/**
 * @typedef {'full' | 'preview'} QualityProfile
 * @typedef {{ quality?: QualityProfile, autoStart?: boolean }} EffectOptions
 * @typedef {{ start(): EffectController, stop(): EffectController, resize(): EffectController, destroy(): void }} EffectController
 */

/**
 * Mount an internal renderer onto a canvas.
 * @param {string | HTMLCanvasElement} target
 * @param {(context: {canvas: HTMLCanvasElement, quality: QualityProfile}) => object} rendererFactory
 * @param {EffectOptions} [options]
 * @returns {EffectController}
 */
export function mountEffect(target, rendererFactory, options = {}) {
  const canvas = resolveCanvas(target);
  const quality = options.quality ?? 'full';
  if (quality !== 'full' && quality !== 'preview') {
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
  if (!renderer || typeof renderer.render !== 'function') {
    throw new TypeError('A Demoscene renderer must provide render().');
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
      if (fallbackResizeListener && typeof globalThis.removeEventListener === 'function') {
        globalThis.removeEventListener('resize', fallbackResizeListener);
      }
      if (renderer?.pointer && typeof canvas.removeEventListener === 'function') {
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerleave', onPointerLeave);
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
        delta = Math.min(MAX_DELTA_SECONDS, Math.max(0, (timestamp - lastTimestamp) / 1000));
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

  if (typeof globalThis.ResizeObserver === 'function') {
    resizeObserver = new globalThis.ResizeObserver(() => applySize());
    resizeObserver.observe(canvas);
  } else if (typeof globalThis.addEventListener === 'function') {
    fallbackResizeListener = () => applySize();
    globalThis.addEventListener('resize', fallbackResizeListener);
  }

  if (quality === 'preview' && typeof globalThis.IntersectionObserver === 'function') {
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

  if (renderer.pointer && typeof canvas.addEventListener === 'function') {
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
  }

  if (options.autoStart !== false) controller.start();
  return controller;
}
