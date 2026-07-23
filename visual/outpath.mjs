import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

// The capture step `rm -rf`s the resolved --out directory before rewriting it.
// That delete must be confined to destinations the harness OWNS — not merely
// "somewhere under visual/", because visual/ also holds tracked harness source
// (compare.mjs, capture_runner.py, README.md) and the committed baselines.
//
// Two independent restrictions, together closing every escape found across
// review cycles:
//
//   1. ALLOWLIST. --out must resolve to a path under one of the capture-owned
//      roots below. These are the only directories the harness is ever supposed
//      to delete and regenerate. Anything else — repo root/parents, src/scripts/
//      dist/.git/node_modules, tracked files, even other visual/ paths — is
//      rejected. Containment-under-visual/ alone was not enough (it accepted
//      visual/compare.mjs, visual/baselines/manifest.json, ...).
//
//   2. NON-DIRECTORY REJECTION. If the destination already exists it must be a
//      directory. A path that resolves to an existing file (tracked source, a
//      baseline PNG, a stray manifest) is rejected so `rm -rf <file>` can never
//      delete it. (rm -rf on a file does remove it; we refuse to let the
//      harness do that.)
//
// Realpath canonicalization of the deepest existing ancestor defeats a symlinked
// ancestor that lexically sits under a capture root but resolves outside it.
const HARNESS_ROOT = 'visual';
const CAPTURE_OWNED_ROOTS = Object.freeze(['captures', 'baselines']);

function isPathInside(parentDir, candidate) {
  const rel = relative(parentDir, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

// Canonicalize the longest existing ancestor of `candidate` (the leaf may not
// exist yet — capture creates it) so an in-repo symlink pointing outside the
// checkout cannot smuggle the destination beyond its capture root.
function realpathish(candidate) {
  try {
    return realpathSync(candidate);
  } catch {
    const parts = candidate.split(/[\\/]/);
    let tail = [];
    for (let i = parts.length; i > 0; i--) {
      const existing = parts.slice(0, i).join('/') || '/';
      try { return resolve(realpathSync(existing), ...tail); }
      catch { tail.unshift(parts[i - 1]); }
    }
    return candidate; // nothing exists yet; the allowlist is the only signal
  }
}

// Resolve a user-supplied --out path and validate it is a capture-owned
// destination. `root` is the repo root (absolute). `rawOut` may be relative to
// the repo root or absolute. Returns the validated absolute destination dir.
//
// Throws if the destination is not under an allowlisted capture root (after
// symlink canonicalization), or if it already exists as a non-directory.
export function resolveOutDir(root, rawOut) {
  const harnessRoot = realpathish(resolve(root, HARNESS_ROOT));
  const candidate = isAbsolute(rawOut) ? resolve(rawOut) : resolve(root, rawOut);
  const canonical = realpathish(candidate);

  // 1. Allowlist: candidate must sit under <root>/visual/<owned-root>/. Compare
  //    both sides in canonical form so a tmpdir symlink (e.g. /tmp -> /private/tmp
  //    on macOS) cannot make a real descendant look like an outsider.
  const relToHarness = relative(harnessRoot, canonical);
  const firstSegment = relToHarness.split(/[\\/]/)[0];
  const owned =
    isPathInside(harnessRoot, canonical)
    && CAPTURE_OWNED_ROOTS.includes(firstSegment);
  if (!owned) {
    throw new Error(
      `visual-capture: refusing to use --out '${rawOut}': it is not under a capture-owned output root. `
      + `Capture deletes --out before writing, so it must be one of: `
      + `${CAPTURE_OWNED_ROOTS.map((r) => `${HARNESS_ROOT}/${r}`).join(', ')} `
      + `(or a path beneath them).`
    );
  }

  // 2. If it already exists, it must be a directory — never a tracked file or
  //    stray artifact that rm -rf would delete.
  let stat;
  try { stat = lstatSync(canonical); }
  catch { /* does not exist yet — fine, capture will create it */ }
  if (stat && !stat.isDirectory()) {
    throw new Error(
      `visual-capture: refusing to use --out '${rawOut}': it resolves to an existing non-directory `
      + `(${canonical}). Capture can only replace directories it owns.`
    );
  }

  return canonical;
}
