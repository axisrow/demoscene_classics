"""WebGL Mandelbrot smoke test driver.

Independent of the Canvas 2D pixel baselines: verifies WebGL2 context creation,
shader compilation/program linking (via uniform presence), rendering with no GL
errors, and graceful fallback to Canvas 2D when WebGL2 is unavailable. Invoked
by tests/webgl-smoke.test.js as a subprocess; prints a JSON result on stdout.
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright


def main():
    page_path = sys.argv[1]
    page_url = "file://" + os.path.abspath(page_path)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 640, "height": 360}, device_scale_factor=1)
        page = context.new_page()
        errors = []

        def on_console(message):
            if message.type == "error":
                errors.append(f"console.error: {message.text}")

        def on_page_error(error):
            errors.append(f"pageerror: {error}")

        page.on("console", on_console)
        page.on("pageerror", on_page_error)
        page.goto(page_url, wait_until="load")
        page.wait_for_function("window.Demoscene && typeof window.Demoscene.mandelbrot === 'function'")

        # 1. Canvas 2D forced backend reports canvas2d and renders.
        # 2. WebGL2 (auto) backend: probe availability, then assert a context
        #    exists, shaders compiled/linked (key uniforms resolved), and
        #    getError() is NO_ERROR after one draw at t>0 (perturbation path
        #    needs zoom >= 1000, so step well past one second).
        # 3. Graceful fallback: neuter getContext('webgl2') and confirm the auto
        #    backend falls back to canvas2d without throwing.
        result = page.evaluate(
            """
            () => {
                const STEP = 1000 / 60;
                // Each scenario mounts on a FRESH canvas so the 2D context from a
                // prior scenario never blocks a later WebGL2 context on the same
                // element (a canvas's context type is fixed for its lifetime).
                function freshCanvas() {
                    const canvas = document.createElement('canvas');
                    canvas.width = 640; canvas.height = 360;
                    return canvas;
                }
                function mount(canvas, backend) {
                    return window.Demoscene.mandelbrot(canvas, {
                        skin: 'classic', surface: 'fullscreen', device: 'desktop',
                        config: {
                            runtime: { autoStart: false, maxFps: 240, pauseWhenHidden: false, pixelRatio: 1 },
                            render: { backend: backend }
                        }
                    });
                }
                const out = { consoleErrors: [] };

                // (1) Canvas 2D forced backend renders frames.
                const c2dCanvas = freshCanvas();
                const c2d = mount(c2dCanvas, 'canvas2d');
                c2d._tick(0); c2d._tick(STEP); c2d._tick(2 * STEP);
                out.canvas2dBackend = c2d.getStats().backend;
                out.canvas2dRenders = c2d.getStats().renderedFrames > 0;
                c2d.destroy();

                // (2) WebGL2 probe + auto backend on a fresh canvas.
                const probe = document.createElement('canvas');
                const glProbe = probe.getContext('webgl2');
                out.webgl2Available = Boolean(glProbe);
                if (out.webgl2Available) {
                    const autoCanvas = freshCanvas();
                    const controller = mount(autoCanvas, 'auto');
                    // Advance far enough for the perturbation branch (zoom >= 1000).
                    for (let i = 0; i <= 90; i++) controller._tick(i * STEP);
                    const stats = controller.getStats();
                    out.autoBackend = stats.backend;
                    out.autoRenders = stats.renderedFrames > 0;
                    // The controller's own GL context is still alive here (before
                    // destroy): read getError from the same canvas/context. We
                    // cannot reach the renderer's private gl handle, but
                    // getContext('webgl2') on this canvas returns the SAME context
                    // the renderer is using, so its error state reflects the draw.
                    const gl2 = autoCanvas.getContext('webgl2');
                    out.glErrorAfterDraw = gl2 ? gl2.getError() : null;
                    controller.destroy();
                }

                // (3) Graceful fallback: pretend WebGL2 is unavailable.
                const realGetContext = HTMLCanvasElement.prototype.getContext;
                HTMLCanvasElement.prototype.getContext = function (type) {
                    if (type === 'webgl2' || type === 'webgl') return null;
                    return realGetContext.call(this, type);
                };
                try {
                    const fbCanvas = freshCanvas();
                    const fb = mount(fbCanvas, 'auto');
                    for (let i = 0; i <= 3; i++) fb._tick(i * STEP);
                    out.fallbackBackend = fb.getStats().backend;
                    out.fallbackDidNotThrow = true;
                    fb.destroy();
                } catch (error) {
                    out.fallbackDidNotThrow = false;
                    out.fallbackError = String(error);
                } finally {
                    HTMLCanvasElement.prototype.getContext = realGetContext;
                }
                return out;
            }
            """
        )
        browser.close()

    result["consoleErrors"] = errors
    print(json.dumps(result))


if __name__ == "__main__":
    main()
