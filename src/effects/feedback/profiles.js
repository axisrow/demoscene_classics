import { buildProfiles } from '../profiles.js';

// Responsive profiles for feedback (issue #13). Four explicit, effect-owned
// slots — one per (surface × device) combination. The feedback-loop identity
// (sides, passes, per-second decay/scale/rotation) is owned by config.js;
// profiles only tune execution budgets.
//
// The bounded ping-pong renderer keeps its composition normalized: orbit
// centres, polygon radius, blur width, and stroke width are fractions of the
// buffer short side, so `render.resolution` changes the sampling cost (how many
// backing pixels a frame touches) without altering the composition. Lower
// resolution therefore cheapens blur and fill cost on preview/mobile while the
// luminous trail persists comparably across every slot.
//
// Runtime budgets: preview/desktop 30 FPS, preview/mobile 24 FPS,
// fullscreen/desktop 60 FPS, fullscreen/mobile 30 FPS. pixelRatio is pinned to
// 1 and viewport auto-pause is enabled everywhere. Per-second decay (see
// config.js) keeps trail persistence comparable across these FPS budgets.

const RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };

const PREVIEW_RENDER = { render: { resolution: 0.7 } };

export const FEEDBACK_PROFILES = buildProfiles({
  'fullscreen.desktop': { ...RUNTIME_FULLSCREEN_DESKTOP },
  'fullscreen.mobile': { ...RUNTIME_FULLSCREEN_MOBILE },
  'preview.desktop': { ...RUNTIME_PREVIEW_DESKTOP, ...PREVIEW_RENDER },
  'preview.mobile': { ...RUNTIME_PREVIEW_MOBILE, ...PREVIEW_RENDER }
});
