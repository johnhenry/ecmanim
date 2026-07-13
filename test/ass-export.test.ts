// ASS/SSA export: wordCaptionTrackToAss serializes a WordCaptionTrack's
// word-timed pages to karaoke .ass. Verifies both the serializer's own
// arithmetic (ms->centiseconds, BGR color reorder) AND that the output is a
// real, loadable .ass file by round-tripping it through this campaign's own
// parseASS/loadASS -- the automatable analog of the plan's "load the
// exported file in a real ASS player" verification step.

import { test } from "node:test";
import assert from "node:assert/strict";
import { WordCaptionTrack } from "../src/captions/caption_track.ts";
import { createTikTokStyleCaptions } from "../src/captions/captions.ts";
import type { Caption, CaptionPage } from "../src/captions/captions.ts";
import { wordCaptionTrackToAss, vmobjectToAssDrawing } from "../src/interchange/ass.ts";
import { parseASS, parseDrawingCommands } from "../src/loaders/ass_loader.ts";
import { loadASS } from "../src/mobject/ass_mobject.ts";
import { Rectangle } from "../src/mobject/geometry.ts";

const cap = (text: string, startMs: number, endMs: number): Caption => ({
  text, startMs, endMs, timestampMs: startMs, confidence: null,
});

// Two pages: "Hello brave world" (0-900ms) and "Goodbye now" (2000-2600ms).
const PAGES: CaptionPage[] = createTikTokStyleCaptions({
  captions: [
    cap("Hello ", 0, 300), cap("brave ", 300, 600), cap("world", 600, 900),
    cap("Goodbye ", 2000, 2300), cap("now", 2300, 2600),
  ],
  combineTokensWithinMilliseconds: 500,
}).pages;

test("wordCaptionTrackToAss: one Dialogue per page, one \\k syllable per token", () => {
  const track = new WordCaptionTrack(PAGES);
  const ass = wordCaptionTrackToAss(track);
  const dialogueLines = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.equal(dialogueLines.length, 2);
  assert.equal((dialogueLines[0].match(/\\k\d+/g) ?? []).length, 3);
  assert.equal((dialogueLines[1].match(/\\k\d+/g) ?? []).length, 2);
});

test("wordCaptionTrackToAss: \\k duration is the token's own span in centiseconds", () => {
  const track = new WordCaptionTrack(PAGES);
  const ass = wordCaptionTrackToAss(track);
  // "Hello " spans 0-300ms -> 30cs; "brave " spans 300-600ms -> 30cs.
  const firstLine = ass.split("\n").find((l) => l.startsWith("Dialogue:"))!;
  assert.match(firstLine, /\{\\k30\}Hello \{\\k30\}brave \{\\k30\}world/);
});

test("wordCaptionTrackToAss: Dialogue Start/End match the page's first/last token", () => {
  const track = new WordCaptionTrack(PAGES);
  const ass = wordCaptionTrackToAss(track);
  const firstLine = ass.split("\n").find((l) => l.startsWith("Dialogue:"))!;
  // 0ms -> "0:00:00.00", 900ms -> "0:00:00.90"
  assert.ok(firstLine.startsWith("Dialogue: 0,0:00:00.00,0:00:00.90,"), firstLine);
});

test("wordCaptionTrackToAss: colors round-trip through the BGR hex reorder", () => {
  const track = new WordCaptionTrack(PAGES);
  const ass = wordCaptionTrackToAss(track, { primaryColor: "#112233", secondaryColor: "#ffe066" });
  const script = parseASS(ass);
  const style = script.styles.get("Default")!;
  assert.ok(Math.abs(style.primaryColor.r - 0x11 / 255) < 1e-6);
  assert.ok(Math.abs(style.primaryColor.g - 0x22 / 255) < 1e-6);
  assert.ok(Math.abs(style.primaryColor.b - 0x33 / 255) < 1e-6);
  assert.ok(Math.abs(style.secondaryColor.r - 0xff / 255) < 1e-6);
  assert.ok(Math.abs(style.secondaryColor.g - 0xe0 / 255) < 1e-6);
  assert.ok(Math.abs(style.secondaryColor.b - 0x66 / 255) < 1e-6);
});

test("wordCaptionTrackToAss: output is a real, loadable .ass file (parseASS + loadASS round trip)", () => {
  const track = new WordCaptionTrack(PAGES);
  const ass = wordCaptionTrackToAss(track);
  const script = parseASS(ass);
  assert.equal(script.events.filter((e) => !e.isComment).length, 2);
  assert.doesNotThrow(() => loadASS(ass, { width: 13 }));
  const subs = loadASS(ass, { width: 13 });
  // A missing-font fallback warning is expected in this headless test env
  // (same as every other ASS fixture in this campaign) -- what matters is
  // there's no tag-parsing/"not yet implemented" warning, confirming the
  // exported \k syntax round-trips cleanly through the loader.
  const unexpected = subs.warnings.filter((w) => !w.includes("not resolved"));
  assert.deepEqual(unexpected, []);
});

test("wordCaptionTrackToAss: braces/backslashes in token text are sanitized, never corrupt the override block", () => {
  const dirtyPages: CaptionPage[] = createTikTokStyleCaptions({
    captions: [cap("wei{rd}\\text ", 0, 300), cap("ok", 300, 600)],
    combineTokensWithinMilliseconds: 500,
  }).pages;
  const track = new WordCaptionTrack(dirtyPages);
  const ass = wordCaptionTrackToAss(track);
  assert.doesNotThrow(() => parseASS(ass));
  const script = parseASS(ass);
  assert.equal(script.events.filter((e) => !e.isComment).length, 1);
});

test("wordCaptionTrackToAss: an empty page (all-whitespace tokens) is skipped, not emitted as a blank Dialogue", () => {
  const blankPages: CaptionPage[] = [{ text: "  ", startMs: 0, durationMs: 100, tokens: [{ text: "  ", fromMs: 0, toMs: 100 }] }];
  const track = new WordCaptionTrack(blankPages);
  const ass = wordCaptionTrackToAss(track);
  assert.equal(ass.split("\n").filter((l) => l.startsWith("Dialogue:")).length, 0);
});

// vmobjectToAssDrawing --------------------------------------------------------

test("vmobjectToAssDrawing: a rectangle's corners round-trip exactly (hand-verifiable geometry)", () => {
  const rect = new Rectangle({ width: 4, height: 2, fillColor: "#112233", fillOpacity: 1, strokeWidth: 0 });
  const ass = vmobjectToAssDrawing(rect, { scale: 100 });
  const dialogueLine = ass.split("\n").find((l) => l.startsWith("Dialogue:"))!;
  const drawingMatch = dialogueLine.match(/\\p1\}(.*)\{\\p0\}/);
  assert.ok(drawingMatch, `expected a \\p1...\\p0 drawing block in: ${dialogueLine}`);
  const subpaths = parseDrawingCommands(drawingMatch![1], 1);
  assert.equal(subpaths.length, 1);
  // Rectangle's own verts are [w/2,h/2],[-w/2,h/2],[-w/2,-h/2],[w/2,-h/2] --
  // already centered on its own getCenter(), so at scale=100 with Y-flip the
  // corners should land at exactly (+-200,-+100) in drawing space.
  const corners = subpaths[0].filter((_, i) => i % 3 === 0).map(([x, y]) => [Math.round(x), Math.round(y)]);
  for (const [x, y] of corners) {
    assert.ok(Math.abs(Math.abs(x) - 200) < 1, `expected |x|=200, got ${x}`);
    assert.ok(Math.abs(Math.abs(y) - 100) < 1, `expected |y|=100, got ${y}`);
  }
});

test("vmobjectToAssDrawing: fill/stroke colors and alpha round-trip through parseASS", () => {
  const rect = new Rectangle({ width: 2, height: 2, fillColor: "#a1b2c3", fillOpacity: 0.5, strokeColor: "#ff0000", strokeWidth: 3 });
  const ass = vmobjectToAssDrawing(rect);
  const script = parseASS(ass);
  const style = script.styles.get("Default")!;
  assert.ok(Math.abs(style.primaryColor.r - 0xa1 / 255) < 1e-6);
  assert.ok(Math.abs(style.primaryColor.g - 0xb2 / 255) < 1e-6);
  assert.ok(Math.abs(style.primaryColor.b - 0xc3 / 255) < 1e-6);
  assert.ok(Math.abs(style.outlineColor.r - 1) < 1e-6);
  assert.equal(style.outline, 3);
  // \alpha on the dialogue line carries the fill opacity (0.5 -> ~0x80 alpha byte).
  const dialogueLine = ass.split("\n").find((l) => l.startsWith("Dialogue:"))!;
  assert.match(dialogueLine, /\\alpha&H80&/);
});

test("vmobjectToAssDrawing: config.pos places the shape, default centers it on PlayRes", () => {
  const rect = new Rectangle({ width: 1, height: 1 });
  const defaultAss = vmobjectToAssDrawing(rect, { playResX: 1920, playResY: 1080 });
  assert.match(defaultAss, /\\pos\(960,540\)/);
  const customAss = vmobjectToAssDrawing(rect, { pos: [100, 200] });
  assert.match(customAss, /\\pos\(100,200\)/);
});

test("vmobjectToAssDrawing: output is a real, loadable .ass file and visually fills the shape (sampled pixel)", async () => {
  const rect = new Rectangle({ width: 3, height: 3, fillColor: "#00ff00", fillOpacity: 1, strokeWidth: 0 });
  const ass = vmobjectToAssDrawing(rect, { scale: 100 });
  assert.doesNotThrow(() => loadASS(ass, { width: 13 }));
  const subs = loadASS(ass, { width: 13 });
  const unexpected = subs.warnings.filter((w) => !w.includes("not resolved"));
  assert.deepEqual(unexpected, []);

  const { Scene } = await import("../src/scene/Scene.ts");
  const { captureFrames, loadNapiCanvas } = await import("./_snapshot_util.ts");
  const canvasAvailable = await loadNapiCanvas().then((m: any) => !!m);
  if (!canvasAvailable) return; // environment has no @napi-rs/canvas -- skip the render-level check
  class S extends Scene {
    async construct() {
      loadASS(ass, { width: 13 }).attachTo(this);
      await this.wait(1);
    }
  }
  const caps = await captureFrames(S, [7], { width: 480, height: 270, fps: 15 });
  const cap = caps.get(7)!;
  const centerIdx = (135 * 480 + 240) * 4;
  assert.ok(cap.data[centerIdx + 1] > 150, `expected green fill at frame center, got rgba=${cap.data.slice(centerIdx, centerIdx + 4)}`);
  assert.ok(cap.data[centerIdx] < 100, `expected low red at frame center, got rgba=${cap.data.slice(centerIdx, centerIdx + 4)}`);
});
