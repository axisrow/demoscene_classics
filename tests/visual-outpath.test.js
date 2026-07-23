import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveOutDir } from '../visual/outpath.mjs';

// The capture step `rm -rf`s the resolved --out directory before rewriting it,
// so resolveOutDir must confine the destination to a capture-OWNED root and
// refuse any existing non-directory. Containment-under-visual/ was not enough
// (it accepted tracked files like visual/compare.mjs), so an explicit allowlist
// plus a non-directory guard are required. These tests use a real temp tree so
// the non-directory/symlink checks exercise the filesystem.

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'vc-out-'));
  mkdirSync(join(root, 'visual'), { recursive: true });
  mkdirSync(join(root, 'visual/captures'), { recursive: true });
  mkdirSync(join(root, 'visual/baselines'), { recursive: true });
  // Tracked-looking harness source and files inside visual/.
  writeFileSync(join(root, 'visual/compare.mjs'), 'export {}');
  writeFileSync(join(root, 'visual/README.md'), '# readme');
  writeFileSync(join(root, 'visual/baselines/manifest.json'), '{}');
  writeFileSync(join(root, 'package.json'), '{}');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  return root;
}

test('accepts a path under a capture-owned root', () => {
  const root = makeRepo();
  // resolveOutDir returns a canonical (realpath) absolute path, so compare
  // against realpathSync, not a lexical resolve (macOS /var -> /private/var).
  assert.equal(resolveOutDir(root, 'visual/captures'), realpathSync(join(root, 'visual/captures')));
  assert.equal(resolveOutDir(root, 'visual/baselines'), realpathSync(join(root, 'visual/baselines')));
  assert.equal(resolveOutDir(root, 'visual/captures/sub'), realpathSync(join(root, 'visual/captures')) + '/sub');
});

test('accepts a nested relative path that stays under a capture root', () => {
  const root = makeRepo();
  assert.equal(resolveOutDir(root, 'visual/../visual/captures'), realpathSync(join(root, 'visual/captures')));
});

test('rejects the bare visual/ root (must target an owned subdir)', () => {
  const root = makeRepo();
  assert.throws(() => resolveOutDir(root, 'visual'), /capture-owned output root/);
  assert.throws(() => resolveOutDir(root, 'visual/'), /capture-owned output root/);
  assert.throws(() => resolveOutDir(root, 'visual/..'), /capture-owned output root/);
});

test('rejects repo root, parents, and traversal outside the repo', () => {
  const root = makeRepo();
  assert.throws(() => resolveOutDir(root, '.'), /capture-owned output root/);
  assert.throws(() => resolveOutDir(root, '..'), /capture-owned output root/);
  assert.throws(() => resolveOutDir(root, '../sibling'), /capture-owned output root/);
  assert.throws(() => resolveOutDir(root, '/etc'), /capture-owned output root/);
});

test('rejects harness-adjacent dirs that are NOT capture roots (src/scripts/dist/.git/node_modules)', () => {
  const root = makeRepo();
  assert.throws(() => resolveOutDir(root, 'src'), /capture-owned output root/);
  assert.throws(() => resolveOutDir(root, 'scripts'), /capture-owned output root/);
  assert.throws(() => resolveOutDir(root, 'dist'), /capture-owned output root/);
  assert.throws(() => resolveOutDir(root, '.git'), /capture-owned output root/);
  assert.throws(() => resolveOutDir(root, 'node_modules'), /capture-owned output root/);
});

test('rejects tracked harness files inside visual/', () => {
  const root = makeRepo();
  // Files directly under visual/ are not under a capture-owned root, so the
  // allowlist rejects them.
  assert.throws(() => resolveOutDir(root, 'visual/compare.mjs'), /capture-owned output root/);
  assert.throws(() => resolveOutDir(root, 'visual/README.md'), /capture-owned output root/);
  // A tracked file that DOES sit under an owned root (manifest.json under
  // visual/baselines/) passes the allowlist but is caught by the
  // non-directory guard — rm -rf must never target an existing file.
  assert.throws(() => resolveOutDir(root, 'visual/baselines/manifest.json'), /non-directory/);
  // A tracked file outside visual/ is rejected by the allowlist.
  assert.throws(() => resolveOutDir(root, 'package.json'), /capture-owned output root/);
});

test('rejects a symlinked ancestor that escapes the capture root', () => {
  const root = makeRepo();
  const outside = mkdtempSync(join(tmpdir(), 'vc-out-escape-'));
  // visual/captures/evil -> /tmp/outside: an in-repo symlink pointing out.
  symlinkSync(outside, join(root, 'visual/captures/evil'), 'dir');
  assert.throws(() => resolveOutDir(root, 'visual/captures/evil'), /capture-owned output root/);
});
