// Shared glyph-run builder for both the raster-fallback vector path (Text.ts)
// and VText (vectorized_text.ts) -- previously two independent, near-identical
// "iterate characters, charToGlyph, getPath, advance x" loops. Kerning,
// grapheme-cluster iteration, and (eventually) real HarfBuzz shaping all touch
// this exact loop, so it lives in one place.
//
// Default backend ("opentype", see setTextShapingBackend() below) iterates
// by Unicode grapheme cluster (not UTF-16 code unit or code point), so
// combining-mark sequences and multi-codepoint emoji count as one glyph
// slot -- every code point in a cluster gets its own opentype.js glyph
// outline, merged into a single VMobject per cluster so the whole cluster
// moves/selects as one unit. It does NOT perform GSUB/GPOS shaping (no
// ligatures, no mark-attachment positioning -- combining marks are drawn at
// the same pen position as their base glyph). The optional "harfbuzz"
// backend (text_shaping_hb.ts) does full real shaping instead.

import { VMobject } from "./VMobject.ts";
import { parsePathToSubpaths, subpathsToVMobject } from "./svg_path.ts";

export const UNITS_PER_WORLD = 100; // opentype path uses px; scaled to world after.

export interface GlyphRunEntry {
  mob: VMobject;
  /** Index into the source line where this cluster begins (UTF-16 code units). */
  sourceStart: number;
  /** Length of this cluster in the source line (UTF-16 code units). */
  clusterLength: number;
}

export interface GlyphRunResult {
  entries: GlyphRunEntry[];
  /** Pen x position (opentype px space, per `px`; NOT world units) after the last glyph. */
  endX: number;
}

export interface BuildGlyphRunOptions {
  font: any;
  /** opentype path px size; defaults to UNITS_PER_WORLD. */
  px?: number;
  scaleToWorld: number;
  /** Apply font kerning between clusters. Default true. */
  kerning?: boolean;
  /** Include GSUB ligature features (liga/clig/calt) when shaping with the
   *  HarfBuzz backend. Default true. No effect on the opentype.js backend
   *  (which never performs GSUB substitution at all). */
  ligatures?: boolean;
}

// --- text-shaping backend selection ----------------------------------------
// Default "opentype": the per-code-point charToGlyph loop below (no GSUB/GPOS
// shaping). Optional "harfbuzz": full shaping via the harfbuzzjs WASM build
// (real ligatures, contextual forms, mark-attachment positioning) -- see
// text_shaping_hb.ts. Loaded lazily via a cached dynamic import (not a static
// one) specifically to avoid a circular module dependency, since
// text_shaping_hb.ts itself imports UNITS_PER_WORLD/types from this file.
export type TextShapingBackend = "opentype" | "harfbuzz";
let _backend: TextShapingBackend = "opentype";
let _lastBackendUsed: TextShapingBackend = "opentype";
let _hbBridge: typeof import("./text_shaping_hb.ts") | null = null;

/** Which backend buildGlyphRun() will *try* to use. */
export function getTextShapingBackend(): TextShapingBackend {
  return _backend;
}

/**
 * Which backend actually ran for the most recent buildGlyphRun() call --
 * may differ from getTextShapingBackend() if HarfBuzz was requested but
 * couldn't be used (not loaded yet, or the active font has no raw bytes),
 * in which case buildGlyphRun() transparently falls back to "opentype".
 */
export function isTextShapingBackendActive(): TextShapingBackend {
  return _lastBackendUsed;
}

/**
 * Select the shaping backend. Selecting "harfbuzz" loads harfbuzzjs (if not
 * already loaded) and resolves once it's ready to use -- await this before
 * constructing Text/VText that should use it; a Text/VText built before the
 * load resolves falls back to "opentype" for that call, not an error.
 */
export async function setTextShapingBackend(backend: TextShapingBackend): Promise<void> {
  _backend = backend;
  if (backend === "harfbuzz" && !_hbBridge) {
    _hbBridge = await import("./text_shaping_hb.ts");
    await _hbBridge.loadHarfBuzz();
  }
}

const graphemeSegmenter: any =
  typeof Intl !== "undefined" && typeof (Intl as any).Segmenter === "function"
    ? new (Intl as any).Segmenter(undefined, { granularity: "grapheme" })
    : null;

function graphemeClusters(line: string): string[] {
  if (graphemeSegmenter) {
    const out: string[] = [];
    for (const seg of graphemeSegmenter.segment(line)) out.push(seg.segment);
    return out;
  }
  // Environments without Intl.Segmenter: fall back to code-point iteration
  // (still better than a raw UTF-16 code-unit split, just not cluster-aware).
  return Array.from(line);
}

/**
 * Build one VMobject per grapheme cluster in `line`, laid out left-to-right
 * starting at pen position (0,0) in opentype px space. Callers position the
 * whole run (e.g. onto a line's y offset) and add the resulting mobjects.
 */
export function buildGlyphRun(line: string, opts: BuildGlyphRunOptions): GlyphRunResult {
  const { font, scaleToWorld } = opts;

  if (_backend === "harfbuzz" && _hbBridge?.canShapeWithHarfBuzz(font)) {
    const hbResult = _hbBridge.shapeWithHarfBuzz(font, line, { scaleToWorld, ligatures: opts.ligatures });
    if (hbResult) {
      _lastBackendUsed = "harfbuzz";
      return hbResult;
    }
  }
  _lastBackendUsed = "opentype";

  const px = opts.px ?? UNITS_PER_WORLD;
  const kerning = opts.kerning ?? true;
  const scaleFactor = px / font.unitsPerEm;

  const clusters = graphemeClusters(line);
  const entries: GlyphRunEntry[] = [];
  let x = 0;
  let sourceStart = 0;
  let prevGlyph: any = null;

  for (const cluster of clusters) {
    const codePoints = Array.from(cluster);
    const glyphs = codePoints.map((cp) => font.charToGlyph(cp));
    const firstGlyph = glyphs[0] ?? null;

    if (kerning && prevGlyph && firstGlyph) {
      const kern = font.getKerningValue(prevGlyph, firstGlyph) ?? 0;
      if (kern) x += kern * scaleFactor;
    }

    const mob = new VMobject();
    const allSubs: number[][][] = [];
    for (const glyph of glyphs) {
      const gp = glyph.getPath(x, 0, px);
      const d = gp.toPathData(3);
      if (d && d.length) allSubs.push(...parsePathToSubpaths(d));
    }
    if (allSubs.length) {
      subpathsToVMobject(mob, allSubs, { scale: scaleToWorld, translate: [0, 0, 0], flipY: true });
    }

    entries.push({ mob, sourceStart, clusterLength: cluster.length });
    prevGlyph = firstGlyph;
    sourceStart += cluster.length;
    x += (firstGlyph?.advanceWidth ?? font.unitsPerEm * 0.5) * scaleFactor;
  }

  return { entries, endX: x };
}

/**
 * Advance width of `line` in world units, via the same safe per-cluster
 * `charToGlyph` + kerning walk as `buildGlyphRun` (deliberately NOT
 * `font.getAdvanceWidth()`/`font.forEachGlyph()` -- those route through
 * opentype.js's whole-string GSUB/bidi shaping pipeline, which throws on
 * some fonts for lookup types it doesn't implement; the per-character path
 * this module already uses to build glyphs avoids that entirely). Skips
 * building any glyph outlines, so this is cheap to call repeatedly (e.g.
 * once per candidate line while word-wrapping).
 */
export function measureGlyphRunWidth(line: string, opts: BuildGlyphRunOptions): number {
  const { font, scaleToWorld } = opts;
  const px = opts.px ?? UNITS_PER_WORLD;
  const kerning = opts.kerning ?? true;
  const scaleFactor = px / font.unitsPerEm;

  const clusters = graphemeClusters(line);
  let x = 0;
  let prevGlyph: any = null;
  for (const cluster of clusters) {
    const codePoints = Array.from(cluster);
    const firstGlyph = font.charToGlyph(codePoints[0]);
    if (kerning && prevGlyph && firstGlyph) {
      const kern = font.getKerningValue(prevGlyph, firstGlyph) ?? 0;
      if (kern) x += kern * scaleFactor;
    }
    prevGlyph = firstGlyph;
    x += (firstGlyph?.advanceWidth ?? font.unitsPerEm * 0.5) * scaleFactor;
  }
  return x * scaleToWorld;
}
