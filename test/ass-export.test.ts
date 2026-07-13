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
import { wordCaptionTrackToAss } from "../src/interchange/ass.ts";
import { parseASS } from "../src/loaders/ass_loader.ts";
import { loadASS } from "../src/mobject/ass_mobject.ts";

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
