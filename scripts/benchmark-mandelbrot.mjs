import { performance } from 'node:perf_hooks';

import { mandelbrotDefinition } from '../src/effects/mandelbrot/index.js';
import { resolveDescriptor } from '../src/resolver.js';
import { renderMandelbrotPixels } from '../src/effects/mandelbrot/mandelbrot-core.js';
import { buildGradientPalette, packHexColor } from '../src/effects/utils.js';

const cssWidth = 1456;
const cssHeight = 902;
const portfolioResolution = Number(process.env.DEMO_RESOLUTION || 0.22);
const maxIterations = process.env.DEMO_MAX_ITERATIONS
  ? Number(process.env.DEMO_MAX_ITERATIONS)
  : 140;

// Base configuration passed through the v3 explicit-config escape hatch.
// Camera/algorithm are algorithmic identity and must live under `config`.
const baseConfig = {
  runtime: { autoStart: false, pauseWhenHidden: false },
  render: { smoothing: true },
  motion: { speed: 1, cycleSeconds: 20, startPhase: 0.25 },
  appearance: {
    palette: ['#050607', '#121719', '#30393a', '#8a8073', '#dfd0b8'],
    colorCount: 256,
    backgroundColor: '#050607',
    interiorColor: '#050607'
  },
  camera: {
    centerX: -0.7436438870371587,
    centerY: 0.1318259042053119,
    minZoom: 4000,
    maxZoom: 250000
  },
  algorithm: { maxIterations }
};

function mergeDeep(target, source) {
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeDeep(target[key] ?? {}, value)
      : value;
  }
  return out;
}

function measure(name, runtime, render) {
  const { config } = resolveDescriptor(mandelbrotDefinition, {
    config: mergeDeep(baseConfig, { runtime, render })
  });
  const width = Math.floor(cssWidth * config.runtime.pixelRatio * config.render.resolution);
  const height = Math.floor(cssHeight * config.runtime.pixelRatio * config.render.resolution);
  const pixels = new Uint32Array(width * height);
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  const interiorColor = packHexColor(config.appearance.interiorColor);
  const samples = [];

  for (let index = 0; index < 8; index++) {
    const time = index * config.motion.cycleSeconds / 8;
    const started = performance.now();
    renderMandelbrotPixels({ pixels, width, height, time, config, palette, interiorColor });
    samples.push(performance.now() - started);
  }

  const ordered = [...samples].sort((left, right) => left - right);
  const median = ordered[Math.floor(ordered.length / 2)];
  const p95 = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))];
  return {
    name,
    runtime: {
      maxFps: config.runtime.maxFps,
      pixelRatio: config.runtime.pixelRatio,
      resolution: config.render.resolution
    },
    buffer: `${width}x${height}`,
    samplesMs: samples.map((value) => Number(value.toFixed(2))),
    medianMs: Number(median.toFixed(2)),
    p95Ms: Number(p95.toFixed(2))
  };
}

const legacy = measure(
  'legacy-site-skin',
  { maxFps: 12, pixelRatio: 1.5 },
  { resolution: 0.5 }
);
const portfolio = measure(
  'api-v3-portfolio-skin',
  { maxFps: 24, pixelRatio: 1 },
  { resolution: portfolioResolution }
);
const target = { medianMs: 30, p95Ms: 41 };

console.log(JSON.stringify({
  stopped: { name: 'stopped', renderedFrames: 0, computeMs: 0 },
  legacy,
  portfolio,
  target
}, null, 2));

if (portfolio.medianMs > target.medianMs || portfolio.p95Ms > target.p95Ms) {
  process.exitCode = 1;
}
