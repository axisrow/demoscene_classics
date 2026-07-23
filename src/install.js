import { mountEffect } from './runtime.js';
import { resolveDescriptor } from './resolver.js';

/**
 * Install one beginner-facing function on the global Demoscene namespace.
 *
 * The public function accepts the API v3 descriptor `{ skin, surface, device, config }`,
 * resolves it into a frozen configuration, then mounts the renderer.
 *
 * @param {object} definition - effect definition (name, rendererFactory, configDefaults, validate, skins, profiles, capabilities).
 * @returns {Function}
 */
export function installEffect(definition) {
  const { name } = definition;
  const namespace = globalThis.Demoscene && typeof globalThis.Demoscene === 'object'
    ? globalThis.Demoscene
    : {};

  namespace[name] = (target, descriptor) => {
    const { config, selection } = resolveDescriptor(definition, descriptor);
    return mountEffect(target, definition.rendererFactory, config, selection);
  };
  globalThis.Demoscene = namespace;
  return namespace[name];
}
