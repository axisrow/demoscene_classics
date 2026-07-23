import { createRotozoomRenderer } from './renderer.js';
import { ROTOZOOM_DEFAULTS, validateRotozoom } from './config.js';
import { ROTOZOOM_SKINS } from './skins.js';
import { ROTOZOOM_PROFILES } from './profiles.js';

export const rotozoomDefinition = {
  name: 'rotozoom',
  rendererFactory: createRotozoomRenderer,
  configDefaults: ROTOZOOM_DEFAULTS,
  validate: validateRotozoom,
  skins: ROTOZOOM_SKINS,
  profiles: ROTOZOOM_PROFILES,
  capabilities: {
    // Skins change presentation only. The procedural *texture* (checker, rings,
    // spokes, radii) is algorithmic identity and must go through `config`.
    skinAllow: new Set(['runtime', 'render', 'motion', 'appearance'])
  }
};
