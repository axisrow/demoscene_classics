import { createCopperBarsRenderer } from './renderer.js';
import { COPPER_BARS_DEFAULTS, validateCopperBars } from './config.js';
import { COPPER_BARS_SKINS } from './skins.js';
import { COPPER_BARS_PROFILES } from './profiles.js';

export const copperBarsDefinition = {
  name: 'copperBars',
  rendererFactory: createCopperBarsRenderer,
  configDefaults: COPPER_BARS_DEFAULTS,
  validate: validateCopperBars,
  skins: COPPER_BARS_SKINS,
  profiles: COPPER_BARS_PROFILES,
  capabilities: {
    // Skins change presentation only. The bar *layout* and *shading* model are
    // algorithmic identity and must go through `config`.
    skinAllow: new Set(['runtime', 'render', 'motion', 'appearance'])
  }
};
