import { buildProfiles } from '../profiles.js';

// Responsive profiles for plasma. Four explicit, effect-owned slots — one per
// (surface × device) combination. The plasma *field* (frequencies, centres,
// amplitudes, aspect correction) is algorithmic identity owned by config.js;
// profiles NEVER change composition, scale, or phase. They only tune execution
// budgets (maxFps, pixelRatio, pauseWhenHidden) and `render.resolution` — and
// because the field is evaluated in normalized viewport coordinates (#5),
// lowering `render.resolution` purely reduces sampling cost. All four profiles
// therefore show the same recognizable plasma composition and the same landmark
// positions at any fixed timestamp; mobile just samples it more coarsely.
//
// Runtime budgets (#3): preview/desktop 30 FPS, preview/mobile 24 FPS,
// fullscreen/desktop 60 FPS, fullscreen/mobile 30 FPS. pixelRatio is pinned to
// 1 and viewport auto-pause is enabled everywhere. Preview slots sample at the
// coarser buffer the gallery card previously used; mobile lowers sampling a
// little further but stays well above the floor where the field would alias into
// a flat or differently-scaled wash.

const RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };

// Sampling density per slot. Fullscreen keeps the 0.25 default; preview cards
// sample a little coarser; mobile lowers density once more to keep the per-card
// cost down. None of these values change the field geometry — only how many
// cells sample it — so landmarks and phase stay aligned across the four slots.
const RENDER_FULLSCREEN = { render: { resolution: 0.25 } };
const RENDER_FULLSCREEN_MOBILE = { render: { resolution: 0.2 } };
const RENDER_PREVIEW = { render: { resolution: 0.2 } };
const RENDER_PREVIEW_MOBILE = { render: { resolution: 0.16 } };

export const PLASMA_PROFILES = buildProfiles({
  'fullscreen.desktop': { ...RUNTIME_FULLSCREEN_DESKTOP, ...RENDER_FULLSCREEN },
  'fullscreen.mobile': { ...RUNTIME_FULLSCREEN_MOBILE, ...RENDER_FULLSCREEN_MOBILE },
  'preview.desktop': { ...RUNTIME_PREVIEW_DESKTOP, ...RENDER_PREVIEW },
  'preview.mobile': { ...RUNTIME_PREVIEW_MOBILE, ...RENDER_PREVIEW_MOBILE }
});
