import { buildProfiles } from '../profiles.js';

// Responsive profiles for tunnel (issue #9). Four explicit, effect-owned
// slots — one per (surface × device) combination. The normalized polar/depth
// identity (vanishing point, wall/angular frequencies, near epsilon, fog band
// and strength) is owned by config.js; profiles only tune EXECUTION budgets
// (maxFps, render resolution), never the composition.
//
// `render.resolution` affects SAMPLING QUALITY ONLY: lowering it resamples the
// identical tunnel into fewer pixels (wall bands, vanishing point and forward
// speed stay stable), so the tunnel still reads as a receding ring in portrait
// and at preview/mobile sampling rates. Fullscreen slots keep the classic
// 1/3-resolution composition; preview slots lower the sampling cost so the
// gallery card shows the same rotating tunnel at a coarser buffer.
//
// Runtime budgets (#3): preview/desktop 30 FPS, preview/mobile 24 FPS,
// fullscreen/desktop 60 FPS, fullscreen/mobile 30 FPS. pixelRatio is pinned to
// 1 and viewport auto-pause is enabled everywhere.

const RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };

const PREVIEW_RENDER = { render: { resolution: 0.2 } };

export const TUNNEL_PROFILES = buildProfiles({
  'fullscreen.desktop': { ...RUNTIME_FULLSCREEN_DESKTOP },
  'fullscreen.mobile': { ...RUNTIME_FULLSCREEN_MOBILE },
  'preview.desktop': { ...RUNTIME_PREVIEW_DESKTOP, ...PREVIEW_RENDER },
  'preview.mobile': { ...RUNTIME_PREVIEW_MOBILE, ...PREVIEW_RENDER }
});
