# Changelog

## Unreleased

### Fixed
- **Node: `Text`/`estimateTextSize()` now auto-load a system font lazily on
  first use, instead of silently falling back to the raster/`CHAR_ASPECT`
  estimate until an explicit `loadVectorFont()` call** (issue #16). Follow-up
  to 0.0.9's fix for #14: exporting `loadVectorFont()` gave callers a way to
  force real glyph metrics, but it was still opt-in, and the raster estimate
  treats every character as equal width — measured against real glyph
  metrics, the two paths could disagree by anywhere from 0.53x to 2.4x
  depending on the string's character composition (not the fixed ~10% a
  single test case had suggested). `getDefaultFont()` now resolves a system
  font via fontconfig the first time it's needed (memoized, at most once per
  process, via a Node-only registration seam so the shared
  `vectorized_text.ts` module stays browser-safe), so a fresh process
  measures text the same way `render()` does without requiring any explicit
  setup call. `loadVectorFont()`/`resolveFontPath()` remain available (now
  alongside a synchronous `loadVectorFontSync()`) for callers who want to
  choose a non-default font pattern or force the fc-match/parse cost eagerly.

## 0.0.9

### Fixed
- **`loadVectorFont`/`resolveFontPath` (Node) are now exported from
  `ecmanim`/`ecmanim/node`, not just the internal `renderer/fonts-node.ts`
  module** (issue #14). Without a public way to force the vector-glyph font
  path `render()` uses internally, `Text`/`estimateTextSize()` measured
  *before* the first `render()` call in a process silently used the
  raster/`CHAR_ASPECT` estimate instead, which could disagree with the real
  glyph metrics `render()` ends up using by ~10% — enough to turn a
  correctly-gated "measure before you render" layout check into clipped
  output. Callers doing their own layout/measurement ahead of `render()` can
  now call `await loadVectorFont()` first to get consistent measurements.

## 0.0.8

### Changed
- **`skills/ecmanim-practical-authoring`: removed the "Confirmed library
  gotchas" section documenting issues #3, #5, and #7** now that all three are
  fixed and published (0.0.7) — the section's write-ups and workarounds were
  stale as soon as they landed. Replaced with a short "Reporting a new bug"
  pointer to `assets/bug_report_template.md`.

## 0.0.7

### Fixed
- **`FadeIn` (and other single-mobject `Animation` subclasses) silently
  duck-typed an extra positional `Mobject` argument as `config`, corrupting
  the first mobject instead of raising an error.** `new FadeIn(a, b)` bound
  `b` (a live `Mobject`) to the `config` parameter; `config.shift` resolved
  to `Mobject.prototype.shift` (a function, so truthy), so `this.shiftVec`
  ended up holding a function instead of a 3-vector, NaN-poisoning `a`'s
  start geometry with no error of any kind. The `Animation` base constructor
  now throws a `TypeError` when its `config` argument is mobject-shaped
  (checked via `points`/`submobjects`/`opacity` own-fields, since most
  subclasses pass `config` through a `{ ...config }` spread before it
  reaches the base, which strips prototype methods but not these own
  fields). Multiple mobjects must be wrapped in a `Group`:
  `new FadeIn(new Group(a, b, c))`.
- **`Mobject.color` was a dead field for rendering purposes.** Raw assignment
  (`mob.color = "#E8833A"`) never synced `VMobject`'s `strokeColor`/
  `fillColor`, which the renderer actually reads, so it silently did nothing
  visible. `color` is now a getter/setter backed by `_color`; the setter
  forwards to `setColor()` so raw assignment and `setColor()` agree. Every
  `setColor()` override (`Mobject`, `VMobject`, `Text` x2) and internal
  copy/interpolate path (`become()`, `copy()`, `interpolate()`) writes to
  `_color` directly to avoid re-entering the setter and recoloring stale or
  shared submobjects.
- **CLI `render`/`plan` crashed with `TypeError: Class constructor ... cannot
  be invoked without 'new'` for scene files that imported `Scene` through a
  different specifier than the CLI itself** (e.g. `import { Scene } from
  "ecmanim/node"`, which resolves to `dist/`, while the CLI's own dev-mode
  `instanceof Scene` check imported `../src/node.ts` directly). Node loaded
  two referentially-distinct copies of `Scene`, so `instanceof` failed even
  for a legitimate subclass and the CLI misidentified it as a bare construct
  function. Replaced every `instanceof Scene` check (CLI scene discovery,
  `makeScene`/`runConstruct`) with a shared duck-typed `isSceneLike()` that
  checks for `construct`/`play`/`wait` on the prototype instead.
- **`Mobject` wasn't iterable.** `for (const m of group)` / `[...group]`
  threw "not iterable" for every `Mobject`/`VGroup`, even though Python
  manim's `VGroup.__iter__` (shallow, over direct submobjects) is a common
  idiom real scripts rely on. Added `[Symbol.iterator]()` delegating to
  `submobjects`.
- **`py2ts`: raw strings (`r"..."`) passed through with the invalid `r`
  prefix intact** (a syntax error) — very common for LaTeX in `MathTex`/`Tex`,
  which almost always use raw strings to avoid backslash-escaping. Now drops
  the prefix and escapes backslashes, preserving raw-string semantics.
- **`py2ts`: `enumerate()` wasn't converted** — `for i, x in enumerate(y):`
  produced a call to a nonexistent `enumerate` function (a `ReferenceError`
  at runtime). Now emits a small generator helper, the same way `range()`
  already does.
- **`py2ts`: top-level (non-method) `def`s were missing the `function`
  keyword** — valid only as class-method shorthand, a syntax error at module
  scope — and even when that's fixed, callers still need the definition's
  camelCased name to match: a bare call to a user-defined snake_case helper
  now gets camelCased at the call site too, consistently with the
  definition.
- `py2ts`'s header comment now names its two known-broken constructs (list/
  generator comprehensions and multi-line statements — both pass through as
  invalid TS silently, not caught by the "TODO marker" safety net the
  header otherwise promises) instead of just claiming a vague "~80% subset."

Found while building real execution-based tests for the four fixes above
(actually running converted output, not just pattern-matching the generated
text — which is exactly what caught these):
- **`py2ts` never `export`ed the converted top-level class.** The CLI
  (`ecmanim render`/`plan`) discovers scenes by inspecting the imported
  module's own exports; an unexported class is invisible to it, so
  `ecmanim render <converted-file>` silently rendered **nothing at all** —
  no error, no video, just a "no exported Scene found" warning. Every
  single file `py2ts` had ever converted was unusable via the CLI.
- **`py2ts`: `self.attr = value` assignments never rewrote the
  assignment's left-hand side.** `rewriteStatement` (which does the
  `self.` → `this.` rewrite) only ever ran on the right-hand side of an
  `=`, so `self.circle = Circle()` produced literal, undefined-at-runtime
  `self.circle = ...` — silently broken for what's likely the single most
  common Python-manim idiom for keeping a mobject reference across a
  scene.
- **`py2ts`: `.append(x)` wasn't converted to `.push(x)`** — passed
  through as syntactically valid but nonexistent-at-runtime JS.
- **`VMobject.setFill()`/`setStroke()` silently accepted the wrong
  argument shape.** Python's `set_fill(color, opacity=0.3)` naturally
  supports keyword args; `py2ts` folds them into a trailing config object
  like it does everywhere else (`setFill(RED, { opacity: 0.3 })`) — but
  the actual signature took a bare number, so `fillOpacity` silently
  became the *object* `{opacity: 0.3}`, not `0.3`. No error, no crash —
  just a wrong value once rendered. Both methods now also accept a
  trailing options object, matching the config-object convention the rest
  of the API already uses.

### Added
- **`CHAR_ASPECT` and `estimateTextSize(text, fontSize, opts?)` exported**
  from `ecmanim`/`ecmanim/node` (`src/mobject/text/Text.ts`). `CHAR_ASPECT`
  (the per-character width factor `RasterText`/`Text` use to size themselves
  before real glyph layout is available) was previously an unexported
  module-private constant — any code that wanted a fast width/height
  estimate without constructing a mobject had to hardcode a duplicate `0.55`
  and hope it never silently drifted from the real one. `RasterText._buildBox()`
  and `Text._buildRasterBox()` (which previously each inlined a slightly
  different copy of the same formula — one hard-coded a `1.2` line height,
  the other used the instance's own `lineSpacing`) now both call this one
  shared, exported function, so there's exactly one formula, used
  identically inside and outside the library. Pure refactor: verified
  byte-identical output for both call sites before and after.
- **`skills/ecmanim-practical-authoring`** — a field guide synthesized from
  real scene-authoring work: frame-geometry/layout math (verified against
  `src/core/constants.ts`), a measured-not-estimated text-width helper, an
  `Axes`-centering helper (`solveAxesShift`), a verification discipline
  (pixel-level clip checks, multi-frame sampling, minimal-repro debugging),
  and confirmed library gotchas with workarounds — including two bug
  reports that turned out to still be open despite being cited as fixed,
  independently re-verified while writing this skill. Includes
  `assets/layout.ts` (a working, runtime-verified helper module) and
  `assets/bug_report_template.md` (modeled on this repo's own best real
  bug reports, issues #1-#3).
  - `assets/layout.ts` gained `solveAxesShift(axes, { left/right/bottom/top })`
    (pin a specific axes-box edge at an exact world-space margin, in
    addition to the existing auto-center form), `assertGap()` (clearance
    between two elements, distinct from `assertClear()`'s frame-boundary
    check), and `buildStatBlock()` for a live-updating label + numeric-value
    row — built on `DecimalNumber`'s `edgeToFix` option (verified against
    `src/mobject/value_tracker.ts`), which keeps a pinned edge stationary
    across `setValue()` regardless of digit-count changes, rather than
    pre-computing a "worst-case width" externally.

## 0.0.6

### Added
- **Pointer-driven interactive camera + `<manim-chart>`** — browser-interactive
  graphing, requested after the mpld3 comparison. New `ecmanim/studio` exports:
  `attachInteractiveCamera(canvas, camera, opts)` attaches drag-to-pan/orbit and
  wheel-to-zoom to any `Camera` (2D `CanvasRenderer`, 2D-orthographic or 3D
  `ThreeRenderer`), plus `onClick`/`onHover` screen-space bounding-box picking
  via the new `pickAt()`. The base `Camera` gained a `zoom` field (default
  no-op), unifying zoom across all three renderer configurations. `<manim-chart>`
  (`ManimChartElement`/`defineManimChart`) is a new custom element that renders
  a static graph once via `CanvasRenderer` (no `Player`/frame-recording
  involved) and layers the interactive camera on top, dispatching
  `manim-chart-pick`/`manim-chart-hover` `CustomEvent`s. `startStudio({
  interactive: true })` wires the same controller into the dev-server's live
  preview via a new `Player.rerenderCurrentFrame()`. See
  [`docs/authoring-studio.md`](docs/authoring-studio.md) and
  [`examples/browser/manim-chart.html`](examples/browser/manim-chart.html).

## 0.0.5

### Fixed
- **`Axes`/`NumberPlane`'s `c2p()` didn't track transforms applied after
  construction** (`shift()`, `moveTo()`, nesting inside a shifted parent,
  etc.), reported as
  [#2](https://github.com/johnhenry/ecmanim/issues/2) — the same category of
  bug as #1, just triggered by a different code path: the *drawn* axis line
  moved (since `shift()` mutates a mobject's `points` directly) but
  `c2p()`/`coordsToPoint()` still computed from frozen construction-time
  scalars (`_leftX`/`unit`), so its output never changed. Fixed at the root:
  `NumberLine.numberToPoint()`/`pointToNumber()` now derive from the axis
  line's *current* rendered endpoints (`axisLine.getStart()`/`getEnd()`) via
  affine-transform-safe interpolation/projection, instead of the frozen
  scalars — so they stay correct under any subsequent shift/scale/rotate, or
  nesting inside a transformed parent group. `Axes.coordsToPoint()`/
  `pointToCoords()` were simplified to sum/project per-axis displacements
  from a shared origin (mirroring upstream Python manim's
  `CoordinateSystem.coords_to_point`), replacing the more fragile
  reference-relative `_xWorld`/`_yWorld`/`_rawYPoint` scalar arithmetic added
  for #1. Added a regression test covering a post-construction `shift()`,
  including the #1 (asymmetric range) + #2 (shift) cases composed together.

## 0.0.4

### Fixed
- **`Axes`/`NumberPlane` placed points at the wrong x-coordinate for any
  `xRange` not centered on zero** (e.g. `[0, 70]`), reported as
  [#1](https://github.com/johnhenry/ecmanim/issues/1). `coordsToPoint()`
  (`c2p`) computed its x-coordinate via `xAxis.numberToPoint()`, which uses
  the `NumberLine`'s pre-shift `_leftX` and ignores the `shift()` applied in
  the `Axes` constructor to re-center the axis on its zero-reference — so the
  *drawn* axis line moved but every plotted point/line/dot didn't, producing
  a constant horizontal offset. Invisible for a symmetric range (shift is
  zero) — exactly why it slipped through the bundled example and test suite.
  Fixed by mirroring the y-axis's already-correct `_yWorld()` pattern with an
  analogous `_xWorld()`, used by `coordsToPoint`, `pointToCoords`, and
  `getXAxisLabel`. Added a regression test asserting `c2p()` output lands on
  the actual rendered axis line for an asymmetric range, plus a round-trip
  `c2p`/`p2c` check.

## 0.0.3

### Added
- A hierarchical `skills/` folder (root `ecmanim` skill + 9 domain skills:
  timeline, captions/audio, voiceover, presentation, interchange, physics,
  authoring-pipeline, studio, render-cli) for LLM coding agents. Ships as
  plain reference material — nothing auto-activates on install.

### Fixed
- **`skills/` was never actually published to npm.** It was committed to git
  but missing from `package.json`'s `files` array, so `0.0.1`/`0.0.2` shipped
  without it despite existing in the repo. Now included.
- `skills/README.md` documents [`skills-npm`](https://github.com/antfu/skills-npm)
  (`npx skills-npm`) as the standard opt-in way to symlink these skills into
  an agent's skills directory, alongside the existing manual copy/symlink
  instructions.

## 0.0.2

### Fixed
- **The published npm CLI was completely broken.** `bin/ecmanim.ts` and
  `bin/py2ts.ts` shipped as raw `.ts` source; Node refuses zero-config
  TypeScript type-stripping for anything under `node_modules`, so every
  `npx ecmanim <command>` and `npx py2ts` crashed immediately with
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` for any real install — 100%
  broken for every consumer, every subcommand. Only ever "worked" when run
  from inside a git checkout of the repo itself, which is how it had always
  been tested. Fixed by compiling `bin/*.ts` to `dist/bin/*.js` (new
  `tsconfig.bin.json`) and pointing `package.json`'s `bin` field there.
  Verified against a real `npm pack` + fresh install in an unrelated
  directory, not just source-mode.
- `ecmanim --help`/`-h` with no subcommand exited 1 instead of 0 (only
  `<subcommand> --help` exited 0 correctly).
- **`applyWatermark()` crashed the whole render on ffmpeg builds without
  `libfreetype`** (e.g. Homebrew's default `ffmpeg` formula, which omits the
  `drawtext` filter it needs). Now probes for the filter and warns + no-ops
  instead of throwing, matching the project's established fallback pattern
  (TeX → MathJax, TTS → silent).
- **`renderGL()`/browser `record()` frame-capture pacing.** Captured frames
  were pushed on every `requestAnimationFrame` tick with no throttling, so
  under a headless/software WebGL backend (rAF firing faster than the target
  fps) the captured WebM's wall-clock timestamps compressed the whole clip
  into a fraction of its real runtime (e.g. a 1.4s scene reporting ~0.33s /
  ~117fps). Now paced to each frame's real target time, matching the live
  `play()` path. See [docs/renderers.md](docs/renderers.md).
- **macOS: vector-text font resolution.** `loadVectorFont()`'s fallback font
  scanner only checked Linux font directories, so on macOS (where `fc-match`
  commonly resolves `sans-serif` to a rejected `.ttc` collection) `VText`,
  `MathTex`, and `VectorDecimalNumber` failed with "needs a font" even though
  `checkhealth` reported fonts as OK. The scanner now also checks the standard
  macOS font directories. See [docs/external-tools.md](docs/external-tools.md#macos-notes).
- **Test suite: partial-cache race across concurrently-run test files.**
  `test/media.test.ts` and `test/cli-config.test.ts` both rendered into the
  bare OS tmpdir, so they shared `render()`'s `dirname(output)/partial` cache
  directory; one test's cleanup could delete it while another was mid-render
  under the default parallel test runner, corrupting the ffmpeg concat step.
  Each now renders into its own unique subdirectory.
- The `applyWatermark` test's ffmpeg guard only checked the binary existed,
  not that it had `drawtext` — now checks `ffmpeg -filters` and skips cleanly
  on builds that lack it instead of failing.

### Added
- `examples/plugins-demo.ts` — the plugin system end to end: a native
  `use()` plugin and a portable JSON manifest (`loadManifestFromFile()`)
  together in one scene, including a real shaded 3D surface (`MobiusStrip`)
  defined purely as JSON math expressions.
- `examples/coverage-mobjects.ts`, `examples/coverage-animations.ts` — a
  registry audit found 24 mobjects and 29 animations with zero usage
  anywhere in the repo; these exercise all of them against their actual
  constructor signatures. Example/test coverage is now 121/121 mobjects and
  67/67 animations (100%).

## 0.0.1

The first published release. Version reset to 0.0.1 — the earlier 1.x/2.0
numbers tracked development phases, not releases.

### Renamed
- **Project renamed from `manim-js` to `ecmanim`** ("ecma" + "manim") — package
  name, CLI binary (`ecmanim`, formerly `manim-js`; `bin/ecmanim.ts`), GitHub
  repo (`github.com/johnhenry/ecmanim`), and all docs/examples/import
  specifiers updated. Not yet published, so no compatibility shim or deprecated
  alias was needed. The bundled `manim-wasm` and `manim-portable-plugins`
  sub-packages keep their names — they describe Manim-ecosystem/Python-manim
  compatibility, not this package's brand.

### Fixed
- **Cache soundness — container mobjects.** Segment hashes fingerprinted only an
  animation target's own `points`, which are empty for containers (VGroup,
  vector Text, diagram boards) — so moving/re-styling them between renders
  silently reused stale partial movie files. The fingerprint now walks the whole
  family (found by dogfooding the explainer video; regression-tested in
  `test/hash-invalidation.test.ts`). All existing partial caches invalidate once.
- `AnimationGroup.begin()` had a tautological ternary in the timing rescale.
- Browser backends dropped `finalizeSections()` for construct-function scenes
  (drifted copies of `makeScene`/`runConstruct` — now shared in
  `scene/orchestrate.ts`).
- Explainer/diagram polish: bullets left-anchor instead of centering off-screen;
  diagram arrows trim to node-box boundaries; layered layout gained barycenter
  crossing-reduction sweeps.

### Added
- **TypeScript `strict: true`** across the codebase (was `strict: false`).
- **Frame-snapshot visual regression tests** (`test/snapshot.test.ts` + golden
  PNGs): the first tests that catch "renders but looks wrong"; includes a
  byte-determinism guard for the render cache.
- **Real Format-layer payload**: `explainer` (sections + bullets + diagrams +
  TTS narration), `chart-reveal` (animated bar charts), `quote-card` (social
  aspect presets) — all zero-network with optional LLM enhancement.
- `VoiceoverTracker.timingSource` (`"word-boundaries" | "proportional"`).
- `SimpleEngine` bodies accept `angularVelocity` (kinematic spin).
- `examples/explainer-video.ts` — a real explainer about ecmanim, made by the
  explainer format (dogfooding).

### Docs
- Honesty pass: Lottie static-only scope, OTIO skeleton scope, voiceover
  bookmark-drift warning, SimpleEngine limits, Studio's actual feature set,
  diagram layout limits.

## 2.0.0 — adoption phase 7: authoring layer + Studio

Two new opt-in subpath entries keep the core lean while adding a higher-level
authoring/orchestration layer and a live-preview Studio.

### `ecmanim/authoring`
- **Plan IR + dry-run** (`toPlanIR`/`toPlanString`, CLI `ecmanim plan`): harvest a
  scene's segments/sections/duration as inspectable JSON **without rendering**.
- **Quality gates** (`runQualityGates`, `slideshowRisk`, `checkDeliveryPromise`):
  automated checks incl. a "slideshow-risk" score (is it actually animated?) and
  "delivery-promise" contracts (does the output match a declared intent?).
- **Format lifecycle** (`Format` = `plan`/`generateAssets`/`compose`/`revise`) +
  **provider abstraction** (`llm`/`tts`/`render`), and a **ecmanim render
  provider** + example `title-card` format — so ecmanim can back prompt→video
  pipelines (scrollmark/showrunner-style).

### `ecmanim/studio`
- **Live-preview dev server** (`startStudio`): serves your Scene in a
  `<manim-player>` and **hot-reloads the browser on save** (file-watch + SSE),
  dependency-free. The foundation for checkpoint replay / mouse-camera / eval REPL.
- **`schemaToControls`**: turn a `defineSchema` spec into props-panel control
  descriptors (the data half of a schema-driven editor).

18 new tests (590 total); type-clean; both subpaths build + import; example
`examples/authoring.ts` (format → real render + plan dry-run).

## 1.12.0 — adoption phase 6: physics

- **Analytic EM fields** (`ElectricField`, `MagneticField`, `electricFieldFunc`,
  `magneticFieldFunc`): formula-based vector fields (Coulomb / out-of-plane
  currents) as `ArrowVectorField` subclasses — cheap and deterministic.
- **Waves** (`LinearWave`, `StandingWave`, `WaveCurve`): time-parameterized sine
  curves that advance via an updater.
- **Optics**: `thinLensRefract` (paraxial thin-lens ray bending).
- **Rigid-body**: a dependency-free `SimpleEngine` (semi-implicit Euler + gravity
  + floor collision) stepped per frame (`physics(scene, opts)`), plus an ODE
  `Pendulum`. The engine is pluggable — swap in planck.js (pure-JS Box2D,
  recommended optional dep) or @dimforge/rapier2d for heavy collision/determinism.

10 new tests (582 total); type-clean; example `examples/physics.ts` (field +
pendulum + bouncing bodies).

## 1.11.0 — adoption phase 5: interchange + fidelity

- **OTIO** (`sceneToOtio`, `toOtioJSON`/`fromOtioJSON`, `RationalTime`): export a
  scene's play/wait segments (or sections) as a frame-exact OpenTimelineIO `.otio`
  JSON that round-trips to Resolve/Premiere/FCPXML/EDL. Reimplemented in TS.
- **Lottie import/export** (`vmobjectToLottieShapes`, `vmobjectToLottieJSON`,
  `loadLottie`): map VMobject cubic-Bézier subpaths to Lottie's `{v,i,o,c}` shape
  model and back — export manim shapes to a format every web/iOS/Android Lottie
  player understands (geometry; ThorVG-WASM noted for full fidelity).
- **Watermark** (`applyWatermark`, `render({ watermark })`): burn a text or image
  watermark into the output via an ffmpeg overlay, positionable with opacity.
- **Real-TeX** backend confirmed shipped (`texToSVGViaDvisvgm`: `latex → dvi →
  dvisvgm → SVG → Béziers` with detection + MathJax fallback).

6 new tests (572 total); type-clean; example `examples/interchange.ts`
(watermarked render + `.otio` + Lottie export).

## 1.10.0 — adoption phase 4: animation depth + presentation

- **`TransformMatchingAuto`** — automatic shared-element matching (à la Reveal.js
  Auto-Animate / Motion `layoutId`): pairs pieces across two states by identity
  (`matchId` → text → shape, position-independent), Transforms matched pairs
  (tweening the move/size/color delta) and fades the rest.
- **Presenter controls on `Player`** + `<manim-player>`: `playbackRate`, `volume`,
  `presenterMode` (pause/loop at section boundaries via `SectionType.LOOP`),
  `seekToSection`/`nextSection`/`prevSection`, and keyboard nav (space, arrows,
  `f` fullscreen) + `presenter`/`playback-rate`/`volume` attributes on the element.
- **Diagram-as-code** (`parseDiagram`, `layoutDiagram`, `buildBoard`, `diagram`):
  a tiny Mermaid/D2-ish DSL → deterministic layered/circular layout → a board
  (VGroup of node + edge mobjects tagged with `matchId`), so board-to-board
  transitions animate via `TransformMatchingAuto` (elkjs is an optional future backend).

12 new tests (566 total); type-clean; example `examples/diagram.ts` (board morph).

## 1.9.0 — adoption phase 3: voiceover / TTS-synced narration

- **`voiceover(scene, text, callback, opts)`** (manim-voiceover style): synthesize
  narration, mux it at the current scene time, and get a **tracker** whose
  `.duration` you feed into `play({runTime})` so animations stretch to the speech.
  Inline `<bookmark mark="name"/>` tags + `tracker.waitUntilBookmark("name")`
  trigger animations at specific words. `parseBookmarks` exported.
- **TTS provider abstraction** (`registerTTSProvider`/`resolveTTSProvider`): built-in
  `silent` (no key — a silent clip of the estimated duration, for timing/offline),
  `system` (macOS `say` / Linux espeak), and `openai`/`elevenlabs` HTTP adapters
  (used only when an API key is present). Register your own.

5 new tests (554 total); type-clean; example `examples/voiceover.ts` (bookmark-synced,
runs with the no-key `silent` provider) + docs.

## 1.8.0 — adoption phase 2: captions + audio-reactive

- **Captions** (`parseSrt`/`serializeSrt`, `createTikTokStyleCaptions`,
  `captionAt`, `Caption`): a framework-agnostic caption model + SRT round-trip +
  TikTok-style karaoke pages (token→page grouping). Transcription (Whisper/etc.)
  stays an external step that emits `Caption[]`.
- **`CaptionTrack`** mobject: an in-scene overlay that shows the active caption for
  the current time with optional karaoke reveal (reuses `RasterText.revealFraction`).
- **Audio analysis** (`getAudioData`, `visualizeAudio`, `getWaveformPortion`,
  `createSmoothSvgPath`): decode audio to PCM (Node ffmpeg / browser
  `decodeAudioData`) and get per-frame frequency spectra for audio-reactive
  visuals. Ships a compact dependency-free radix-2 FFT (`fftInPlace`,
  `magnitudeSpectrum`).

12 new tests (549 total); type-clean; example `examples/audio-reactive.ts`
(spectrum bars + captions + muxed audio), docs.

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

Export the web's video metadata standards straight from a render — ecmanim knows
a video's duration, dimensions, and `nextSection()` structure at render time, so
it doesn't have to reverse-engineer them. See [docs/metadata.md](docs/metadata.md).

- **`toVideoObject`** — schema.org `VideoObject` JSON-LD (discovery); chapters
  become `hasPart` `Clip`s. `toVideoObjectScript` returns an embeddable
  `<script type="application/ld+json">`.
- **`toIIIFManifest`** — IIIF Presentation 3.0 Manifest (presentation/navigation):
  Canvas with `duration`, a painting `Video` body, and — the standout —
  **`structures` Ranges (chapters) derived from `nextSection()`**, targeting
  temporal fragments.
- **Provenance sliver** — opt-in `provenance` adds a ecmanim `creator`
  `SoftwareApplication` and the IPTC digital-source-type for algorithmic media
  (folded into both formats). Full IPTC VMH is intentionally out of scope.
- **IIIF ingest** — `loadVideo` (Node + browser) accepts a IIIF manifest (object,
  or a URL with `{ iiif: true }`), resolves the video body URL, and attaches the
  manifest's chapters to the `VideoMobject` (`mob.chapters`). `resolveIIIFVideo`
  is exported. Node reads remote URLs through ffmpeg (cached by URL).
- **`<manim-player>`** injects the `VideoObject` JSON-LD when you set `metadata`
  (off otherwise); also `getVideoObject()` / `injectSchema()`.
- `render()` results now include `sections` (feeds the metadata input).

All isomorphic (exported from `ecmanim`). 15 new tests (510 total); type-clean;
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
philosophy and source, adapted to ecmanim's imperative, GPU-less architecture
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
  common manim-scene subset to ecmanim (imports, `Scene` subclass, `self.play`
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
  surfaces/shapes as portable expressions) loadable by both ecmanim and Python
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
