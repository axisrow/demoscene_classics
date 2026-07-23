import { createMetaballsRenderer } from './renderer.js';
import { METABALLS_DEFAULTS, validateMetaballs, validateMetaballsInput } from './config.js';
import { METABALLS_SKINS } from './skins.js';
import { METABALLS_PROFILES } from './profiles.js';

export const metaballsDefinition = {
  name: 'metaballs',
  rendererFactory: createMetaballsRenderer,
  configDefaults: METABALLS_DEFAULTS,
  validate: validateMetaballs,
  validateInput: validateMetaballsInput,
  skins: METABALLS_SKINS,
  profiles: METABALLS_PROFILES,
  capabilities: {
    // Skins change presentation only. The scalar *field* (point count, paths,
    // threshold) is algorithmic identity and must go through `config`.
    skinAllow: new Set(['runtime', 'render', 'motion', 'appearance'])
  }
};
