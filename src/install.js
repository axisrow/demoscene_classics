import { mountEffect } from './runtime.js';

/**
 * Install one beginner-facing function on the global Demoscene namespace.
 * @param {string} name
 * @param {Function} rendererFactory
 */
export function installEffect(name, rendererFactory) {
  const namespace = globalThis.Demoscene && typeof globalThis.Demoscene === 'object'
    ? globalThis.Demoscene
    : {};

  namespace[name] = (target, options) => mountEffect(target, rendererFactory, options);
  globalThis.Demoscene = namespace;
  return namespace[name];
}
