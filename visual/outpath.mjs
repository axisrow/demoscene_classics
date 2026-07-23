import { isAbsolute, relative, resolve } from 'node:path';

// Resolve a user-supplied --out path (relative to `root`, or absolute) and
// reject anything that would let `rm -rf` escape the harness output area:
//   - the repo root itself (`--out .`),
//   - any ancestor of the root (`--out ..`, `--out ../..`),
//   - parent-directory traversal that lands outside the root,
//   - an absolute path outside the repo.
//
// The capture step removes the destination before writing, so an unvalidated
// `--out` could delete the checkout (or its parent) instead of a capture dir.
// `root` must be an absolute path. Returns the validated absolute destination.
export function resolveOutDir(root, rawOut) {
  const candidate = isAbsolute(rawOut) ? resolve(rawOut) : resolve(root, rawOut);
  const rel = relative(root, candidate);
  // `relative` yields '' for the root itself and a '..'-prefixed path for
  // anything outside it. (On cross-drive Windows `relative` can return an
  // absolute path, which isAbsolute() also rejects.)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `visual-capture: refusing to use --out '${rawOut}': it resolves to the repo root or escapes it. `
      + 'Choose a path strictly inside the repository (e.g. visual/captures).'
    );
  }
  return candidate;
}
