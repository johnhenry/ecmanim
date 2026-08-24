// ASS/SSA subtitle player (v1 scope) — the mobject half of the ASS/SSA
// importer. Mirrors src/mobject/lottie_mobject.ts's two-phase contract:
// `_buildCues()` runs once at construction (stable per-event Group topology
// decided from the parsed script), `_updateCues(tMs)` runs on every
// `setTime`/`setFrame` call and REBUILDS each visible cue's text geometry
// from scratch every time (never mutates incrementally) -- this is what
// makes `setTime` a provably pure function of time: same tMs in, same world
// geometry out, in any call order. That purity is required both for
// scrub-safety and for ecmanim's content-hash partial-movie render cache
// (Scene._mobjectFingerprint reads a mobject's CURRENT geometry/paint at
// wait()-time; it never re-invokes updaters to check for hidden state).
//
// Supported (v1): \pos, \move, \an (+legacy \a) + margins, \fad, \fade,
// \c/\1c-\4c, \alpha/\1a-\4a, \fscx, \fscy, \fs, \fn (with fallback+warn),
// \b, \i, \u, \s, \frz/\fr (pivoted at run-bbox-center when no \org is
// given), \bord, \shad, \k (instant karaoke), Layer z-order, \N (+\n under
// WrapStyle 2) hard line breaks, greedy word-wrap within PlayRes margins.
// Supported (v1.5): \t(t1,t2,accel,tags) animating numeric/color fields
// (see applyTransformTag in the loader), rectangular \clip/\iclip via
// CompositeGroup + destination-in/out (verbatim reuse of LottieMobject's
// own mask mechanism -- see _clipMask below), \org (explicit rotate/shear
// pivot, applied post-placement -- see _applyOrgTransform), \fax/\fay
// (shear, via Mobject.applyMatrix), \be/\blur (via Mobject.blur()), \kf/\K
// (continuous sweep-fill karaoke -- secondary-color base + primary-color
// overlay clipped to the sampled per-frame fraction via the same
// CompositeGroup+destination-in mask mechanism as \clip, see
// _renderKaraoke), \ko (approximated as an instant color swap, not a true
// outline-only sweep -- see _renderKaraoke for the scope-management
// reasoning).
// Supported (v2): \p<n> drawing-mode dialogue lines (m/l/b/s/p/c mini-
// language, via ass_loader.ts's parseDrawingCommands + svg_path.ts's
// subpathsToVMobject, reused verbatim) -- see _renderDrawing. A drawing
// run's own (0,0) origin maps directly to the line's \pos/alignment anchor
// point (a documented simplification of the real alignment-vs-bbox
// interaction libass uses; the overwhelming majority of real \p content
// pairs \an7+\pos for exactly this top-left-origin placement anyway).
// NOT yet implemented (recognized, silently skipped -- warned once by tag
// name): vector-drawing \clip/\iclip (the drawing PARSER this needs now
// exists via v2, but wiring it into the clip-mask path is still open),
// \pbo. Unsupported features never throw.

import { Group, CompositeGroup } from "./Mobject.ts";
import type { Mobject } from "./Mobject.ts";
import { Text } from "./text/Text.ts";
import { Rectangle } from "./geometry.ts";
import { VMobject } from "./VMobject.ts";
import { subpathsToVMobject } from "./svg_path.ts";
import {
  parseASS,
  tokenizeOverrideText,
  resolveLineRuns,
  evalLineOpacity,
  evalClipRect,
  evalKaraoke,
  extractKaraokeSyllables,
  hasKaraokeTags,
  alignmentAnchorFraction,
  parseDrawingCommands,
} from "../loaders/ass_loader.ts";
import type { ASSScript, ASSStyle, ASSEvent, ASSToken, ResolvedRun, ResolvedRunStyle, ClipRect } from "../loaders/ass_loader.ts";

export interface ASSConfig {
  /** World-unit fit (like LottieConfig) -- default ~10 units wide. */
  width?: number;
  height?: number;
  /** attachTo clock multiplier (default 1). No `loop` option -- subtitles have a natural non-looping end (durationMs). */
  speed?: number;
  /** Resolve an ASS style's FontName to a font ecmanim can actually load; falsy/undefined falls back to the default font (warned once per distinct missing name). */
  fontResolver?: (styleFontName: string) => string | undefined;
}

// Tags known to the loader but not yet rendered at this stage -- used only
// to produce an accurate "not yet supported" warning instead of silently
// doing nothing with no explanation.
const NOT_YET_SUPPORTED_TAGS = new Set(["pbo"]);

interface CueState {
  event: ASSEvent;
  tokens: ASSToken[];
  style: ASSStyle;
  karaoke: boolean;
  outer: Group;
}

export function loadASS(assText: string, config: ASSConfig = {}): ASSMobject {
  return new ASSMobject(parseASS(assText), config);
}

export class ASSMobject extends Group {
  readonly warnings: string[] = [];
  readonly resX: number;
  readonly resY: number;
  /** Duration in ms: the last event's end time. */
  readonly durationMs: number;
  speed: number;

  private _script: ASSScript;
  private _cues: CueState[] = [];
  private _k: number; // pixel -> world scale
  private _clock = 0;
  private readonly _fontResolver?: (name: string) => string | undefined;
  private readonly _warnedFonts = new Set<string>();

  constructor(script: ASSScript, config: ASSConfig = {}) {
    super();
    this._script = script;
    this.resX = script.info.playResX;
    this.resY = script.info.playResY;
    this.speed = config.speed ?? 1;
    this._fontResolver = config.fontResolver;
    this.durationMs = script.events.reduce((m, e) => (e.isComment ? m : Math.max(m, e.endMs)), 0);

    const w = this.resX || 1;
    const h = this.resY || 1;
    if (config.width != null && config.height != null) {
      this._k = Math.min(config.width / w, config.height / h);
    } else if (config.width != null) {
      this._k = config.width / w;
    } else if (config.height != null) {
      this._k = config.height / h;
    } else {
      this._k = 10 / w;
    }

    this._buildCues();
    this.setTime(0);
  }

  // --- public API ------------------------------------------------------------

  /** Pose every cue at `tMs` -- a pure function of the script. Same tMs in, same world geometry out, in any call order. */
  setTime(tMs: number): this {
    for (const cue of this._cues) {
      const visible = tMs >= cue.event.startMs && tMs < cue.event.endMs;
      if (!visible) {
        if (cue.outer.submobjects.length) cue.outer.submobjects = [];
        continue;
      }
      cue.outer.submobjects = this._renderCue(cue, tMs);
    }
    return this;
  }

  /** Pose at frame `f` (`setTime((f / fps) * 1000)`). */
  setFrame(f: number, fps = 30): this {
    return this.setTime((f / fps) * 1000);
  }

  attachTo(scene: { add(...mobs: Mobject[]): unknown }): this {
    this.addUpdater((_m: Mobject, dt: number) => {
      this._clock += dt * 1000 * this.speed;
      this.setTime(Math.min(this._clock, this.durationMs));
    });
    scene.add(this);
    return this;
  }

  cues(): string[] {
    return this._cues.map((c, i) => {
      const { startMs, endMs, style } = c.event;
      const preview = c.event.text.replace(/\{[^}]*\}/g, "").slice(0, 40);
      return `[${i}] ${fmtMs(startMs)}–${fmtMs(endMs)} Style=${style}: ${preview}`;
    });
  }

  cue(index: number): Mobject | undefined {
    return this._cues[index]?.outer;
  }

  styles(): string[] {
    return Array.from(this._script.styles.keys());
  }

  style(name: string): ASSStyle | undefined {
    return this._script.styles.get(name);
  }

  // --- warnings ----------------------------------------------------------------

  private _warn(msg: string): void {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }

  // --- static structure (decided once) ------------------------------------------

  private _buildCues(): void {
    const dialogue = this._script.events
      .map((event, fileOrder) => ({ event, fileOrder }))
      .filter((e) => !e.event.isComment)
      .sort((a, b) => a.event.layer - b.event.layer || a.fileOrder - b.fileOrder);

    for (const { event } of dialogue) {
      const style = this._script.styles.get(event.style) ?? this._script.styles.get("Default")!;
      const tokens = tokenizeOverrideText(event.text);
      const outer = new Group();
      this._cues.push({ event, tokens, style, karaoke: hasKaraokeTags(tokens), outer });
      this.add(outer);
      this._warnUnsupportedTags(tokens);
    }
  }

  private _warnUnsupportedTags(tokens: ASSToken[]): void {
    for (const tok of tokens) {
      if (tok.type === "tag" && NOT_YET_SUPPORTED_TAGS.has(tok.name)) {
        this._warn(`\\${tok.name} is recognized but not yet implemented -- ignored`);
      }
    }
    if (evalClipRect(tokens).vectorFormPresent) {
      this._warn("\\clip/\\iclip with a vector-drawing shape is not yet implemented -- only the rectangular form is; ignored");
    }
  }

  // --- per-frame geometry (rebuilt from scratch every call) ---------------------

  private _renderCue(cue: CueState, tMs: number): Mobject[] {
    const { event, tokens, style } = cue;
    const lineDurMs = Math.max(1, event.endMs - event.startMs);
    const opacity = evalLineOpacity(tokens, tMs, event.startMs, lineDurMs);
    const runs = resolveLineRuns(tokens, style, this._script.styles, tMs, event.startMs, lineDurMs);

    let mobs = runs.some((r) => r.style.drawScale > 0)
      ? this._renderDrawing(runs, event, style)
      : cue.karaoke
      ? this._renderKaraoke(cue, tMs, runs[0]?.style ?? styleDefaults(style))
      : this._renderRuns(runs, event, style);

    for (const m of mobs) m.opacity = (m.opacity ?? 1) * opacity;

    const { rect } = evalClipRect(tokens);
    if (rect) mobs = [this._clipMask(mobs, rect)];
    return mobs;
  }

  // World-unit font size a ResolvedRunStyle should actually be measured/rendered
  // at -- ASS font sizes are PlayRes pixels, so this must go through the same
  // pixel->world scale (_k) everywhere a width/height gets measured or a Text
  // mobject gets constructed, or layout math and rendered glyphs will disagree.
  private _worldFontSize(style: Pick<ResolvedRunStyle, "fontSize">): number {
    return style.fontSize * this._k;
  }

  // \bord/\shad/\blur/\be values are PlayRes pixels, but Mobject.strokeWidth/
  // blur()/dropShadow() all live in the "roughly px at 1080p" reference space
  // strokeScale() (src/renderer/CanvasRenderer.ts) later converts to actual
  // output pixels -- NOT world units, despite every other pixel-valued ASS
  // field on this class (_worldFontSize, _worldX/_worldY) going through the
  // world-unit scale `_k`. Scaling these three by `_k` instead (an earlier,
  // uncaught bug in this file) put border/shadow/blur into WORLD-unit-sized
  // numbers a thousandfold too small once strokeScale() then shrank them
  // again -- border invisible, shadow/blur imperceptible even at extreme
  // ASS values. This mirrors lottie_mobject.ts's STROKE_PX_PER_WORLD_UNIT
  // precedent (= 1080/8, the same "reference height" idea) but keyed off the
  // script's own PlayResY instead of a world frame height, since there's no
  // world-unit hop in between for this conversion.
  private _refPx(playResPx: number): number {
    return playResPx * (1080 / (this.resY || 1));
  }

  private _worldX(px: number): number {
    return this._k * (px - this.resX / 2);
  }

  private _worldY(py: number): number {
    return -this._k * (py - this.resY / 2);
  }

  // Uses a straight lerp between the two margin-inset edges (rather than a
  // 3-way ternary on the fraction) specifically because a ternary chain here
  // already produced a real, hard-to-spot bug once (ax===1/ay===1 briefly
  // mislabeled as the CENTER case instead of the right/top case, sending
  // \an2's default center anchor to the right edge -- caught only via an
  // actual rendered still, not the object-graph smoke test).
  private _marginAnchor(event: ASSEvent, style: ASSStyle, alignment: number): [number, number] {
    const [ax, ay] = alignmentAnchorFraction(alignment); // ax: 0=left,0.5=center,1=right; ay: 0=bottom,0.5=middle,1=top
    const mL = event.marginL > 0 ? event.marginL : style.marginL;
    const mR = event.marginR > 0 ? event.marginR : style.marginR;
    const mV = event.marginV > 0 ? event.marginV : style.marginV;
    const pxX = mL + (this.resX - mR - mL) * ax;
    const pxYBottom = this.resY - mV; // ay=0
    const pxYTop = mV; // ay=1
    const pxY = pxYBottom + (pxYTop - pxYBottom) * ay;
    return [this._worldX(pxX), this._worldY(pxY)];
  }

  // Rectangular \clip(x1,y1,x2,y2) / \iclip(...): wrap the cue's content in a
  // CompositeGroup with a Rectangle mask, VERBATIM the same mechanism
  // LottieMobject uses for masks/mattes (a mask VMobject's
  // compositeOperation set to "destination-in"/"destination-out", added
  // alongside the target inside a CompositeGroup) -- no new renderer code.
  private _clipMask(content: Mobject[], rect: ClipRect): Mobject {
    const left = this._worldX(Math.min(rect.x1, rect.x2));
    const right = this._worldX(Math.max(rect.x1, rect.x2));
    const top = this._worldY(Math.min(rect.y1, rect.y2)); // smaller pixel Y -> larger world Y
    const bottom = this._worldY(Math.max(rect.y1, rect.y2));
    const mask = new Rectangle({
      width: Math.max(0, right - left),
      height: Math.max(0, top - bottom),
      point: [(left + right) / 2, (top + bottom) / 2, 0],
      fillColor: "#FFFFFF", fillOpacity: 1, strokeWidth: 0,
    });
    mask.compositeOperation = rect.invert ? "destination-out" : "destination-in";
    return new CompositeGroup(new Group(...content), mask);
  }

  // Left edge (world X) of a `totalW`-wide line so that the horizontal
  // alignment fraction `ax` (0=left, 0.5=center, 1=right, from
  // alignmentAnchorFraction) lands the line correctly relative to anchorX.
  private _lineLeftX(anchorX: number, totalW: number, ax: number): number {
    return anchorX - totalW * ax;
  }

  // Non-karaoke path: greedy word-wrap across styled runs (wrap boundaries
  // are between runs/words only -- wrapping mid-run is a documented v1
  // simplification), then position the whole block per \pos/\move or the
  // default alignment+margin rule.
  private _renderRuns(runs: ResolvedRun[], event: ASSEvent, baseStyle: ASSStyle): Mobject[] {
    if (runs.length === 0) return [];
    const alignment = runs[0].style.alignment;
    const posOverride = runs.find((r) => r.style.posOverride)?.style.posOverride ?? null;

    // Expand into hard-broken lines of {text, style} words: \N always breaks;
    // \n breaks only under WrapStyle 2 (otherwise treated as a plain space).
    type Word = { text: string; style: ResolvedRunStyle };
    const breakOnLowerN = this._script.info.wrapStyle === 2;
    const lines: Word[][] = [[]];
    for (const run of runs) {
      const normalized = breakOnLowerN ? run.text : run.text.replace(/\\n/g, " ");
      const pieces = normalized.split(/\\N|\\n/);
      pieces.forEach((piece, i) => {
        if (i > 0) lines.push([]);
        for (const word of piece.split(/\s+/)) {
          if (word !== "") lines[lines.length - 1].push({ text: word, style: run.style });
        }
      });
    }

    // Measure-then-position: estimateTextSize is only an APPROXIMATION (its
    // own doc warns it can disagree with a real constructed mobject's width
    // by ~10%+, especially off the default/fallback font) -- close enough
    // for the earlier synthetic-fixture-count check, but not for word
    // spacing, where that error visibly closes the gap between words. Build
    // every word's mobject at the origin first, measure its REAL
    // getWidth()/getHeight(), compute layout from those real numbers, then
    // moveTo() each into its final position.
    interface Placed { word: Word; mob: Mobject; w: number; h: number; spaceAfter: number }
    // Per-word-size space width, not one shared style-default width: a
    // mid-line \fs/\fscx override changes THAT word's own rendered size, and
    // reusing the line's base style size for the gap after it silently
    // closes the intended space (this bit the earlier \fs90 fixture).
    const spaceWCache = new Map<number, number>();
    const spaceWFor = (worldFs: number): number => {
      const key = Math.round(worldFs * 1000);
      let w = spaceWCache.get(key);
      if (w == null) { w = new Text(" ", { fontSize: worldFs }).getWidth(); spaceWCache.set(key, w); }
      return w;
    };
    const placedLines: Placed[][] = lines.map((line) =>
      line.map((word) => {
        const mob = this._buildRunText(word.text, word.style, [0, 0, 0]);
        return { word, mob, w: mob.getWidth(), h: mob.getHeight(), spaceAfter: spaceWFor(this._worldFontSize(word.style)) };
      }),
    );
    const baseFs = this._worldFontSize({ fontSize: baseStyle.fontSize });
    const lineHeights = placedLines.map((line) => (line.length ? Math.max(...line.map((p) => p.h)) * 1.2 : baseFs * 1.2));
    const blockH = lineHeights.reduce((a, b) => a + b, 0) || baseFs * 1.2;

    const [ax, ay] = alignmentAnchorFraction(alignment);
    let anchorX: number, anchorY: number;
    if (posOverride) {
      [anchorX, anchorY] = [this._worldX(posOverride[0]), this._worldY(posOverride[1])];
    } else {
      [anchorX, anchorY] = this._marginAnchor(event, baseStyle, alignment);
    }

    // topEdge: world Y of the top of the whole block, derived from which
    // edge/center the alignment anchor actually pins (ay=1 top-anchored: the
    // block starts exactly at the anchor; ay=0 bottom-anchored: the anchor is
    // the block's bottom, so the top is blockH above it; ay=0.5: centered).
    const topEdge = anchorY + blockH * (1 - ay);

    const mobs: Mobject[] = [];
    let rowTop = topEdge;
    placedLines.forEach((line) => {
      const lh = line.length ? Math.max(...line.map((p) => p.h)) * 1.2 : baseFs * 1.2;
      const rowCenterY = rowTop - lh / 2;
      const totalW = line.reduce((s, p, i) => s + p.w + (i < line.length - 1 ? p.spaceAfter : 0), 0);
      let x = this._lineLeftX(anchorX, totalW, ax);
      for (const p of line) {
        p.mob.moveTo([x + p.w / 2, rowCenterY, 0]);
        this._applyOrgTransform(p.mob, p.word.style);
        mobs.push(p.mob);
        x += p.w + p.spaceAfter;
      }
      rowTop -= lh;
    });
    return mobs;
  }

  // \p<n> drawing-mode dialogue lines (fansub sign/logo redraws): each
  // drawing run's own (0,0) origin is built at world [0,0,0] first (mirrors
  // _buildRunText's "rotate about local origin, then shift into place"
  // two-phase order, so \frz/\fax/\fay with no \org pivot about the
  // drawing's own origin exactly like a no-org text run pivots about its
  // own placement point), then shifted to the line's \pos/alignment anchor.
  // A plain-text run mixed into a \p line (rare -- most real content is a
  // drawing run alone) is simply skipped, not rendered as text; that
  // mixed-content case isn't supported at this stage.
  private _renderDrawing(runs: ResolvedRun[], event: ASSEvent, baseStyle: ASSStyle): Mobject[] {
    const mobs: Mobject[] = [];
    for (const run of runs) {
      if (run.style.drawScale <= 0) continue;
      const subpaths = parseDrawingCommands(run.text, run.style.drawScale);
      if (subpaths.length === 0) continue;

      const vm = new VMobject({
        fillColor: run.style.primary, fillOpacity: run.style.primary.a,
        strokeColor: run.style.outline,
        strokeWidth: this._refPx(run.style.borderWidth),
        strokeOpacity: run.style.borderWidth > 0 ? run.style.outline.a : 0,
      });
      // scale by _k (PlayRes px -> world units, same scale every other
      // pixel-valued field on this class uses) and flip Y (ASS drawing
      // space is Y-down like SVG; ecmanim world space is Y-up).
      subpathsToVMobject(vm, subpaths, { scale: this._k, flipY: true });

      if (!run.style.orgOverride) {
        if (run.style.angle) vm.rotate((run.style.angle * Math.PI) / 180);
        if (run.style.shearX || run.style.shearY) vm.applyMatrix([[1, run.style.shearX], [run.style.shearY, 1]]);
      }
      if (run.style.blurRadius > 0) vm.blur(this._refPx(run.style.blurRadius));

      let anchorX: number, anchorY: number;
      if (run.style.posOverride) [anchorX, anchorY] = [this._worldX(run.style.posOverride[0]), this._worldY(run.style.posOverride[1])];
      else [anchorX, anchorY] = this._marginAnchor(event, baseStyle, run.style.alignment);
      vm.shift([anchorX, anchorY, 0]);
      this._applyOrgTransform(vm, run.style);
      mobs.push(vm);
    }
    return mobs;
  }

  // \org(x,y)-pivoted rotation/shear: must run AFTER the mobject's final
  // moveTo(), since \org is an absolute PlayRes point, not relative to the
  // not-yet-placed mobject _buildRunText() constructs.
  private _applyOrgTransform(mob: Mobject, style: ResolvedRunStyle): void {
    if (!style.orgOverride || (!style.angle && !style.shearX && !style.shearY)) return;
    const aboutPoint = [this._worldX(style.orgOverride[0]), this._worldY(style.orgOverride[1]), 0];
    if (style.angle) mob.rotate((style.angle * Math.PI) / 180, { aboutPoint });
    if (style.shearX || style.shearY) mob.applyMatrix([[1, style.shearX], [style.shearY, 1]], { aboutPoint });
  }

  private _buildRunText(text: string, style: ResolvedRunStyle, at: number[]): Mobject {
    const font = this._resolveFont(style.fontName);
    // NOTE: Text's constructor `weight`/`slant` fields are stored but never
    // actually applied to glyph outlines (confirmed by reading
    // text_shaping.ts/buildGlyphRun -- neither is referenced there at all).
    // Bold/italic only have a visible effect through the t2w/t2s SUBSTRING
    // MAPS (stroke-based bold emulation, shear-based italic emulation) --
    // route through those instead, mapping the run's own text to itself.
    // Known interaction: t2w's bold emulation unconditionally sets each
    // glyph's strokeColor to its fillColor, so a run with BOTH \b1 and a
    // custom \3c outline color will show the bold-emulation color, not the
    // custom outline color -- a real but narrow v1 approximation inherited
    // from how Text itself emulates bold without a real bold font face.
    const t = new Text(text, {
      fontSize: this._worldFontSize(style),
      ...(font ? { font } : {}),
      ...(style.bold ? { t2w: { [text]: "bold" } } : {}),
      ...(style.italic ? { t2s: { [text]: "italic" } } : {}),
      fillColor: style.primary,
      fillOpacity: style.primary.a,
      strokeColor: style.outline,
      strokeWidth: this._refPx(style.borderWidth),
      strokeOpacity: style.borderWidth > 0 ? style.outline.a : 0,
      align: "center",
      point: at,
    });
    if (style.shadowDepth > 0) {
      t.dropShadow({ color: style.back, offsetX: this._refPx(style.shadowDepth), offsetY: -this._refPx(style.shadowDepth) });
    }
    if (style.blurRadius > 0) t.blur(this._refPx(style.blurRadius));
    // Rotation/shear about the run's own bbox center (the default, no-\org
    // case) can be applied right here at construction time -- it commutes
    // correctly with the later moveTo() either way. \org-pivoted rotation
    // needs the run's FINAL on-screen position (org is an absolute PlayRes
    // point, not relative to this not-yet-placed mobject), so that case is
    // deferred to _applyOrgTransform(), called by the caller after moveTo().
    if (!style.orgOverride) {
      if (style.angle) t.rotate((style.angle * Math.PI) / 180);
      if (style.shearX || style.shearY) t.applyMatrix([[1, style.shearX], [style.shearY, 1]]);
    }
    if (!style.underline && !style.strikeOut) return t;

    const w = t.getWidth();
    const h = t.getHeight();
    const deco = new Rectangle({
      width: w,
      height: Math.max(0.002, this._worldFontSize(style) * 0.05),
      fillColor: style.primary,
      fillOpacity: style.primary.a,
      strokeWidth: 0,
      point: [at[0], at[1] + (style.underline ? -h * 0.45 : 0), 0],
    });
    return new Group(t, deco);
  }

  private _resolveFont(styleFontName: string): string | undefined {
    const resolved = this._fontResolver?.(styleFontName);
    if (resolved) return resolved;
    if (!this._warnedFonts.has(styleFontName)) {
      this._warnedFonts.add(styleFontName);
      this._warn(`font "${styleFontName}" not resolved -- falling back to the default font`);
    }
    return undefined;
  }

  // Karaoke path: one Text per syllable, active/inactive color swaps
  // INSTANTLY at the syllable boundary (a true step function, per \k's spec
  // -- NOT eased like WordCaptionTrack's TikTok-style pop, which this
  // deliberately doesn't reuse for that reason even though the underlying
  // coloring pattern is the same shape).
  private _renderKaraoke(cue: CueState, tMs: number, style: ResolvedRunStyle): Mobject[] {
    const syllables = extractKaraokeSyllables(cue.tokens);
    if (syllables.length === 0) return [];
    const { index: activeIndex, fraction } = evalKaraoke(syllables, tMs, cue.event.startMs);

    const [anchorX, anchorY] = this._marginAnchor(cue.event, cue.style, style.alignment);
    const [ax] = alignmentAnchorFraction(style.alignment);

    // Same measure-then-position discipline as _renderRuns: build each
    // syllable's mobject at the origin, measure its REAL width, then place
    // syllables flush against each other -- NO extra injected gap. Real ASS
    // karaoke syllables carry their own spacing in the syllable text itself
    // when a word boundary needs one (e.g. "{\k30}one {\k40}two"); a
    // word-internal syllable split (e.g. "{\k50}ka{\k50}ra") has none on
    // purpose. Adding a spaceW unconditionally between every syllable (as
    // _renderRuns does between WRAPPED WORDS, a different situation) would
    // double-space every syllable that already ends in a space.
    //
    // \k/\ko: instant color swap the moment a syllable becomes active (\ko
    // is approximated as an instant swap too, not a true outline-only sweep
    // -- real-world \ko usage is rare enough that a full second sweep
    // pipeline for outline-vs-fill isn't worth it at this stage; \kf/\K get
    // the real continuous sweep, being the overwhelmingly common case).
    // \kf/\K (normalized to "kf" by the loader): the ACTIVE syllable gets a
    // continuous sweep -- a SECONDARY-colored base plus a PRIMARY-colored
    // overlay clipped to `fraction` of the syllable's own width via the same
    // CompositeGroup+Rectangle destination-in mechanism _clipMask uses for
    // \clip, composing the existing clip primitive with the already-computed
    // per-frame `fraction` (no separate KeyframeTrack/tween instance needed
    // -- this whole class already evaluates everything as a pure function of
    // tMs, so `fraction` IS that sampled value).
    const built = syllables.map((syl, i) => {
      if (i === activeIndex && syl.kind === "kf") {
        const base = this._buildRunText(syl.text, { ...style, primary: style.secondary }, [0, 0, 0]);
        const w = base.getWidth();
        if (fraction <= 0) return { mob: base, w };
        const overlay = this._buildRunText(syl.text, { ...style, primary: style.primary }, [0, 0, 0]);
        if (fraction >= 1) return { mob: overlay, w };
        const h = overlay.getHeight();
        const sweepW = w * fraction;
        const mask = new Rectangle({
          width: sweepW, height: h * 1.5,
          point: [-w / 2 + sweepW / 2, 0, 0], // left-aligned within the syllable's own (origin-centered) bbox
          fillColor: "#FFFFFF", fillOpacity: 1, strokeWidth: 0,
        });
        mask.compositeOperation = "destination-in";
        const clippedOverlay = new CompositeGroup(overlay, mask);
        return { mob: new Group(base, clippedOverlay), w };
      }
      const active = i <= activeIndex;
      const color = active ? style.primary : style.secondary;
      const mob = this._buildRunText(syl.text, { ...style, primary: color }, [0, 0, 0]);
      return { mob, w: mob.getWidth() };
    });
    const totalW = built.reduce((s, b) => s + b.w, 0);
    let x = this._lineLeftX(anchorX, totalW, ax);

    const mobs: Mobject[] = [];
    for (const b of built) {
      b.mob.moveTo([x + b.w / 2, anchorY, 0]);
      this._applyOrgTransform(b.mob, style);
      mobs.push(b.mob);
      x += b.w;
    }
    return mobs;
  }
}

function fmtMs(ms: number): string {
  const totalCs = Math.round(ms / 10);
  const cs = totalCs % 100;
  const totalS = Math.floor(totalCs / 100);
  const s = totalS % 60;
  const totalM = Math.floor(totalS / 60);
  const m = totalM % 60;
  const h = Math.floor(totalM / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function styleDefaults(style: ASSStyle): ResolvedRunStyle {
  return {
    fontName: style.fontName, fontSize: style.fontSize, bold: style.bold, italic: style.italic,
    underline: style.underline, strikeOut: style.strikeOut,
    primary: style.primaryColor, secondary: style.secondaryColor, outline: style.outlineColor, back: style.backColor,
    scaleX: style.scaleX, scaleY: style.scaleY, angle: style.angle,
    borderWidth: style.outline, shadowDepth: style.shadow,
    posOverride: null, orgOverride: null, shearX: 0, shearY: 0, blurRadius: 0, alignment: style.alignment,
    drawScale: 0,
  };
}
