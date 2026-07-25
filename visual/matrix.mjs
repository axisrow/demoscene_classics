import { PROFILES } from './profiles.mjs';

// The ten public effect names, in gallery order. These are the keys on the
// `Demoscene` namespace and the public function names; the visual suite must
// enumerate exactly these so the harness cannot drift from the shipped API.
export const EFFECT_NAMES = Object.freeze([
  'plasma',
  'fire',
  'starfield',
  'metaballs',
  'tunnel',
  'mandelbrot',
  'sineScroller',
  'rotozoom',
  'feedback',
  'copperBars'
]);

export const TIMESTAMPS = Object.freeze([0, 1.5, 5]);

// The test clock advances in exact 1/60 second steps. A capture at `t` seconds
// runs `Math.round(t * 60)` fixed steps (so 0 -> 0 steps, 1.5 -> 90, 5 -> 300),
// always advancing every intermediate step — never jumping from zero to the
// capture timestamp. This is mandatory for stateful effects whose state
// accumulates across delta (fire accumulator, starfield/sine-scroller position,
// feedback prior-frame reads).
export const STEP_HZ = 60;
export const STEP_SECONDS = 1 / STEP_HZ;

export function stepCountForTimestamp(timestampSeconds) {
  return Math.round(timestampSeconds * STEP_HZ);
}

// Render the stable, deterministic filename for one capture. Encoding effect,
// surface, resolved device, dimensions and timestamp lets the comparator detect
// stale or missing cases by name alone. `resolvedDevice` is provided by the
// resolver's selection snapshot at capture time; it equals the profile device
// because the harness never requests `device:'auto'`.
export function captureFilename({
  effectName,
  profileId,
  width,
  height,
  resolvedDevice,
  timestampSeconds
}) {
  const tsLabel = Number.isInteger(timestampSeconds)
    ? `${timestampSeconds}`
    : `${timestampSeconds}`.replace('.', 'p');
  return [
    effectName,
    profileId,
    `${width}x${height}`,
    resolvedDevice,
    `${tsLabel}s`
  ].join('__').concat('.png');
}

// Parse a capture filename back into its identifying fields. Used by the
// comparator and contact-sheet builder to detect stale/malformed baselines.
export function parseCaptureFilename(filename) {
  const base = filename.endsWith('.png') ? filename.slice(0, -'.png'.length) : filename;
  const parts = base.split('__');
  if (parts.length !== 5) return null;
  const [effectName, profileId, dimensions, resolvedDevice, tsLabel] = parts;
  const dimMatch = dimensions.match(/^(\d+)x(\d+)$/);
  if (!dimMatch) return null;
  const timestampSeconds = tsLabel.endsWith('s') ? Number(tsLabel.slice(0, -1).replace('p', '.')) : NaN;
  if (!Number.isFinite(timestampSeconds)) return null;
  return {
    effectName,
    profileId,
    width: Number(dimMatch[1]),
    height: Number(dimMatch[2]),
    resolvedDevice,
    timestampSeconds
  };
}

// Stable identity for a manifest capture entry. The filename already encodes
// every identifying field (effect/profile/dimensions/timestamp, see
// captureFilename), so it is the canonical key for "same capture slot". Used by
// mergeManifest to replace-in-place the entries a subset run re-rendered while
// leaving every other effect's entries untouched.
export function captureEntryKey(entry) {
  if (!entry || typeof entry.file !== 'string') return null;
  return entry.file.split('/').pop();
}

// Merge a fresh batch of capture entries into an existing manifest.
//
// A subset capture run (--effect/--profile) re-renders only its own slice of
// the matrix (e.g. the 12 metaballs frames). Its manifest write MUST NOT
// replace the whole manifest with that slice — that would silently drop every
// other effect's entries and shrink captureCount (the #27 regression: 120 ->
// 12). Instead each freshly captured entry replaces the existing entry with the
// same slot key (filename); entries not re-rendered are preserved verbatim.
//
// `existing` may be null/undefined (first capture into an empty dir, or a
// corrupt/missing manifest): the merge then behaves like a fresh write, which
// is correct — a full run also writes from scratch.
//
// `fresh` is the array of entries produced by this run. `meta` carries the
// top-level scalar fields to stamp onto the merged manifest
// (generatedAt/playwrightVersion/chromiumBuild). Returns the full merged
// manifest object (captures in existing order with replacements applied, new
// slots appended).
export function mergeManifest(existing, fresh, meta) {
  const byKey = new Map();
  const orderedKeys = [];
  if (existing && Array.isArray(existing.captures)) {
    for (const entry of existing.captures) {
      const key = captureEntryKey(entry);
      if (key === null || byKey.has(key)) continue;
      byKey.set(key, entry);
      orderedKeys.push(key);
    }
  }
  for (const entry of fresh) {
    const key = captureEntryKey(entry);
    if (key === null) continue;
    if (!byKey.has(key)) orderedKeys.push(key);
    byKey.set(key, entry);
  }
  const captures = orderedKeys.map((key) => byKey.get(key));
  return {
    generatedAt: meta.generatedAt,
    playwrightVersion: meta.playwrightVersion,
    chromiumBuild: meta.chromiumBuild,
    captureCount: captures.length,
    captures
  };
}

// A case is one effect rendered in one profile. A capture is one frame of a
// case at one timestamp. The full matrix is 10 effects x 4 profiles x 3
// timestamps = 120 captures.
export function buildMatrix() {
  const cases = [];
  const captures = [];
  const seenCaseIds = new Set();
  for (const effectName of EFFECT_NAMES) {
    for (const profile of PROFILES) {
      const caseId = `${effectName}__${profile.id}`;
      if (seenCaseIds.has(caseId)) {
        throw new Error(`Duplicate visual case id: ${caseId}`);
      }
      seenCaseIds.add(caseId);
      const caseCaptures = [];
      for (const timestampSeconds of TIMESTAMPS) {
        const capture = Object.freeze({
          caseId,
          effectName,
          profileId: profile.id,
          surface: profile.surface,
          device: profile.device,
          resolvedDevice: profile.device,
          width: profile.width,
          height: profile.height,
          timestampSeconds,
          steps: stepCountForTimestamp(timestampSeconds),
          filename: captureFilename({
            effectName,
            profileId: profile.id,
            width: profile.width,
            height: profile.height,
            resolvedDevice: profile.device,
            timestampSeconds
          })
        });
        captures.push(capture);
        caseCaptures.push(capture);
      }
      cases.push(Object.freeze({
        caseId,
        effectName,
        profile,
        captures: Object.freeze(caseCaptures)
      }));
    }
  }
  return Object.freeze({ cases: Object.freeze(cases), captures: Object.freeze(captures) });
}

export const EXPECTED_CAPTURE_COUNT = EFFECT_NAMES.length * PROFILES.length * TIMESTAMPS.length;
export const EXPECTED_CASE_COUNT = EFFECT_NAMES.length * PROFILES.length;
