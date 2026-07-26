#!/usr/bin/env node
// Node orchestrator for the gallery screenshot capture (issue #15).
//
// Mirrors scripts/visual-capture.mjs: verifies the pinned Python Playwright,
// invokes visual/gallery_runner.py once, and writes the desktop + mobile
// full-page gallery PNGs plus a JSONL-style manifest. This harness is SEPARATE
// from the effect visual harness: it captures the decorated index.html at a
// fixed viewport and advances the gallery to a fixed maturity, so presentation
// regressions are owned on their own baseline without touching effect baselines.
//
// Usage:
//   node scripts/gallery-capture.mjs --out <dir>
//   node scripts/gallery-capture.mjs --out visual/captures/gallery   # compare run
//   node scripts/gallery-capture.mjs --out visual/baselines/gallery  # baseline update

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINNED_CHROMIUM_BUILD, PINNED_PLAYWRIGHT_VERSION } from '../visual/pin.mjs';
import { resolveOutDir } from '../visual/outpath.mjs';
import { GALLERY_CAPTURES, GALLERY_MATURITY_SECONDS } from '../visual/gallery.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runnerPath = join(root, 'visual', 'gallery_runner.py');
const galleryPagePath = join(root, 'index.html');

// Capture set + maturity live in visual/gallery.mjs so the comparator can share
// the same expected-filename source of truth without executing this script's
// main() at import time.
const CAPTURES = GALLERY_CAPTURES;

function parseArgs(argv) {
  const args = { out: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: gallery-capture --out <dir>');
      process.exit(0);
    }
  }
  if (!args.out) {
    console.error('gallery-capture: --out <dir> is required.');
    process.exit(2);
  }
  return args;
}

// Identical Playwright pin check to visual-capture.mjs: the harness is only
// reproducible against playwright 1.59.0 / chromium build 1217.
async function checkPlaywright() {
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
        console.error(`gallery-capture: Python Playwright check failed.\n${err}`);
        console.error(`Install the pinned runtime:\n  pip install playwright==${PINNED_PLAYWRIGHT_VERSION}\n  python -m playwright install chromium`);
        process.exit(2);
      }
      try {
        const info = JSON.parse(out.trim().split('\n').pop());
        if (info.build !== PINNED_CHROMIUM_BUILD) {
          console.error(`gallery-capture: pinned chromium build is ${PINNED_CHROMIUM_BUILD} but found chromium-${info.build}.`);
          console.error(`Install the pinned runtime:\n  pip install playwright==${PINNED_PLAYWRIGHT_VERSION}\n  python -m playwright install chromium`);
          process.exit(2);
        }
        resolve();
      } catch (error) {
        console.error(`gallery-capture: could not parse Playwright info: ${error}\n${out}`);
        process.exit(2);
      }
    });
  });
}

async function runRunner(captures, outDir) {
  const request = JSON.stringify({ outDir, captures });
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [runnerPath, galleryPagePath], { stdio: ['pipe', 'pipe', 'pipe'] });
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
        reject(new Error(`gallery_runner exited ${code}\n${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split('\n').pop()));
      } catch (error) {
        reject(new Error(`gallery_runner produced unparseable output: ${error}\n${stdout}\n${stderr}`));
      }
    });
    proc.stdin.end(request);
  });
}

async function main() {
  const args = parseArgs(process.argv);
  await checkPlaywright();

  const outDir = resolveOutDir(root, args.out);

  // The gallery harness replaces its full output set atomically: clear the dir,
  // then rewrite both captures. (Unlike the effect harness there is no
  // --effect/--profile subset mode, so a full replace is always correct here.)
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const t0 = Date.now();
  const { results, chromiumBuild } = await runRunner(CAPTURES, outDir);
  const elapsed = (((Date.now?.() ?? 0) - t0) / 1000).toFixed(1);

  const failures = results.filter((r) => !r.ok);
  const fresh = results.map((r) => ({
    file: `${args.out}/${r.filename}`,
    sha256: r.sha256,
    size: r.size,
    view: CAPTURES.find((c) => c.filename === r.filename)?.view,
    steps: CAPTURES.find((c) => c.filename === r.filename)?.steps,
    chromiumBuild,
    playwrightVersion: PINNED_PLAYWRIGHT_VERSION
  }));

  const manifestPath = join(outDir, 'manifest.json');
  const manifest = {
    generatedAt: new Date().toISOString(),
    playwrightVersion: PINNED_PLAYWRIGHT_VERSION,
    chromiumBuild,
    maturitySeconds: GALLERY_MATURITY_SECONDS,
    captureCount: fresh.length,
    captures: fresh
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`gallery-capture: wrote ${results.length} captures to ${args.out}/ in ${elapsed}s (chromium-${chromiumBuild}).`);
  if (failures.length) {
    for (const failure of failures) {
      console.error(`  FAIL ${failure.filename}: ${failure.error || failure.pageErrors?.join('; ')}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`gallery-capture: ${error.message}`);
  process.exit(1);
});
