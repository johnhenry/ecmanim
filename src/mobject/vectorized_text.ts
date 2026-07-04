// Vectorized text: real glyph OUTLINES as cubic-Bezier VMobjects (via
// opentype.js), so Write traces the letterforms and Transform morphs them into
// other shapes — unlike the raster canvas Text. Each glyph becomes a VMobject
// submobject of a VGroup.
//
// Node: a system font is auto-resolved via fontconfig. Browser: preload a font
// with `await setDefaultFont(urlOrArrayBuffer)` (or pass config.font as an
// opentype Font).

// opentype.js is imported lazily (only when parsing a font) so that importing
// this module — and thus the whole library — never requires a bare "opentype.js"
// specifier to resolve in an unbundled browser. Font *usage* (charToGlyph etc.)
// is all methods on an already-parsed Font object, needing no module reference.
import { VMobject, VGroup } from "./VMobject.ts";
import { Color } from "../core/color.ts";
import * as V from "../core/math/vector.ts";
import { parsePathToSubpaths, subpathsToVMobject } from "./svg_path.ts";
import type { ColorLike } from "../core/types.ts";

/** Configuration accepted by VText. */
export interface VTextConfig {
  fontSize?: number;
  font?: any;
  color?: ColorLike;
  fillColor?: ColorLike;
  strokeColor?: ColorLike;
  fillOpacity?: number;
  strokeWidth?: number;
  strokeOpacity?: number;
  point?: number[];
  [key: string]: any;
}

let _defaultFont: any = null;

// Node-only auto-resolution seam (issue #16). This module stays browser-safe
// (no Node imports of its own) -- src/node.ts registers a synchronous
// system-font loader here, so getDefaultFont() can lazily resolve a default
// font the first time nothing has been loaded yet, instead of every caller
// needing to remember an explicit `await loadVectorFont()` call before
// constructing/measuring a Text. Attempted at most once per process (a
// failed lookup, e.g. no system font available, isn't retried on every call).
type NodeFontAutoLoader = () => any;
let _nodeAutoLoader: NodeFontAutoLoader | null = null;
let _nodeAutoLoadAttempted = false;

export function registerNodeFontAutoLoader(fn: NodeFontAutoLoader): void {
  _nodeAutoLoader = fn;
}

export function getDefaultFont(): any {
  if (_defaultFont == null && !_nodeAutoLoadAttempted && _nodeAutoLoader) {
    _nodeAutoLoadAttempted = true;
    try {
      _nodeAutoLoader(); // sets _defaultFont itself via setDefaultFontSync()
    } catch {
      // No system font available -- callers fall back to the raster/estimate path.
    }
  }
  return _defaultFont;
}

// Preload a font for the browser (or override the default in Node).
//   await setDefaultFont("/fonts/Inter.ttf")
export async function setDefaultFont(source: any): Promise<any> {
  if (typeof source === "string") {
    const opentype = (await import("opentype.js")).default;
    const buf = await fetch(source).then((r) => r.arrayBuffer());
    _defaultFont = opentype.parse(buf);
  } else if (source instanceof ArrayBuffer) {
    const opentype = (await import("opentype.js")).default;
    _defaultFont = opentype.parse(source);
  } else {
    _defaultFont = source; // already a parsed opentype.Font
  }
  return _defaultFont;
}

export function setDefaultFontSync(font: any): any {
  _defaultFont = font;
  return font;
}

const UNITS_PER_WORLD = 100; // opentype path uses px; we render at this px size then scale to world

export class VText extends VGroup {
  text: string;
  fontSize: number;

  constructor(text = "", config: VTextConfig = {}) {
    super();
    this.text = String(text);
    this.fontSize = config.fontSize ?? 0.7; // world cap-height-ish
    const font = config.font ?? _defaultFont;
    if (!font) {
      throw new Error(
        "VText needs a font. In the browser call `await setDefaultFont(url)` first; " +
        "in Node a system font is auto-loaded via fontconfig (is one installed?).",
      );
    }
    this.fillColor = Color.parse(config.color ?? config.fillColor ?? "#FFFFFF");
    this.strokeColor = Color.parse(config.strokeColor ?? config.color ?? "#FFFFFF");
    this._buildGlyphs(font, config);
    this.setStyle({
      fillColor: this.fillColor,
      fillOpacity: config.fillOpacity ?? 1,
      strokeColor: this.strokeColor,
      strokeWidth: config.strokeWidth ?? 0,
      strokeOpacity: config.strokeOpacity ?? (config.strokeWidth ? 1 : 0),
    });
    if (config.point) this.moveTo(config.point);
    else this.center();
  }

  _buildGlyphs(font: any, config: VTextConfig): void {
    const px = UNITS_PER_WORLD;
    const scaleToWorld = this.fontSize / px * 1.4; // approx cap-height mapping
    // Iterate characters with charToGlyph (avoids GSUB shaping, which opentype.js
    // does not fully support for some fonts). One VMobject per glyph.
    const chars = Array.from(this.text);
    let x = 0;
    const scaleFactor = px / font.unitsPerEm;
    for (const ch of chars) {
      const glyph = font.charToGlyph(ch);
      const gp = glyph.getPath(x, 0, px); // y-down, baseline at 0
      const d = gp.toPathData(3);
      const mob = new VMobject();
      if (d && d.length) {
        const subs = parsePathToSubpaths(d);
        subpathsToVMobject(mob, subs, { scale: scaleToWorld, translate: [0, 0, 0], flipY: true });
      }
      mob.fillColor = Color.parse(this.fillColor);
      mob.strokeColor = Color.parse(this.strokeColor);
      mob.fillOpacity = config.fillOpacity ?? 1;
      mob.strokeWidth = config.strokeWidth ?? 0;
      mob.strokeOpacity = config.strokeOpacity ?? (config.strokeWidth ? 1 : 0);
      if (mob.points.length) this.add(mob);
      x += (glyph.advanceWidth ?? font.unitsPerEm * 0.5) * scaleFactor;
    }
  }

  setStyle(style: any): this {
    for (const g of this.submobjects) (g as any).setStyle(style);
    return this;
  }
}

export function setStyle(): void { /* placeholder to keep VGroup happy if referenced */ }
