import { createFeedbackRenderer } from './renderer.js';
import { FEEDBACK_DEFAULTS, validateFeedback } from './config.js';
import { FEEDBACK_SKINS } from './skins.js';
import { FEEDBACK_PROFILES } from './profiles.js';

export const feedbackDefinition = {
  name: 'feedback',
  rendererFactory: createFeedbackRenderer,
  configDefaults: FEEDBACK_DEFAULTS,
  validate: validateFeedback,
  skins: FEEDBACK_SKINS,
  profiles: FEEDBACK_PROFILES,
  capabilities: {
    // Skins change presentation only. The polygon *geometry* and the recursive
    // *feedback* loop are algorithmic identity and must go through `config`.
    skinAllow: new Set(['runtime', 'render', 'motion', 'appearance'])
  }
};
