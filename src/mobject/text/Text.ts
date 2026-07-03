// Text: a proper vector mobject, mirroring ManimCommunity's
// manim/mobject/text/text_mobject.py (Text / MarkupText). Each glyph becomes a
// VMobject outline (via the VText glyph pipeline) and lives as a submobject, so
// Write traces the letterforms and Transform morphs them. Per-glyph `.chars`
// gives manim-style indexing and substring selection (getPartByText), and
// t2c/t2w/t2s/t2g/gradient recolour / restyle substrings.
//
// FALLBACK: when no vector font is available (e.g. the browser before
// setDefaultFont, or Node without any installed font), Text degrades to the
// legacy raster canvas behaviour (`_isText` + a bounding box the renderer's
// drawText special-cases). This keeps the browser demos and font-less Node
// working. The raster class is still exported as RasterText and is what
// DecimalNumber builds on.

import { Mobject } from "../Mobject.ts";
import type { MobjectConfig } from "../Mobject.ts";
import { VMobject, VGroup } from "../VMobject.ts";
import { Color } from "../../core/color.ts";
import * as V from "../../core/math/vector.ts";
import { parsePathToSubpaths, subpathsToVMobject } from "../svg_path.ts";
import { getDefaultFont } from "../vectorized_text.ts";
import type { ColorLike } from "../../core/types.ts";

/** Configuration accepted by the raster Text mobject. */
export interface TextConfig extends MobjectConfig {
  fontSize?: number;
  font?: any;
  weight?: string;
  slant?: string;
  align?: string;
  fillColor?: ColorLike;
  fillOpacity?: number;
  strokeColor?: ColorLike;
  strokeWidth?: number;
  strokeOpacity?: number;
  lineSpacing?: number;
  disableLigatures?: boolean;
  // text-to-* maps: substring -> value.
  t2c?: Record<string, ColorLike>;
  t2w?: Record<string, string>;
  t2s?: Record<string, string>;
  t2g?: Record<string, ColorLike[]>;
  gradient?: ColorLike[];
  point?: number[];
  at?: number[];
}

// Rough per-character width factor for layout estimation without a context.
export const CHAR_ASPECT = 0.55;

/**
 * Estimate a text block's rendered width/height without constructing a
 * mobject — the same formula `RasterText`/`Text` use internally to size
 * themselves before real glyph layout is available. A fast approximation,
 * not a guarantee: for anything close to a layout boundary, prefer measuring
 * a real, constructed mobject's `.getWidth()`/`.getHeight()` instead.
 */
export function estimateTextSize(
  text: string,
  fontSize: number,
  opts: { lineHeight?: number } = {},
): { width: number; height: number } {
  const lineHeight = opts.lineHeight ?? 1.2;
  const lines = text.split("\n");
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 1);
  return {
    width: longest * fontSize * CHAR_ASPECT,
    height: lines.length * fontSize * lineHeight,
  };
}

// ---------------------------------------------------------------------------
// RasterText — the original canvas-2D text (kept verbatim in behaviour).
// ---------------------------------------------------------------------------
export class RasterText extends Mobject {
  _isText: boolean;
  text: string;
  fontSize: number;
  font: string;
  weight: string;
  slant: string;
  align: string;
  fillColor: Color;
  fillOpacity: number;
  strokeOpacity: number;
  revealFraction: number;
  numLines!: number; // set by _layout() in the constructor

  constructor(text = "", config: TextConfig = {}) {
    super(config);
    this._isText = true;
    this.text = String(text);
    // World-space cap height of one line.
    this.fontSize = config.fontSize ?? 0.7;
    this.font = (typeof config.font === "string" ? config.font : undefined) ?? "sans-serif";
    this.weight = config.weight ?? "normal";
    this.slant = config.slant ?? "normal"; // normal | italic
    this.align = config.align ?? "center"; // left | center | right
    this.fillColor = Color.parse(config.color ?? config.fillColor ?? "#FFFFFF");
    this.fillOpacity = config.fillOpacity ?? 1;
    this.strokeOpacity = 0;
    this.opacity = config.opacity ?? 1;
    this.revealFraction = 1; // typewriter reveal for Write/Create

    this._buildBox();
    const at = config.point ?? config.at;
    if (at) this.moveTo(at);
  }

  _buildBox() {
    const { width: w, height: h } = estimateTextSize(this.text, this.fontSize);
    // Four corners (TL, TR, BR, BL) centered on origin — transforms act on these.
    this.points = [
      [-w / 2, h / 2, 0],
      [w / 2, h / 2, 0],
      [w / 2, -h / 2, 0],
      [-w / 2, -h / 2, 0],
    ];
    this.numLines = this.text.split("\n").length;
  }

  setColor(color: ColorLike): this {
    this.fillColor = Color.parse(color);
    this._color = Color.parse(color);
    return this;
  }

  setOpacity(o: number): this {
    this.fillOpacity = o;
    this.opacity = o;
    return this;
  }

  // The world-space font height after any scaling applied to the box.
  currentFontHeight(): number {
    return (this.getHeight() / Math.max(1, this.numLines)) / 1.2;
  }

  interpolate(start: any, target: any, alpha: number): this {
    const n = Math.min(this.points.length, start.points.length, target.points.length);
    for (let i = 0; i < n; i++) this.points[i] = V.lerp(start.points[i] as number[], target.points[i] as number[], alpha);
    this.fillColor = Color.lerp(start.fillColor, target.fillColor, alpha);
    this.fillOpacity = start.fillOpacity + (target.fillOpacity - start.fillOpacity) * alpha;
    this.opacity = start.opacity + (target.opacity - start.opacity) * alpha;
    return this;
  }

  copy(): this {
    const c = super.copy();
    c.fillColor = Color.parse(this.fillColor);
    return c;
  }
}

// ---------------------------------------------------------------------------
// Text — the vector class. Extends VGroup; each glyph is a VMobject submobject.
// Falls back to raster behaviour when no font is loaded.
// ---------------------------------------------------------------------------

const UNITS_PER_WORLD = 100; // opentype path px size; then scaled to world

export class Text extends VGroup {
  // Common (both modes)
  text: string;
  fontSize: number;
  fontFamily: string;
  weight: string;
  slant: string;
  align: string;
  lineSpacing: number;
  disableLigatures: boolean;

  // Vector-mode data. `chars` is a VGroup of the per-glyph VMobjects (manim's
  // .chars). `_charSource` maps each glyph mob index -> source string index in
  // the original (newline-stripped) text, for substring selection.
  chars!: VGroup;
  _charSource!: number[];
  _plainText!: string; // text with newlines removed (glyph stream order)

  // Raster-mode fields (only meaningful when _isText is true).
  _isText?: boolean;
  // fillColor/fillOpacity/strokeOpacity are inherited from VMobject; re-declared
  // here (without initializer) only for documentation.
  declare fillColor: Color;
  declare fillOpacity: number;
  declare strokeOpacity: number;
  revealFraction?: number;
  numLines?: number;
  private _rasterFontSize?: number;
  private _rasterFont?: string;

  constructor(text = "", config: TextConfig = {}) {
    super();
    this.text = String(text);
    this.fontSize = config.fontSize ?? 0.7;
    this.fontFamily = typeof config.font === "string" ? config.font : "sans-serif";
    this.weight = config.weight ?? "normal";
    this.slant = config.slant ?? "normal";
    this.align = config.align ?? "center";
    this.lineSpacing = config.lineSpacing ?? 1.2;
    this.disableLigatures = config.disableLigatures ?? false;

    this.fillColor = Color.parse(config.color ?? config.fillColor ?? "#FFFFFF");
    this.strokeColor = Color.parse(config.strokeColor ?? config.color ?? config.fillColor ?? "#FFFFFF");
    this.fillOpacity = config.fillOpacity ?? 1;
    this.strokeOpacity = config.strokeOpacity ?? (config.strokeWidth ? 1 : 0);
    this.strokeWidth = config.strokeWidth ?? 0;
    this.opacity = config.opacity ?? 1;

    const font = config.font && typeof config.font !== "string" ? config.font : getDefaultFont();

    if (!font) {
      // FALLBACK: build as raster text (renderer draws it via drawText).
      this._buildAsRaster(config);
      const at = config.point ?? config.at;
      if (at) this.moveTo(at);
      return;
    }

    // Vector mode.
    this._buildGlyphs(font);
    this.setStyle({
      fillColor: this.fillColor,
      fillOpacity: this.fillOpacity,
      strokeColor: this.strokeColor,
      strokeWidth: this.strokeWidth,
      strokeOpacity: this.strokeOpacity,
    });

    // Apply per-substring styling.
    if (config.t2s) this._applyT2s(config.t2s);
    if (config.t2w) this._applyT2w(config.t2w);
    if (config.t2c) this.setColorByT2c(config.t2c);
    if (config.t2g) this.setColorByT2g(config.t2g);
    if (config.gradient) this.setColorByGradientText(config.gradient);

    const at = config.point ?? config.at;
    if (at) this.moveTo(at);
    else this.center();
  }

  // --- raster fallback ----------------------------------------------------
  private _buildAsRaster(config: TextConfig): void {
    this._isText = true;
    this.revealFraction = 1;
    this._rasterFontSize = this.fontSize;
    this._rasterFont = this.fontFamily;
    this.chars = new VGroup();
    this._charSource = [];
    this._plainText = this.text.replace(/\n/g, "");
    void config;
    this._buildRasterBox();
  }

  private _buildRasterBox(): void {
    const { width: w, height: h } = estimateTextSize(this.text, this.fontSize, { lineHeight: this.lineSpacing });
    this.points = [
      [-w / 2, h / 2, 0],
      [w / 2, h / 2, 0],
      [w / 2, -h / 2, 0],
      [-w / 2, -h / 2, 0],
    ];
    this.numLines = this.text.split("\n").length;
  }

  // Renderer's drawText reads .font/.numLines/.currentFontHeight().
  get font(): string {
    return this._rasterFont ?? this.fontFamily;
  }
  set font(v: string) {
    this._rasterFont = v;
  }

  currentFontHeight(): number {
    return (this.getHeight() / Math.max(1, this.numLines ?? 1)) / this.lineSpacing;
  }

  // --- vector construction ------------------------------------------------
  private _buildGlyphs(font: any): void {
    const px = UNITS_PER_WORLD;
    const scaleToWorld = (this.fontSize / px) * 1.4;
    const scaleFactor = px / font.unitsPerEm;

    this.chars = new VGroup();
    this._charSource = [];

    const lines = this.text.split("\n");
    this._plainText = lines.join("");

    // Vertical advance per line (world units).
    const lineHeight = this.fontSize * this.lineSpacing;

    let sourceIndex = 0; // index into _plainText
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const chars = Array.from(line);
      let x = 0;
      const y = -li * lineHeight; // first line at top, subsequent below
      const lineGlyphs: VMobject[] = [];
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
        mob.fillOpacity = this.fillOpacity;
        mob.strokeWidth = this.strokeWidth;
        mob.strokeOpacity = this.strokeOpacity;
        // Shift onto its line.
        if (y !== 0) mob.shift([0, y, 0]);
        // Always add (even whitespace/empty) so char indices line up with text.
        this.chars.add(mob);
        this.add(mob);
        this._charSource.push(sourceIndex);
        lineGlyphs.push(mob);
        sourceIndex += 1;
        x += (glyph.advanceWidth ?? font.unitsPerEm * 0.5) * scaleFactor;
      }
      void lineGlyphs;
    }

    // Centre the whole block (manim positions text about its own centre).
    if (this.submobjects.length) {
      const c = this.getCenter();
      this.shift(V.neg(c));
    }
  }

  // --- substring selection ------------------------------------------------
  // Indices in _plainText where `substr` occurs (all non-overlapping matches).
  private _matchRanges(substr: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    if (!substr) return ranges;
    const hay = this._plainText;
    let from = 0;
    while (true) {
      const idx = hay.indexOf(substr, from);
      if (idx < 0) break;
      ranges.push([idx, idx + substr.length]);
      from = idx + substr.length;
    }
    return ranges;
  }

  // Glyph submobjects whose source-character index falls inside any match.
  private _glyphsForRange(start: number, end: number): VMobject[] {
    const out: VMobject[] = [];
    for (let i = 0; i < this.chars.submobjects.length; i++) {
      const src = this._charSource[i];
      if (src >= start && src < end) out.push(this.chars.submobjects[i] as VMobject);
    }
    return out;
  }

  // All matches as an array of VGroups (one per occurrence of `substr`).
  getPartsByText(substr: string): VGroup[] {
    return this._matchRanges(substr).map(([s, e]) => {
      const g = new VGroup();
      for (const m of this._glyphsForRange(s, e)) g.add(m);
      return g;
    });
  }

  // First match as a VGroup (empty VGroup if not found).
  getPartByText(substr: string): VGroup {
    const parts = this.getPartsByText(substr);
    return parts[0] ?? new VGroup();
  }

  // --- per-substring styling ----------------------------------------------
  setColorByT2c(t2c?: Record<string, ColorLike>): this {
    if (!t2c) return this;
    for (const [substr, color] of Object.entries(t2c)) {
      for (const part of this.getPartsByText(substr)) {
        for (const g of part.submobjects) {
          (g as VMobject).fillColor = Color.parse(color);
          (g as VMobject).strokeColor = Color.parse(color);
          (g as VMobject).color = Color.parse(color);
        }
      }
    }
    return this;
  }

  // Per-substring gradient: {substr: [c0, c1, ...]} laid across that substring.
  setColorByT2g(t2g?: Record<string, ColorLike[]>): this {
    if (!t2g) return this;
    for (const [substr, colors] of Object.entries(t2g)) {
      for (const part of this.getPartsByText(substr)) {
        this._gradientAcross(part.submobjects as VMobject[], colors);
      }
    }
    return this;
  }

  // Weight per substring. With a single loaded font we cannot re-shape to a bold
  // face, so we emulate weight by adding a proportional stroke on the fill.
  private _applyT2w(t2w: Record<string, string>): this {
    for (const [substr, weight] of Object.entries(t2w)) {
      const bold = /bold|[6-9]00/i.test(weight);
      for (const part of this.getPartsByText(substr)) {
        for (const g of part.submobjects) {
          const m = g as VMobject;
          if (bold) {
            m.strokeColor = Color.parse(m.fillColor);
            m.strokeWidth = Math.max(m.strokeWidth, this.fontSize * 2.2);
            m.strokeOpacity = m.fillOpacity;
          }
        }
      }
    }
    return this;
  }

  // Slant per substring. Emulated by a horizontal shear about the baseline.
  private _applyT2s(t2s: Record<string, string>): this {
    for (const [substr, slant] of Object.entries(t2s)) {
      if (!/italic|oblique/i.test(slant)) continue;
      for (const part of this.getPartsByText(substr)) {
        for (const g of part.submobjects) {
          const m = g as VMobject;
          for (const p of m.points) p[0] += p[1] * 0.2; // shear x by 0.2*y
        }
      }
    }
    return this;
  }

  // Gradient across the entire text (manim's `gradient=`), spread glyph-wise.
  setColorByGradientText(colors: ColorLike[]): this {
    this._gradientAcross(this.chars.submobjects as VMobject[], colors);
    return this;
  }

  // Distribute a colour ramp across a list of glyphs (left-to-right).
  private _gradientAcross(glyphs: VMobject[], colors: ColorLike[]): void {
    const stops = colors.map((c) => Color.parse(c));
    const n = glyphs.length;
    if (n === 0 || stops.length === 0) return;
    if (stops.length === 1) {
      for (const g of glyphs) {
        g.fillColor = Color.parse(stops[0]);
        g.strokeColor = Color.parse(stops[0]);
        g.color = Color.parse(stops[0]);
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      const seg = t * (stops.length - 1);
      const lo = Math.min(stops.length - 1, Math.floor(seg));
      const hi = Math.min(stops.length - 1, lo + 1);
      const local = seg - lo;
      const c = Color.lerp(stops[lo], stops[hi], local);
      g_set(glyphs[i], c);
    }
  }

  // --- overrides ----------------------------------------------------------
  setColor(color: ColorLike): this {
    const c = Color.parse(color);
    this.fillColor = c;
    this.strokeColor = Color.parse(color);
    this._color = Color.parse(color);
    for (const m of this.submobjects) (m as VMobject).setColor(color);
    return this;
  }

  copy(): this {
    const c = super.copy();
    // Rebuild the chars VGroup to reference the copied submobjects (order-preserved).
    const nc = new VGroup();
    for (const s of (c as any).submobjects) nc.add(s);
    (c as any).chars = nc;
    (c as any)._charSource = [...this._charSource];
    (c as any)._plainText = this._plainText;
    if (this._isText) {
      (c as any).fillColor = Color.parse(this.fillColor);
    }
    return c;
  }
}

// Helper: set all colour channels on a glyph.
function g_set(m: VMobject, c: Color): void {
  m.fillColor = Color.parse(c);
  m.strokeColor = Color.parse(c);
  m.color = Color.parse(c);
}

// ---------------------------------------------------------------------------
// MarkupText — parses a small Pango-ish subset and feeds runs into t2c/t2w/t2s.
//   <b>bold</b>  <i>italic</i>
//   <span foreground="#hex">…</span>  <span color="…">…</span>
//   <gradient from=".." to="..">…</gradient>
// Tags are stripped; the plain text is built as a vector Text with the derived
// text-to-* maps.
// ---------------------------------------------------------------------------
interface MarkupRun {
  bold: boolean;
  italic: boolean;
  color?: string;
  gradientFrom?: string;
  gradientTo?: string;
}

export class MarkupText extends Text {
  constructor(markup = "", config: TextConfig = {}) {
    const { plain, t2c, t2w, t2s, t2g } = MarkupText._parse(String(markup));
    // Merge parsed maps under any explicitly-provided config maps (config wins).
    const merged: TextConfig = {
      ...config,
      t2c: { ...t2c, ...(config.t2c ?? {}) },
      t2w: { ...t2w, ...(config.t2w ?? {}) },
      t2s: { ...t2s, ...(config.t2s ?? {}) },
      t2g: { ...t2g, ...(config.t2g ?? {}) },
    };
    super(plain, merged);
  }

  // Very small tag-stack parser. Returns the tag-stripped text plus text-to-*
  // maps keyed by the exact substring each run covers.
  static _parse(markup: string): {
    plain: string;
    t2c: Record<string, string>;
    t2w: Record<string, string>;
    t2s: Record<string, string>;
    t2g: Record<string, string[]>;
  } {
    const t2c: Record<string, string> = {};
    const t2w: Record<string, string> = {};
    const t2s: Record<string, string> = {};
    const t2g: Record<string, string[]> = {};

    let plain = "";
    const stack: MarkupRun[] = [];
    const top = (): MarkupRun => stack[stack.length - 1] ?? { bold: false, italic: false };

    // Accumulate the text covered by each currently-open styled run so that when
    // it closes we can register the substring in the appropriate map.
    type Open = { run: MarkupRun; start: number };
    const open: Open[] = [];

    const tagRe = /<(\/?)([a-zA-Z]+)((?:\s+[^>]*)?)>/g;
    let last = 0;
    let m: RegExpExecArray | null;
    const pushText = (txt: string) => {
      plain += txt;
    };

    while ((m = tagRe.exec(markup)) !== null) {
      pushText(markup.slice(last, m.index));
      last = tagRe.lastIndex;
      const closing = m[1] === "/";
      const name = m[2].toLowerCase();
      const attrs = m[3] ?? "";

      if (!closing) {
        const parent = top();
        const run: MarkupRun = { bold: parent.bold, italic: parent.italic, color: parent.color };
        if (name === "b") run.bold = true;
        else if (name === "i") run.italic = true;
        else if (name === "span") {
          const fg = /(?:foreground|color)\s*=\s*"([^"]*)"/i.exec(attrs);
          if (fg) run.color = fg[1];
          if (/font_weight\s*=\s*"(?:bold|[6-9]00)"/i.test(attrs)) run.bold = true;
          if (/font_style\s*=\s*"(?:italic|oblique)"/i.test(attrs)) run.italic = true;
        } else if (name === "gradient") {
          const from = /from\s*=\s*"?([#\w]+)"?/i.exec(attrs);
          const to = /to\s*=\s*"?([#\w]+)"?/i.exec(attrs);
          run.gradientFrom = from ? from[1] : undefined;
          run.gradientTo = to ? to[1] : undefined;
        }
        stack.push(run);
        open.push({ run, start: plain.length });
      } else {
        const o = open.pop();
        stack.pop();
        if (o) {
          const substr = plain.slice(o.start);
          const run = o.run;
          if (substr) {
            if (run.bold) t2w[substr] = "bold";
            if (run.italic) t2s[substr] = "italic";
            if (run.color) t2c[substr] = run.color;
            if (run.gradientFrom && run.gradientTo) t2g[substr] = [run.gradientFrom, run.gradientTo];
          }
        }
      }
    }
    pushText(markup.slice(last));

    return { plain, t2c, t2w, t2s, t2g };
  }
}
