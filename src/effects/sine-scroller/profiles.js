import { buildProfiles } from '../profiles.js';

// Responsive profiles for sine-scroller (issue #11). Four explicit,
// effect-owned slots — one per (surface × device) combination. The scroller
// IDENTITY (the phrase, the wave CYCLE count, the classic palette and font) is
// owned by config.js / skins.js; profiles tune EXECUTION budgets (maxFps,
// render resolution) and the per-slot LAYOUT GEOMETRY (typography scale, wave
// amplitude, scroll speed) and STAR BUDGET.
//
// GEOMETRY IS NORMALIZED against the viewport (see renderer.js), so the same
// slot composes predictably at any size. Mobile slots reduce the font ratio and
// amplitude and lift the baseline a touch so the phrase stays readable and
// inside the safe band on a tall portrait screen (390×844); they also use an
// AREA-DERIVED star budget so a small screen stays populated without the desktop
// cost. Preview slots lower render.resolution (the gallery sampling budget) and
// cap the star budget.
//
// render.resolution stays a SAMPLING budget: lowering it resamples the SAME
// composition into fewer pixels — it never changes type scale, wave frequency,
// or star count (those are normalized against the logical viewport).
//
// WAVE FREQUENCY (wave.cycles) is intentionally NOT overridden per slot: it is
// cycles-across-the-text-path, which is aspect- and resolution-independent by
// construction, so all four slots share the same wave rhythm. The issue calls
// out that wave frequency must NOT change with canvas width — leaving cycles
// constant across slots is what guarantees that.
//
// Initial runtime budgets (#3): preview/desktop 30 FPS, preview/mobile 24 FPS,
// fullscreen/desktop 60 FPS, fullscreen/mobile 30 FPS. pixelRatio is pinned to
// 1 and viewport auto-pause is enabled everywhere.

const RUNTIME_FULLSCREEN_DESKTOP = { runtime: { maxFps: 60, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_FULLSCREEN_MOBILE = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_DESKTOP = { runtime: { maxFps: 30, pixelRatio: 1, pauseWhenHidden: true } };
const RUNTIME_PREVIEW_MOBILE = { runtime: { maxFps: 24, pixelRatio: 1, pauseWhenHidden: true } };

// DESKTOP layout — bold banner, generous amplitude, classic baseline. Font
// ratio 0.16 of the short side on a 720-tall landscape frame ≈ 115px, clamped
// to fontSizeMax 96; amplitude 0.06 of the short side is a clear but bounded
// sway. Baseline 0.62 keeps ink well inside [safeMargin, 1 - safeMargin] even
// at peak amplitude. Star budget is explicit and dense (the audited baseline).
const GEOMETRY_DESKTOP = {
  text: { fontSizeRatio: 0.16, fontSizeMax: 96, safeMargin: 0.04 },
  wave: { baseline: 0.62, amplitude: 0.06 },
  motion: { scrollSpeed: 0.18 }
};
const STARS_DESKTOP = {
  stars: { densityMode: 'explicit', count: 220 }
};

// MOBILE layout — slightly smaller font ratio and amplitude, baseline lifted a
// touch, so on a 390×844 portrait screen (short side 390) the banner ≈ 62px and
// the whole phrase + sway + ascenders/descenders stays inside the safe band
// with no top/bottom cropping. Scroll speed is unchanged (viewport-widths/sec)
// so the banner crosses the frame at the same pace on any width. Star budget is
// AREA-DERIVED and clamped so a small screen stays populated (never empty) but
// never pays the desktop cost.
const GEOMETRY_MOBILE = {
  text: { fontSizeRatio: 0.14, fontSizeMax: 64, safeMargin: 0.06 },
  wave: { baseline: 0.6, amplitude: 0.045 },
  motion: { scrollSpeed: 0.18 }
};
const STARS_MOBILE = {
  stars: { densityMode: 'area', densityPerUnitArea: 0.45, densityMin: 80, densityMax: 320 }
};

// Preview cards: coarser buffer + lighter star budget, same composition.
const PREVIEW_RENDER = { render: { resolution: 0.7 } };
const STARS_PREVIEW_DESKTOP = {
  stars: { densityMode: 'explicit', count: 90 }
};
const STARS_PREVIEW_MOBILE = {
  stars: { densityMode: 'area', densityPerUnitArea: 0.4, densityMin: 40, densityMax: 140 }
};

export const SINE_SCROLLER_PROFILES = buildProfiles({
  'fullscreen.desktop': { ...RUNTIME_FULLSCREEN_DESKTOP, ...GEOMETRY_DESKTOP, ...STARS_DESKTOP },
  'fullscreen.mobile': { ...RUNTIME_FULLSCREEN_MOBILE, ...GEOMETRY_MOBILE, ...STARS_MOBILE },
  'preview.desktop': { ...RUNTIME_PREVIEW_DESKTOP, ...GEOMETRY_DESKTOP, ...STARS_PREVIEW_DESKTOP, ...PREVIEW_RENDER },
  'preview.mobile': { ...RUNTIME_PREVIEW_MOBILE, ...GEOMETRY_MOBILE, ...STARS_PREVIEW_MOBILE, ...PREVIEW_RENDER }
});
