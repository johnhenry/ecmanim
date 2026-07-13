// ASS/SSA subtitle loader — the PURE-MATH half of the ASS/SSA subtitle player.
// Everything in this module is a deterministic function of the script text:
// section parsing ([Script Info]/[V4+ Styles]/[Events]), color/time parsing,
// the override-tag tokenizer, and per-frame tag-evaluation math (fade/move/
// karaoke timing). No mobjects, no node: imports, no DOM — mirrors the split
// established by src/loaders/lottie_loader.ts (pure parsing+math) vs.
// src/mobject/ass_mobject.ts (mobject construction from these evaluations).
//
// Supported / approximated / not-yet-supported (v1 scope; see ass_mobject.ts
// for what actually consumes each of these, and CHANGELOG.md for the
// itemized per-stage feature list):
// - [Script Info]: PlayResX/PlayResY (default 384x288, the real ASS
//   default), WrapStyle (0-3), ScaledBorderAndShadow.
// - [V4+ Styles] (ASS) and legacy [V4 Styles] (SSA, alignment renumbered
//   from SSA's 1-11 scheme to ASS's 1-9 numpad scheme via a fixed table).
// - [Events]: Dialogue + Comment (skipped), Layer-ordered, Format-line-driven
//   column mapping (tolerant of reordered/missing trailing columns, since
//   `Text` is comma-greedy per the real format).
// - Override tags: \pos, \move, \an (+legacy \a), \fad, \fade, \c/\1c-\4c,
//   \alpha/\1a-\4a, \fscx, \fscy, \fs, \fn, \b, \i, \u, \s, \frz/\fr, \bord,
//   \shad, \k/\kf/\K/\ko (karaoke -- \K is a documented alias for \kf, see
//   KaraokeSyllable), \r/\r[Name] (style reset), \N/\n + WrapStyle,
//   \t(t1,t2,accel,tags) (numeric/color fields only -- see applyTransformTag),
//   rectangular \clip/\iclip(x1,y1,x2,y2) (see evalClipRect), \org
//   (explicit rotate/shear pivot), \fax/\fay (shear), \be/\blur.
// - Known-but-not-yet-implemented tags (vector-drawing \clip/\iclip, \p,
//   \pbo) are recognized (so warnings name the exact tag) but currently
//   skipped, not evaluated.
// - Unknown tags are tolerated silently at the tokenizer level; the
//   evaluator is what decides whether to warn (see ass_mobject.ts's _warn).
// - NEVER throws on malformed input except when there's no [Events] section
//   with at least one Dialogue: line at all -- same "throws only when
//   fundamentally not the format" contract as parseLottie.

import { Color } from "../core/color.ts";

// ---------------------------------------------------------------------------
// Script structure
// ---------------------------------------------------------------------------

export interface ASSScriptInfo {
  playResX: number;
  playResY: number;
  wrapStyle: 0 | 1 | 2 | 3;
  scaledBorderAndShadow: boolean;
  format: "ass" | "ssa";
}

export interface ASSStyle {
  name: string;
  fontName: string;
  fontSize: number;
  primaryColor: Color;
  secondaryColor: Color;
  outlineColor: Color;
  backColor: Color;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeOut: boolean;
  scaleX: number;
  scaleY: number;
  spacing: number;
  angle: number;
  borderStyle: number;
  outline: number;
  shadow: number;
  alignment: number; // ASS numpad 1-9 (legacy SSA remapped at parse time)
  marginL: number;
  marginR: number;
  marginV: number;
}

export interface ASSEvent {
  layer: number;
  startMs: number;
  endMs: number;
  style: string;
  name: string;
  marginL: number;
  marginR: number;
  marginV: number;
  effect: string;
  text: string; // raw, with {...} override blocks still inline
  isComment: boolean;
}

export interface ASSScript {
  info: ASSScriptInfo;
  styles: Map<string, ASSStyle>;
  events: ASSEvent[]; // Dialogue + Comment, file order (Layer used separately for z-order)
}

const DEFAULT_STYLE: Omit<ASSStyle, "name"> = {
  fontName: "Arial",
  fontSize: 20,
  primaryColor: new Color(1, 1, 1, 1),
  secondaryColor: new Color(1, 1, 0, 1),
  outlineColor: new Color(0, 0, 0, 1),
  backColor: new Color(0, 0, 0, 1),
  bold: false,
  italic: false,
  underline: false,
  strikeOut: false,
  scaleX: 100,
  scaleY: 100,
  spacing: 0,
  angle: 0,
  borderStyle: 1,
  outline: 2,
  shadow: 2,
  alignment: 2,
  marginL: 10,
  marginR: 10,
  marginV: 10,
};

// Legacy SSA alignment (1-11, split top/middle/bottom differently) -> ASS numpad (1-9).
const SSA_ALIGNMENT_TO_ASS: Record<number, number> = {
  1: 1, 2: 2, 3: 3,
  5: 7, 6: 8, 7: 9,
  9: 4, 10: 5, 11: 6,
};

/** "&HAABBGGRR&" / "&HBBGGRR" / "BBGGRR" -> Color (alpha nibble inverted: 00=opaque). */
export function parseAssColor(s: string): Color {
  const hex = s.trim().replace(/^&H/i, "").replace(/&$/, "");
  const n = parseInt(hex, 16);
  if (!Number.isFinite(n)) return new Color(1, 1, 1, 1);
  if (hex.length > 6) {
    const aa = (n >>> 24) & 0xff, bb = (n >>> 16) & 0xff, gg = (n >>> 8) & 0xff, rr = n & 0xff;
    return new Color(rr / 255, gg / 255, bb / 255, 1 - aa / 255);
  }
  const bb = (n >>> 16) & 0xff, gg = (n >>> 8) & 0xff, rr = n & 0xff;
  return new Color(rr / 255, gg / 255, bb / 255, 1);
}

/** "H:MM:SS.CC" -> milliseconds. */
export function parseAssTime(s: string): number {
  const m = s.trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!m) return 0;
  const [, h, mm, ss, cs] = m;
  return ((+h * 3600 + +mm * 60 + +ss) * 1000) + +cs * 10;
}

function parseInfoSection(lines: string[]): ASSScriptInfo {
  const kv = new Map<string, string>();
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    kv.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return {
    playResX: parseInt(kv.get("playresx") ?? "384", 10) || 384,
    playResY: parseInt(kv.get("playresy") ?? "288", 10) || 288,
    wrapStyle: (Math.max(0, Math.min(3, parseInt(kv.get("wrapstyle") ?? "0", 10) || 0)) as 0 | 1 | 2 | 3),
    scaledBorderAndShadow: (kv.get("scaledborderandshadow") ?? "yes").toLowerCase() !== "no",
    format: "ass",
  };
}

function num(s: string | undefined, fallback: number): number {
  const n = parseFloat(s ?? "");
  return Number.isFinite(n) ? n : fallback;
}

function bool(s: string | undefined, fallback: boolean): boolean {
  if (s == null || s === "") return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n !== 0 : fallback;
}

function parseStylesSection(lines: string[], isLegacySSA: boolean): Map<string, ASSStyle> {
  const styles = new Map<string, ASSStyle>();
  let format: string[] | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^Format:/i.test(line)) {
      format = line.slice(line.indexOf(":") + 1).split(",").map((s) => s.trim().toLowerCase());
      continue;
    }
    if (!/^Style:/i.test(line)) continue;
    const fields = line.slice(line.indexOf(":") + 1).split(",").map((s) => s.trim());
    const col = (name: string): string | undefined => {
      if (!format) return undefined;
      const idx = format.indexOf(name);
      return idx === -1 ? undefined : fields[idx];
    };
    const name = col("name") ?? fields[0] ?? "Default";
    let alignment = Math.round(num(col("alignment"), 2));
    if (isLegacySSA) alignment = SSA_ALIGNMENT_TO_ASS[alignment] ?? 2;
    const style: ASSStyle = {
      name,
      fontName: col("fontname") ?? DEFAULT_STYLE.fontName,
      fontSize: num(col("fontsize"), DEFAULT_STYLE.fontSize),
      primaryColor: parseAssColor(col("primarycolour") ?? col("primarycolor") ?? "&HFFFFFF&"),
      secondaryColor: parseAssColor(col("secondarycolour") ?? col("secondarycolor") ?? "&HFFFF00&"),
      outlineColor: parseAssColor(col("outlinecolour") ?? col("outlinecolor") ?? col("tertiarycolour") ?? "&H000000&"),
      backColor: parseAssColor(col("backcolour") ?? col("backcolor") ?? "&H000000&"),
      bold: bool(col("bold"), DEFAULT_STYLE.bold),
      italic: bool(col("italic"), DEFAULT_STYLE.italic),
      underline: bool(col("underline"), DEFAULT_STYLE.underline),
      strikeOut: bool(col("strikeout"), DEFAULT_STYLE.strikeOut),
      scaleX: num(col("scalex"), DEFAULT_STYLE.scaleX),
      scaleY: num(col("scaley"), DEFAULT_STYLE.scaleY),
      spacing: num(col("spacing"), DEFAULT_STYLE.spacing),
      angle: num(col("angle"), DEFAULT_STYLE.angle),
      borderStyle: num(col("borderstyle"), DEFAULT_STYLE.borderStyle),
      outline: num(col("outline"), DEFAULT_STYLE.outline),
      shadow: num(col("shadow"), DEFAULT_STYLE.shadow),
      alignment: alignment || DEFAULT_STYLE.alignment,
      marginL: num(col("marginl"), DEFAULT_STYLE.marginL),
      marginR: num(col("marginr"), DEFAULT_STYLE.marginR),
      marginV: num(col("marginv"), DEFAULT_STYLE.marginV),
    };
    styles.set(name, style);
  }
  return styles;
}

function parseEventsSection(lines: string[]): ASSEvent[] {
  const events: ASSEvent[] = [];
  let format: string[] | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^Format:/i.test(line)) {
      format = line.slice(line.indexOf(":") + 1).split(",").map((s) => s.trim().toLowerCase());
      continue;
    }
    const isComment = /^Comment:/i.test(line);
    if (!isComment && !/^Dialogue:/i.test(line)) continue;
    if (!format) continue; // no Format: line -- can't reliably map columns, skip tolerantly
    const rest = line.slice(line.indexOf(":") + 1);
    const textCol = format.indexOf("text");
    // Split only on the first (format.length - 1) commas; "Text" (always last) is comma-greedy.
    const parts: string[] = [];
    let cursor = 0;
    for (let i = 0; i < format.length - 1; i++) {
      const comma = rest.indexOf(",", cursor);
      if (comma === -1) break;
      parts.push(rest.slice(cursor, comma));
      cursor = comma + 1;
    }
    parts.push(rest.slice(cursor));
    const col = (name: string): string | undefined => {
      const idx = format!.indexOf(name);
      return idx === -1 ? undefined : parts[idx];
    };
    events.push({
      layer: Math.round(num(col("layer"), 0)),
      startMs: parseAssTime(col("start") ?? "0:00:00.00"),
      endMs: parseAssTime(col("end") ?? "0:00:00.00"),
      style: (col("style") ?? "Default").trim(),
      name: (col("name") ?? col("actor") ?? "").trim(),
      marginL: Math.round(num(col("marginl"), 0)),
      marginR: Math.round(num(col("marginr"), 0)),
      marginV: Math.round(num(col("marginv"), 0)),
      effect: (col("effect") ?? "").trim(),
      text: textCol === -1 ? "" : (parts[textCol] ?? ""),
      isComment,
    });
  }
  return events;
}

/** Parse a full .ass/.ssa script. Throws only when no usable [Events] section exists. */
export function parseASS(text: string): ASSScript {
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*\[(.+?)\]\s*$/);
    if (m) {
      current = [];
      sections.set(m[1].trim(), current);
      continue;
    }
    if (current) current.push(raw);
  }

  const isLegacySSA = sections.has("V4 Styles") && !sections.has("V4+ Styles");
  const info = parseInfoSection(sections.get("Script Info") ?? []);
  info.format = isLegacySSA ? "ssa" : "ass";
  const styles = parseStylesSection(sections.get("V4+ Styles") ?? sections.get("V4 Styles") ?? [], isLegacySSA);
  if (!styles.has("Default")) styles.set("Default", { name: "Default", ...DEFAULT_STYLE });
  const eventsLines = sections.get("Events") ?? [];
  const events = parseEventsSection(eventsLines);

  if (!events.some((e) => !e.isComment)) {
    throw new Error("parseASS: no [Events] Dialogue: lines found -- not a usable ASS/SSA script");
  }

  return { info, styles, events };
}

// ---------------------------------------------------------------------------
// Override-tag tokenizer
// ---------------------------------------------------------------------------

export type ASSToken =
  | { type: "text"; text: string }
  | { type: "tag"; name: string; args: string; raw: string };

// Longest-name-first so e.g. "frz" matches before "fr", "1c" before "c".
const KNOWN_TAGS = [
  "move", "fade", "clip", "iclip", "alpha",
  "fscx", "fscy", "frz", "fax", "fay", "bord", "shad", "blur",
  "pos", "fad", "org", "pbo",
  "1c", "2c", "3c", "4c", "1a", "2a", "3a", "4a",
  "fs", "fn", "fr", "be",
  "kf", "ko",
  "an", "a", "b", "i", "u", "s", "c", "k", "K", "r", "t", "p", "q",
].sort((a, b) => b.length - a.length);

// \fn and \r deliberately consume arbitrary trailing letters as their
// argument (a font name / a style name, e.g. "fnArial", "rMyStyle"). Every
// other tag's argument starts with a digit, "(", "&", or nothing -- so a
// SHORT known tag (b, i, u, s, c, r, k, a, ...) immediately followed by
// another letter is actually the start of a longer, unrecognized tag name
// (e.g. "unknowntag123" must not be misread as "u" + garbage args "nknown...
// tag123", which would silently turn on underline). Confirmed as a real bug
// via an actual rendered fixture, not a hypothetical -- see
// examples/ass-parity/fixtures/14-malformed-tolerant.ass.
const LETTER_ARG_TAGS = new Set(["fn", "r"]);

function matchTagName(chunk: string): { name: string; args: string } | null {
  for (const name of KNOWN_TAGS) {
    if (!chunk.startsWith(name)) continue;
    const rest = chunk.slice(name.length);
    if (!LETTER_ARG_TAGS.has(name) && /^[a-zA-Z]/.test(rest)) continue;
    return { name, args: rest };
  }
  return null;
}

// Splits one {...} override block into individual tag chunks on top-level
// backslashes (respecting paren depth, so "\move(1,2,3,4)" isn't split at
// its commas -- there are none to split on since we only split on "\").
function splitTagChunks(block: string): string[] {
  const chunks: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    if (c === "\\" && depth === 0) {
      if (cur) chunks.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Tokenize one Dialogue event's raw text into text runs + override tags. */
export function tokenizeOverrideText(rawText: string): ASSToken[] {
  const tokens: ASSToken[] = [];
  let i = 0;
  while (i < rawText.length) {
    if (rawText[i] === "{") {
      const close = rawText.indexOf("}", i);
      const block = close === -1 ? rawText.slice(i + 1) : rawText.slice(i + 1, close);
      for (const chunk of splitTagChunks(block)) {
        const m = matchTagName(chunk);
        if (m) tokens.push({ type: "tag", name: m.name, args: m.args, raw: chunk });
        // unrecognized chunks are silently dropped at the tokenizer level;
        // the evaluator layer decides what (if anything) to warn about.
      }
      i = close === -1 ? rawText.length : close + 1;
    } else {
      const next = rawText.indexOf("{", i);
      const end = next === -1 ? rawText.length : next;
      tokens.push({ type: "text", text: rawText.slice(i, end) });
      i = end;
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Tag-evaluation math (pure functions of time)
// ---------------------------------------------------------------------------

/** \fad(t1,t2): fade in over t1 ms, fade out over the last t2 ms. Returns an opacity multiplier. */
export function evalFad(t1: number, t2: number, tMs: number, lineDurMs: number): number {
  if (t1 > 0 && tMs < t1) return tMs / t1;
  if (t2 > 0 && tMs > lineDurMs - t2) return Math.max(0, (lineDurMs - tMs) / t2);
  return 1;
}

/** \fade(a1,a2,a3,t1,t2,t3,t4): piecewise-linear opacity through 3 alpha levels. Alphas are 0-255 (ASS convention); returns opacity 0..1. */
export function evalFade(
  a1: number, a2: number, a3: number,
  t1: number, t2: number, t3: number, t4: number,
  tMs: number,
): number {
  const o1 = 1 - a1 / 255, o2 = 1 - a2 / 255, o3 = 1 - a3 / 255;
  if (tMs < t1) return o1;
  if (tMs < t2) return o1 + (o2 - o1) * ((tMs - t1) / Math.max(1, t2 - t1));
  if (tMs < t3) return o2;
  if (tMs < t4) return o2 + (o3 - o2) * ((tMs - t3) / Math.max(1, t4 - t3));
  return o3;
}

/** \move(x1,y1,x2,y2[,t1,t2]): LINEAR interpolation (no easing, per spec) between two points. */
export function evalMove(
  x1: number, y1: number, x2: number, y2: number,
  t1: number, t2: number, tMs: number, lineDurMs: number,
): [number, number] {
  const start = t1 || 0;
  const end = t2 || lineDurMs;
  const u = end > start ? Math.max(0, Math.min(1, (tMs - start) / (end - start))) : (tMs < start ? 0 : 1);
  return [x1 + (x2 - x1) * u, y1 + (y2 - y1) * u];
}

export interface KaraokeSyllable {
  durCs: number; // centiseconds until this syllable finishes
  text: string;
  // \k: instant color swap at the syllable boundary. \kf: continuous fill
  // sweep across the syllable's duration. \ko: continuous OUTLINE-only
  // sweep. \K is normalized to "kf" here -- it's a documented libass/Aegisub
  // alias for \kf (continuous sweep), NOT an instant-swap sibling of
  // lowercase \k, despite the capitalization looking that way.
  kind: "k" | "kf" | "ko";
}

/** Which syllable is active at tMs (relative to the line's own start), and how far through it (0..1, for sweep tags). */
export function evalKaraoke(
  syllables: KaraokeSyllable[],
  tMs: number,
  lineStartMs: number,
): { index: number; fraction: number } {
  const relMs = tMs - lineStartMs;
  let acc = 0;
  for (let i = 0; i < syllables.length; i++) {
    const durMs = syllables[i].durCs * 10;
    if (relMs < acc + durMs || i === syllables.length - 1) {
      const fraction = durMs > 0 ? Math.max(0, Math.min(1, (relMs - acc) / durMs)) : 1;
      return { index: i, fraction: relMs < acc ? 0 : fraction };
    }
    acc += durMs;
  }
  return { index: -1, fraction: 1 };
}

/** \an numpad alignment (1-9) -> the [0,1] anchor fraction within a run's own bbox (0,0 = bottom-left of bbox, matching how the offset is subtracted from the tag position). */
export function alignmentAnchorFraction(alignment: number): [number, number] {
  const col = ((alignment - 1) % 3); // 0=left,1=center,2=right
  const row = Math.floor((alignment - 1) / 3); // 0=bottom,1=middle,2=top (ASS numpad convention)
  return [col === 0 ? 0 : col === 1 ? 0.5 : 1, row === 0 ? 0 : row === 1 ? 0.5 : 1];
}

// ---------------------------------------------------------------------------
// resolveLineRuns — the busiest function: walks a tokenized line's tags left
// to right, maintaining a mutable "current style," applying each tag's
// effect AT tMs (time-varying tags are genuinely re-evaluated per frame,
// same as evalVector(prop, frame) in the Lottie loader), and emitting one
// {text, style} run per contiguous text span between tag changes.
// ---------------------------------------------------------------------------

export interface ResolvedRunStyle {
  fontName: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeOut: boolean;
  primary: Color;
  secondary: Color;
  outline: Color;
  back: Color;
  scaleX: number;
  scaleY: number;
  angle: number;
  borderWidth: number;
  shadowDepth: number;
  posOverride: [number, number] | null; // set by \pos or \move; null = use default alignment-based layout
  orgOverride: [number, number] | null; // set by \org; null = rotate/shear about the run's own bbox center (v1 approximation)
  shearX: number; // \fax: x' = x + shearX*y
  shearY: number; // \fay: y' = y + shearY*x
  blurRadius: number; // \be or \blur, in PlayRes-pixel-ish units (see applyOneRunEffects for the world-unit conversion)
  alignment: number;
}

export interface ResolvedRun {
  text: string;
  style: ResolvedRunStyle;
}

function cloneStyle(s: ResolvedRunStyle): ResolvedRunStyle {
  return { ...s, primary: s.primary, secondary: s.secondary, outline: s.outline, back: s.back };
}

function styleFromASSStyle(s: ASSStyle): ResolvedRunStyle {
  return {
    fontName: s.fontName, fontSize: s.fontSize, bold: s.bold, italic: s.italic,
    underline: s.underline, strikeOut: s.strikeOut,
    primary: s.primaryColor, secondary: s.secondaryColor, outline: s.outlineColor, back: s.backColor,
    scaleX: s.scaleX, scaleY: s.scaleY, angle: s.angle,
    borderWidth: s.outline, shadowDepth: s.shadow,
    posOverride: null, orgOverride: null, shearX: 0, shearY: 0, blurRadius: 0, alignment: s.alignment,
  };
}

function parseArgList(args: string): string[] {
  const m = args.match(/^\(([^)]*)\)$/);
  const inner = m ? m[1] : args;
  return inner.split(",").map((s) => s.trim()).filter((s) => s !== "" || inner === "");
}

export function resolveLineRuns(
  tokens: ASSToken[],
  baseStyle: ASSStyle,
  styles: Map<string, ASSStyle>,
  tMs: number,
  lineStartMs: number,
  lineDurMs: number,
): ResolvedRun[] {
  let cur = styleFromASSStyle(baseStyle);
  const runs: ResolvedRun[] = [];
  const relMs = tMs - lineStartMs;

  for (const tok of tokens) {
    if (tok.type === "text") {
      if (tok.text.length > 0) runs.push({ text: tok.text, style: cloneStyle(cur) });
      continue;
    }
    const a = tok.args;
    switch (tok.name) {
      case "pos": {
        const [x, y] = parseArgList(a).map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) cur.posOverride = [x, y];
        break;
      }
      case "move": {
        const p = parseArgList(a).map(Number);
        if (p.length >= 4) {
          const [xy0, xy1, xy2, xy3, t1 = 0, t2 = 0] = p;
          cur.posOverride = evalMove(xy0, xy1, xy2, xy3, t1, t2, relMs, lineDurMs);
        }
        break;
      }
      case "an": {
        const n = parseInt(a.replace(/[()]/g, ""), 10);
        if (n >= 1 && n <= 9) cur.alignment = n;
        break;
      }
      case "a": {
        const n = parseInt(a.replace(/[()]/g, ""), 10);
        if (SSA_ALIGNMENT_TO_ASS[n] !== undefined) cur.alignment = SSA_ALIGNMENT_TO_ASS[n];
        else if (n >= 1 && n <= 9) cur.alignment = n;
        break;
      }
      case "c": case "1c": cur.primary = parseAssColor(a); break;
      case "2c": cur.secondary = parseAssColor(a); break;
      case "3c": cur.outline = parseAssColor(a); break;
      case "4c": cur.back = parseAssColor(a); break;
      case "alpha": case "1a": cur.primary = new Color(cur.primary.r, cur.primary.g, cur.primary.b, 1 - parseInt(a.replace(/[&Hh]/g, ""), 16) / 255); break;
      case "2a": cur.secondary = new Color(cur.secondary.r, cur.secondary.g, cur.secondary.b, 1 - parseInt(a.replace(/[&Hh]/g, ""), 16) / 255); break;
      case "3a": cur.outline = new Color(cur.outline.r, cur.outline.g, cur.outline.b, 1 - parseInt(a.replace(/[&Hh]/g, ""), 16) / 255); break;
      case "4a": cur.back = new Color(cur.back.r, cur.back.g, cur.back.b, 1 - parseInt(a.replace(/[&Hh]/g, ""), 16) / 255); break;
      case "fscx": { const n = parseFloat(a); if (Number.isFinite(n)) cur.scaleX = n; break; }
      case "fscy": { const n = parseFloat(a); if (Number.isFinite(n)) cur.scaleY = n; break; }
      case "fs": { const n = parseFloat(a); if (Number.isFinite(n)) cur.fontSize = n; break; }
      case "fn": { const name = a.trim(); if (name) cur.fontName = name; break; }
      case "frz": case "fr": { const n = parseFloat(a); if (Number.isFinite(n)) cur.angle = n; break; }
      case "bord": { const n = parseFloat(a); if (Number.isFinite(n)) cur.borderWidth = n; break; }
      case "shad": { const n = parseFloat(a); if (Number.isFinite(n)) cur.shadowDepth = n; break; }
      case "org": {
        const [x, y] = parseArgList(a).map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) cur.orgOverride = [x, y];
        break;
      }
      case "fax": { const n = parseFloat(a); if (Number.isFinite(n)) cur.shearX = n; break; }
      case "fay": { const n = parseFloat(a); if (Number.isFinite(n)) cur.shearY = n; break; }
      case "be": case "blur": { const n = parseFloat(a); if (Number.isFinite(n)) cur.blurRadius = n; break; }
      case "b": cur.bold = a.replace(/[()]/g, "") !== "0"; break;
      case "i": cur.italic = a.replace(/[()]/g, "") !== "0"; break;
      case "u": cur.underline = a.replace(/[()]/g, "") !== "0"; break;
      case "s": cur.strikeOut = a.replace(/[()]/g, "") !== "0"; break;
      case "k": break; // consumed by the mobject layer's karaoke syllable pass, not per-run style
      case "r": {
        const name = a.trim();
        cur = styleFromASSStyle((name && styles.get(name)) || baseStyle);
        break;
      }
      case "t": {
        cur = applyTransformTag(cur, a, relMs, lineDurMs);
        break;
      }
      // \clip, \iclip, \K, \kf, \ko, \org, \fax, \fay, \be, \blur, \p, \pbo:
      // known but not yet implemented at this stage -- silently no-op here;
      // ass_mobject.ts's warning pass is responsible for surfacing them.
      default:
        break;
    }
  }
  if (runs.length === 0) runs.push({ text: "", style: cur });
  return runs;
}

// ---------------------------------------------------------------------------
// \t(t1,t2,accel,tags) -- animate a set of inner tags' target values in
// linearly over [t1,t2] (accel-eased), relative to the line's own start.
// Real ASS supports 4 arities: \t(tags), \t(accel,tags), \t(t1,t2,tags),
// \t(t1,t2,accel,tags) -- disambiguated below by counting numeric args
// before the first backslash. Only NUMERIC/COLOR fields are interpolated
// (fscx/fscy/fs/frz/fr/bord/shad/c/1c-4c/alpha/1a-4a); toggle/string tags
// (\b/\i/\u/\s/\fn/\pos/\an/\r) inside a \t block are intentionally not
// blended (they don't have continuous semantics) and are ignored if present.
// Overlapping \t windows on the same property compose LAST-TAG-WINS in tag
// order (not libass's true additive blend) -- a documented approximation.
// ---------------------------------------------------------------------------

const ANIMATABLE_NUMERIC: Array<keyof ResolvedRunStyle> = ["fontSize", "scaleX", "scaleY", "angle", "borderWidth", "shadowDepth"];
const ANIMATABLE_NUMERIC_TAGS: Record<string, keyof ResolvedRunStyle> = {
  fs: "fontSize", fscx: "scaleX", fscy: "scaleY", frz: "angle", fr: "angle", bord: "borderWidth", shad: "shadowDepth",
};
const ANIMATABLE_COLOR_TAGS: Record<string, keyof ResolvedRunStyle> = {
  c: "primary", "1c": "primary", "2c": "secondary", "3c": "outline", "4c": "back",
};
const ANIMATABLE_ALPHA_TAGS: Record<string, keyof ResolvedRunStyle> = {
  alpha: "primary", "1a": "primary", "2a": "secondary", "3a": "outline", "4a": "back",
};

function lerpColor(a: Color, b: Color, t: number): Color {
  return new Color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t);
}

function applyTransformTag(cur: ResolvedRunStyle, rawArgs: string, relMs: number, lineDurMs: number): ResolvedRunStyle {
  const m = rawArgs.match(/^\(([^)]*)\)$/);
  if (!m) return cur;
  const inner = m[1];
  const backslash = inner.indexOf("\\");
  const head = backslash === -1 ? inner : inner.slice(0, backslash);
  const tagString = backslash === -1 ? "" : inner.slice(backslash);
  const headArgs = head.split(",").map((s) => s.trim()).filter((s) => s !== "");
  let t1 = 0, t2 = lineDurMs, accel = 1;
  if (headArgs.length === 1) accel = Number(headArgs[0]) || 1;
  else if (headArgs.length === 2) { t1 = Number(headArgs[0]) || 0; t2 = Number(headArgs[1]) || lineDurMs; }
  else if (headArgs.length >= 3) { t1 = Number(headArgs[0]) || 0; t2 = Number(headArgs[1]) || lineDurMs; accel = Number(headArgs[2]) || 1; }
  if (!tagString) return cur;

  let u = t2 > t1 ? Math.max(0, Math.min(1, (relMs - t1) / (t2 - t1))) : (relMs < t1 ? 0 : 1);
  u = Math.pow(u, accel);

  const target = cloneStyle(cur);
  for (const innerTok of tokenizeOverrideText(`{${tagString}}`)) {
    if (innerTok.type !== "tag") continue;
    const n = parseFloat(innerTok.args);
    if (ANIMATABLE_NUMERIC_TAGS[innerTok.name] && Number.isFinite(n)) {
      (target as any)[ANIMATABLE_NUMERIC_TAGS[innerTok.name]] = n;
    } else if (ANIMATABLE_COLOR_TAGS[innerTok.name]) {
      (target as any)[ANIMATABLE_COLOR_TAGS[innerTok.name]] = parseAssColor(innerTok.args);
    } else if (ANIMATABLE_ALPHA_TAGS[innerTok.name]) {
      const field = ANIMATABLE_ALPHA_TAGS[innerTok.name];
      const base = (cur as any)[field] as Color;
      const alpha = 1 - parseInt(innerTok.args.replace(/[&Hh]/g, ""), 16) / 255;
      (target as any)[field] = new Color(base.r, base.g, base.b, alpha);
    }
  }

  const out = cloneStyle(cur);
  for (const field of ANIMATABLE_NUMERIC) {
    (out as any)[field] = (cur as any)[field] + ((target as any)[field] - (cur as any)[field]) * u;
  }
  for (const field of ["primary", "secondary", "outline", "back"] as const) {
    out[field] = lerpColor(cur[field], target[field], u);
  }
  return out;
}

/** Fade opacity considering both \fad and \fade tags anywhere in the token stream (last one wins, matching \r-reset-style "last stated value wins" semantics). */
export function evalLineOpacity(tokens: ASSToken[], tMs: number, lineStartMs: number, lineDurMs: number): number {
  let opacity = 1;
  const relMs = tMs - lineStartMs;
  for (const tok of tokens) {
    if (tok.type !== "tag") continue;
    if (tok.name === "fad") {
      const [t1, t2] = parseArgList(tok.args).map(Number);
      if (Number.isFinite(t1) && Number.isFinite(t2)) opacity = evalFad(t1, t2, relMs, lineDurMs);
    } else if (tok.name === "fade") {
      const p = parseArgList(tok.args).map(Number);
      if (p.length >= 7) opacity = evalFade(p[0], p[1], p[2], p[3], p[4], p[5], p[6], relMs);
    }
  }
  return opacity;
}

export interface ClipRect { x1: number; y1: number; x2: number; y2: number; invert: boolean }

/**
 * Extract a RECTANGULAR \clip(x1,y1,x2,y2) / \iclip(x1,y1,x2,y2) anywhere in
 * the token stream (last one wins). Vector-drawing clip
 * (\clip([scale,]drawing-commands)) is detected but returns null with
 * `vectorForm: true` in the second element, since it needs the v2 drawing
 * parser (parseDrawingCommands) that doesn't exist yet at this stage --
 * ass_mobject.ts's warning pass surfaces that case distinctly from "no clip
 * at all" so a future v2 pass can find every site that needs upgrading.
 */
export function evalClipRect(tokens: ASSToken[]): { rect: ClipRect | null; vectorFormPresent: boolean } {
  let rect: ClipRect | null = null;
  let vectorFormPresent = false;
  for (const tok of tokens) {
    if (tok.type !== "tag" || (tok.name !== "clip" && tok.name !== "iclip")) continue;
    const parts = parseArgList(tok.args);
    const nums = parts.map(Number);
    if (parts.length === 4 && nums.every(Number.isFinite)) {
      rect = { x1: nums[0], y1: nums[1], x2: nums[2], y2: nums[3], invert: tok.name === "iclip" };
    } else {
      vectorFormPresent = true;
    }
  }
  return { rect, vectorFormPresent };
}

/** Extract \k/\K/\kf/\ko syllables + the plain text between them, in order (used to decide the karaoke-vs-plain layout path and drive per-syllable timing). */
function normalizeKaraokeKind(tagName: string): "k" | "kf" | "ko" {
  if (tagName === "K" || tagName === "kf") return "kf"; // \K is an alias for \kf, see KaraokeSyllable's kind doc
  if (tagName === "ko") return "ko";
  return "k";
}

export function extractKaraokeSyllables(tokens: ASSToken[]): KaraokeSyllable[] {
  const out: KaraokeSyllable[] = [];
  let pendingDur = 0;
  let pendingKind: "k" | "kf" | "ko" = "k";
  let haveK = false;
  for (const tok of tokens) {
    if (tok.type === "tag" && (tok.name === "k" || tok.name === "K" || tok.name === "kf" || tok.name === "ko")) {
      if (haveK) out.push({ durCs: pendingDur, text: "", kind: pendingKind }); // no text arrived before the next \k -- empty syllable
      pendingDur = parseInt(tok.args.replace(/[()]/g, ""), 10) || 0;
      pendingKind = normalizeKaraokeKind(tok.name);
      haveK = true;
    } else if (tok.type === "text" && haveK) {
      out.push({ durCs: pendingDur, text: tok.text, kind: pendingKind });
      haveK = false;
    }
  }
  return out;
}

export function hasKaraokeTags(tokens: ASSToken[]): boolean {
  return tokens.some((t) => t.type === "tag" && (t.name === "k" || t.name === "K" || t.name === "kf" || t.name === "ko"));
}
