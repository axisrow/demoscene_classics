import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { resolveOutDir } from '../visual/outpath.mjs';

// The capture step `rm -rf`s the resolved --out directory before rewriting it,
// so resolveOutDir must confine the destination to the harness's own output
// area (under visual/). Containment-inside-the-repo is not enough: that still
// accepts .git/src/scripts/dist and tracked files. These are pure path tests
// rooted at a synthetic repo dir.

const ROOT = resolve('/repo');

test('accepts a path strictly inside the harness output area (visual/)', () => {
  assert.equal(resolveOutDir(ROOT, 'visual/captures'), resolve('/repo/visual/captures'));
  assert.equal(resolveOutDir(ROOT, 'visual/baselines'), resolve('/repo/visual/baselines'));
});

test('accepts a nested relative path that stays inside visual/', () => {
  assert.equal(resolveOutDir(ROOT, 'visual/../visual/captures'), resolve('/repo/visual/captures'));
  assert.equal(resolveOutDir(ROOT, 'visual/_scratch/x'), resolve('/repo/visual/_scratch/x'));
});

test('rejects the repo root itself and its parents', () => {
  assert.throws(() => resolveOutDir(ROOT, '.'), /refusing to use --out/);
  assert.throws(() => resolveOutDir(ROOT, '..'), /refusing to use --out/);
  assert.throws(() => resolveOutDir(ROOT, '../..'), /refusing to use --out/);
});

test('rejects traversal that escapes the repo', () => {
  assert.throws(() => resolveOutDir(ROOT, '../sibling'), /refusing to use --out/);
  assert.throws(() => resolveOutDir(ROOT, '/etc'), /refusing to use --out/);
  assert.throws(() => resolveOutDir(ROOT, '/tmp/captures'), /refusing to use --out/);
});

test('rejects harness-adjacent repo dirs that are NOT output areas (.git/src/scripts/dist)', () => {
  // Containment-in-repo is insufficient: a typo must not let rm -rf wipe source,
  // build output, or Git metadata.
  assert.throws(() => resolveOutDir(ROOT, '.git'), /refusing to use --out/);
  assert.throws(() => resolveOutDir(ROOT, 'src'), /refusing to use --out/);
  assert.throws(() => resolveOutDir(ROOT, 'scripts'), /refusing to use --out/);
  assert.throws(() => resolveOutDir(ROOT, 'dist'), /refusing to use --out/);
  assert.throws(() => resolveOutDir(ROOT, 'node_modules'), /refusing to use --out/);
});

test('rejects a tracked file path even though it is inside the repo', () => {
  // rm -rf on a file path would delete it; the guard must reject files outright.
  assert.throws(() => resolveOutDir(ROOT, 'package.json'), /refusing to use --out/);
  assert.throws(() => resolveOutDir(ROOT, 'visual/../package.json'), /refusing to use --out/);
});

test('rejects the bare visual/ root (must target a subdir, not the whole harness area)', () => {
  assert.throws(() => resolveOutDir(ROOT, 'visual'), /refusing to use --out/);
  assert.throws(() => resolveOutDir(ROOT, 'visual/'), /refusing to use --out/);
  assert.throws(() => resolveOutDir(ROOT, 'visual/..'), /refusing to use --out/);
});
