import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSrt, serializeSrt, createTikTokStyleCaptions, captionAt,
} from "../src/captions/captions.ts";

const SRT = `1
00:00:00,000 --> 00:00:01,000
Hello

2
00:00:01,000 --> 00:00:02,500
world
`;

test("parseSrt reads cues with timing + text", () => {
  const caps = parseSrt(SRT);
  assert.equal(caps.length, 2);
  assert.equal(caps[0].text, "Hello");
  assert.equal(caps[0].startMs, 0);
  assert.equal(caps[0].endMs, 1000);
  assert.equal(caps[1].startMs, 1000);
  assert.equal(caps[1].endMs, 2500);
});

test("serializeSrt round-trips through parseSrt", () => {
  const caps = parseSrt(SRT);
  const out = serializeSrt(caps);
  const reparsed = parseSrt(out);
  assert.deepEqual(reparsed.map((c) => [c.text, c.startMs, c.endMs]),
    caps.map((c) => [c.text, c.startMs, c.endMs]));
});

test("createTikTokStyleCaptions groups tokens within a gap threshold", () => {
  const captions = [
    { text: "the", startMs: 0, endMs: 200, timestampMs: 100, confidence: 1 },
    { text: " quick", startMs: 220, endMs: 500, timestampMs: 360, confidence: 1 },
    { text: " fox", startMs: 520, endMs: 800, timestampMs: 660, confidence: 1 },
    { text: " jumps", startMs: 3000, endMs: 3300, timestampMs: 3150, confidence: 1 },
  ];
  const { pages } = createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: 500 });
  assert.equal(pages.length, 2, "a >500ms gap starts a new page");
  assert.equal(pages[0].tokens.length, 3);
  assert.equal(pages[0].text, "the quick fox");
  assert.equal(pages[0].startMs, 0);
  assert.equal(pages[1].text, "jumps");
});

test("captionAt returns the active caption", () => {
  const caps = parseSrt(SRT);
  assert.equal(captionAt(caps, 500)?.text, "Hello");
  assert.equal(captionAt(caps, 1500)?.text, "world");
  assert.equal(captionAt(caps, 5000), null);
});

test("CaptionTrack shows the active caption as scene time advances (via updater)", async () => {
  const { CaptionTrack } = await import("../src/captions/caption_track.ts");
  const caps = parseSrt(SRT);
  const ct = new CaptionTrack(caps, { karaoke: true });
  assert.equal(ct.text, "Hello"); // t=0
  ct.update(0.5); // -> 500ms
  assert.equal(ct.text, "Hello");
  assert.ok(ct.revealFraction > 0.4 && ct.revealFraction < 0.6, "karaoke ~half revealed");
  ct.update(1.0); // -> 1500ms
  assert.equal(ct.text, "world");
  ct.update(5.0); // past the end
  assert.equal(ct.text, "");
  ct.seekMs(250);
  assert.equal(ct.text, "Hello");
});
