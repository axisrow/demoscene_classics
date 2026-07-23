import { createStarfieldRenderer } from './renderer.js';
import { STARFIELD_DEFAULTS, validateStarfield } from './config.js';
import { STARFIELD_SKINS } from './skins.js';
import { STARFIELD_PROFILES } from './profiles.js';

export const starfieldDefinition = {
  name: 'starfield',
  rendererFactory: createStarfieldRenderer,
  configDefaults: STARFIELD_DEFAULTS,
  validate: validateStarfield,
  skins: STARFIELD_SKINS,
  profiles: STARFIELD_PROFILES,
  capabilities: {
    // Skins change presentation only. The particle projection (seed, count,
    // fov, depth, travel) is algorithmic identity and must go through `config`.
    skinAllow: new Set(['runtime', 'render', 'motion', 'appearance'])
  }
};
