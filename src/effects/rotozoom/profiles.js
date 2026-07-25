import { buildProfiles } from '../profiles.js';

// Responsive profiles for rotozoom. Four explicit, effect-owned slots — one
// per (surface × device) combination. The texture identity (tile count, lattice
// frequencies) and the transform (centre, rotation/zoom motion) are owned by
// config.js; profiles ONLY tune execution budgets (maxFps, pixelRatio,
// pauseWhenHidden) and `render.resolution` (sampling density). Because the
// texture is sampled in normalized texture space (#12), lowering
// `render.resolution` purely reduces sampling cost — it cannot move the tile
// scale, transform centre, or phase. All four profiles therefore show the same
// recognizable tiled motif and the same landmark positions at any fixed
// timestamp; mobile just samples it more coarsely.
//
// Filtering (#12): every slot keeps `render.smoothing` true so the upscaled
// buffer blends sub-sample detail under rotation — this keeps the motif stable
// and avoids moiré on the coarse sampling without collapsing to a flat colour.
// Lower-frequency detail comes from the lattice itself (an integer-frequency
// sine field is band-limited per tile), so preview/mobile can sample coarser
// without aliasing into noise.
//
// Runtime budgets (#3): preview/desktop 30 FPS, preview/mobile 24 FPS,
// fullscreen/desktop 60 FPS, fullscreen/mobile 30 FPS. pixelRatio is pinned to
// 1 and viewport auto-pause is enabled everywhere. Preview/mobile slots lower
// the sampling resolution once more to keep per-card cost down, but stay well
// above the floor (0.1) where the lattice would alias into a differently-scaled
// or flat wash.

const RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };

// Sampling density per slot. Fullscreen/desktop keeps the 0.5 default; mobile
// and preview lower the sampling buffer. None of these change the texture
// geometry — only how many cells sample it — so landmarks and phase stay
// aligned across the four slots.
const RENDER_FULLSCREEN = { render: { resolution: 0.5 } };
const RENDER_FULLSCREEN_MOBILE = { render: { resolution: 0.4 } };
const RENDER_PREVIEW = { render: { resolution: 0.3 } };
const RENDER_PREVIEW_MOBILE = { render: { resolution: 0.22 } };

export const ROTOZOOM_PROFILES = buildProfiles({
  'fullscreen.desktop': { ...RUNTIME_FULLSCREEN_DESKTOP, ...RENDER_FULLSCREEN },
  'fullscreen.mobile': { ...RUNTIME_FULLSCREEN_MOBILE, ...RENDER_FULLSCREEN_MOBILE },
  'preview.desktop': { ...RUNTIME_PREVIEW_DESKTOP, ...RENDER_PREVIEW },
  'preview.mobile': { ...RUNTIME_PREVIEW_MOBILE, ...RENDER_PREVIEW_MOBILE }
});
