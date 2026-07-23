import { createTunnelRenderer } from './renderer.js';
import { TUNNEL_DEFAULTS, validateTunnel } from './config.js';
import { TUNNEL_SKINS } from './skins.js';
import { TUNNEL_PROFILES } from './profiles.js';

export const tunnelDefinition = {
  name: 'tunnel',
  rendererFactory: createTunnelRenderer,
  configDefaults: TUNNEL_DEFAULTS,
  validate: validateTunnel,
  skins: TUNNEL_SKINS,
  profiles: TUNNEL_PROFILES,
  capabilities: {
    // Skins change presentation only. The polar *geometry* (centre, frequencies,
    // fog) is algorithmic identity and must go through `config`.
    skinAllow: new Set(['runtime', 'render', 'motion', 'appearance'])
  }
};
