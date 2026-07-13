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
  extractKaraokeSyllables,
  hasKaraokeTags,
  alignmentAnchorFraction,
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
