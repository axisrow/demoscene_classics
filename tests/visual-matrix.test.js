import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMatrix,
  captureFilename,
  EFFECT_NAMES,
  EXPECTED_CAPTURE_COUNT,
  EXPECTED_CASE_COUNT,
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
