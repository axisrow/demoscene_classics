import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Runs the WebGL Mandelbrot smoke driver in the pinned Chromium. This test is
// independent of the Canvas 2D pixel baselines: it exercises context creation,
// shader compile/link, GL-error-free rendering, and graceful Canvas 2D fallback.
// Skipped automatically if the pinned Python Playwright is unavailable.

function runSmoke() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [
      join(root, 'visual', 'webgl_smoke.py'),
      join(root, 'visual', 'test-page.html')
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`webgl_smoke.py exited ${code}\n${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim().split('\n').pop()));
      } catch (error) {
        reject(new Error(`webgl_smoke.py unparseable output: ${error}\n${stdout}\n${stderr}`));
      }
    });
  });
}

const isPlaywrightAvailable = spawnSync('python3', ['-c', 'import playwright'], { stdio: 'ignore' }).status === 0;

// Capture the driver result once, then assert on it across focused subtests.
// `await` resolves the promise during test file evaluation; if Playwright is
// absent the file is skipped entirely before any browser launch.
const result = isPlaywrightAvailable ? await runSmoke() : null;
const runOrSkip = isPlaywrightAvailable ? test : test.skip;

runOrSkip('WebGL smoke: the canvas2d backend renders frames', () => {
  assert.equal(result.canvas2dBackend, 'canvas2d');
  assert.equal(result.canvas2dRenders, true);
});

runOrSkip('WebGL smoke: no console or page errors were emitted', () => {
  assert.deepEqual(result.consoleErrors, []);
});

runOrSkip('WebGL smoke: WebGL2 context is available in the pinned Chromium', () => {
  assert.equal(result.webgl2Available, true, 'WebGL2 context could not be created');
});

runOrSkip('WebGL smoke: the auto backend selects webgl2 and draws without GL errors', () => {
  assert.equal(result.autoBackend, 'webgl2');
  assert.equal(result.autoRenders, true);
  assert.equal(result.glErrorAfterDraw, 0, `expected gl.NO_ERROR (0), got ${result.glErrorAfterDraw}`);
});

runOrSkip('WebGL smoke: graceful fallback to canvas2d when WebGL2 is unavailable', () => {
  assert.equal(result.fallbackDidNotThrow, true, `fallback threw: ${result.fallbackError}`);
  assert.equal(result.fallbackBackend, 'canvas2d');
});
