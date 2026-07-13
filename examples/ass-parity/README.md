# ASS/SSA subtitle suite

**Real ASS/SSA subtitle files, played as first-class ecmanim mobjects —
plus the reverse: exporting ecmanim's own captions/shapes back out to
`.ass`.** `loadASS(text)` turns a `.ass`/`.ssa` script into a scrub-safe
`ASSMobject` — per-run position/rotation/color/clip override tags,
continuous sweep karaoke, and a `\p`-mode vector-drawing engine — posed as
a pure function of time so it renders headlessly, cache-safe, on the same
Canvas-2D path as everything else. `wordCaptionTrackToAss`/
`vmobjectToAssDrawing` do the reverse: turn ecmanim's own word-timed
captions or a static shape into a real, portable `.ass` deliverable.

```bash
ECMANIM_DEMO_QUALITY=low npx tsx examples/ass-parity/01-karaoke-sweep.ts
```

Full feature census, tag table, and known approximations:
[`../../docs/subtitles.md`](../../docs/subtitles.md). The 23 synthetic
fixtures these demos and the unit/golden-frame test suite draw on live in
[`fixtures/`](./fixtures/) — this is a 100%-synthetic corpus (no specific
real fansub-distributed `.ass` file is bundled or assumed safe to use from
memory; see `docs/subtitles.md`'s "Real-corpus honesty" section).

## Scorecard — 3/3 rendered & frame-verified

| # | Demo | Proves |
|---|------|--------|
| 01 | karaoke-sweep | Continuous sweep karaoke (`\kf`/`\K`) — secondary→primary color sweep across each syllable's own duration |
| 02 | drawing-sign | `\p<n>` drawing-mode dialogue lines — a vector shape drawn via the `m`/`l` mini-language, then rotated via `\frz` |
| 03 | export-roundtrip | The full export round trip: `WordCaptionTrack` → `wordCaptionTrackToAss` → `loadASS` → real render, proving the exported `.ass` is genuinely loadable, not just a plausible string |

## The player (all library, this campaign)

`loadASS(text, {width, height, speed, fontResolver})` → `ASSMobject` with
`setTime(t)`/`setFrame(f)` (pure, scrub-safe, any call order),
`attachTo(scene)` (clock updater), `cues()`/`cue(i)`, `styles()`/`style(name)`,
and `warnings` (deduped by tag name). Full tag table and the export API
(`wordCaptionTrackToAss`, `vmobjectToAssDrawing`) in
[`../../docs/subtitles.md`](../../docs/subtitles.md).
