// ASS/SSA parity demo 03: the export round trip. Builds a WordCaptionTrack
// from plain word timing (the same data createTikTokStyleCaptions produces
// from ASR output), exports it to a real karaoke .ass file via
// wordCaptionTrackToAss, then loads that exported file straight back
// through loadASS and renders it -- proving the exported file is a real,
// correct, independently-loadable ASS script, not just a plausible string.

import { Scene, loadASS } from "../../src/node.ts";
import { WordCaptionTrack } from "../../src/captions/caption_track.ts";
import { createTikTokStyleCaptions } from "../../src/captions/captions.ts";
import type { Caption } from "../../src/captions/captions.ts";
import { wordCaptionTrackToAss } from "../../src/interchange/ass.ts";
import { demoRender } from "./_run.ts";

const cap = (text: string, startMs: number, endMs: number): Caption => ({
  text, startMs, endMs, timestampMs: startMs, confidence: null,
});

const { pages } = createTikTokStyleCaptions({
  captions: [
    cap("Round ", 0, 400), cap("trip ", 400, 800), cap("through ", 800, 1300), cap("ASS", 1300, 1900),
  ],
  combineTokensWithinMilliseconds: 500,
});

class ExportRoundtrip extends Scene {
  async construct() {
    const track = new WordCaptionTrack(pages);
    const ass = wordCaptionTrackToAss(track, { fontSize: 90 });
    console.log(ass);

    const subs = loadASS(ass, { width: 13 });
    subs.attachTo(this);
    await this.wait(subs.durationMs / 1000);
    console.log("warnings:", subs.warnings.length ? subs.warnings : "(none)");
  }
}

await demoRender(ExportRoundtrip, import.meta.url);
