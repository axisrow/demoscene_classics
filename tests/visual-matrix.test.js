import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMatrix,
  captureEntryKey,
  captureFilename,
  EFFECT_NAMES,
  EXPECTED_CAPTURE_COUNT,
  EXPECTED_CASE_COUNT,
  mergeManifest,
  parseCaptureFilename,
  stepCountForTimestamp,
  STEP_SECONDS,
  TIMESTAMPS
} from '../visual/matrix.mjs';
import { PROFILES } from '../visual/profiles.mjs';

test('matrix covers ten effects x four profiles x three timestamps', () => {
  const { cases, captures } = buildMatrix();
  assert.equal(cases.length, EXPECTED_CASE_COUNT);
  assert.equal(captures.length, EXPECTED_CAPTURE_COUNT);
  assert.equal(cases.length, EFFECT_NAMES.length * PROFILES.length);
  assert.equal(captures.length, cases.length * TIMESTAMPS.length);
});

test('matrix enumerates exactly the ten public effect names', () => {
  const { cases } = buildMatrix();
  const names = [...new Set(cases.map((c) => c.effectName))];
  assert.deepEqual(names, [...EFFECT_NAMES]);
});

test('expected counts are 40 cases and 120 captures', () => {
  assert.equal(EXPECTED_CASE_COUNT, 40);
  assert.equal(EXPECTED_CAPTURE_COUNT, 120);
});

test('case ids are stable and unique', () => {
  const { cases } = buildMatrix();
  const ids = cases.map((c) => c.caseId);
  assert.equal(new Set(ids).size, ids.length);
  // Idempotent: rebuild yields byte-identical ids in the same order.
  const ids2 = buildMatrix().cases.map((c) => c.caseId);
  assert.deepEqual(ids, ids2);
  // Format is <effect>__<profileId>.
  assert.equal(cases[0].caseId, 'plasma__desktop-preview');
  assert.equal(cases[cases.length - 1].caseId, 'copperBars__mobile-fullscreen');
});

test('capture filenames encode effect, profile, dimensions, resolved device and timestamp', () => {
  const { captures } = buildMatrix();
  const sample = captures.find(
    (c) => c.effectName === 'plasma'
      && c.profileId === 'desktop-preview'
      && c.timestampSeconds === 1.5
  );
  assert.equal(
    sample.filename,
    'plasma__desktop-preview__320x180__desktop__1p5s.png'
  );
  assert.equal(
    captureFilename({
      effectName: 'mandelbrot',
      profileId: 'mobile-fullscreen',
      width: 390,
      height: 844,
      resolvedDevice: 'mobile',
      timestampSeconds: 5
    }),
    'mandelbrot__mobile-fullscreen__390x844__mobile__5s.png'
  );
  assert.equal(
    captureFilename({
      effectName: 'fire',
      profileId: 'desktop-fullscreen',
      width: 1280,
      height: 720,
      resolvedDevice: 'desktop',
      timestampSeconds: 0
    }),
    'fire__desktop-fullscreen__1280x720__desktop__0s.png'
  );
});

test('filenames round-trip through parseCaptureFilename', () => {
  const { captures } = buildMatrix();
  for (const capture of captures) {
    const parsed = parseCaptureFilename(capture.filename);
    assert.ok(parsed, `unparseable: ${capture.filename}`);
    assert.equal(parsed.effectName, capture.effectName);
    assert.equal(parsed.profileId, capture.profileId);
    assert.equal(parsed.width, capture.width);
    assert.equal(parsed.height, capture.height);
    assert.equal(parsed.resolvedDevice, capture.resolvedDevice);
    assert.equal(parsed.timestampSeconds, capture.timestampSeconds);
  }
});

test('parseCaptureFilename rejects malformed names', () => {
  assert.equal(parseCaptureFilename('garbage.png'), null);
  // Too few fields.
  assert.equal(parseCaptureFilename('plasma__preview__320x180__desktop.png'), null);
  // Too many fields.
  assert.equal(parseCaptureFilename('plasma__preview__320x180__desktop__1p5s__extra.png'), null);
  // Non-numeric dimensions.
  assert.equal(parseCaptureFilename('plasma__preview__WxH__desktop__1p5s.png'), null);
  // Unparseable timestamp.
  assert.equal(parseCaptureFilename('plasma__preview__320x180__desktop__soons.png'), null);
});

test('filenames across the full matrix are unique', () => {
  const { captures } = buildMatrix();
  const names = captures.map((c) => c.filename);
  assert.equal(new Set(names).size, names.length);
});

test('the test clock advances in exact 1/60 second steps', () => {
  assert.equal(STEP_SECONDS, 1 / 60);
  assert.equal(stepCountForTimestamp(0), 0);
  assert.equal(stepCountForTimestamp(1.5), 90);
  assert.equal(stepCountForTimestamp(5), 300);
});

test('every capture records the fixed-step count for its timestamp', () => {
  const { captures } = buildMatrix();
  for (const capture of captures) {
    assert.equal(capture.steps, stepCountForTimestamp(capture.timestampSeconds));
  }
  // Captures at the mature 5s mark always run the full 300 intermediate steps.
  const mature = captures.filter((c) => c.timestampSeconds === 5);
  assert.equal(mature.length, EXPECTED_CASE_COUNT);
  assert.ok(mature.every((c) => c.steps === 300));
});

test('resolved device is held constant per profile, never auto', () => {
  const { captures } = buildMatrix();
  for (const capture of captures) {
    assert.notEqual(capture.device, 'auto');
    assert.equal(capture.resolvedDevice, capture.device);
    assert.ok(capture.resolvedDevice === 'desktop' || capture.resolvedDevice === 'mobile');
  }
});

test('every case carries the four-profile geometry independent of render resolution', () => {
  const { cases } = buildMatrix();
  const dims = new Set(cases.map((c) => `${c.profile.width}x${c.profile.height}`));
  assert.deepEqual(
    [...dims].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    ['320x180', '360x180', '390x844', '1280x720']
  );
});

// --- manifest subset-merge ------------------------------------------------
// Regression guard for the #27 bug: a `--effect <name>` subset capture
// re-renders only that effect's 12 frames but must MERGE into the existing
// manifest, preserving every other effect's entries and the true captureCount.
// These tests exercise the pure merge function the orchestrator now calls, so
// they run without launching a browser.

function buildManifestEntry(capture, overrides = {}) {
  return {
    ...parseCaptureFilename(capture.filename),
    file: `visual/baselines/${capture.filename}`,
    sha256: '0'.repeat(64),
    size: 1000,
    selection: { preset: 'classic' },
    steps: capture.steps,
    chromiumBuild: '1217',
    playwrightVersion: '1.59.0',
    ...overrides
  };
}

test('captureEntryKey keys a manifest entry by its filename slot', () => {
  const entry = { file: 'visual/baselines/plasma__desktop-preview__320x180__desktop__0s.png' };
  assert.equal(captureEntryKey(entry), 'plasma__desktop-preview__320x180__desktop__0s.png');
  // The key ignores the directory prefix: a baseline and a capture of the same
  // slot share a key even though their `file` paths differ.
  const captureEntry = { file: 'visual/captures/plasma__desktop-preview__320x180__desktop__0s.png' };
  assert.equal(captureEntryKey(captureEntry), captureEntryKey(entry));
  assert.equal(captureEntryKey({}), null);
  assert.equal(captureEntryKey(null), null);
});

test('mergeManifest: subset update replaces only the re-rendered effect, keeps the rest', () => {
  // A complete, healthy manifest covering all 120 slots.
  const all = buildMatrix().captures.map((c) => buildManifestEntry(c, { sha256: 'aaaa' }));
  const existing = {
    generatedAt: '2026-07-25T00:00:00.000Z',
    playwrightVersion: '1.59.0',
    chromiumBuild: '1217',
    captureCount: all.length,
    captures: all
  };

  // A subset run re-rendered metaballs (12 frames) with new checksums.
  const fresh = buildMatrix().captures
    .filter((c) => c.effectName === 'metaballs')
    .map((c) => buildManifestEntry(c, { sha256: 'bbbb' }));

  const merged = mergeManifest(existing, fresh, {
    generatedAt: '2026-07-26T00:00:00.000Z',
    playwrightVersion: '1.59.0',
    chromiumBuild: '1217'
  });

  // captureCount must stay at the full matrix size, NOT collapse to 12.
  assert.equal(merged.captureCount, EXPECTED_CAPTURE_COUNT);
  assert.equal(merged.captures.length, EXPECTED_CAPTURE_COUNT);

  // metaballs entries were replaced (new sha256); every other effect untouched.
  for (const entry of merged.captures) {
    const expected = entry.effectName === 'metaballs' ? 'bbbb' : 'aaaa';
    assert.equal(entry.sha256, expected, `wrong checksum for ${entry.file}`);
  }
  // All ten effects are still present.
  assert.deepEqual(
    [...new Set(merged.captures.map((c) => c.effectName))].sort(),
    [...EFFECT_NAMES].sort()
  );
  // Top-level scalars were stamped.
  assert.equal(merged.generatedAt, '2026-07-26T00:00:00.000Z');
  assert.equal(merged.chromiumBuild, '1217');
});

test('mergeManifest: subset update preserves the original entry order', () => {
  const all = buildMatrix().captures.map((c) => buildManifestEntry(c));
  const existing = { captureCount: all.length, captures: all };
  const fresh = buildMatrix().captures
    .filter((c) => c.effectName === 'metaballs')
    .map((c) => buildManifestEntry(c, { sha256: 'new' }));

  const merged = mergeManifest(existing, fresh, {
    generatedAt: 't',
    playwrightVersion: '1.59.0',
    chromiumBuild: '1217'
  });

  // Replaced entries stay in their original positions; no reordering.
  const originalFiles = all.map((c) => c.file);
  const mergedFiles = merged.captures.map((c) => c.file);
  assert.deepEqual(mergedFiles, originalFiles);
});

test('mergeManifest: subset run appends slots that did not previously exist', () => {
  // An existing manifest holding only plasma (e.g. a prior subset run, or a
  // partially-populated dir). A metaballs subset run must ADD its 12 frames
  // without dropping plasma.
  const plasma = buildMatrix().captures
    .filter((c) => c.effectName === 'plasma')
    .map((c) => buildManifestEntry(c));
  const existing = { captureCount: plasma.length, captures: plasma };
  const fresh = buildMatrix().captures
    .filter((c) => c.effectName === 'metaballs')
    .map((c) => buildManifestEntry(c));

  const merged = mergeManifest(existing, fresh, {
    generatedAt: 't',
    playwrightVersion: '1.59.0',
    chromiumBuild: '1217'
  });

  assert.equal(merged.captureCount, plasma.length + fresh.length);
  const effects = new Set(merged.captures.map((c) => c.effectName));
  assert.equal(effects.size, 2);
  assert.ok(effects.has('plasma'));
  assert.ok(effects.has('metaballs'));
});

test('mergeManifest: null/missing existing manifest behaves like a fresh write', () => {
  const fresh = buildMatrix().captures
    .filter((c) => c.effectName === 'plasma')
    .map((c) => buildManifestEntry(c));

  const merged = mergeManifest(null, fresh, {
    generatedAt: 't',
    playwrightVersion: '1.59.0',
    chromiumBuild: '1217'
  });
  assert.equal(merged.captureCount, fresh.length);
  assert.deepEqual(merged.captures, fresh);
});

test('mergeManifest: degenerate duplicate filenames in existing manifest are de-duplicated', () => {
  // A corrupt prior manifest carrying a duplicate slot must not double-count.
  const one = buildManifestEntry(buildMatrix().captures[0]);
  const existing = { captureCount: 2, captures: [one, { ...one }] };
  const merged = mergeManifest(existing, [], {
    generatedAt: 't',
    playwrightVersion: '1.59.0',
    chromiumBuild: '1217'
  });
  assert.equal(merged.captureCount, 1);
  assert.equal(merged.captures.length, 1);
});
