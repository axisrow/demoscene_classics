#!/usr/bin/env node
// Node orchestrator for the visual-QA capture.
//
// Generates the capture matrix, invokes the pinned Python Playwright driver
// (visual/capture_runner.py) once, and writes raw PNGs into the requested
// directory plus a JSONL manifest (selection + checksum per capture).
//
// Usage:
//   node scripts/visual-capture.mjs --out <dir> [--effect <name>] [--profile <id>]
//   node scripts/visual-capture.mjs --out visual/captures            # compare run
//   node scripts/visual-capture.mjs --out visual/baselines           # baseline update

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMatrix, mergeManifest, parseCaptureFilename } from '../visual/matrix.mjs';
import { PINNED_CHROMIUM_BUILD, PINNED_PLAYWRIGHT_VERSION } from '../visual/pin.mjs';
import { resolveOutDir } from '../visual/outpath.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runnerPath = join(root, 'visual', 'capture_runner.py');
const testPagePath = join(root, 'visual', 'test-page.html');

function parseArgs(argv) {
  const args = { out: null, effect: null, profile: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i];
    else if (arg === '--effect') args.effect = argv[++i];
    else if (arg === '--profile') args.profile = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: visual-capture --out <dir> [--effect <name>] [--profile <id>]');
      process.exit(0);
    }
  }
  if (!args.out) {
    console.error('visual-capture: --out <dir> is required.');
    process.exit(2);
  }
  return args;
}

async function checkPlaywright() {
  // Verify the pinned Python Playwright is importable and resolves the pinned
  // chromium build before we pay for a matrix run. Fails loudly otherwise.
  return new Promise((resolve) => {
    const proc = spawn('python3', ['-c', `
from playwright.sync_api import sync_playwright
import playwright, json, sys
with sync_playwright() as p:
    exe = p.chromium.executable_path
    build = None
    for part in exe.replace("\\\\", "/").split("/"):
        if part.startswith("chromium-"):
            build = part.split("-", 1)[1]
    print(json.dumps({"playwright": playwright.__version__ if hasattr(playwright,"__version__") else "unknown", "build": build}))
`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`visual-capture: Python Playwright check failed.\n${err}`);
        console.error(`Install the pinned runtime:\n  pip install playwright==${PINNED_PLAYWRIGHT_VERSION}\n  python -m playwright install chromium`);
        process.exit(2);
      }
      try {
        const info = JSON.parse(out.trim().split('\n').pop());
        if (info.build !== PINNED_CHROMIUM_BUILD) {
          console.error(`visual-capture: pinned chromium build is ${PINNED_CHROMIUM_BUILD} but found chromium-${info.build}.`);
          console.error(`Install the pinned runtime:\n  pip install playwright==${PINNED_PLAYWRIGHT_VERSION}\n  python -m playwright install chromium`);
          process.exit(2);
        }
        resolve();
      } catch (error) {
        console.error(`visual-capture: could not parse Playwright info: ${error}\n${out}`);
        process.exit(2);
      }
    });
  });
}

async function runRunner(captures, outDir) {
  const request = JSON.stringify({ outDir, captures });
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [runnerPath, testPagePath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 2) {
        // Runner emitted its own pin/error JSON on stdout.
        console.error(stdout.trim() || stderr);
        process.exit(2);
      }
      if (code !== 0) {
        reject(new Error(`capture_runner exited ${code}\n${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split('\n').pop()));
      } catch (error) {
        reject(new Error(`capture_runner produced unparseable output: ${error}\n${stdout}\n${stderr}`));
      }
    });
    proc.stdin.end(request);
  });
}

async function main() {
  const args = parseArgs(process.argv);
  await checkPlaywright();

  let { captures } = buildMatrix();
  const isSubset = Boolean(args.effect || args.profile);
  if (args.effect) captures = captures.filter((c) => c.effectName === args.effect);
  if (args.profile) captures = captures.filter((c) => c.profileId === args.profile);

  const outDir = resolveOutDir(root, args.out);

  if (isSubset) {
    // A subset run (--effect/--profile) must NOT wipe the whole output dir: that
    // would destroy unrelated captures/baselines and write only the filtered
    // few. Remove only the files this run is about to replace, then reuse the
    // existing directory. (A subset run therefore only ever edits its own
    // slice of an existing matrix.)
    await mkdir(outDir, { recursive: true });
    await Promise.all(captures.map((c) => rm(join(outDir, c.filename), { force: true })));
  } else {
    // A full run replaces the complete matrix atomically-ish: clear the dir,
    // then rewrite all 120 captures.
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
  }

  const runnerCaptures = captures.map((c) => ({
    effectName: c.effectName,
    surface: c.surface,
    device: c.device,
    width: c.width,
    height: c.height,
    steps: c.steps,
    filename: c.filename
  }));

  const t0 = Date.now();
  const { results, chromiumBuild } = await runRunner(runnerCaptures, outDir);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const failures = results.filter((r) => !r.ok);
  const fresh = results.map((r) => {
    const parsed = parseCaptureFilename(r.filename);
    return {
      ...parsed,
      file: join(args.out, r.filename),
      sha256: r.sha256,
      size: r.size,
      selection: r.selection,
      steps: r.steps,
      chromiumBuild,
      playwrightVersion: PINNED_PLAYWRIGHT_VERSION
    };
  });

  const manifestPath = join(outDir, 'manifest.json');
  const meta = {
    generatedAt: new Date().toISOString(),
    playwrightVersion: PINNED_PLAYWRIGHT_VERSION,
    chromiumBuild
  };

  let manifest;
  if (isSubset) {
    // A subset run re-rendered only its own slice of the matrix. The manifest
    // must MERGE: read the existing manifest, replace entries this run
    // re-captured (matched by filename slot), and preserve every other effect's
    // entries verbatim. Writing only the fresh slice here would silently drop
    // the rest and shrink captureCount (the regression that left the baselines
    // manifest holding just 12 metaballs entries instead of 120).
    let existing = null;
    try {
      const raw = await readFile(manifestPath, 'utf8');
      existing = JSON.parse(raw);
    } catch {
      // No prior manifest (or unreadable): treat as a fresh write.
      existing = null;
    }
    manifest = mergeManifest(existing, fresh, meta);
  } else {
    // A full run replaces the whole manifest from scratch.
    manifest = { ...meta, captureCount: fresh.length, captures: fresh };
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const captureNote = isSubset
    ? `wrote ${results.length} captures + merged manifest to ${manifest.captureCount} total`
    : `wrote ${results.length} captures`;
  console.log(`visual-capture: ${captureNote} to ${args.out}/ in ${elapsed}s (chromium-${chromiumBuild}).`);
  if (failures.length) {
    for (const failure of failures) {
      console.error(`  FAIL ${failure.filename}: ${failure.error || failure.pageErrors?.join('; ')}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`visual-capture: ${error.message}`);
  process.exit(1);
});
