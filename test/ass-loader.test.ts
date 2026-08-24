// ASS/SSA subtitle loader: section parsing, color/time parsing, the
// override-tag tokenizer, and per-tag evaluation math. Mirrors
// test/lottie-loader.test.ts's scope for the pure-math half of a foreign-
// format importer.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseASS,
  parseAssColor,
  parseAssTime,
  tokenizeOverrideText,
  resolveLineRuns,
  evalFad,
  evalFade,
  evalMove,
  evalKaraoke,
  evalLineOpacity,
  evalClipRect,
  extractKaraokeSyllables,
  hasKaraokeTags,
  alignmentAnchorFraction,
  uniformBSplineToBezier,
  parseDrawingCommands,
} from "../src/loaders/ass_loader.ts";

const MINIMAL = `[Script Info]
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Hello, world!
Comment: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,ignored
`;

test("parseASS: parses script info, styles, and events", () => {
  const script = parseASS(MINIMAL);
  assert.equal(script.info.playResX, 1920);
  assert.equal(script.info.playResY, 1080);
  assert.equal(script.info.format, "ass");
  assert.ok(script.styles.has("Default"));
  assert.equal(script.styles.get("Default")!.fontSize, 48);
  assert.equal(script.events.length, 2);
  const [dialogue, comment] = script.events;
  assert.equal(dialogue.isComment, false);
  assert.equal(dialogue.text, "Hello, world!"); // comma-greedy Text column
  assert.equal(dialogue.endMs, 5000);
  assert.equal(comment.isComment, true);
});

test("parseASS: throws only when there's no usable [Events] section", () => {
  assert.throws(() => parseASS("[Script Info]\nPlayResX: 100\n"));
  // A Format-less/Dialogue-less Events section also has nothing usable.
  assert.throws(() => parseASS("[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"));
});

test("parseASS: tolerates malformed/unrecognized sections and fields", () => {
  const text = MINIMAL + "\n[Some Unknown Section]\ngarbage: true\n";
  const script = parseASS(text);
  assert.equal(script.events.length, 2);
});

test("parseASS: legacy [V4 Styles] (SSA) alignment remap", () => {
  const ssa = `[Script Info]
[V4 Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding
Style: Default,Arial,20,&HFFFFFF,&HFFFF,&H0,&H0,0,0,1,2,2,7,10,10,10,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,hi
`;
  const script = parseASS(ssa);
  assert.equal(script.info.format, "ssa");
  // legacy alignment 7 (top-left) -> ASS numpad 9 (top-right)... actually verify via table: 7 -> 9
  assert.equal(script.styles.get("Default")!.alignment, 9);
});

test("parseAssColor: 6-digit, 8-digit, and case-insensitive forms", () => {
  const white = parseAssColor("&H00FFFFFF");
  assert.equal(white.r, 1); assert.equal(white.g, 1); assert.equal(white.b, 1); assert.equal(white.a, 1);
  const halfAlpha = parseAssColor("&H80FFFFFF");
  assert.ok(Math.abs(halfAlpha.a - (1 - 0x80 / 255)) < 1e-6);
  const bare = parseAssColor("0000FF"); // BGR: red channel
  assert.equal(bare.r, 1); assert.equal(bare.g, 0); assert.equal(bare.b, 0);
  const lower = parseAssColor("&h00ff0000&");
  assert.ok(lower.b > 0.9 && lower.r < 0.1); // BGR 0000FF -> wait this is 00FF0000 -> B=00,G=FF,R=00... actually just assert it parses without throwing
  assert.ok(Number.isFinite(lower.r));
});

test("parseAssTime: H:MM:SS.CC -> ms", () => {
  assert.equal(parseAssTime("0:00:00.00"), 0);
  assert.equal(parseAssTime("0:01:02.30"), 62300);
  assert.equal(parseAssTime("1:00:00.00"), 3600000);
});

test("tokenizeOverrideText: splits text vs override blocks, multiple tags per block", () => {
  const tokens = tokenizeOverrideText("Hello {\\b1\\c&H00FF00&}green bold{\\b0} normal");
  assert.deepEqual(tokens.map((t) => t.type), ["text", "tag", "tag", "text", "tag", "text"]);
  const tagNames = tokens.filter((t) => t.type === "tag").map((t: any) => t.name);
  assert.deepEqual(tagNames, ["b", "c", "b"]);
});

test("tokenizeOverrideText: paren args aren't split on their internal commas", () => {
  const tokens = tokenizeOverrideText("{\\move(10,20,30,40)}text");
  const tag = tokens.find((t) => t.type === "tag") as any;
  assert.equal(tag.name, "move");
  assert.equal(tag.args, "(10,20,30,40)");
});

test("resolveLineRuns: \\pos overrides default alignment-based layout", () => {
  const script = parseASS(MINIMAL);
  const tokens = tokenizeOverrideText("{\\pos(100,200)}hi");
  const runs = resolveLineRuns(tokens, script.styles.get("Default")!, script.styles, 0, 0, 5000);
  assert.deepEqual(runs[0].style.posOverride, [100, 200]);
});

test("resolveLineRuns: color/alpha tags", () => {
  const script = parseASS(MINIMAL);
  const tokens = tokenizeOverrideText("{\\c&H0000FF&\\alpha&H80&}red");
  const runs = resolveLineRuns(tokens, script.styles.get("Default")!, script.styles, 0, 0, 1000);
  assert.equal(runs[0].style.primary.r, 1);
  assert.equal(runs[0].style.primary.g, 0);
  assert.equal(runs[0].style.primary.b, 0);
  assert.ok(Math.abs(runs[0].style.primary.a - (1 - 0x80 / 255)) < 1e-6);
});

test("resolveLineRuns: bold/italic/underline/strikeout toggles + \\r reset", () => {
  const script = parseASS(MINIMAL);
  const tokens = tokenizeOverrideText("{\\b1\\i1}bi{\\r}plain");
  const runs = resolveLineRuns(tokens, script.styles.get("Default")!, script.styles, 0, 0, 1000);
  assert.equal(runs[0].text, "bi");
  assert.equal(runs[0].style.bold, true);
  assert.equal(runs[0].style.italic, true);
  assert.equal(runs[1].text, "plain");
  assert.equal(runs[1].style.bold, false);
});

test("resolveLineRuns: \\fscx/\\fscy/\\fs/\\fn/\\frz", () => {
  const script = parseASS(MINIMAL);
  const tokens = tokenizeOverrideText("{\\fscx50\\fscy150\\fs72\\fnComic Sans\\frz45}text");
  const runs = resolveLineRuns(tokens, script.styles.get("Default")!, script.styles, 0, 0, 1000);
  assert.equal(runs[0].style.scaleX, 50);
  assert.equal(runs[0].style.scaleY, 150);
  assert.equal(runs[0].style.fontSize, 72);
  assert.equal(runs[0].style.fontName, "Comic Sans");
  assert.equal(runs[0].style.angle, 45);
});

test("resolveLineRuns: \\an sets alignment", () => {
  const script = parseASS(MINIMAL);
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const tokens = tokenizeOverrideText(`{\\an${n}}x`);
    const runs = resolveLineRuns(tokens, script.styles.get("Default")!, script.styles, 0, 0, 1000);
    assert.equal(runs[0].style.alignment, n);
  }
});

test("evalFad: fade in / hold / fade out", () => {
  assert.equal(evalFad(500, 500, 0, 5000), 0);
  assert.equal(evalFad(500, 500, 250, 5000), 0.5);
  assert.equal(evalFad(500, 500, 2500, 5000), 1);
  assert.equal(evalFad(500, 500, 5000, 5000), 0);
  assert.equal(evalFad(500, 500, 4750, 5000), 0.5);
});

test("evalFade: piecewise through 3 alpha levels", () => {
  // a1=255(transparent) -> a2=0(opaque) -> a3=255(transparent), over t1..t4
  const o = evalFade(255, 0, 255, 0, 100, 200, 300, 50);
  assert.ok(o > 0 && o < 1);
  assert.equal(evalFade(255, 0, 255, 0, 100, 200, 300, 150), 1);
});

test("evalMove: linear interpolation, no easing", () => {
  const [x, y] = evalMove(0, 0, 100, 200, 0, 1000, 500, 5000);
  assert.equal(x, 50);
  assert.equal(y, 100);
  const [x2] = evalMove(0, 0, 100, 0, 0, 0, 500, 1000); // t1=t2=0 -> spans the whole line
  assert.equal(x2, 50);
});

test("evalKaraoke: syllable boundaries and fraction", () => {
  const syllables = [{ durCs: 50, text: "ka" }, { durCs: 50, text: "ra" }, { durCs: 50, text: "oke" }];
  assert.equal(evalKaraoke(syllables, 0, 0).index, 0);
  const mid = evalKaraoke(syllables, 750, 0); // 250ms into syllable 1's 500-1000ms window
  assert.equal(mid.index, 1);
  assert.ok(mid.fraction > 0.4 && mid.fraction < 0.6);
  const last = evalKaraoke(syllables, 10000, 0); // past the end -> clamped to last syllable
  assert.equal(last.index, 2);
});

test("extractKaraokeSyllables + hasKaraokeTags", () => {
  const tokens = tokenizeOverrideText("{\\k50}ka{\\k50}ra{\\k50}oke");
  assert.equal(hasKaraokeTags(tokens), true);
  const syllables = extractKaraokeSyllables(tokens);
  assert.equal(syllables.length, 3);
  assert.equal(syllables[0].text, "ka");
  assert.equal(syllables[0].durCs, 50);
});

// \K is a documented libass/Aegisub alias for \kf (continuous sweep), NOT an
// instant-swap sibling of lowercase \k -- get this normalization right, since
// mixing it up silently downgrades \K lines to instant-swap rendering.
test("extractKaraokeSyllables: \\k/\\K/\\kf/\\ko kind normalization", () => {
  const tokens = tokenizeOverrideText("{\\k50}a{\\K50}b{\\kf50}c{\\ko50}d");
  const syllables = extractKaraokeSyllables(tokens);
  assert.deepEqual(syllables.map((s) => s.kind), ["k", "kf", "kf", "ko"]);
});

test("evalKaraoke: fraction progresses 0->1 across a sweep syllable's window", () => {
  const syllables = [{ durCs: 100, text: "sweep", kind: "kf" as const }];
  assert.equal(evalKaraoke(syllables, 0, 0).fraction, 0);
  assert.ok(Math.abs(evalKaraoke(syllables, 250, 0).fraction - 0.25) < 1e-9);
  assert.ok(Math.abs(evalKaraoke(syllables, 500, 0).fraction - 0.5) < 1e-9);
  assert.ok(Math.abs(evalKaraoke(syllables, 750, 0).fraction - 0.75) < 1e-9);
  assert.equal(evalKaraoke(syllables, 1000, 0).fraction, 1);
});

test("evalClipRect: rectangular form parses, vector form is flagged distinctly", () => {
  const rectTokens = tokenizeOverrideText("{\\clip(0,0,100,200)}text");
  const rect = evalClipRect(rectTokens);
  assert.deepEqual(rect.rect, { x1: 0, y1: 0, x2: 100, y2: 200, invert: false });
  assert.equal(rect.vectorFormPresent, false);

  const iclipTokens = tokenizeOverrideText("{\\iclip(0,0,100,200)}text");
  assert.equal(evalClipRect(iclipTokens).rect?.invert, true);

  const vectorTokens = tokenizeOverrideText("{\\clip(m 0 0 l 100 0 100 100 0 100)}text");
  const vector = evalClipRect(vectorTokens);
  assert.equal(vector.rect, null);
  assert.equal(vector.vectorFormPresent, true);
});

test("evalLineOpacity: \\fad tag drives opacity", () => {
  const tokens = tokenizeOverrideText("{\\fad(500,500)}text");
  assert.equal(evalLineOpacity(tokens, 0, 0, 5000), 0);
  assert.equal(evalLineOpacity(tokens, 2500, 0, 5000), 1);
});

test("alignmentAnchorFraction: numpad corners/edges/center", () => {
  assert.deepEqual(alignmentAnchorFraction(1), [0, 0]); // bottom-left
  assert.deepEqual(alignmentAnchorFraction(2), [0.5, 0]); // bottom-center
  assert.deepEqual(alignmentAnchorFraction(5), [0.5, 0.5]); // middle-center
  assert.deepEqual(alignmentAnchorFraction(9), [1, 1]); // top-right
});

// Hand-computed lock-down for the v2 drawing engine's one genuinely new math
// primitive (per the plan: verify this BEFORE trusting any golden-frame PNG
// built on top of it). 4 evenly-spaced COLLINEAR points make the expected
// output easy to check by hand: a uniform cubic B-spline through collinear
// points must itself be a straight line, and for P0=(0,0) P1=(3,0) P2=(6,0)
// P3=(9,0), the derived formulas give exactly-evenly-spaced Bezier points
// B0=(3,0) B1=(4,0) B2=(5,0) B3=(6,0) (worked by hand in the function's own
// doc comment).
test("uniformBSplineToBezier: 4 collinear points -> evenly-spaced Bezier points (hand-computed)", () => {
  const out = uniformBSplineToBezier([[0, 0], [3, 0], [6, 0], [9, 0]]);
  assert.equal(out.length, 4); // n=4 -> exactly 1 segment -> [anchor, c1, c2, end]
  const xs = out.map((p) => p[0]);
  assert.deepEqual(xs, [3, 4, 5, 6]);
  for (const p of out) assert.equal(p[1], 0);
});

test("uniformBSplineToBezier: n control points -> n-3 segments, chained continuously", () => {
  const pts = [[0, 0], [1, 4], [3, 4], [5, 0], [7, 4], [9, 0]]; // n=6 -> 3 segments
  const out = uniformBSplineToBezier(pts);
  assert.equal(out.length, 1 + 3 * (pts.length - 3));
  // Segment i's B3 (window pts[i..i+3]) must algebraically equal segment
  // (i+1)'s B0 (window pts[i+1..i+4]) -- the continuity identity the doc
  // comment claims. Verify by computing each window independently (not just
  // trusting the single flat-list output) and cross-checking against it.
  const seg0 = uniformBSplineToBezier(pts.slice(0, 4));
  const seg1 = uniformBSplineToBezier(pts.slice(1, 5));
  const seg2 = uniformBSplineToBezier(pts.slice(2, 6));
  assert.deepEqual(seg0[3], seg1[0]);
  assert.deepEqual(seg1[3], seg2[0]);
  // The flat list is exactly the concatenation of each window's own [B1,B2,B3]
  // appended after a single shared leading anchor (seg0's B0).
  assert.deepEqual(out, [seg0[0], seg0[1], seg0[2], seg0[3], seg1[1], seg1[2], seg1[3], seg2[1], seg2[2], seg2[3]]);
});

test("uniformBSplineToBezier: n=3 falls back to a quadratic-elevated cubic through all 3 points", () => {
  const out = uniformBSplineToBezier([[0, 0], [5, 10], [10, 0]]);
  assert.equal(out.length, 4);
  assert.deepEqual([out[0][0], out[0][1]], [0, 0]); // starts exactly at P0
  assert.deepEqual([out[3][0], out[3][1]], [10, 0]); // ends exactly at P2
});

test("uniformBSplineToBezier: fewer than 3 points returns empty", () => {
  assert.deepEqual(uniformBSplineToBezier([[0, 0], [1, 1]]), []);
});

test("parseDrawingCommands: m/l builds a flat cubic point list (lines as degenerate cubics)", () => {
  const subpaths = parseDrawingCommands("m 0 0 l 10 0 10 10 0 10", 1);
  assert.equal(subpaths.length, 1);
  assert.equal(subpaths[0].length, 1 + 3 * 3); // anchor + 3 line segments: (10,0) (10,10) (0,10)
  assert.deepEqual([subpaths[0][0][0], subpaths[0][0][1]], [0, 0]);
  const last = subpaths[0][subpaths[0].length - 1];
  assert.deepEqual([last[0], last[1]], [0, 10]);
});

test("parseDrawingCommands: b passes cubic control points straight through, no conversion", () => {
  const subpaths = parseDrawingCommands("m 0 0 b 1 1 2 2 3 3", 1);
  assert.equal(subpaths.length, 1);
  assert.equal(subpaths[0].length, 4);
  assert.deepEqual([subpaths[0][3][0], subpaths[0][3][1]], [3, 3]);
});

test("parseDrawingCommands: \\p<n> scale exponent divides coordinates by 2^(n-1)", () => {
  const n1 = parseDrawingCommands("m 100 200 l 300 400", 1);
  const n3 = parseDrawingCommands("m 100 200 l 300 400", 3); // divide by 2^(3-1)=4
  assert.deepEqual([n1[0][0][0], n1[0][0][1]], [100, 200]);
  assert.deepEqual([n3[0][0][0], n3[0][0][1]], [25, 50]);
});

test("parseDrawingCommands: s...c closes a spline into a continuous loop without throwing", () => {
  assert.doesNotThrow(() => {
    const subpaths = parseDrawingCommands("m 0 0 s 0 0 10 10 20 0 10 -10 c", 1);
    assert.equal(subpaths.length, 1);
    assert.ok(subpaths[0].length > 4);
  });
});

test("parseDrawingCommands: malformed/truncated input never throws", () => {
  assert.doesNotThrow(() => parseDrawingCommands("m 0 0 l 10", 1)); // dangling odd coordinate
  assert.doesNotThrow(() => parseDrawingCommands("z q 1 2", 1)); // unknown commands
  assert.doesNotThrow(() => parseDrawingCommands("", 1));
  assert.doesNotThrow(() => parseDrawingCommands("p 1 2", 1)); // \p with no open spline
});
