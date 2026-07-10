// d3-scale-chromatic data + color-space interpolators (D3-parity campaign,
// cluster D1). Categorical schemes are d3's exact hex arrays. Sequential/
// diverging ramps are d3's ColorBrewer stop data, piecewise-RGB-lerped
// between adjacent stops — visually close to d3's spline-through-Lab but
// not bit-identical (documented divergence; with 9-11 stops the RGB error
// per segment is far below perceptual threshold). Rainbow/Turbo are stop
// samples of d3's formula output.

import { Color } from "./color.ts";

// --- categorical schemes (exact d3 data) ---------------------------------------

export const schemeCategory10 = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
  "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
];

export const schemeTableau10 = [
  "#4e79a7", "#f28e2c", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ab",
];

export const schemeObservable10 = [
  "#4269d0", "#efb118", "#ff725c", "#6cc5b0", "#3ca951",
  "#ff8ab7", "#a463f2", "#97bbf5", "#9c6b4e", "#9498a0",
];

// ColorBrewer Blues, k = 3..9 (schemeBlues[k]), exact d3 data.
export const schemeBlues: ReadonlyArray<readonly string[] | undefined> = [
  undefined, undefined, undefined,
  ["#deebf7", "#9ecae1", "#3182bd"],
  ["#eff3ff", "#bdd7e7", "#6baed6", "#2171b5"],
  ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"],
  ["#eff3ff", "#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"],
  ["#eff3ff", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#084594"],
  ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#084594"],
  ["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08519c", "#08306b"],
];

// --- piecewise interpolator over hex stops ---------------------------------------

/** t in [0,1] → hex, RGB-lerping between adjacent stops. */
export function makeInterpolator(stops: readonly string[]): (t: number) => string {
  const colors = stops.map((s) => Color.parse(s));
  const n = colors.length - 1;
  return (t: number): string => {
    const clamped = Math.max(0, Math.min(1, t));
    const x = clamped * n;
    const i = Math.min(n - 1, Math.floor(x));
    return Color.lerp(colors[i], colors[i + 1], x - i).toHex();
  };
}

const BLUES_STOPS = schemeBlues[9]!;
const BUPU_STOPS = [
  "#f7fcfd", "#e0ecf4", "#bfd3e6", "#9ebcda", "#8c96c6",
  "#8c6bb1", "#88419d", "#810f7c", "#4d004b",
];
const PIYG_STOPS = [
  "#8e0152", "#c51b7d", "#de77ae", "#f1b6da", "#fde0ef", "#f7f7f7",
  "#e6f5d0", "#b8e186", "#7fbc41", "#4d9221", "#276419",
];
const BRBG_STOPS = [
  "#543005", "#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#f5f5f5",
  "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30",
];
const SPECTRAL_STOPS = [
  "#9e0142", "#d53e4f", "#f46d43", "#fdae61", "#fee08b", "#ffffbf",
  "#e6f598", "#abdda4", "#66c2a5", "#3288bd", "#5e4fa2",
];
const VIRIDIS_STOPS = [
  "#440154", "#482475", "#414487", "#355f8d", "#2a788e", "#21918c",
  "#22a884", "#44bf70", "#7ad151", "#bddf26", "#fde725",
];
const TURBO_STOPS = [
  "#23171b", "#4a58dd", "#2f9df5", "#27d7c4", "#4df884", "#95fb51",
  "#dedd32", "#ffa423", "#f65f18", "#ba2208", "#900c00",
];
// d3.interpolateRainbow sampled at 11 evenly spaced t (cyclic: ends meet).
const RAINBOW_STOPS = [
  "#6e40aa", "#bf3caf", "#fe4b83", "#ff7847", "#e2b72f", "#aff05b",
  "#52f667", "#1ddfa3", "#23abd8", "#4c6edb", "#6e40aa",
];

export const interpolateBlues = makeInterpolator(BLUES_STOPS);
export const interpolateBuPu = makeInterpolator(BUPU_STOPS);
export const interpolatePiYG = makeInterpolator(PIYG_STOPS);
export const interpolateBrBG = makeInterpolator(BRBG_STOPS);
export const interpolateSpectral = makeInterpolator(SPECTRAL_STOPS);
export const interpolateViridis = makeInterpolator(VIRIDIS_STOPS);
export const interpolateTurbo = makeInterpolator(TURBO_STOPS);
export const interpolateRainbow = makeInterpolator(RAINBOW_STOPS);

// --- HSV interpolation (volcano's interpolateTerrain builds on this) -------------

export interface Hsv { h: number; s: number; v: number }

/** d3.hsv(h, s, v) equivalent value object (h in degrees). */
export function hsv(h: number, s: number, v: number): Hsv {
  return { h, s, v };
}

function hsvToColor({ h, s, v }: Hsv): Color {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return new Color(r1 + m, g1 + m, b1 + m, 1);
}

/** d3.interpolateHsvLong: hue takes the LONG way around the wheel. */
export function interpolateHsvLong(a: Hsv, b: Hsv): (t: number) => string {
  return (t: number): string => {
    // "Long": interpolate raw hue values without shortest-path adjustment.
    return hsvToColor({
      h: a.h + (b.h - a.h) * t,
      s: a.s + (b.s - a.s) * t,
      v: a.v + (b.v - a.v) * t,
    }).toHex();
  };
}

/** The volcano notebook's terrain ramp, exactly as it defines it. */
export const interpolateTerrain = (() => {
  const i0 = interpolateHsvLong(hsv(120, 1, 0.65), hsv(60, 1, 0.9));
  const i1 = interpolateHsvLong(hsv(60, 1, 0.9), hsv(0, 0, 0.95));
  return (t: number) => (t < 0.5 ? i0(t * 2) : i1((t - 0.5) * 2));
})();

// --- HCL interpolation (zoomable circle packing's color scale) --------------------

// sRGB <-> Lab <-> LCh(ab), D65. Small and exact — this is the perceptual
// space d3.interpolateHcl uses.
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
const XN = 0.95047, YN = 1, ZN = 1.08883;
const labF = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : t * (24389 / 27) / 116 + 4 / 29);
const labFInv = (t: number) => (t > 6 / 29 ? t * t * t : (116 * t - 16) * (27 / 24389));

function colorToLch(color: Color): { l: number; c: number; h: number } {
  const r = srgbToLinear(color.r), g = srgbToLinear(color.g), b = srgbToLinear(color.b);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / XN;
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / YN;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / ZN;
  const fx = labF(x), fy = labF(y), fz = labF(z);
  const l = 116 * fy - 16;
  const aa = 500 * (fx - fy);
  const bb = 200 * (fy - fz);
  const c = Math.hypot(aa, bb);
  let h = (Math.atan2(bb, aa) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l, c, h };
}

function lchToColor(l: number, c: number, h: number): Color {
  const rad = (h * Math.PI) / 180;
  const aa = Math.cos(rad) * c;
  const bb = Math.sin(rad) * c;
  const fy = (l + 16) / 116;
  const fx = fy + aa / 500;
  const fz = fy - bb / 200;
  const x = XN * labFInv(fx), y = YN * labFInv(fy), z = ZN * labFInv(fz);
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const b = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  return new Color(clamp01(linearToSrgb(r)), clamp01(linearToSrgb(g)), clamp01(linearToSrgb(b)), 1);
}

/** d3.interpolateHcl(a, b): shortest-hue-path interpolation in LCh(ab). */
export function interpolateHcl(a: string | Color, b: string | Color): (t: number) => string {
  const la = colorToLch(Color.parse(a as any));
  const lb = colorToLch(Color.parse(b as any));
  let dh = lb.h - la.h;
  if (Math.abs(dh) > 180) dh -= Math.sign(dh) * 360; // shortest path
  return (t: number): string =>
    lchToColor(la.l + (lb.l - la.l) * t, la.c + (lb.c - la.c) * t, la.h + dh * t).toHex();
}
