---
name: ecmanim-captions-audio
description: Add burned-in captions and audio-reactive visuals to ecmanim scenes — SRT parse/serialize, TikTok-style word-by-word karaoke caption pages, an on-screen CaptionTrack overlay, and audio analysis (PCM decode, FFT/getAudioData/visualizeAudio, waveform slices) for spectrum bars, oscilloscopes, and audio-synced motion. Use this skill when the user wants subtitles, karaoke-style text reveal, TikTok captions, or bars/waveforms that react to a music/voice track.
metadata:
  tags: ecmanim, captions, srt, karaoke, audio, fft, waveform
---

# ecmanim-captions-audio

Child skill of `ecmanim` (read `../ecmanim/SKILL.md` first for the shared
Plan→Code→Render→Verify→Iterate loop and `checkhealth`-first convention — not
repeated here). This skill covers two adjacent, isomorphic (Node + browser)
features ported from Remotion: **captions** (`@remotion/captions`-style SRT +
karaoke) and **audio-reactive** visuals (`@remotion/media-utils`-style FFT).
Full detail: [../../docs/captions-audio.md](../../docs/captions-audio.md) —
read it before asserting an API shape; this file only orients you.

## Captions

Everything lives in `src/captions/` and is exported from the package root:

```ts
import { parseSrt, serializeSrt, createTikTokStyleCaptions, captionAt, CaptionTrack } from "ecmanim";
import type { Caption, CaptionToken, CaptionPage } from "ecmanim";
```

- **`parseSrt(srt: string): Caption[]`** — one `Caption` per SRT cue:
  `{ text, startMs, endMs, timestampMs, confidence }`. Tolerant of the optional
  numeric index line; `timestampMs` is synthesized as the cue midpoint (SRT has
  no per-word timing) and `confidence` is always `null`.
- **`serializeSrt(captions: Caption[]): string`** — inverse of `parseSrt`.
- **`captionAt(captions, timeMs): Caption | null`** — the cue active at
  `timeMs` (half-open `[startMs, endMs)`), or `null`.
- **`createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds })`**
  → `{ pages: CaptionPage[] }` — greedily merges consecutive captions into a
  `CaptionPage` (`{ text, startMs, durationMs, tokens }`) as long as the gap to
  the next one is `<= combineTokensWithinMilliseconds`; larger gaps start a new
  page. Use this to turn per-word ASR output into short on-screen "chunks" the
  way TikTok/Reels captions are chunked, or to feed `tokens` into your own
  word-by-word reveal.

Where captions come from: **transcription (Whisper / whisper.cpp / any ASR) is
an external step** you run yourself and turn into `Caption[]` (or SRT text to
feed `parseSrt`) — this module has no ASR built in, it's pure data/timing math.

### Rendering captions in a Scene

`CaptionTrack` (`src/captions/caption_track.ts`) is a ready-made overlay
mobject — it extends `RasterText`, so it behaves like any other text mobject
(position via `point`, restyle, etc.):

```ts
this.add(new CaptionTrack(captions, {
  karaoke: true,        // progressive left-to-right reveal of the active cue
  point: [0, -3, 0],
  fontSize: 0.5,
  align: "center",       // "left" | "center" | "right"
  color: "#FFFFFF",
  offsetMs: 0,            // start the internal clock at this ms
}));
```

`CaptionTrack` registers an `addUpdater` that accumulates `dt` internally, so
its notion of "current time" tracks the Scene through `play()`/`wait()`
automatically — you don't feed it time explicitly. It looks up the active cue
each tick via `captionAt`. With `karaoke: true` it drives `revealFraction`
(the same field `RasterText`'s typewriter clipping uses) from
`(elapsed - cue.startMs) / (cue.endMs - cue.startMs)`; without it, the whole
cue text shows at once. If you seek/scrub the scene time out of band, call
`track.seekMs(ms)` to resync — the updater alone won't self-correct for a
jump.

For fully custom caption UI (multi-line pages, animated per-word highlight,
etc.), skip `CaptionTrack` and drive your own mobjects from `captionAt` /
`createTikTokStyleCaptions` pages inside an `alwaysRedraw`/updater instead —
`CaptionTrack` is a convenience default, not the only path.

## Audio-reactive

Everything lives in `src/audio/` (`analyze.ts` for decode + audio-domain
math, `fft.ts` for the raw transform) and is exported from the package root:

```ts
import { getAudioData, visualizeAudio, getWaveformPortion, createSmoothSvgPath } from "ecmanim";
import { fftInPlace, magnitudeSpectrum, nextPow2 } from "ecmanim"; // low-level, rarely needed directly
```

- **`getAudioData(src, { sampleRate?, channels? }): Promise<AudioData>`** —
  decodes to PCM. `AudioData` is `{ channelWaveforms: Float32Array[],
  sampleRate, durationInSeconds, numberOfChannels }`. Defaults:
  `sampleRate: 44100`, `channels: 1` (mono). **Node decodes by shelling out to
  `ffmpeg`** (spawns it with `-f f32le`); **browser decodes via
  `fetch` + `AudioContext.decodeAudioData`** — these are genuinely different
  code paths, picked automatically by environment detection, not a shared
  implementation.
- **`visualizeAudio({ audioData, frame, fps, numberOfSamples, smoothing?, channel? }): number[]`**
  — returns `numberOfSamples` values in `[0,1]`, bin 0 = bass → last bin =
  highs, for the window centered at `frame/fps` seconds. Runs a Hann-windowed
  FFT (size = `nextPow2(numberOfSamples * 2)`) via `magnitudeSpectrum` each
  call — it's a per-frame call, not a precomputed track, so call it once per
  render frame (e.g. from `alwaysRedraw`), not in a tight loop. `smoothing`
  (default `true`) applies a 3-tap blur across bins. Prefer `numberOfSamples`
  as a power of two.
- **`getWaveformPortion({ audioData, startTimeInSeconds, durationInSeconds, numberOfSamples, channel? }): number[]`**
  — peak amplitude per bucket in `[-1,1]`, for drawing an oscilloscope/waveform
  slice rather than a spectrum.
- **`createSmoothSvgPath(points: [number, number][], tension?): string`** —
  Catmull-Rom-to-cubic-Bézier smoothing; feed it `visualizeAudio`/
  `getWaveformPortion` output zipped with x-coordinates to get a flowing SVG
  path string for a waveform/spectrum line.

### Typical pattern: spectrum bars synced to playback

```ts
const audioData = await getAudioData("music.mp3", { sampleRate: 44100, channels: 1 });

const bars = alwaysRedraw(() => {
  const frame = Math.round(this.time * 30); // fps must match addSound/render fps
  const spec = visualizeAudio({ audioData, frame, fps: 30, numberOfSamples: 32 });
  return makeBars(spec); // your own VGroup-of-rectangles builder
});
this.add(bars);
this.addSound("music.mp3"); // Scene.addSound({ timeOffset?, gain? }) — muxes the track into the render
```

Keep the `fps` passed to `visualizeAudio` consistent with the render's actual
fps (and with any `timeOffset` passed to `addSound`), since `visualizeAudio`
converts `frame/fps` to a sample index against `audioData.sampleRate` — a
mismatched `fps` desyncs the visual from the audible beat even though nothing
throws.

## Gotchas

- **Node audio decode needs `ffmpeg` on `PATH`.** `getAudioData` in Node
  spawns `ffmpeg` directly (not ffprobe); if it's missing you'll get an
  `ffmpeg pcm decode exited <code>` rejection, not a graceful fallback. Run
  `npx ecmanim checkhealth` first if audio decode fails mysteriously.
- **Node vs. browser decode are different code paths.** Sample-accurate output
  can differ slightly between ffmpeg's resampling and `AudioContext.decodeAudioData`'s
  browser-native resampling — don't assume byte-identical waveforms across
  targets, only "close enough" for visualization.
- **SRT round-trip is lossy for karaoke timing.** `parseSrt` has no per-word
  timestamps (SRT format doesn't carry them), so `timestampMs` is just the cue
  midpoint. For real word-level karaoke reveal, get per-word timing from your
  ASR step directly rather than relying on parsed SRT.
- **`CaptionTrack.karaoke` reveal is per-cue, not per-word.** It linearly
  interpolates `revealFraction` across the whole cue's `[startMs, endMs)`
  span — it does not consume `CaptionToken`/`CaptionPage` word boundaries. For
  true word-by-word highlighting, build a custom overlay from
  `createTikTokStyleCaptions` pages instead.
- **`visualizeAudio`/`getWaveformPortion` are stateless, per-call math** — no
  caching. Calling them every frame from `alwaysRedraw` is expected and cheap
  (one windowed FFT of size `nextPow2(numberOfSamples * 2)`), but don't call
  them in a hot inner loop beyond one-per-frame.
- **The FFT (`fftInPlace`) requires power-of-two length** and throws
  otherwise; `nextPow2` is exported to size buffers safely if you're calling
  `magnitudeSpectrum`/`fftInPlace` directly instead of going through
  `visualizeAudio`.

See [examples/audio-reactive.ts](../../examples/audio-reactive.ts) for a full
worked example, and [../../docs/captions-audio.md](../../docs/captions-audio.md)
for the authoritative reference this skill summarizes.
