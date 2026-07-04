---
title: "External tools & optional capabilities"
---

ecmanim delegates a number of jobs to things outside the package — system
programs, optional npm packages, network APIs, a WASM module, system fonts.
The pattern is the same everywhere: **probe lazily at the moment a feature
needs the capability, fall back gracefully where a fallback exists**. This page
is the index of every instance. Run `npx ecmanim checkhealth` for an eager
all-at-once report of what your machine has.

## System programs (shelled out to; npm does not provide these)

| tool | required? | used for | when missing |
|------|-----------|----------|--------------|
| **ffmpeg** | for Node video | every Node render (PNG frames → MP4/WebM/GIF/MOV), partial-movie concat, audio muxing, watermark filters, silent TTS clips, PCM decode for `getAudioData`/FFT | no Node video output at all; browser rendering (canvas/WebM via MediaRecorder) is unaffected |
| **ffprobe** | with ffmpeg | duration/stream probing: video ingestion (`VideoMobject`), TTS clip timing | durations fall back to estimates or 0 |
| `say` (macOS) / `espeak-ng` (Linux) | optional | the `system` voiceover TTS provider | provider reports unavailable; resolution falls through to `silent` (mute, correctly paced). See [voiceover.md](/guides/voiceover/) for install commands + better-sounding alternatives |
| `latex` (or `pdflatex`) + `dvisvgm` | optional | the publication-grade real-TeX math backend (`MathTexDvisvgm`) | falls back to MathJax — which is the default anyway |
| **Chrome / Chromium** (reached over CDP, not spawned) | optional | the opt-in GPU render path (`renderGL`) — drives WebGL in a headless Chrome at `$MANIM_CDP_URL` (default `http://localhost:9222`) | `renderGL` unavailable; the CPU renderer (including software 3D) is unaffected |

## Optional npm packages (`optionalDependencies`, lazy-imported)

| package | used for | when missing |
|---------|----------|--------------|
| `@napi-rs/canvas` | all Node rasterization (render, renderStill, snapshots) + font registration | Node rendering unavailable (`checkhealth` flags it); pure-data features (plan IR, interchange, captions parsing…) still work |
| `three` | the browser WebGL backend (`ecmanim/browser-three`) and `renderGL`'s in-page renderer | WebGL backend unavailable; Canvas-2D browser backend and CPU 3D unaffected |

(The regular `dependencies` — mathjax-full, opentype.js, gifenc, mp4-muxer,
mp4box, polygon-clipping — are also lazy-imported for startup speed, but npm
always installs them; they can only be "missing" under unusual bundler setups.)

## Network services (opt-in via environment variables)

| service | env var | used for | when unset |
|---------|---------|----------|------------|
| OpenAI TTS (`api.openai.com`) | `OPENAI_API_KEY` | the `openai` voiceover provider (`gpt-4o-mini-tts`) | provider reports unavailable; TTS resolution falls through (`system` → `silent`) |
| ElevenLabs TTS (`api.elevenlabs.io`) | `ELEVENLABS_API_KEY` | the `elevenlabs` voiceover provider | same fallthrough |
| — | `MANIM_CDP_URL` | override the Chrome DevTools endpoint for `renderGL` and the GPU e2e tests | defaults to `http://localhost:9222`; point it at an unreachable address to force-skip GPU paths |

These are the only third-party *services* the library calls on its own.
Separately, asset loaders accept http(s) URLs — remote video sources
(`VideoMobject` / IIIF manifests), fonts, audio, Lottie files — but those only
touch the network when you pass a URL instead of a local path. With local
assets and no TTS keys, everything (including all built-in formats) runs fully
offline.

## Other outside-the-package capabilities

- **WASM math core** (`packages/manim-wasm/manim_core.wasm`): an opt-in
  accelerator loaded via `loadWasm()`; every accelerated function
  (`bezierEvalWasm`, `earclipWasm`, …) has a pure-JS implementation that is
  used when the module isn't loaded. Also consumable from Python manim — see
  [plugins.md](/guides/plugins/).
- **System fonts**: discovered by walking the OS font directories and
  registered with the canvas at render time (`checkhealth` reports the count).
  With none found, text falls back to whatever the canvas default resolves to.

## Bring-your-own backends (documented, not shipped)

Some features define a pluggable interface and document recommended external
engines without bundling an adapter: **planck.js / @dimforge/rapier2d** for
rigid-body physics ([physics.md](/guides/physics/)), **ThorVG-WASM** for
full-fidelity Lottie import ([interchange.md](/guides/interchange/)), **ELK/dagre**
for large-graph diagram layout
([animation-presentation.md](/guides/animation-presentation/)), and **Piper** (or any
TTS with word timings) via `registerTTSProvider`
([voiceover.md](/guides/voiceover/)).

## Practical notes

- **ffmpeg and @napi-rs/canvas are the two that matter** for the core use case
  (Node video). Everything else is an enhancement with a fallback.
- **Detection is lazy and per-feature.** ecmanim probes at the moment a
  feature needs the capability (`command -v`, version calls, key presence, CDP
  probe, `import()` in try/catch) and picks the fallback silently where one
  exists. `checkhealth` is the eager version of those probes.

## macOS notes

The project is developed primarily on Linux; two gaps show up on macOS.

- **Vector-text glyph outlines (`VText`, `MathTex`, `VectorDecimalNumber`) need a
  concrete `.ttf`/`.otf` file** for `opentype.js` to extract paths from —
  `loadVectorFont()` resolves one via `fc-match sans-serif`, then falls back to
  scanning common font directories (`src/renderer/fonts-node.ts`). On Linux,
  `fc-match` typically resolves straight to a `.ttf` (DejaVu Sans, Liberation
  Sans, …). On macOS, `fc-match` (from Homebrew's `fontconfig`, if installed)
  commonly resolves `sans-serif` to a `.ttc` **font collection** (e.g. Hiragino),
  which is intentionally rejected — `opentype.js` doesn't parse collections —
  and the old fallback scanner only checked Linux font directories, so
  resolution failed outright with "VText needs a font." The scanner now also
  checks the standard macOS font directories (`/System/Library/Fonts`,
  `/System/Library/Fonts/Supplemental`, `/Library/Fonts`, `~/Library/Fonts`) and
  finds `Arial.ttf` there. `checkhealth`'s font check was unaffected by this bug
  — `@napi-rs/canvas` discovers macOS system fonts fine for *raster* text; only
  the separate vector-outline path needed a real file path.
- **The watermark filter (`applyWatermark`, `drawtext`) needs an ffmpeg build
  with `libfreetype`.** Homebrew's default `ffmpeg` formula does **not**
  compile that in (`ffmpeg -filters | grep drawtext` returns nothing); the
  separate `ffmpeg-full` formula does. This is an ffmpeg build limitation, not
  something ecmanim can detect-and-fall-back for beyond skipping — install
  `ffmpeg-full` (`brew install ffmpeg-full`) if you need text watermarks. Most
  Linux ffmpeg packages (including the standard `apt`/`dnf` builds) ship with
  `libfreetype` enabled by default, which is why this doesn't surface there.
