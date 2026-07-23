import { cloneConfig, freezeValue } from './config.js';

const RUNTIME_KEY = Symbol.for('demoscene-classics.runtime');
const MAX_DELTA_SECONDS = 0.05;
// requestAnimationFrame timestamps regularly land a fraction of a millisecond
// before an exact 60/30 FPS boundary. Without a small tolerance, one early
// callback makes the limiter skip a whole display refresh.
const FRAME_INTERVAL_TOLERANCE_MS = 1;

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

function measureCanvas(canvas, pixelRatio = 1) {
  const rect = typeof canvas.getBoundingClientRect === 'function'
    ? canvas.getBoundingClientRect()
    : null;
  const cssWidth = rect?.width || canvas.clientWidth || canvas.width || 1;
  const cssHeight = rect?.height || canvas.clientHeight || canvas.height || 1;
  const width = Math.max(1, Math.round(cssWidth * pixelRatio));
  const height = Math.max(1, Math.round(cssHeight * pixelRatio));
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
 * @typedef {{ runtime: { autoStart: boolean, maxFps: number, pixelRatio: number, pauseWhenHidden: boolean } }} EffectConfig
 * @typedef {{ requestedSkin: (string|object), preset: string, surface: string, requestedDevice: string, resolvedDevice: string }} EffectSelection
 * @typedef {{ start(): EffectController, stop(): EffectController, resize(): EffectController, renderOnce(timeSeconds?: number): EffectController, getConfig(): EffectConfig, getSelection(): (EffectSelection|null), getStats(): object, destroy(): void }} EffectController
 */

/**
 * Mount an internal renderer onto a canvas.
 * @param {string | HTMLCanvasElement} target
 * @param {(context: {canvas: HTMLCanvasElement, config: EffectConfig}) => object} rendererFactory
 * @param {EffectConfig} config
 * @param {object} [selection] - the resolved API v3 selection snapshot (returned by getSelection()).
 * @returns {EffectController}
 */
export function mountEffect(target, rendererFactory, config, selection = null) {
  const canvas = resolveCanvas(target);
  const { autoStart, maxFps, pixelRatio, pauseWhenHidden } = config.runtime;
  const minimumFrameInterval = maxFps === Infinity ? 0 : 1000 / maxFps;

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
  if (!renderer || typeof renderer.render !== 'function') {
    throw new TypeError('A Demoscene renderer must provide render().');
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
        throw new RangeError('Demoscene renderOnce time must be a non-negative number.');
      }
      controller.stop();
      elapsed = timeSeconds;
      staticTime = timeSeconds;
      applySize(true);
      return controller;
    },
    getConfig() {
      // Return a fresh, deeply frozen clone so callers receive the fully
      // resolved v3 configuration (frozen per the API contract) without ever
      // holding a reference to the live internal config object.
      return freezeValue(cloneConfig(config));
    },
    getSelection() {
      return selection;
    },
    getStats() {
      return {
        backend: renderer?.getStats?.().backend ?? 'canvas2d',
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
      return running && visible && !destroyed
        && (typeof renderer?.isAvailable !== 'function' || renderer.isAvailable());
    },
    _tick(timestamp) {
      let delta = 0;
      if (lastTimestamp !== null) {
        delta = Math.min(MAX_DELTA_SECONDS, Math.max(0, (timestamp - lastTimestamp) / 1000));
      }
      lastTimestamp = timestamp;
      pendingDelta += delta;
      if (lastRenderTimestamp !== null
          && timestamp - lastRenderTimestamp + FRAME_INTERVAL_TOLERANCE_MS
            < minimumFrameInterval) {
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

  if (typeof globalThis.ResizeObserver === 'function') {
    resizeObserver = new globalThis.ResizeObserver(() => applySize());
    resizeObserver.observe(canvas);
  } else if (typeof globalThis.addEventListener === 'function') {
    fallbackResizeListener = () => applySize();
    globalThis.addEventListener('resize', fallbackResizeListener);
  }

  if (pauseWhenHidden && typeof globalThis.IntersectionObserver === 'function') {
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

  if (renderer.pointer && typeof canvas.addEventListener === 'function') {
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
  }

  if (autoStart) controller.start();
  return controller;
}
