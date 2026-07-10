// Visual effects model: per-mobject raster effects (blur / glow / drop-shadow
// / color adjustment / noise) plus camera-level full-frame grading
// (FrameEffect adds vignette). This module is the ISOMORPHIC, pure layer --
// renderers translate these descriptors into their own mechanisms
// (CanvasRenderer: ctx.filter + shadow* + composite passes; SVGRenderer:
// <filter> defs; ThreeRenderer delegates full-frame work to the
// post-processing pipeline in renderer/three_post.ts). It deliberately sits
// below the renderers (like color.ts / watermark.ts) so all three share one
// source of truth for filter math.
//
// Determinism note: noise is seeded (mulberry32) because Node renders are
// content-hash cached per animation segment (src/node.ts) -- a
// nondeterministic effect would silently poison partial-movie reuse.

import type { ColorLike } from "./types.ts";
import { Color } from "./color.ts";
import { mulberry32 } from "./noise.ts";

export type Effect =
  | { type: "blur"; radius: number }
  | { type: "glow"; radius: number; color?: ColorLike; strength?: number }
  | { type: "shadow"; blur: number; color?: ColorLike; offsetX?: number; offsetY?: number }
  | { type: "colorAdjust"; brightness?: number; contrast?: number; saturate?: number; hueRotate?: number; grayscale?: number }
  | { type: "noise"; amount: number; monochrome?: boolean; seed?: number };

/** Camera-level full-frame effects: everything a mobject can have, plus
 *  vignette (meaningless per-mobject, classic as a frame grade). */
export type FrameEffect = Effect | { type: "vignette"; strength: number; color?: ColorLike };

/** Effects expressible as a single CSS canvas-filter string (ctx.filter):
 *  blur + the colorAdjust family. Radii are declared at 1080p-reference
 *  pixels and scaled by `scale` (camera.strokeScale()), matching how stroke
 *  widths already scale. Returns "" when nothing applies. */
export function effectsToCanvasFilter(effects: readonly Effect[], scale: number): string {
  const parts: string[] = [];
  for (const e of effects) {
    if (e.type === "blur") {
      if (e.radius > 0) parts.push(`blur(${e.radius * scale}px)`);
    } else if (e.type === "colorAdjust") {
      // Identity values are elided so an all-default colorAdjust is a no-op.
      if (e.brightness != null && e.brightness !== 1) parts.push(`brightness(${e.brightness})`);
      if (e.contrast != null && e.contrast !== 1) parts.push(`contrast(${e.contrast})`);
      if (e.saturate != null && e.saturate !== 1) parts.push(`saturate(${e.saturate})`);
      if (e.hueRotate != null && e.hueRotate !== 0) parts.push(`hue-rotate(${e.hueRotate}deg)`);
      if (e.grayscale != null && e.grayscale !== 0) parts.push(`grayscale(${e.grayscale})`);
    }
  }
  return parts.join(" ");
}

/** Extra bounding-box padding (device px) an offscreen render needs so the
 *  effect's spill (blur halo, shadow offset, glow) isn't clipped. */
export function effectPad(effects: readonly Effect[], scale: number): number {
  let pad = 0;
  for (const e of effects) {
    if (e.type === "blur") pad = Math.max(pad, 3 * e.radius * scale);
    else if (e.type === "glow") pad = Math.max(pad, 3 * e.radius * scale);
    else if (e.type === "shadow") {
      pad = Math.max(pad, (3 * e.blur + Math.max(Math.abs(e.offsetX ?? 0), Math.abs(e.offsetY ?? 0))) * scale);
    }
  }
  return Math.ceil(pad);
}

/** Stable fingerprint for cache keys (static-subtree render cache). */
export function effectsFingerprint(effects: readonly Effect[] | undefined): string {
  if (!effects || effects.length === 0) return "";
  return JSON.stringify(effects);
}

/** Split an effect list into the passes the canvas compositor plans around.
 *  Order within each category is preserved; at most one shadow/glow/noise
 *  is applied per mobject (last one wins -- documented limitation). */
export function splitEffects(effects: readonly Effect[]): {
  filter: Effect[];
  shadow?: Extract<Effect, { type: "shadow" }>;
  glow?: Extract<Effect, { type: "glow" }>;
  noise?: Extract<Effect, { type: "noise" }>;
} {
  const filter: Effect[] = [];
  let shadow, glow, noise;
  for (const e of effects) {
    if (e.type === "blur" || e.type === "colorAdjust") filter.push(e);
    else if (e.type === "shadow") shadow = e;
    else if (e.type === "glow") glow = e;
    else if (e.type === "noise") noise = e;
  }
  return { filter, shadow, glow, noise };
}

/** Deterministic RGBA noise tile bytes (size x size). Monochrome = same
 *  value across RGB; color = independent channels. Alpha is always 255 --
 *  the renderer clips the tile to the source's alpha via compositing.
 *  Byte-identical for identical (size, seed, mono) -- render-cache safe. */
export function makeNoiseBytes(size: number, seed: number, mono: boolean): Uint8ClampedArray {
  const rand = mulberry32(seed);
  const bytes = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    if (mono) {
      const v = Math.floor(rand() * 256);
      bytes[o] = v; bytes[o + 1] = v; bytes[o + 2] = v;
    } else {
      bytes[o] = Math.floor(rand() * 256);
      bytes[o + 1] = Math.floor(rand() * 256);
      bytes[o + 2] = Math.floor(rand() * 256);
    }
    bytes[o + 3] = 255;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// CSS-filter-spec color math, shared by the SVG renderer's feColorMatrix /
// feComponentTransfer defs (and available to shader passes). Kept here so
// canvas (native ctx.filter), SVG, and GL grade identically by construction.
// Reference: https://www.w3.org/TR/filter-effects-1/#ShorthandEquivalents
// ---------------------------------------------------------------------------

/** 20-element feColorMatrix "matrix" values for saturate(s). */
export function saturateMatrix(s: number): number[] {
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** 20-element feColorMatrix "matrix" values for hue-rotate(deg). */
export function hueRotateMatrix(deg: number): number[] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0, 0,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0, 0,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Lerp two effect lists for Transform interpolation. Only same-shape lists
 *  (equal length, matching type sequence) blend numerically; mixed shapes
 *  snap: start's effects below alpha 1, target's at alpha >= 1. Morphing
 *  between structurally different effect stacks is out of scope. */
export function lerpEffects(
  start: readonly Effect[] | undefined,
  target: readonly Effect[] | undefined,
  alpha: number,
): Effect[] | undefined {
  const snap = () => (alpha >= 1 ? target?.map((e) => ({ ...e })) : start?.map((e) => ({ ...e })));
  if (!start || !target || start.length !== target.length) return snap();
  const sameShape = start.every((e, i) => e.type === target[i].type);
  if (!sameShape) return snap();

  const lerpNum = (a: number | undefined, b: number | undefined, dflt: number): number | undefined => {
    if (a == null && b == null) return undefined;
    const av = a ?? dflt, bv = b ?? dflt;
    return av + (bv - av) * alpha;
  };
  const lerpCol = (a: ColorLike | undefined, b: ColorLike | undefined): ColorLike | undefined => {
    if (a == null && b == null) return undefined;
    if (a == null || b == null) return alpha >= 0.5 ? b : a;
    return Color.lerp(Color.parse(a), Color.parse(b), alpha).toHex();
  };

  return start.map((s, i): Effect => {
    const t = target[i];
    switch (s.type) {
      case "blur":
        return { type: "blur", radius: lerpNum(s.radius, (t as typeof s).radius, 0)! };
      case "glow": {
        const tt = t as typeof s;
        return {
          type: "glow", radius: lerpNum(s.radius, tt.radius, 0)!,
          color: lerpCol(s.color, tt.color), strength: lerpNum(s.strength, tt.strength, 2),
        };
      }
      case "shadow": {
        const tt = t as typeof s;
        return {
          type: "shadow", blur: lerpNum(s.blur, tt.blur, 0)!,
          color: lerpCol(s.color, tt.color),
          offsetX: lerpNum(s.offsetX, tt.offsetX, 0), offsetY: lerpNum(s.offsetY, tt.offsetY, 0),
        };
      }
      case "colorAdjust": {
        const tt = t as typeof s;
        return {
          type: "colorAdjust",
          brightness: lerpNum(s.brightness, tt.brightness, 1),
          contrast: lerpNum(s.contrast, tt.contrast, 1),
          saturate: lerpNum(s.saturate, tt.saturate, 1),
          hueRotate: lerpNum(s.hueRotate, tt.hueRotate, 0),
          grayscale: lerpNum(s.grayscale, tt.grayscale, 0),
        };
      }
      case "noise": {
        const tt = t as typeof s;
        // seed/monochrome are discrete -- snap at midpoint; amount lerps.
        return {
          type: "noise", amount: lerpNum(s.amount, tt.amount, 0)!,
          monochrome: alpha >= 0.5 ? tt.monochrome : s.monochrome,
          seed: alpha >= 0.5 ? tt.seed : s.seed,
        };
      }
    }
  });
}
