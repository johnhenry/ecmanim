# External tools

manim-js delegates several jobs to programs on your system rather than bundling
them. **None of these are npm dependencies** — `npm install` does not provide
them, and each degrades in its own way when missing. Run `npx manim-js
checkhealth` to see what your machine has.

| tool | required? | used for | when missing |
|------|-----------|----------|--------------|
| **ffmpeg** | for Node video | every Node render (PNG frames → MP4/WebM/GIF/MOV), partial-movie concat, audio muxing, watermark filters, silent TTS clips, PCM decode for `getAudioData`/FFT | no Node video output at all; browser rendering (canvas/WebM via MediaRecorder) is unaffected |
| **ffprobe** | with ffmpeg | duration/stream probing: video ingestion (`VideoMobject`), TTS clip timing | durations fall back to estimates or 0 |
| `say` (macOS) / `espeak-ng` (Linux) | optional | the `system` voiceover TTS provider | provider reports unavailable; resolution falls through to `silent` (mute, correctly paced). See [voiceover.md](voiceover.md) for install commands + better-sounding alternatives |
| `latex` (or `pdflatex`) + `dvisvgm` | optional | the publication-grade real-TeX math backend (`MathTexDvisvgm`) | falls back to MathJax — which is the default anyway |
| **Chrome / Chromium** (reached over CDP, not spawned) | optional | the opt-in GPU render path (`renderGL`) — drives WebGL in a headless Chrome at `$MANIM_CDP_URL` (default `http://localhost:9222`) | `renderGL` unavailable; the CPU renderer (including software 3D) is unaffected |

Two practical notes:

- **ffmpeg is the one that matters.** Everything else is an enhancement with a
  fallback; without ffmpeg the Node backend cannot produce video. It also must
  be a build with the codecs you target (the stock builds from distro packages
  / `brew install ffmpeg` are fine for mp4/webm/gif).
- **Detection is lazy and per-feature.** manim-js probes for a binary at the
  moment a feature needs it (`command -v`, version calls, CDP probe) and picks
  the fallback silently where one exists. `checkhealth` is the eager,
  all-at-once version of those probes.
