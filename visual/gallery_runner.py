"""Deterministic gallery screenshot driver for the demoscene visual-QA harness.

Mirrors visual/capture_runner.py's determinism contract (frozen Date,
performance.now, Math.random, color scheme, reduced motion, chromium-1217 pin),
but captures the DECORATED gallery page (index.html) rather than an undecorated
effect canvas. This is the issue #15 "gallery screenshots own presentation
regressions separately" harness: a desktop-landscape and a mobile-portrait
full-page snapshot, advanced to a fixed 5s maturity via a deterministic rAF pump.

Why a separate driver (not capture_runner.py):
  - capture_runner.py mounts one effect into a bare #c canvas and toDataURLs it.
    That owns effect-only baselines and must stay byte-stable for the 120 effect
    captures. Gallery screenshots are a different artifact: the whole decorated
    page (cards, CRT overlay, typography) at a fixed viewport, so a presentation
    regression (broken aspect, overflow, hover transform on touch, overlay
    crushing contrast) is caught on its own baseline without touching effect
    baselines.

Protocol:
  argv[1] = path to the decorated gallery page (index.html, file://)
  stdin    = JSON object { outDir, captures: [...] }
  stdout   = JSON object { results: [...], chromiumBuild: "<build>" }

Each capture:  { view, width, height, deviceScaleFactor, steps, filename }.
Each result:   { filename, ok, sha256, size, error?, pageErrors? }.

The runtime's shared scheduler lives on
globalThis[Symbol.for('demoscene-classics.runtime')] and its tick is private, so
we cannot call controller._tick directly from outside. Instead the init script
overrides requestAnimationFrame to queue callbacks onto window.__galleryFrames;
the driver drains that queue `steps` times, invoking each callback with the exact
fixed timestamp i*(1000/60). Each drained callback is the scheduler's tick, which
re-queues itself (autoStart:true default); re-queued callbacks land in the NEXT
step's queue, mirroring real per-frame scheduling and advancing every 1/60s step.
"""

import hashlib
import json
import os
import sys

from playwright.sync_api import sync_playwright

# Same pin as capture_runner.py: reproducible only against this Playwright/
# chromium pair. Playwright 1.59.0 resolves chromium build 1217.
PINNED_CHROMIUM_BUILD = "1217"


def _build_from_executable(playwright):
    exe = playwright.chromium.executable_path
    parts = exe.replace("\\", "/").split("/")
    for part in parts:
        if part.startswith("chromium-"):
            return part.split("-", 1)[1]
    return None


# Same determinism init as capture_runner.py, EXCEPT requestAnimationFrame queues
# callbacks instead of becoming a no-op. The gallery page mounts effects with
# autoStart (the default), which registers real rAF callbacks through the shared
# scheduler; we must pump them to advance effect state to a fixed maturity.
INIT_SCRIPT = """
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
        var s = 1993 >>> 0;
        Math.random = function () {
            s = (s + 0x6D2B79F5) | 0;
            var v = Math.imul(s ^ s >>> 15, 1 | s);
            v ^= v + Math.imul(v ^ v >>> 7, 61 | v);
            return ((v ^ v >>> 14) >>> 0) / 4294967296;
        };
        // Queue rAF callbacks instead of discarding them. The driver drains this
        // queue once per fixed step; the shared runtime scheduler re-queues its
        // tick here each frame, so draining steps the whole gallery forward.
        window.__galleryFrames = [];
        window.requestAnimationFrame = function (cb) {
            window.__galleryFrames.push(cb);
            return window.__galleryFrames.length;
        };
        window.cancelAnimationFrame = function () {};
    })();
"""


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
            # Deterministic font rendering / no font sub-pixel variance
            # (same as capture_runner.py so gallery text rasterises stably).
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

        for capture in captures:
            errors_before = len(page_errors)
            context = browser.new_context(
                viewport={"width": capture["width"], "height": capture["height"]},
                device_scale_factor=capture.get("deviceScaleFactor", 1),
                # Hold color scheme and reduced-motion constant (same as the
                # effect harness) so decoration and prefers-reduced-motion do not
                # drift between captures.
                color_scheme="dark",
                reduced_motion="reduce",
            )
            page = context.new_page()
            page.on("console", on_console)
            page.on("pageerror", on_page_error)
            page.on("requestfailed", on_request_failed)

            page.add_init_script(INIT_SCRIPT)
            page.goto(page_url, wait_until="load")
            # Wait for the gallery to have mounted all ten cards before pumping.
            page.wait_for_function(
                "() => Boolean(window.Demoscene && document.getElementById('grid') "
                "&& document.getElementById('grid').children.length === 10)"
            )

            try:
                page.evaluate(
                    """
                    (steps) => {
                        const STEP = 1000 / 60;
                        // Drain the rAF queue once per fixed step. Each drain
                        // invokes the scheduler's tick for the active preview
                        // controllers; they re-queue, so the next drain advances
                        // the next 1/60s step. This advances every intermediate
                        // step (never jumping), matching the effect harness so a
                        // stateful preview (fire accumulator, scroller position,
                        // feedback prior-frame) reaches the same 5s maturity.
                        for (let i = 1; i <= steps; i++) {
                            const ts = i * STEP;
                            const pending = window.__galleryFrames;
                            window.__galleryFrames = [];
                            for (const cb of pending) {
                                try { cb(ts); } catch (e) { /* a failing effect must not abort the pump */ }
                            }
                        }
                    }
                    """,
                    capture["steps"],
                )
                png_bytes = page.screenshot(full_page=True, type="png")
            except Exception as exc:  # noqa: BLE001 - surface any capture failure
                results.append({
                    "filename": capture["filename"],
                    "ok": False,
                    "error": f"capture: {exc}",
                    "pageErrors": list(page_errors[errors_before:]),
                })
                context.close()
                continue

            new_errors = page_errors[errors_before:]
            if len(png_bytes) < 1000:
                new_errors = new_errors + ["capture: suspiciously small/blank PNG"]

            out_path = os.path.join(out_dir, capture["filename"])
            with open(out_path, "wb") as fh:
                fh.write(png_bytes)

            results.append({
                "filename": capture["filename"],
                "ok": len(new_errors) == 0,
                "sha256": hashlib.sha256(png_bytes).hexdigest(),
                "size": len(png_bytes),
                "pageErrors": new_errors,
            })
            context.close()

        browser.close()

    print(json.dumps({"results": results, "chromiumBuild": build}))


if __name__ == "__main__":
    main()
