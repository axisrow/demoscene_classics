import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

// The only directory the capture step is allowed to `rm -rf` and rewrite is the
// harness's own output area under `visual/` (captures, baselines, the ad-hoc
// subset worktrees under visual/_*/). Anywhere else — `src`, `scripts`, `dist`,
// `.git`, tracked files like `package.json`, or anything outside the repo —
// would destroy source, build output, or Git metadata on a typo or
// misconfiguration. Containment-inside-the-repo is not enough: that still
// accepts `.git`/`src`/`scripts`. We require strict containment inside the
// harness output root, then canonicalize with realpath to defeat a symlinked
// ancestor that lexically sits under `visual/` but resolves outside it.
const HARNESS_OUTPUT_SUBPATH = 'visual';

function contains(parentDir, candidate) {
  const rel = relative(parentDir, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

// Canonicalize the longest existing ancestor of `candidate` (the leaf may not
// exist yet — capture creates it) so an in-repo symlink pointing outside the
// checkout cannot smuggle the destination beyond the harness output root.
function realpathish(candidate) {
  try {
    return realpathSync(candidate);
  } catch {
    // Walk up to the deepest existing ancestor, canonicalize that, then
    // re-append the (still-missing) tail lexically.
    const parts = candidate.split(/[\\/]/);
    let existing = candidate;
    let tail = [];
    for (let i = parts.length; i > 0; i--) {
      existing = parts.slice(0, i).join('/') || '/';
      try { const real = realpathSync(existing); return resolve(real, ...tail); }
      catch { tail.unshift(parts[i - 1]); }
    }
    return candidate; // nothing exists yet; lexical check is the only signal
  }
}

// Resolve a user-supplied --out path and validate it is a harness-owned output
// destination. `root` is the repo root (absolute). `rawOut` may be relative to
// the repo root or absolute. Returns the validated absolute destination dir.
//
// Throws if the destination is not strictly inside `<root>/visual/` (after
// symlink canonicalization), which keeps the recursive delete the capture step
// performs confined to the harness's own generated artifacts.
export function resolveOutDir(root, rawOut) {
  const harnessRoot = resolve(root, HARNESS_OUTPUT_SUBPATH);
  const candidate = isAbsolute(rawOut) ? resolve(rawOut) : resolve(root, rawOut);
  const canonical = realpathish(candidate);
  if (!contains(harnessRoot, canonical)) {
    throw new Error(
      `visual-capture: refusing to use --out '${rawOut}': it is not inside the harness output area (${HARNESS_OUTPUT_SUBPATH}/). `
      + `Capture deletes --out before writing, so it must be confined to ${HARNESS_OUTPUT_SUBPATH}/ (e.g. ${HARNESS_OUTPUT_SUBPATH}/captures).`
    );
  }
  return canonical;
}
