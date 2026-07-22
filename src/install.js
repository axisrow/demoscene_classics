import { mountEffect } from './runtime.js';

/**
 * Install one beginner-facing function on the global Demoscene namespace.
 * @param {string} name
 * @param {Function} rendererFactory
 * @param {(input?: object) => object} normalizeConfig
 */
export function installEffect(name, rendererFactory, normalizeConfig) {
  const namespace = globalThis.Demoscene && typeof globalThis.Demoscene === 'object'
    ? globalThis.Demoscene
    : {};

  namespace[name] = (target, options) => {
    const config = normalizeConfig(options);
    return mountEffect(target, rendererFactory, config);
  };
  globalThis.Demoscene = namespace;
  return namespace[name];
}
