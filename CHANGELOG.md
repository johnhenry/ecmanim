# Changelog

## 1.7.0 — adoption phase 1: pure primitives

First phase of the tool-survey adoption program (Manim / Remotion / GSAP / Motion
Canvas / showrunner / …). Small, dependency-free, isomorphic wins:

- **AE-style expression helpers** (`wiggle`, `remap`, `ramp`, `valueAtTime`,
  `compose`, `mulberry32`): pure, deterministic (order-independent) drivers for
  animating properties from updaters. `wiggle` is value-noise, safe under scrubbing.
- **GSAP-style `Timeline`** (`timeline()`): place animations with a compact
  position grammar (`"+=1"`, `"-=0.5"`, `"<"`/`">"` with offsets, labels, absolute
  seconds) → one `AnimationGroup` for `scene.play()`. Removes manual `t` bookkeeping.
- **`VectorDecimalNumber`**: a live number rendered as crisp vector glyph outlines
  (SVG-friendly, individually animatable digits), mirroring `DecimalNumber`'s
  formatting + edge-fix — fixes the raster gap.
- **`renderStill(scene, {frame|time})`** + a **composition registry**
  (`registerComposition`/`listCompositions`/`compositionsToJSON`) for thumbnails,
  poster frames, and enumerable renderable scenes.
- **Style + aspect-ratio presets**: `STYLE_PRESETS` (named looks incl. `3b1b-dark`)
  and `ASPECT_RATIO_PRESETS` (`16:9`/`9:16`/`1:1`/…); `render()` gains `style` and
  `aspectRatio` options (aspect overrides dimensions; style sets background/font).

27 new tests (537 total); type-clean; verified end-to-end (still + preset renders).

## 1.6.0 — video metadata (schema.org · IIIF · provenance)

Export the web's video metadata standards straight from a render — manim-js knows
a video's duration, dimensions, and `nextSection()` structure at render time, so
it doesn't have to reverse-engineer them. See [docs/metadata.md](docs/metadata.md).

- **`toVideoObject`** — schema.org `VideoObject` JSON-LD (discovery); chapters
  become `hasPart` `Clip`s. `toVideoObjectScript` returns an embeddable
  `<script type="application/ld+json">`.
- **`toIIIFManifest`** — IIIF Presentation 3.0 Manifest (presentation/navigation):
  Canvas with `duration`, a painting `Video` body, and — the standout —
  **`structures` Ranges (chapters) derived from `nextSection()`**, targeting
  temporal fragments.
- **Provenance sliver** — opt-in `provenance` adds a manim-js `creator`
  `SoftwareApplication` and the IPTC digital-source-type for algorithmic media
  (folded into both formats). Full IPTC VMH is intentionally out of scope.
- **IIIF ingest** — `loadVideo` (Node + browser) accepts a IIIF manifest (object,
  or a URL with `{ iiif: true }`), resolves the video body URL, and attaches the
  manifest's chapters to the `VideoMobject` (`mob.chapters`). `resolveIIIFVideo`
  is exported. Node reads remote URLs through ffmpeg (cached by URL).
- **`<manim-player>`** injects the `VideoObject` JSON-LD when you set `metadata`
  (off otherwise); also `getVideoObject()` / `injectSchema()`.
- `render()` results now include `sections` (feeds the metadata input).

All isomorphic (exported from `manim-js`). 15 new tests (510 total); type-clean;
verified end-to-end (scene sections → VideoObject + IIIF manifest, round-tripped).

## 1.5.0 — WebCodecs browser video decode

Upgrades the browser `VideoMobject` path with a WebCodecs decoder, behind the
same synchronous `frameAt()` contract (drop-in; VideoMobject unchanged). See
[docs/video.md](docs/video.md).

- **`WebCodecsProvider`**: demuxes an mp4/mov with `mp4box.js` and decodes the
  whole stream in a single pass through a WebCodecs `VideoDecoder`, then resamples
  the decoded frames onto the target fps grid as `ImageBitmap`s. Much faster than
  the seek-and-capture path (one decode pass vs. O(frames) sequential seeks).
- **`loadVideo` mode `"auto"` (new default)**: prefers `webcodecs` for a URL
  source when the browser supports it and mp4box can demux it, and transparently
  falls back to the dependency-free `precapture` path otherwise (or on any
  demux/decode failure). Explicit `mode: "webcodecs" | "precapture" | "live"`
  still available; `webcodecs` surfaces errors instead of falling back.
- `mp4box` added as a dependency, imported lazily (never at module load) so the
  module stays Node-import-safe and unbundled-browser-safe. Also exports
  `webCodecsAvailable()`.

Verified in live headless Chrome (Mesa): mode `"webcodecs"` demuxed + decoded an
h264 mp4 to 10 `ImageBitmap` frames with correct dims and frame-swapping. 4 new
tests (492 total, WebCodecs decode itself covered by the browser e2e).

## 1.4.0 — VideoMobject (external-video ingestion)

Place an external video clip inside a scene. `VideoMobject` is an `ImageMobject`
whose bitmap is swapped per scene frame to the clip's frame for the current time,
so it plays through `play()`/`wait()` and stays in sync with scene time. See
[docs/video.md](docs/video.md).

- **Isomorphic core** (`VideoMobject`, `VideoFrameProvider`): the class depends
  only on a small sync `frameAt(t)` provider interface; each backend supplies a
  provider. Frame-accurate by construction (exact frame extraction, not
  `<video>` keyframe seeking). Deterministic `dt` accumulation, so it composes
  with the partial-movie cache and `renderParallel`.
- **Node** (`loadVideo`): frames extracted with ffmpeg into a content-hash decode
  cache, pre-decoded to memory for O(1) sync lookup. Optional **audio
  ingestion** — the clip's audio track is muxed into the render via the existing
  `scene.addSound` path (output carries both video + audio). Also exports
  `probeVideo` / `extractFrames`.
- **Browser** (`loadVideo`): a `precapture` provider (dependency-free,
  frame-accurate — seeks a `<video>` and captures each frame to an `ImageBitmap`)
  and a `live` provider (real-time `<video>` passthrough). Node-import-safe; a
  WebCodecs path is noted as a future upgrade.

New example `examples/video.ts` (synthesizes its own clip). 34 new tests
(488 total); type-clean; Node path verified end-to-end (rendered mp4 carrying
both h264 video and muxed aac audio).

## 1.3.0 — alternate renderers

Two opt-in render targets that share the same backend-agnostic scene graph. The
CPU Canvas-2D rasterizer stays the default (its determinism underpins the
content-hash cache); see [docs/renderers.md](docs/renderers.md).

- **SVG / vector output** (`SVGRenderer`, `mobjectsToSVG`, and Node
  `format: "svg"`). A second render backend that emits an SVG document per frame
  — VMobjects → `<path>` cubic Béziers, raster `Text` → `<text>`, `ImageMobject`
  → `<image>` — projected through the exact same `camera.toPixel` as the canvas,
  so geometry matches pixel-for-pixel but is resolution-independent, tiny, and
  editable. `render(Scene, { format: "svg" })` writes a single `.svg` (with
  `saveLastFrame`) or a numbered sequence. Deterministic, no GPU, no browser. 3D
  is a documented painter's-order vector approximation (no per-pixel z-buffer).
- **Opt-in headless GPU** (`renderGL`, Node). Renders the existing Three.js/WebGL
  backend inside a CDP-accessible headless Chrome (WebGL2 via Mesa llvmpipe — no
  physical GPU) and captures the video back to disk, giving real per-pixel
  lighting, MSAA, and GPU strokes. Zero-dependency CDP client (Node global
  `fetch`/`WebSocket`); reuses `browser-three`'s `record()` and the shared
  ffmpeg helpers for webm→mp4/mov. Non-deterministic vs. the CPU path, so it
  stays out of the partial-movie cache. Also exports `probeCDP`/`connectCDP`.

New examples: `examples/svg-output.ts`, `examples/render-gl.ts` (+ the
browser-importable `examples/scenes/gl-demo-scene.ts`). 19 new tests (473 total);
type-clean; both paths verified end-to-end (SVG on disk; GL via live headless
Chrome producing valid H.264/VP9).

## 1.2.0 — Remotion-inspired features

Eight features borrowed from studying [Remotion](https://www.remotion.dev)'s
philosophy and source, adapted to manim-js's imperative, GPU-less architecture
(no React/DOM authoring model, no Chromium-screenshot capture):

- **`interpolate(input, inputRange, outputRange, opts)`** — Remotion-style range
  mapping with `easing` and `extrapolateLeft`/`extrapolateRight` (`clamp` /
  `extend` / `identity` / `wrap`). Claims the bare top-level name; the existing
  2-arg lerp stays namespaced as `bezier.interpolate`.
- **`spring()` / `measureSpring()` / `springRate()`** — analytic (closed-form)
  damped-harmonic-oscillator easing where the duration is *derived* from the
  physics (`mass`/`damping`/`stiffness`/`overshootClamping`). Pure function of
  frame, so it preserves the deterministic content-hash render cache.
- **`Easing.in/out/inOut(fn)` + `Easing.bezier(x1,y1,x2,y2)`** — composable
  easing combinators over any base curve, plus a CSS-style cubic-bezier factory.
- **`renderParallel()` / `discoverSegments()` / `partitionSegments()`** —
  worker-thread parallel rendering that shards play()/wait() *segments* across
  cores and reuses the existing partial-movie-file cache + ffmpeg concat. (The
  segment is the parallel unit; per-frame parallelism is impossible since frame
  N depends on 0..N-1 within a play.)
- **`delayRender()` / `continueRender()` / `waitForRender()`** — a unified
  async-asset gate; the Node renderer now registers font/MathJax warm-up as
  blockers and awaits the gate before running `construct()`.
- **`Sequence()` + `crossFade`/`slide`/`wipe`** — a frame-origin time-shift
  wrapper (extends the AnimationGroup timings machinery) and a mobject-level
  transition catalogue that keeps timing orthogonal to visual presentation.
- **`<manim-player>` Web Component** (`defineManimPlayer()`) — a
  framework-agnostic custom element wrapping `Player`, with attributes,
  imperative `seekTo`/`play`/`pause`, and `ready`/`frame`/`ended` events.
  Node-import-safe (the `HTMLElement` reference is lazily guarded).
- **Typed scene params + `calculateMetadata`** — `defineSchema()` (a tiny local
  validator, no Zod) plus `resolveSceneMetadata()`; the Node renderer resolves a
  scene's static `schema`/`calculateMetadata` to fill fps/width/height defaults.

80 new tests (435 total); type-clean; browser `<manim-player>` verified headless.

## 1.1.0 — prior-art learnings

Features informed by studying other manim/web ports (JazonJiao/Manim.js,
maloyan/manim-web, the Dart manim-web, Motion Canvas, MathBox, ManimGL):

- **Python→TypeScript scene converter** (`py2ts` / `bin/py2ts.ts`): transpiles the
  common manim-scene subset to manim-js (imports, `Scene` subclass, `self.play`
  → `await this.play`, kwargs → config objects, snake_case → camelCase).
- **Signals reactivity** (`createSignal`/`computed`/`effect`/`reactive`/`bind`): a
  lazy dependency-tracking alternative to updaters/`always_redraw`.
- **Hardened browser MathJax loader**: npm → CDN fallback with handler-registration
  verification (fixes bundler code-splitting breakage). Plus `texToSVG()`.
- **Raster LaTeX** (`MathTexImage`/`mathTexImage`): render a MathJax equation to a
  bitmap for dense/static equations (cheaper than glyph Béziers).
- **Reliable `TransformMatchingTex`**: explicit key matching by tex-part + `keyMap`
  override + `matchingParts()`.
- **In-browser GIF/MP4 export** (`recordGif`/`recordMp4`/`recordVideo` via gifenc +
  WebCodecs/mp4-muxer) alongside the existing WebM.
- **GPU SDF strokes + lighting** in the Three.js backend (`strokeMode: 'sdf'`,
  `lit: true`) — crisp anti-aliased strokes and real GPU-lit surfaces.
- **Optional dvisvgm Node LaTeX backend** (`mathTexDvisvgm`): real TeX → SVG →
  Béziers with a disk cache, graceful fallback to MathJax when TeX is absent.
- **Live playground + scrubber** (`examples/playground/`, `Player`) and a
  `Scene.onLog` observability hook.
- Fix: `polygon-clipping` is now lazily imported so the unbundled browser bundle
  loads (a Phase-4 regression).

## 1.0.0 — manim parity milestone

A near-complete TypeScript port of ManimCommunity manim, delivered as a phased
program (0–8). Renders the same `Scene` code in Node (MP4/WebM/GIF/MOV/PNG) and
the browser (Canvas-2D + optional WebGL/Three.js). ~390 exports, ~120 registered
mobjects, ~67 animations, ~2200 colors, 318 tests, type-clean.

### Highlights by phase

- **Phase 0 — bug fixes.** Real `DashedLine` dashes, `FadeIn`/`FadeOut` `scale`,
  removed the duplicate `Rotate`, `AnimationGroup` linear rate func, `DecimalNumber`
  edge-fix/commas/sign, and default-value parity (Circle=RED, etc.).
- **Phase 1 — TypeScript.** Full migration; Node 25 runs `.ts` directly, `tsc`
  emits `dist/` + `.d.ts`. Type-clean project.
- **Phase 2 — plugin registry.** `use(plugin)` + a typed registry (mobjects,
  animations, rate funcs, colors, scenes); built-ins registered; name-resolving
  `Color.parse` and `running()`.
- **Phase 3 — core infrastructure.** `become`/`saveState`/`restore`/`generateTarget`,
  `match_*`, `applyMatrix`/`applyComplexFunction`, `arrangeInGrid`; VMobject
  smoothing/anchors/partials/background-stroke/gradient; per-submobject `lag_ratio`,
  `reverseRateFunc`, `Transform` `pathArc`; smooth-handle solver, `paths.ts`, and
  the full space-ops (rotation matrices, quaternions, ear-clipping, …).
- **Phase 4 — the missing class library.** Geometry (tips, arcs, Sector/Angle,
  polygrams/Star/RoundedRectangle, boolean ops, Matrix/Table/Brace, Graph/DiGraph);
  vector `Text` (`.chars`/`t2c`) + `MarkupText` + `MathTex` token/part model +
  text-mode `Tex` + Code/Paragraph/Title/Variable; full Axes helpers (area/Riemann/
  secant/tangent/labels) + PolarPlane/ComplexPlane/LogBase + ParametricFunction/
  FunctionGraph/ImplicitFunction + BarChart/SampleSpace + vector fields; 3D solids
  (caps, Dot3D/Line3D/Arrow3D/Prism, polyhedra) + camera gamma/light/fixed-in-frame
  + real ThreeDAxes; the full animation catalogue (~46 added, incl.
  TransformMatchingShapes/Tex, MoveToTarget/Restore, Homotopy, DrawBorderThenFill).
- **Phase 5 — rate functions, colors, constants.** All ease families +
  squishRateFunc etc.; the full ~2200-color palette (core + X11/XKCD/SVG/BS381/
  AS2700/DVIPS) + color utilities; constants/enums.
- **Phase 6 — CLI, config, caching, cameras/scenes.** MovingCameraScene (animatable
  `camera.frame`), ZoomedScene, VectorScene, LinearTransformationScene, Mapping/
  MultiCamera; layered config, partial-movie-file caching, sections; a full CLI
  (`render` flags + `cfg`/`init`/`plugins`/`checkhealth`).
- **Phase 7 — cross-language plugins.** A portable JSON manifest (colors/rate-funcs/
  surfaces/shapes as portable expressions) loadable by both manim-js and Python
  manim, plus a shared Rust→WASM math core callable from JS and Python (wasmtime),
  verified byte-identical.
- **Phase 8 — parity suite, docs, release.** A structural parity/coverage harness,
  a rendered gallery, a full 50-row parity table, and `docs/` (architecture, CLI,
  plugins).

### Honest divergences

`DecimalNumber` stays raster-backed; `MathTex`/`VText` in the browser need a font
(`setDefaultFont`) / bundler; LaTeX is MathJax→SVG→Béziers (no LaTeX binary); 3D is
CPU projection + z-buffer + Gouraud (no per-pixel Phong); the Python side of the
manifest/WASM needs `manim`/`wasmtime` installed.
