// Color handling. Internally a color is {r, g, b, a} with channels in [0, 1].
// Accepts hex strings, {r,g,b} objects, or existing Color instances.

import type { ColorLike } from "./types.ts";
import { registry } from "../plugins/registry.ts";

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
