"""Deterministic browser capture driver for the demoscene visual-QA harness.

Invoked as a subprocess by scripts/visual-capture.mjs. Launches a single headless
Chromium (the pinned build) and renders each requested capture by mounting the
effect fresh via the API v3 public function, then driving the controller with a
fixed 1/60 s clock and snapshotting the canvas. Every source of nondeterminism
the browser normally injects (wall clock, Date, performance.now, Math.random,
device scale, color scheme, animation scheduling) is held constant.

Protocol:
  argv[1] = path to the undecorated test page (file://) that loads dist/demoscene.js
  stdin    = JSON object { outDir, captures: [...] }
  stdout   = JSON object { results: [...], chromiumBuild: "<build>" }

Each capture: { effectName, surface, device, width, height, steps, filename }.
Each result:  { filename, ok, sha256, size, selection, error? }.
"""

import base64
import hashlib
import json
import os
import sys

from playwright.sync_api import sync_playwright

# Pin: this harness is reproducible only against the Playwright/Chromium pair
# below. Playwright 1.59.0's bundled driver resolves chromium build 1217 (see
# .../playwright/driver/package/browsers.json). The Node orchestrator asserts
# the same value before invoking us; we assert it again here so a mismatched
# local install fails loudly rather than emitting drifting baselines.
PINNED_CHROMIUM_BUILD = "1217"


def _build_from_executable(playwright):
    exe = playwright.chromium.executable_path
    # .../ms-playwright/chromium-1223/chrome-mac/Chromium.app/...
    parts = exe.replace("\\", "/").split("/")
    for part in parts:
        if part.startswith("chromium-"):
            return part.split("-", 1)[1]
    return None


def main():
    page_path = sys.argv[1]
    request = json.load(sys.stdin)
    out_dir = request["outDir"]
    captures = request["captures"]
    page_url = "file://" + os.path.abspath(page_path)

    results = []
    with sync_playwright() as p:
        build = _build_from_executable(p)
        if build != PINNED_CHROMIUM_BUILD:
            print(json.dumps({
                "error": (
                    f"Pinned chromium build is {PINNED_CHROMIUM_BUILD} but the "
                    f"installed Playwright resolved chromium-{build or 'unknown'}. "
                    "Install Playwright 1.59.0 (pip install playwright==1.59.0) "
                    "and run: python -m playwright install chromium."
                )
            }))
            sys.exit(2)

        browser = p.chromium.launch(headless=True, args=[
            "--disable-web-security",
            "--disable-features=CalculateNativeWinOcclusion",
            # Deterministic font rendering / no font sub-pixel variance.
            "--font-render-hinting=none",
        ])
        page_errors = []

        def on_console(message):
            if message.type == "error":
                page_errors.append(f"console.error: {message.text}")

        def on_page_error(error):
            page_errors.append(f"pageerror: {error}")

        def on_request_failed(request):
            page_errors.append(f"requestfailed: {request.url} {request.failure}")

        # Build per-capture. We reuse one browser + one page, but remount the
        # effect from scratch for every capture so resize() reseeds identical
        # starting state. Captures are grouped by (width, height) so we only
        # resize the page viewport when the geometry actually changes.
        for capture in captures:
            errors_before = len(page_errors)
            context = browser.new_context(
                viewport={"width": capture["width"], "height": capture["height"]},
                device_scale_factor=1,
                # Hold color scheme and reduced-motion constant.
                color_scheme="dark",
                reduced_motion="reduce",
            )
            page = context.new_page()
            page.on("console", on_console)
            page.on("pageerror", on_page_error)
            page.on("requestfailed", on_request_failed)

            # Freeze time and randomness before the library loads. The library's
            # own createSeededRandom is deterministic already, but effects and
            # the runtime also consult Date/performance.now (e.g. frame timing),
            # so pin those to a constant origin.
            page.add_init_script("""
                (function () {
                    var FIXED = 1700000000000;
                    var performance = window.performance || {};
                    performance.now = function () { return 0; };
                    window.performance = performance;
                    var RealDate = Date;
                    function FrozenDate() { return arguments.length ? new RealDate(arguments[0]) : new RealDate(FIXED); }
                    FrozenDate.now = function () { return FIXED; };
                    FrozenDate.parse = RealDate.parse; FrozenDate.UTC = RealDate.UTC;
                    FrozenDate.prototype = RealDate.prototype;
                    window.Date = FrozenDate;
                    // Deterministic Math.random so any incidental use (none in the
                    // effects, but defensively) cannot drift between captures.
                    var s = 1993 >>> 0;
                    Math.random = function () {
                        s = (s + 0x6D2B79F5) | 0;
                        var v = Math.imul(s ^ s >>> 15, 1 | s);
                        v ^= v + Math.imul(v ^ v >>> 7, 61 | v);
                        return ((v ^ v >>> 14) >>> 0) / 4294967296;
                    };
                    // No async scheduling: the harness drives the clock directly.
                    window.requestAnimationFrame = function () { return 1; };
                    window.cancelAnimationFrame = function () {};
                })();
            """)

            page.goto(page_url, wait_until="load")
            page.wait_for_function(
                "(effectName) => Boolean(window.Demoscene && typeof window.Demoscene[effectName] === 'function')",
                arg=capture["effectName"],
            )

            try:
                payload = page.evaluate(
                    """
                    ({ effectName, surface, device, width, height, steps }) => {
                        const canvas = document.getElementById('c');
                        canvas.width = width;
                        canvas.height = height;
                        canvas.style.width = width + 'px';
                        canvas.style.height = height + 'px';
                        const STEP = 1000 / 60;
                        // autoStart:false (no gallery rAF), maxFps:240 (defeats the
                        // runtime frame limiter so _tick never skips a fixed step),
                        // pauseWhenHidden:false, pixelRatio:1.
                        const controller = window.Demoscene[effectName](canvas, {
                            skin: 'classic',
                            surface: surface,
                            device: device,
                            config: {
                                runtime: { autoStart: false, maxFps: 240, pauseWhenHidden: false, pixelRatio: 1 }
                            }
                        });
                        // Advance every intermediate 1/60 s step up to the capture
                        // timestamp. Never jump straight to the timestamp.
                        for (let i = 0; i <= steps; i++) { controller._tick(i * STEP); }
                        const selection = controller.getSelection();
                        const pngDataUrl = canvas.toDataURL('image/png');
                        controller.destroy();
                        return { selection: selection, pngDataUrl: pngDataUrl };
                    }
                    """,
                    capture,
                )
            except Exception as exc:  # noqa: BLE001 - surface any render failure
                results.append({
                    "filename": capture["filename"],
                    "ok": False,
                    "error": f"render: {exc}",
                    "pageErrors": list(page_errors[errors_before:]),
                })
                context.close()
                continue

            new_errors = page_errors[errors_before:]
            png_bytes = base64.b64decode(payload["pngDataUrl"].split(",", 1)[1])
            if len(png_bytes) < 100:
                new_errors = new_errors + ["capture: suspiciously small/blank PNG"]

            out_path = os.path.join(out_dir, capture["filename"])
            with open(out_path, "wb") as fh:
                fh.write(png_bytes)

            results.append({
                "filename": capture["filename"],
                "ok": len(new_errors) == 0,
                "sha256": hashlib.sha256(png_bytes).hexdigest(),
                "size": len(png_bytes),
                "selection": payload["selection"],
                "width": capture["width"],
                "height": capture["height"],
                "steps": capture["steps"],
                "pageErrors": new_errors,
            })
            context.close()

        browser.close()

    print(json.dumps({"results": results, "chromiumBuild": build}))


if __name__ == "__main__":
    main()
