// Optional HarfBuzz-backed text shaping: a second implementation of
// text_shaping.ts's buildGlyphRun(), returning the identical
// {entries, endX} shape so call sites need only a backend-selection
// branch, not a rewrite. Gives full GSUB/GPOS shaping (real ligatures,
// contextual forms, mark-attachment positioning, combining-mark
// composition) instead of the naive per-code-point charToGlyph loop.
//
// harfbuzzjs is an optionalDependency (mirrors @napi-rs/canvas/three's own
// graceful-degrade pattern) -- modeled on src/wasm.ts's lazy-load approach.
// If it isn't installed, or the active font has no raw bytes stashed (see
// fonts-node.ts/vectorized_text.ts's `_rawFontBytes`), every function here
// returns null/false and callers fall back to the opentype.js-based
// buildGlyphRun() transparently. Never throws.

import { VMobject } from "./VMobject.ts";
import { parsePathToSubpaths, subpathsToVMobject } from "./svg_path.ts";
import { UNITS_PER_WORLD } from "./text_shaping.ts";
import type { GlyphRunEntry, GlyphRunResult } from "./text_shaping.ts";

let hb: any = null;
let hbLoadAttempted = false;

async function loadHbModule(): Promise<any> {
  if (hb || hbLoadAttempted) return hb;
  hbLoadAttempted = true;
  try {
    hb = await import("harfbuzzjs");
  } catch {
    hb = null; // not installed, or an unbundled browser with no import map for it
  }
  return hb;
}

/** True once harfbuzzjs has successfully loaded (call loadHarfBuzz() first). */
export function isHarfBuzzLoaded(): boolean {
  return hb != null;
}

/** Attempt to load harfbuzzjs. Idempotent, memoized, never throws. */
export async function loadHarfBuzz(): Promise<boolean> {
  await loadHbModule();
  return hb != null;
}

// One hb.Font per opentype.js Font object (keyed by reference), so repeated
// shaping calls against the same loaded font don't rebuild the HarfBuzz
// face/font every time.
const hbFontCache = new WeakMap<any, any>();

function getHbFont(otFont: any): any {
  if (!hb || !otFont?._rawFontBytes) return null;
  let hbFont = hbFontCache.get(otFont);
  if (hbFont) return hbFont;
  const blob = new hb.Blob(otFont._rawFontBytes);
  const face = new hb.Face(blob, 0);
  hbFont = new hb.Font(face);
  // Scale shaping output (advances, offsets) AND glyphToPath's outline
  // coordinates to the same "px" space the opentype.js-based path already
  // uses (confirmed empirically: HarfBuzz's setScale affects both
  // consistently), so no separate post-scale step is needed here.
  hbFont.setScale(UNITS_PER_WORLD, UNITS_PER_WORLD);
  hbFontCache.set(otFont, hbFont);
  return hbFont;
}

/**
 * True if `otFont` can actually be shaped via HarfBuzz right now (module
 * loaded AND the font carries its raw bytes). Callers should check this
 * (or just call shapeWithHarfBuzz and handle a null result) before
 * committing to the HarfBuzz code path.
 */
export function canShapeWithHarfBuzz(otFont: any): boolean {
  return getHbFont(otFont) != null;
}

export interface ShapeWithHarfBuzzOptions {
  scaleToWorld: number;
  /** Include liga/clig/calt GSUB features. Default true. */
  ligatures?: boolean;
}

/**
 * Shape `text` with HarfBuzz (full GSUB/GPOS) and return the same
 * {entries, endX} shape buildGlyphRun() does -- one VMobject per shaped
 * glyph (NOT necessarily one per source character: a ligature merges
 * several source characters into one glyph; a decomposed combining-mark
 * sequence is composed back into one glyph by the `ccmp` feature). Returns
 * null if HarfBuzz/the font's raw bytes aren't available; callers should
 * fall back to buildGlyphRun() in that case.
 *
 * clusterLength per entry is derived from the gap to the next glyph's
 * (distinct) cluster value, defaulting to "rest of the string" for the
 * last glyph -- correct for the common case (one glyph per one-or-more
 * source characters); multiple glyphs sharing one cluster (rare complex-
 * script one-to-many expansions) get overlapping ranges, a known,
 * documented simplification rather than a fully general many-to-many model.
 */
export function shapeWithHarfBuzz(
  otFont: any,
  text: string,
  opts: ShapeWithHarfBuzzOptions,
): GlyphRunResult | null {
  const hbFont = getHbFont(otFont);
  if (!hbFont) return null;
  if (text.length === 0) return { entries: [], endX: 0 };

  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  const features = opts.ligatures === false
    ? [new hb.Feature("liga", 0), new hb.Feature("clig", 0), new hb.Feature("calt", 0)]
    : [];
  hb.shape(hbFont, buffer, features);

  const infos = buffer.getGlyphInfos();
  const positions = buffer.getGlyphPositions();
  const n = infos.length;

  const entries: GlyphRunEntry[] = [];
  let x = 0;
  for (let i = 0; i < n; i++) {
    const info = infos[i];
    const pos = positions[i];

    let clusterLength = text.length - info.cluster;
    for (let j = i + 1; j < n; j++) {
      if (infos[j].cluster !== info.cluster) { clusterLength = infos[j].cluster - info.cluster; break; }
    }

    const mob = new VMobject();
    const d = hbFont.glyphToPath(info.codepoint);
    if (d && d.length) {
      const subs = parsePathToSubpaths(d);
      const shiftX = x + (pos.xOffset ?? 0);
      const shiftY = pos.yOffset ?? 0;
      if (shiftX !== 0 || shiftY !== 0) {
        for (const sub of subs) for (const pt of sub) { pt[0] += shiftX; pt[1] += shiftY; }
      }
      // NOT flipY:true here, unlike the opentype.js path in text_shaping.ts.
      // Confirmed by direct comparison of the two libraries' path data for
      // the same glyph ("H" in the same font): opentype.js's
      // glyph.getPath().toPathData() emits Y-DOWN pixel-space coordinates
      // (top of "H" at y=-71.6, baseline at 0) -- flipY:true is what
      // converts THAT into this codebase's Y-up world space. HarfBuzz's
      // glyphToPath() instead emits Y-UP font-unit-space coordinates (top
      // of "H" at y=+71.58, baseline at 0), already matching Y-up world
      // space after scaling alone. Applying flipY:true here double-flips
      // it, rendering every HarfBuzz-shaped glyph upside down.
      subpathsToVMobject(mob, subs, { scale: opts.scaleToWorld, translate: [0, 0, 0], flipY: false });
    }

    entries.push({ mob, sourceStart: info.cluster, clusterLength });
    x += pos.xAdvance ?? 0;
  }

  return { entries, endX: x };
}
