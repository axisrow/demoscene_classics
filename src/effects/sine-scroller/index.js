import { createSineScrollerRenderer } from './renderer.js';
import { SINE_SCROLLER_DEFAULTS, validateSineScroller } from './config.js';
import { SINE_SCROLLER_SKINS } from './skins.js';
import { SINE_SCROLLER_PROFILES } from './profiles.js';

export const sineScrollerDefinition = {
  name: 'sineScroller',
  rendererFactory: createSineScrollerRenderer,
  configDefaults: SINE_SCROLLER_DEFAULTS,
  validate: validateSineScroller,
  skins: SINE_SCROLLER_SKINS,
  profiles: SINE_SCROLLER_PROFILES,
  capabilities: {
    // Skins change presentation only. The scroller *text*, *wave* shape, and
    // *stars* field are algorithmic identity and must go through `config`.
    skinAllow: new Set(['runtime', 'render', 'motion', 'appearance'])
  }
};
