// Color handling. Internally a color is {r, g, b, a} with channels in [0, 1].
// Accepts hex strings, {r,g,b} objects, or existing Color instances.

import type { ColorLike } from "./types.ts";
import { registry } from "../plugins/registry.ts";

// Re-export the full palettes (manim core names + X11/XKCD/SVGNAMES/BS381/AS2700/
// DVIPSNAMES namespace objects). Importing this module also runs its registration
// side effect, populating the shared registry so Color.parse resolves palette names.
export * from "./colors_data.ts";

export class Color {
  r: number;
  g: number;
  b: number;
  a: number;

  constructor(r = 1, g = 1, b = 1, a = 1) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }

  static parse(input: ColorLike | Color | null | undefined): Color {
    if (input == null) return new Color(1, 1, 1, 1);
    if (input instanceof Color) return new Color(input.r, input.g, input.b, input.a);
    if (typeof input === "string") {
      // Resolve plugin-registered / named colors (e.g. "RED") to their hex.
      const named = registry.colors.get(input);
      return Color.fromHex(named ?? input);
    }
    if (Array.isArray(input)) return new Color(input[0], input[1], input[2], input[3] ?? 1);
    if (typeof input === "object") return new Color(input.r ?? 1, input.g ?? 1, input.b ?? 1, input.a ?? 1);
    return new Color();
  }

  static fromHex(hex: string): Color {
    let h = hex.trim().replace(/^#/, "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const int = parseInt(h.slice(0, 6), 16);
    const r = ((int >> 16) & 255) / 255;
    const g = ((int >> 8) & 255) / 255;
    const b = (int & 255) / 255;
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return new Color(r, g, b, a);
  }

  withAlpha(a: number): Color {
    return new Color(this.r, this.g, this.b, a);
  }

  /** Alias for withAlpha (manim's `set_opacity`). */
  opacity(a: number): Color {
    return this.withAlpha(a);
  }

  /** Interpolate toward another color in RGB space. */
  interpolate(other: ColorLike | Color, alpha: number): Color {
    return Color.lerp(this, other, alpha);
  }

  /** Blend toward white by `amount` (0..1). */
  lighter(amount = 0.2): Color {
    return Color.lerp(this, new Color(1, 1, 1, this.a), amount);
  }

  /** Blend toward black by `amount` (0..1). */
  darker(amount = 0.2): Color {
    return Color.lerp(this, new Color(0, 0, 0, this.a), amount);
  }

  /** Convert to HSV, each channel in [0, 1]. */
  toHsv(): [number, number, number] {
    const { r, g, b } = this;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
      if (h < 0) h += 1;
    }
    const s = max === 0 ? 0 : d / max;
    return [h, s, max];
  }

  /** Build a Color from HSV, each channel in [0, 1]. */
  static fromHsv(h: number, s: number, v: number, a = 1): Color {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r = 0, g = 0, b = 0;
    switch (((i % 6) + 6) % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return new Color(r, g, b, a);
  }

  // Linear interpolation in RGB space (manim's default color interpolation).
  static lerp(c1: ColorLike | Color, c2: ColorLike | Color, t: number): Color {
    const a = Color.parse(c1);
    const b = Color.parse(c2);
    return new Color(
      a.r + (b.r - a.r) * t,
      a.g + (b.g - a.g) * t,
      a.b + (b.b - a.b) * t,
      a.a + (b.a - a.a) * t,
    );
  }

  toRGBAString(alphaOverride: number | null = null): string {
    const a = alphaOverride == null ? this.a : alphaOverride;
    const to255 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
    return `rgba(${to255(this.r)}, ${to255(this.g)}, ${to255(this.b)}, ${a})`;
  }

  toHex(): string {
    const to255 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
    const hx = (x: number) => to255(x).toString(16).padStart(2, "0");
    return `#${hx(this.r)}${hx(this.g)}${hx(this.b)}`;
  }
}

// ---------------------------------------------------------------------------
// Standalone color utility functions (manim's utils/color helpers).
// ---------------------------------------------------------------------------

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Interpolate between two colors in RGB space. Alias for Color.lerp. */
export function interpolateColor(c1: ColorLike | Color, c2: ColorLike | Color, alpha: number): Color {
  return Color.lerp(c1, c2, alpha);
}

/** Produce `length` colors evenly interpolated across the given color stops. */
export function colorGradient(colors: (ColorLike | Color)[], length: number): Color[] {
  if (length <= 0) return [];
  const stops = colors.map((c) => Color.parse(c));
  if (stops.length === 0) return Array.from({ length }, () => new Color());
  if (stops.length === 1) return Array.from({ length }, () => new Color(stops[0].r, stops[0].g, stops[0].b, stops[0].a));
  if (length === 1) return [new Color(stops[0].r, stops[0].g, stops[0].b, stops[0].a)];
  const out: Color[] = [];
  for (let i = 0; i < length; i++) {
    const t = (i / (length - 1)) * (stops.length - 1);
    const lo = Math.min(Math.floor(t), stops.length - 2);
    const frac = t - lo;
    out.push(Color.lerp(stops[lo], stops[lo + 1], frac));
  }
  return out;
}

/** Invert a color's RGB channels (alpha preserved). */
export function invertColor(c: ColorLike | Color): Color {
  const col = Color.parse(c);
  return new Color(1 - col.r, 1 - col.g, 1 - col.b, col.a);
}

/** Component-wise average of one or more colors. */
export function averageColor(...colors: (ColorLike | Color)[]): Color {
  if (colors.length === 0) return new Color();
  let r = 0, g = 0, b = 0, a = 0;
  for (const c of colors) {
    const col = Color.parse(c);
    r += col.r; g += col.g; b += col.b; a += col.a;
  }
  const n = colors.length;
  return new Color(r / n, g / n, b / n, a / n);
}

/** A random color (uniform in RGB). */
export function randomColor(): Color {
  return new Color(Math.random(), Math.random(), Math.random(), 1);
}

/** A random, saturated & bright color. */
export function randomBrightColor(): Color {
  const base = randomColor();
  const [h] = base.toHsv();
  return Color.fromHsv(h, 0.5 + Math.random() * 0.5, 0.7 + Math.random() * 0.3);
}

/** manim's 3D shading helper: darken/lighten an rgb by surface orientation. */
export function getShadedRgb(
  rgb: [number, number, number],
  point: [number, number, number],
  unitNormal: [number, number, number],
  lightSource: [number, number, number],
): [number, number, number] {
  const toLight = [
    lightSource[0] - point[0],
    lightSource[1] - point[1],
    lightSource[2] - point[2],
  ];
  const norm = Math.hypot(toLight[0], toLight[1], toLight[2]) || 1;
  const unitToLight = [toLight[0] / norm, toLight[1] / norm, toLight[2] / norm];
  let factor = unitNormal[0] * unitToLight[0] + unitNormal[1] * unitToLight[1] + unitNormal[2] * unitToLight[2];
  if (factor < 0) {
    factor *= 0.5;
    return [
      clamp01(rgb[0] * (1 + factor)),
      clamp01(rgb[1] * (1 + factor)),
      clamp01(rgb[2] * (1 + factor)),
    ];
  }
  factor *= 0.5;
  return [
    clamp01(rgb[0] + (1 - rgb[0]) * factor),
    clamp01(rgb[1] + (1 - rgb[1]) * factor),
    clamp01(rgb[2] + (1 - rgb[2]) * factor),
  ];
}

/** Build a Color from an [r, g, b] triple with channels in [0, 1]. */
export function rgbToColor([r, g, b]: [number, number, number]): Color {
  return new Color(r, g, b, 1);
}

/** Build a Color from an [r, g, b, a] tuple with channels in [0, 1]. */
export function rgbaToColor([r, g, b, a]: [number, number, number, number]): Color {
  return new Color(r, g, b, a);
}

/** Extract [r, g, b] (channels in [0, 1]) from a color. */
export function colorToRgb(c: ColorLike | Color): [number, number, number] {
  const col = Color.parse(c);
  return [col.r, col.g, col.b];
}

/** Extract [r, g, b, a] (channels in [0, 1]) from a color. */
export function colorToRgba(c: ColorLike | Color): [number, number, number, number] {
  const col = Color.parse(c);
  return [col.r, col.g, col.b, col.a];
}

/** Extract [r, g, b] as 0..255 integers from a color. */
export function colorToIntRgb(c: ColorLike | Color): [number, number, number] {
  const col = Color.parse(c);
  const to255 = (x: number) => Math.round(clamp01(x) * 255);
  return [to255(col.r), to255(col.g), to255(col.b)];
}

/** Parse a hex string into an [r, g, b] triple (channels in [0, 1]). */
export function hexToRgb(hex: string): [number, number, number] {
  const c = Color.fromHex(hex);
  return [c.r, c.g, c.b];
}

/** Convert an [r, g, b] triple (channels in [0, 1]) to a hex string. */
export function rgbToHex([r, g, b]: [number, number, number]): string {
  return new Color(r, g, b, 1).toHex();
}

// manim's default color palette.
export const WHITE = "#FFFFFF";
export const BLACK = "#000000";
export const GRAY = "#888888";
export const GREY = "#888888";
export const RED = "#FC6255";
export const GREEN = "#83C167";
export const BLUE = "#58C4DD";
export const YELLOW = "#FFFF00";
export const GOLD = "#F0AC5F";
export const ORANGE = "#FF862F";
export const PURPLE = "#9A72AC";
export const PINK = "#D147BD";
export const MAROON = "#C55F73";
export const TEAL = "#5CD0B3";
export const LIGHT_GRAY = "#BBBBBB";
export const DARK_GRAY = "#444444";
export const DARK_BLUE = "#236B8E";
export const LIGHT_PINK = "#DC75CD";

export const BLUE_A = "#C7E9F1";
export const BLUE_B = "#9CDCEB";
export const BLUE_C = "#58C4DD";
export const BLUE_D = "#29ABCA";
export const BLUE_E = "#1C758A";
export const GREEN_A = "#C9E2AE";
export const GREEN_C = "#83C167";
export const GREEN_E = "#699C52";
export const RED_C = "#FC6255";
export const RED_E = "#CF5044";
export const YELLOW_C = "#FFFF00";
