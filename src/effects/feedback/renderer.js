import {
  buildGradientPalette,
  createDrawingBuffer,
  getContext2D,
  presentDrawingBuffer,
  resizeDrawingBuffer,
  samplePackedPalette
} from '../utils.js';

// Bounded two-buffer ping-pong feedback (issue #13).
//
// Each render step reads ONLY from the previous frame's buffer and writes ONLY
// to the next buffer, then swaps them — the renderer never samples from and
// draws into the same canvas in one pass (the legacy self-additive recursion
// did exactly that, under `lighter`, and saturated the background by ~5 s).
//
// Frame composition on the WRITE buffer each step:
//   1. Fill the background `source-over` — guarantees a dark base every frame
//      and bounds how dark the trail can settle.
//   2. Composite the READ buffer back IDENTITY (1:1, no transform) `source-over`
//      with `globalAlpha = decayPerSecond ** delta`. Because the alpha is in
//      (0, 1] and the base is repainted first, the previous frame's contribution
//      is strictly bounded — a pixel cannot accumulate energy across frames. The
//      read-back is deliberately NOT rotated/scaled: this drawImage is the only
//      self-referential read in any vector effect, and resampling it every step
//      amplified the ~5% cross-OS AA drift into a 96–98% mature-frame divergence
//      (CI Linux vs local macOS). An identity 1:1 blit does not resample, so the
//      drift is never compounded and stays within the 15% vector tolerance.
//   3. Draw the new polygon geometry `lighter`. Additive blending applies to
//      the freshly drawn geometry only, never to the recursive read-back.
// Every pass resets alpha, composite operation, and shadow state explicitly so
// nothing leaks between buffers or frames.
//
// `decayPerSecond` is a PER-SECOND quantity exponentiated by `delta` (seconds),
// so 24/30/60 FPS schedules that advance the same wall-clock time produce
// comparable trail persistence. `scalePerSecond`/`rotationPerSecond` are pure
// functions of `time` applied to the geometry (ring zoom + pattern rotation) —
// NOT to the read-back — so they add motion without any self-referential
// resampling that could amplify drift. Geometry is normalized to the buffer
// short side and pointer input to [0, 1], making the composition independent of
// `render.resolution` and backing-pixel dimensions.

export function createFeedbackRenderer({ canvas, config }) {
  const output = getContext2D(canvas);
  // Two offscreen buffers with alternating ownership. `buffers[readIndex]` is
  // the previous frame (read source); `buffers[writeIndex]` is the next frame
  // (write target). They swap every step.
  const buffers = [createDrawingBuffer(), createDrawingBuffer()];
  let readIndex = 0;
  let writeIndex = 1;
  const palette = buildGradientPalette(
    new Uint32Array(config.appearance.colorCount),
    config.appearance.palette
  );
  let width = 1;
  let height = 1;
  let shortSide = 1;
  // Pointer stored in normalized viewport coordinates [0, 1]; null on leave.
  let pointerX = null;
  let pointerY = null;
  let hasRendered = false;

  // Recreate both buffers at the same backing dimensions. Both must be
  // re-allocated together (not resized in place) so a stale dimension never
  // smears into the next frame and the read/write pair stays consistent.
  function reallocateBuffers(nextWidth, nextHeight) {
    width = nextWidth;
    height = nextHeight;
    shortSide = Math.min(width, height);
    for (const buffer of buffers) {
      resizeDrawingBuffer(buffer, width, height);
    }
    readIndex = 0;
    writeIndex = 1;
    hasRendered = false;
  }

  // Reset all mutable context state to a known baseline. Called after every
  // compositing block so inherited state never crosses into the next pass or
  // the next buffer.
  function resetContextState(context) {
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.shadowBlur = 0;
    context.shadowColor = 'transparent';
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
  }

  function paintBackground(context) {
    resetContextState(context);
    context.fillStyle = config.appearance.backgroundColor;
    context.fillRect(0, 0, width, height);
  }

  return {
    resize(nextWidth, nextHeight) {
      // nextWidth/nextHeight are CSS×pixelRatio backing pixels of the output
      // canvas. The feedback buffer renders at that size scaled by resolution.
      reallocateBuffers(nextWidth * config.render.resolution, nextHeight * config.render.resolution);
    },
    pointer(x, y) {
      // Runtime delivers backing-pixel output-canvas coordinates. Normalize to
      // [0, 1] so pointer input is independent of resolution and pixel ratio.
      if (x === null || y === null) {
        pointerX = null;
        pointerY = null;
        return;
      }
      pointerX = width > 0 ? Math.min(1, Math.max(0, x / canvas.width)) : null;
      pointerY = height > 0 ? Math.min(1, Math.max(0, y / canvas.height)) : null;
    },
    render({ time, delta }) {
      if (hasRendered && delta === 0) return;
      const read = buffers[readIndex];
      const write = buffers[writeIndex];
      const context = write.context;

      if (!hasRendered) {
        // First frame: seed the write buffer with the background only.
        paintBackground(context);
      } else {
        const frameFactor = delta * config.motion.speed;
        // Bounded compositing of the previous frame onto the fresh background.
        //
        // IDENTITY read-back: the previous buffer is composited 1:1 with NO
        // rotate/scale transform. The legacy transform (rotate + scale around
        // the centre) resampled the previous frame's sub-pixel raster every
        // step; because this drawImage is the ONLY self-referential read in any
        // vector effect, the ~5% cross-OS AA drift was fed back and compounded
        // 90–300× (1.5–5 s @ 60 FPS) into a 96–98% mature-frame divergence
        // (CI Linux vs local macOS, same pinned chromium-1217). An identity
        // 1:1 blit does not resample, so the drift is never amplified — the
        // mature frame stays within the 15% vector tolerance, exactly like the
        // other vector effects that never read their own output back. The only
        // feedback path left is the bounded source-over alpha below.
        paintBackground(context);
        resetContextState(context);
        context.globalAlpha = config.feedback.decayPerSecond ** frameFactor;
        context.globalCompositeOperation = 'source-over';
        context.drawImage(read.canvas, 0, 0);
        resetContextState(context);
      }

      // Newly drawn polygon geometry — the only additive pass.
      const scaledTime = time * config.motion.speed;
      const centerX = (pointerX ?? 0.5
        + Math.cos(scaledTime * config.motion.orbitSpeedX) * config.geometry.orbitX * 0.5) * width;
      const centerY = (pointerY ?? 0.5
        + Math.sin(scaledTime * config.motion.orbitSpeedY) * config.geometry.orbitY * 0.5) * height;
      const radius = (config.geometry.radius
        + Math.sin(scaledTime * config.geometry.radiusOscillationSpeed) * config.geometry.radiusOscillation)
        // scalePerSecond now drives a deterministic per-time zoom of the ring
        // (pure function of `time`, no self-read) instead of a per-step resample
        // of the previous frame. Kept bounded in (0, 1] by validation, so over
        // time the ring eases inward without runaway accumulation.
        * (config.feedback.scalePerSecond ** (time * config.motion.speed))
        * shortSide;
      context.globalCompositeOperation = 'lighter';
      for (let pass = 0; pass < config.geometry.passes; pass++) {
        context.beginPath();
        const passRadius = radius + pass * config.geometry.passSpacing * shortSide;
        for (let point = 0; point <= config.geometry.sides; point++) {
          const angle = point / config.geometry.sides * Math.PI * 2
            + scaledTime * (
              config.motion.polygonRotationSpeed
              // rotationPerSecond now rotates the whole pattern deterministically
              // over time (pure function of `time`, no self-read) instead of
              // rotating the resampled previous frame each step.
              + config.feedback.rotationPerSecond
              + pass * config.motion.passRotationStep
            );
          const x = centerX + Math.cos(angle) * passRadius;
          const y = centerY + Math.sin(angle) * passRadius;
          if (point === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        const color = samplePackedPalette(
          palette,
          (scaledTime * config.motion.colorCycleSpeed + pass / config.geometry.passes) % 1
        );
        const red = color & 255;
        const green = color >>> 8 & 255;
        const blue = color >>> 16 & 255;
        context.lineWidth = config.geometry.strokeWidth * shortSide;
        context.strokeStyle = `rgba(${red},${green},${blue},${config.appearance.strokeAlpha})`;
        context.shadowColor = context.strokeStyle;
        context.shadowBlur = config.geometry.shadowBlur * shortSide;
        context.stroke();
      }
      resetContextState(context);

      hasRendered = true;
      // The freshly written frame becomes the previous frame for the next step.
      // Swap ownership so the next render reads from this buffer and writes to
      // the other one — read and write targets alternate every frame.
      const justWritten = write;
      readIndex = writeIndex;
      writeIndex = (writeIndex + 1) % buffers.length;
      presentDrawingBuffer(output, justWritten, canvas.width, canvas.height, config.render.smoothing);
    },
    destroy() {
      resetContextState(output);
    }
  };
}
