import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { resolveOutDir } from '../visual/outpath.mjs';

// The capture step `rm -rf`s the resolved --out directory before rewriting it,
// so resolveOutDir must refuse anything that escapes the repo root. These are
// pure path tests — no filesystem access, no browser.

const ROOT = resolve('/repo');

test('accepts a path strictly inside the repo root', () => {
  assert.equal(resolveOutDir(ROOT, 'visual/captures'), resolve('/repo/visual/captures'));
  assert.equal(resolveOutDir(ROOT, 'visual/baselines'), resolve('/repo/visual/baselines'));
});

test('accepts a nested relative path that stays inside the repo', () => {
  assert.equal(resolveOutDir(ROOT, 'visual/../visual/captures'), resolve('/repo/visual/captures'));
});

test('rejects the repo root itself (--out .)', () => {
  assert.throws(() => resolveOutDir(ROOT, '.'), /refusing to use --out/);
});

test('rejects a parent directory (--out ..)', () => {
  assert.throws(() => resolveOutDir(ROOT, '..'), /refusing to use --out/);
  assert.throws(() => resolveOutDir(ROOT, '../..'), /refusing to use --out/);
});

test('rejects traversal that escapes the repo (--out ../sibling)', () => {
  assert.throws(() => resolveOutDir(ROOT, '../sibling'), /refusing to use --out/);
});

test('rejects an absolute path outside the repo', () => {
  assert.throws(() => resolveOutDir(ROOT, '/etc'), /refusing to use --out/);
  assert.throws(() => resolveOutDir(ROOT, '/tmp/captures'), /refusing to use --out/);
});

test('accepts an absolute path strictly inside the repo', () => {
  assert.equal(resolveOutDir(ROOT, resolve('/repo/visual/captures')), resolve('/repo/visual/captures'));
});
