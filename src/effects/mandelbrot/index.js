import { createMandelbrotRenderer } from './renderer.js';
import { MANDELBROT_DEFAULTS, validateMandelbrot } from './config.js';
import { MANDELBROT_SKINS } from './skins.js';
import { MANDELBROT_PROFILES } from './profiles.js';

export const mandelbrotDefinition = {
  name: 'mandelbrot',
  rendererFactory: createMandelbrotRenderer,
  configDefaults: MANDELBROT_DEFAULTS,
  validate: validateMandelbrot,
  skins: MANDELBROT_SKINS,
  profiles: MANDELBROT_PROFILES,
  capabilities: {
    // Skins change presentation only. The fractal *camera* target and the
    // escape-time *algorithm* are algorithmic identity and must go through `config`.
    skinAllow: new Set(['runtime', 'render', 'motion', 'appearance'])
  }
};
