import { createFireRenderer } from './renderer.js';
import { FIRE_DEFAULTS, validateFire } from './config.js';
import { FIRE_SKINS } from './skins.js';
import { FIRE_PROFILES } from './profiles.js';

export const fireDefinition = {
  name: 'fire',
  rendererFactory: createFireRenderer,
  configDefaults: FIRE_DEFAULTS,
  validate: validateFire,
  skins: FIRE_SKINS,
  profiles: FIRE_PROFILES,
  capabilities: {
    // Skins change presentation only. The heat *simulation* (seed, cooling,
    // source intensity) is algorithmic identity and must go through `config`.
    skinAllow: new Set(['runtime', 'render', 'motion', 'appearance'])
  }
};
