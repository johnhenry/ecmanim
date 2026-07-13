// ASS/SSA export (caption/typography-layer interchange, NOT a general
// ecmanim-scene-to-.ass exporter -- same disclaimer interchange/lottie.ts's
// own header states for its "static geometry" scope, applied here to
// "caption timing/color/text"). ASS's animation vocabulary has no
// equivalent for ecmanim's spring dynamics, custom rate functions,
// TransformMatchingAuto's point-correspondence morphing, or 3D/mesh
// content -- wordCaptionTrackToAss only ever needs to round-trip caption
// timing/color/text, which IS fully representable as \k karaoke.
//
// wordCaptionTrackToAss(track, config?): WordCaptionTrack's existing
// per-token {fromMs, toMs, text} state (itself sourced from
// createTikTokStyleCaptions()/voiceover()'s word timing) is arithmetically
// close to exactly what ASS \k karaoke needs (ms -> centiseconds, hex color
// BGR-reorder) -- no new animation math, just a serializer over data
// ecmanim already computes. Produces a small, portable, human-editable
// .ass file: plays synced karaoke captions over the RAW, unburned ecmanim
// mp4 in any libass-capable player (mpv/VLC/browsers via JASSUB) -- a real
// soft-subtitle deliverable ecmanim doesn't otherwise have (captions are
// burn-in only) -- and hands off cleanly to Aegisub for manual polish
// without touching ecmanim or re-rendering.
//
// WordCaptionTrack doesn't expose its internal styling (base/active Color
// instances, fontSize) as public fields, so this module's own
// AssExportConfig carries the export-time style choices instead of reading
// them off the track.
//
// vmobjectToAssDrawing(shape, config?): extends the same "static-geometry,
// not general animation" scope to a single static VMobject (a title card,
// an icon, a simple logo) -- mirrors vmobjectToLottieShapes's role almost
// exactly (same subpath walk via VMobject.getSubpaths(), which happens to
// already be in the EXACT flat-point-list shape parseDrawingCommands/
// parsePathToSubpaths use, so this is the inverse serializer of that same
// shape), just producing ASS \p-mode drawing-command text instead of a
// Lottie shape object. Explicitly NOT "export any ecmanim animation" --
// ASS interpolates TAG PARAMETERS (affine transforms of one fixed path),
// never vertex-by-vertex path morphing, so only a single static shape
// round-trips; anything using PointCloud/TransformMatchingAuto morphing
// has no ASS equivalent at all.

import { Color } from "../core/color.ts";
import type { ColorLike } from "../core/types.ts";
import type { WordCaptionTrack } from "../captions/caption_track.ts";
import type { VMobject } from "../mobject/VMobject.ts";

export interface AssExportConfig {
  /** [Script Info] resolution the exported Dialogue coordinates are relative to (default 1920x1080). */
  playResX?: number;
  playResY?: number;
  fontName?: string;
  /** PlayRes-pixel font size (default 64). */
  fontSize?: number;
  /** "Already sung" karaoke color (default white). */
  primaryColor?: ColorLike;
  /** "Not yet sung" karaoke color (default a warm yellow, the common fansub convention). */
  secondaryColor?: ColorLike;
  outlineColor?: ColorLike;
  /** ASS numpad alignment (default 2, bottom-center). */
  alignment?: number;
  marginV?: number;
  styleName?: string;
}

// ASS colors are &HBBGGRR& (BGR byte order, no alpha byte needed on a Style
// line) -- the mirror image of parseAssColor's decode in ass_loader.ts.
function formatAssColorBGR(color: ColorLike): string {
  const c = Color.parse(color);
  const to255 = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return `&H${hex(to255(c.b))}${hex(to255(c.g))}${hex(to255(c.r))}&`;
}

// The mirror image of parseAssTime's decode: ms -> "H:MM:SS.CC".
function formatAssTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.round((t % 1000) / 10);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${h}:${p2(m)}:${p2(s)}.${p2(cs)}`;
}

// {, }, and \ are ASS override-block syntax -- real caption text has no
// legitimate use for literal braces/backslashes, so dropping them outright
// (rather than trying to escape them, which ASS has no mechanism for) is a
// safe, simple way to guarantee the emitted Dialogue line can't be corrupted
// by caption text that happens to contain them.
function sanitizeAssText(text: string): string {
  return text.replace(/[{}\\]/g, "");
}

/**
 * Serialize a WordCaptionTrack's word-timed pages to a karaoke `.ass`
 * script: one `Dialogue:` line per page, one `\k<centiseconds>` syllable per
 * token, using the token's OWN text (including any inherent word-boundary
 * spacing) verbatim (sanitized).
 */
export function wordCaptionTrackToAss(track: WordCaptionTrack, config: AssExportConfig = {}): string {
  const {
    playResX = 1920, playResY = 1080,
    fontName = "Arial", fontSize = 64,
    primaryColor = "#FFFFFF", secondaryColor = "#FFE066", outlineColor = "#000000",
    alignment = 2, marginV = 60, styleName = "Default",
  } = config;

  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: ${styleName},${fontName},${fontSize},${formatAssColorBGR(primaryColor)},${formatAssColorBGR(secondaryColor)},${formatAssColorBGR(outlineColor)},&H00000000,0,0,0,0,100,100,0,0,1,2,0,${alignment},10,10,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  for (const page of track.pages) {
    const tokens = page.tokens.filter((t) => t.text.trim().length > 0);
    if (tokens.length === 0) continue;
    const startMs = tokens[0].fromMs;
    const endMs = tokens[tokens.length - 1].toMs;
    const body = tokens
      .map((t) => `{\\k${Math.max(0, Math.round((t.toMs - t.fromMs) / 10))}}${sanitizeAssText(t.text)}`)
      .join("");
    lines.push(`Dialogue: 0,${formatAssTime(startMs)},${formatAssTime(endMs)},${styleName},,0,0,0,,${body}`);
  }

  return lines.join("\n") + "\n";
}

export interface AssDrawingExportConfig {
  playResX?: number;
  playResY?: number;
  /** PlayRes pixels per ecmanim world unit (default 100). */
  scale?: number;
  /** Where the shape's own center lands, in PlayRes pixels (default: PlayRes center). */
  pos?: [number, number];
  /** How long the drawing's Dialogue line is shown, in ms (default 5000). */
  durationMs?: number;
  styleName?: string;
  fontName?: string;
}

// Serialize a VMobject's cubic-Bezier subpaths (VMobject.getSubpaths(),
// already in the exact flat [anchor, c1,c2,end, ...] shape
// parseDrawingCommands/parsePathToSubpaths use) to ASS \p drawing-command
// text: "m x y" for each subpath's anchor, "b c1x c1y c2x c2y ex ey" for
// each cubic segment. No explicit close command -- ASS (like SVG) fills a
// subpath as implicitly closed, the same convention _renderDrawing's own
// import path already relies on.
function subpathsToDrawingCommands(subpaths: number[][][], scale: number, flipY: boolean): string {
  const sy = flipY ? -scale : scale;
  const n = (v: number): string => String(Math.round(v * 100) / 100);
  const parts: string[] = [];
  for (const sp of subpaths) {
    if (sp.length < 1) continue;
    parts.push(`m ${n(sp[0][0] * scale)} ${n(sp[0][1] * sy)}`);
    const nc = Math.floor((sp.length - 1) / 3);
    if (nc > 0) {
      const bez: string[] = [];
      for (let k = 0; k < nc; k++) {
        const c1 = sp[3 * k + 1], c2 = sp[3 * k + 2], end = sp[3 * k + 3];
        bez.push(`${n(c1[0] * scale)} ${n(c1[1] * sy)} ${n(c2[0] * scale)} ${n(c2[1] * sy)} ${n(end[0] * scale)} ${n(end[1] * sy)}`);
      }
      parts.push(`b ${bez.join(" ")}`);
    }
  }
  return parts.join(" ");
}

/**
 * Serialize a single static VMobject to a standalone `\p1` drawing-mode
 * `.ass` file: fill from the shape's own `fillColor`, stroke from
 * `strokeColor`+`strokeWidth`, centered in drawing-space on the shape's own
 * `getCenter()` (so `\pos` places the shape's visual center, matching how
 * most real \p content is authored) and Y-flipped (ecmanim world space is
 * Y-up, ASS drawing space is Y-down like SVG).
 */
export function vmobjectToAssDrawing(shape: VMobject, config: AssDrawingExportConfig = {}): string {
  const {
    playResX = 1920, playResY = 1080, scale = 100,
    pos = [playResX / 2, playResY / 2],
    durationMs = 5000, styleName = "Default", fontName = "Arial",
  } = config;

  const center = shape.getCenter();
  const subpaths = shape.getSubpaths().map((sp) => sp.map((p) => [p[0] - center[0], p[1] - center[1], 0]));
  const drawing = subpathsToDrawingCommands(subpaths, scale, true);

  const fillColor = formatAssColorBGR(shape.fillColor);
  const fillAlphaByte = Math.round((1 - shape.fillOpacity) * 255).toString(16).padStart(2, "0").toUpperCase();
  const outlineColor = formatAssColorBGR(shape.strokeColor);
  const borderWidth = Math.max(0, shape.strokeWidth);

  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: ${styleName},${fontName},50,${fillColor},&H0000FFFF&,${outlineColor},&H00000000,0,0,0,0,100,100,0,0,1,${borderWidth},0,7,10,10,10,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,${formatAssTime(0)},${formatAssTime(durationMs)},${styleName},,0,0,0,,{\\pos(${pos[0]},${pos[1]})\\an7\\alpha&H${fillAlphaByte}&\\p1}${drawing}{\\p0}`,
  ];
  return lines.join("\n") + "\n";
}
