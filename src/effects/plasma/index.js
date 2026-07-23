import { createPlasmaRenderer } from './renderer.js';
import { PLASMA_DEFAULTS, validatePlasma } from './config.js';
import { PLASMA_SKINS } from './skins.js';
import { PLASMA_PROFILES } from './profiles.js';

export const plasmaDefinition = {
  name: 'plasma',
  rendererFactory: createPlasmaRenderer,
  configDefaults: PLASMA_DEFAULTS,
  validate: validatePlasma,
  skins: PLASMA_SKINS,
  profiles: PLASMA_PROFILES,
  capabilities: {
    // Skins may change presentation only. The plasma *field* (frequencies,
    // centres, amplitudes) is algorithmic identity and must go through `config`.
    skinAllow: new Set(['runtime', 'render', 'motion', 'appearance'])
  }
};
