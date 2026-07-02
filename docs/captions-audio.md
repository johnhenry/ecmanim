# Captions & audio-reactive

Phase-2 adoption additions (from Remotion's `@remotion/captions` and
`@remotion/media-utils`). Isomorphic; the FFT is dependency-free.

## Captions

```js
import { parseSrt, serializeSrt, createTikTokStyleCaptions, CaptionTrack } from "manim-js";

const captions = parseSrt(srtString);          // Caption[] { text, startMs, endMs, ... }
const { pages } = createTikTokStyleCaptions({   // karaoke pages (word-by-word)
  captions, combineTokensWithinMilliseconds: 400,
});

// In a Scene: an overlay that shows the active caption for the current time.
this.add(new CaptionTrack(captions, { karaoke: true, point: [0, -3, 0], fontSize: 0.5 }));
```

`CaptionTrack` accumulates `dt` via an updater, so it stays in sync through
`play()`/`wait()`; `karaoke: true` reveals the active line progressively (reusing
`RasterText.revealFraction`). Transcription (Whisper/whisper.cpp) is an external
step that produces `Caption[]`.

## Audio-reactive

```js
import { getAudioData, visualizeAudio, alwaysRedraw } from "manim-js";
// (getAudioData: Node decodes via ffmpeg; browser via decodeAudioData)

const audioData = await getAudioData("music.mp3", { sampleRate: 44100, channels: 1 });

const bars = alwaysRedraw(() => {
  const frame = Math.round(this.time * 30);
  const spec = visualizeAudio({ audioData, frame, fps: 30, numberOfSamples: 32 }); // [0,1] per bin
  return makeBars(spec); // build a VGroup of bars from the spectrum
});
this.add(bars);
this.addSound("music.mp3");
```

`visualizeAudio` returns `numberOfSamples` values in `[0,1]` (left = bass → right
= highs) via a per-frame windowed FFT. `getWaveformPortion` gives amplitude
slices (oscilloscopes) and `createSmoothSvgPath` turns points into a flowing
line. The FFT (`fftInPlace`, `magnitudeSpectrum`) is a compact pure-JS radix-2
implementation — no dependency, works headless.

See `examples/audio-reactive.ts`.
