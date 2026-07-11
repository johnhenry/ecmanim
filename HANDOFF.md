# ecmanim — Project Handoff & Play-Through

_Written 2026-07-10 to hand a 10-day, 195-commit effort to a fresh session (or a
human). This supersedes `HANDOFF-campaign5.md` (that thin pointer is folded in
and expanded below). Read this one document top to bottom and you will
understand the whole arc — not just the last task — well enough to continue it._

Sources this doc is grounded in: the full conversation narrative (July 1–10),
the repo git history (`git log --oneline`), and the code itself. Where the
record is ambiguous, it says so rather than guessing.

---

## 1. What ecmanim is

**ecmanim** is a TypeScript/JavaScript port of [manim](https://github.com/ManimCommunity/manim)
— the Bézier-based mathematical-animation engine popularized by 3Blue1Brown. You
write a `Scene` subclass with `async construct()`, build mobjects (shapes, text,
LaTeX, 3D solids, charts…), and drive them with animations (`Create`,
`Transform`, `FadeIn`, `.animate.shift(...)`, …). The **same Scene code** renders
to three targets: headless **Node** video (MP4/WebM/GIF/MOV/PNG/SVG via
`@napi-rs/canvas` → ffmpeg), a live **browser** `<canvas>` (Canvas-2D, + WebM via
MediaRecorder), and an optional **WebGL/Three.js** browser backend. 3D uses a
CPU projection camera with a per-pixel software z-buffer and Gouraud shading, so
it renders headlessly with no GPU. Repo: `~/Projects/ecmanim`,
github.com/johnhenry/ecmanim, published on npm as `ecmanim` (current **0.6.0**).
The architectural linchpin: manim's `VMobject` is a tree of cubic Béziers, which
maps almost 1:1 onto the Canvas-2D `bezierCurveTo` API — that mapping is why one
renderer can serve Node and the browser.

---

## 2. The campaign model (the rhythm of the work)

After an initial "foundation era" (see §3.0) that built manim parity itself, the
project shifted to a repeatable **parity-campaign** playbook. Each campaign takes
one target ecosystem with a *canonical, enumerable example gallery*, ports that
gallery onto ecmanim's public API, fills whatever library gaps the ports expose,
and cuts a release. The master playbook was written to
`~/.claude/plans/parity-campaigns-roadmap.md`. Distilled, every campaign runs
these phases:

1. **Phase 0 — Corpus.** Extract verbatim reference sources from *raw* repo files
   (never rendered HTML — Docusaurus mangles whitespace, which bit an early
   campaign). Commit the corpus with provenance/attribution notes. Corpora live
   under `examples/<target>-parity/` (refs, datasets, or source docs).
2. **Assessment fan-out.** Launch parallel sub-agents, each mapping a slice of
   the target gallery against ecmanim's existing surface with `file:line` rigor,
   returning a gap table (READY / small-gap / needs-new-module). The lead
   smoke-tests the riskiest shared dependency by hand first.
3. **Gap-fill (library-first).** Build the missing public API in `src/` with
   tests — done partly in-session, partly by delegated agents on *distinct,
   non-overlapping files*. Policy: fixes belong in the **library**, not as
   per-demo workarounds. Commit the gap-fill as one "foundation" commit.
4. **Port wave.** Write a per-campaign **harness** (`_run.ts` / `_all.ts` +
   coordinate conventions) and an exemplar port, then fan the remaining refs out
   to ~5 parallel port agents. Each agent **frame-verifies** its renders (renders
   the mp4, extracts frames, looks at them) — "type-checks clean" is never
   accepted as done for a demo.
5. **Fix wave.** Ports routinely surface real library bugs (cache-hash holes,
   color/opacity parity bugs, loader artifacts). Consolidate them into one fix
   pass with regression tests; re-render the whole corpus fresh to prove it.
6. **Release train.** README scorecard + CI smoke job (per-suite, consolidated
   into a matrix once >4 suites exist) → CHANGELOG → version bump → CI green →
   GitHub release → `npm publish` → confirm `npm view ecmanim version` → update
   project memory → publish a scorecard artifact on claude.ai.

Cross-cutting constraints that shaped the campaigns:
- **GPU-avoidance arrangement.** The machine's single headless Chrome / GPU is
  shared with other agents via `~/gpu.lock` (see the CLAUDE.md agent-browser
  section). The roadmap deliberately ordered campaigns to be **GPU-light**;
  Motion Canvas, D3, Mermaid, and Lottie need no GPU at all. Before any
  `renderGL`/CDP-Chrome/agent-browser use, check the lock and back off.
- **Determinism.** Renders must be scrub-safe and cache-safe: a frame is a pure
  function of scene time. Several bugs found across campaigns were `Math.random`
  determinism leaks and partial-movie-cache hash holes (see §4).

---

## 3. Campaign-by-campaign play-through

### 3.0 Foundation era (before the campaigns) — v0.0.1 … v0.2.0

This is context, not a "campaign," but a continuer needs it because it built the
engine the campaigns port *onto*.

- **Initial port → 3D → parity phases.** Started 2026-07-01 as `manim-js`.
  Landmarks in git: `27d0b02` initial port (Scene/Mobject/VMobject/geometry/
  renderer/Node+browser backends); `b39878f` 3D projection camera + LaTeX/glyph
  text (MathJax→Bézier, opentype.js `VText`); `965e734` 3D surfaces; `c77e472`
  per-pixel z-buffer (fixes interpenetrating surfaces); `1cd141b` Gouraud
  shading; `775371d` optional WebGL/Three.js backend; `1886cc3` ImageMobject +
  SVGMobject loader + sound.
- **The audit + the 8-phase parity program.** A source-grounded audit (six agents
  diffing against real ManimCommunity source) found the "feature-complete" claim
  was overstated. That produced an 8-phase plan executed as parallel-agent rounds:
  Phase 0 bug-fixes (`3e535ea`), Phase 1 **TypeScript migration** (`cd6b938`/
  `df009a3` — Node runs `.ts` directly via type-stripping, `tsc` emits `dist/`
  for publish), Phase 2 plugin registry (`b2fd64e`), Phase 3 core infra
  (`f8d5290`), Phase 4 the big missing-class port in rounds A–E (`56de30b` …
  `f5bedfd`), Phase 5 rate funcs/colors/constants (2227 colors), Phase 6
  CLI/config/caching/cameras (`d1af765`), Phase 7 **cross-language plugins**
  (portable JSON manifest + Rust→WASM math core, verified byte-identical from
  Python via wasmtime — `ed471ca`), Phase 8 parity harness/docs → an internal
  **v1.0.0** milestone (`d4a7a67`).
- **"Adoption phases" 1.1–2.0.** A second wave added Remotion-inspired features,
  alternate renderers (SVG output, opt-in headless GPU `renderGL`), `VideoMobject`
  + WebCodecs, video metadata (schema.org/IIIF), captions/audio-reactive,
  voiceover/TTS, animation depth, interchange (OTIO + Lottie *static* export +
  watermark), Rapier physics, and an authoring layer + Studio (v2.0.0,
  `3b19094`). **`loadLottie` first appeared here** as a static single-frame shape
  importer in `src/interchange/lottie.ts` — remember this; Campaign 5 collides
  with it.
- **Rename + version reset.** `4a78cac` renamed the project `manim-js → ecmanim`;
  `35053f2` **reset the version to 0.0.1** (the 1.x/2.0.0 tags were pre-publish
  internal milestones) for real npm publishing. Then a run of `0.0.1`–`0.0.13`
  patch releases hardened the published CLI, fonts, text shaping (harfbuzz),
  MathTex, physics, and docs.
- **v0.1.0 (`a0ee78e`)** — showcase-parity suite (18 Remotion.dev/showcase demos),
  the full **render service** (`ecmanim/service`: SQLite job queue, workers,
  signed webhooks, S3 storage, Docker), scene `params` reaching `construct()`,
  SVGMobject id preservation (`byId`), seeded noise module, PieChart,
  WordCaptionTrack, GeoJSON maps.
- **v0.2.0 (`dc23675`)** — manim-gallery parity suite (all 27
  docs.manim.community examples ported 1:1, `examples/manim-parity/`), a rebuilt
  `Brace`, self-centering `Axes`, and a real (render-to-region) `ZoomedScene`.

### 3.1 Campaign 1 — Motion Canvas / Canvas Commons → **v0.3.0** (`79d644f`)

- **Target:** the Motion Canvas example/docs gallery (40 reference scenes,
  extracted from raw repo files; missing "concept" scenes composed from doc
  fragments — `baaacee` added 6 composite refs).
- **Built (6 gap clusters, all landed as MC1–MC6 commits):**
  - **MC1 (`b317b05`)** tween ergonomics — chained property tweens
    (`position.x(300,1).to(-300,1)`), direct signal tweening, `tween()`/`spring()`
    helper shapes, seeded RNG.
  - **MC6 (`acd1ade`)** curve nodes (CubicBezier/QuadBezier/Spline/Path/PolyLine)
    + `tangentAtProportion`, flex padding, `Video.seek`, `findAll`, `matchTex`.
  - **MC5 (`1ca9465`)** camera rotation + `centerOn`/`reset`, `strokeStart`
    rendering, per-mobject composite/blend modes (the logo's mask trick) +
    `CompositeGroup`, grayscale.
  - **MC2 (`c8422a5`)** `waitUntil` named time events + `spawn`/`loopForever`
    background tasks.
  - **MC3 (`308a8ac`)** the `Code` tagged-template edit API (edit/insert/
    selection ranges, instant mutators).
  - **MC4 (`2657ed0`)** scene-to-scene transitions (slide/fade/zoomIn) +
    `Direction` + `finishScene`.
- **Ports:** exemplars (quickstart/bezier) + showcase-logo & showcase-signals
  ported by the lead; the remaining refs by 5 agents. 40 refs → **25
  pixel-verified ports** (`65a20cc`).
- **Bugs found & fixed:** ~10 real library bugs, the notable family being
  **partial-movie cache-hash holes** — `hashAnimations()` didn't fingerprint tween
  *target values*, and `wait()`'s fingerprint counted only top-level mobjects'
  points, so color-only tweens / equal-length holds over different content
  collided in the shared cache. Also a 180°-camera-roll degeneration (fixed with a
  parametric camera-frame tween) and FlexGroup Yoga quantizing at world scale.
- **Shipped:** v0.3.0, `mc-smoke` CI job, README scorecard, npm publish confirmed.

### 3.2 Campaign 2 — D3.js top-25 → **v0.4.0** (`c56d7d0`)

- **Target:** a curated D3 top-25 gallery. **Corpus** (`c0ebd5e`): 26 gallery
  refs pulled as raw cell JS from the Observable API + 24 canonical datasets
  (fetched, gzip-decompressed, provenance recorded — 3.3 MB).
- **Built — the D3 primitive layer** (`2e63216`, "D1–D6", 123 new tests):
  `scales.ts` (linear/log/sqrt/radial/band/point/ordinal/sequential/quantize/
  diverging/UTC-time with d3's exact tick algorithm), shape generators, color
  schemes + HSV-long/HCL interpolation, **d3-hierarchy** (stratify, treemap/
  squarify, pack via bit-identical Welzl/LCG, Buchheim tree/cluster — verified
  against d3's own test vectors), force/sankey/chord layouts, topojson decoder +
  contours + hexbin, a `dataJoin(oldMobs, newData, keyFn)` helper (the thing that
  gates the bar-chart-race), and a van Wijk `interpolateZoom` camera path.
- **Ports:** `9e565dd` harness (`_run`/`_axes`) + bar-chart exemplar; `da9583f`
  ports 02–25 by 5 agents + the library fix wave. **26 refs → 25 frame-verified
  ports**, including the bar-chart-race flagship (keyed dataJoin over 96 keyframes,
  exact-data-verified across decades).
- **Bugs found & fixed (`test/d3-portfixes.test.ts`):** GeoJSON polygon "petal"
  artifact (rings pushed as raw Bézier points), `format(".1s")` SI divergence,
  `scaleBand` getter corruption, more cross-scene `tween(cb)` cache collisions,
  and a real **FadeOut→FadeIn round-trip** bug (FadeOut left opacities at 0;
  manim restores on removal — ecmanim didn't).
- **Shipped:** v0.4.0, `d3-smoke` CI job, scorecard, npm confirmed.

### 3.3 Campaign 3 — 3Blue1Brown canon → **v0.5.0** (`47ad454`)

- **Target:** ten iconic 3b1b visuals. Framed honestly as **recreations on the
  public API, not code ports** — sources cited per scene, no brand assets
  (`6f08eab` CANON.md spec with beats + attributions).
- **Built (small, concentrated gaps):** `FourierPath`/`dftOfPath`/`samplePath`
  (amplitude-sorted complex DFT + epicycle chain, scrub-safe), `NeuralNetworkMobject`
  (layered diagram, deterministic `forwardPass` pulse waves), `hilbertCurve` +
  generic `lsystem` turtle, `sieve`/`primesUpTo`/`eigen2x2`, and
  **`Surface.setFunc`** in-place reparameterization (per-frame surface morphs, for
  the sphere-unwrap). Commits `249e38c` (lead), `413ab08` (agent modules).
- **Ports:** `466d749` harness + linear-transformation exemplar; recreations
  01/03/04/05/10 (`da26d4b`) and 06–09 (`b009a91`). **10/10 frame-verified** — the
  flagships being π traced by 100 epicycles and the 4πr² sphere unwrap (CPU
  z-buffer 3D).
- **Bugs found & fixed:** `Transform` now aligns **FAMILY** point counts (VGroup
  children with mismatched counts dissolved into dashes); `render()` re-binds the
  renderer to `scene.camera` after construct (ThreeDScene's camera upgrade was
  silently 2D); `parseTexGroups` balanced-brace scan (`{{\frac{x^3}{3!}}}` lost
  its closing brace); `forwardPass` pulses throwaway edge copies rather than
  blanking the live skeleton.
- **Shipped:** v0.5.0, CI smoke consolidated into a **5-suite matrix** (`demo-smoke`),
  scorecard, npm confirmed (registry lag noted).

### 3.4 Campaign 4 — Mermaid diagrams → **v0.6.0** (`ad71768`)

- **Target:** all 12 Mermaid diagram types. **Architecture settled by direct
  probe** (`fdf9625`): mermaid@11 + **jsdom** render all 12 types *headlessly*
  with a DOM shim — no Chrome, no GPU. **Corpus** (`8a99bb8`): 12 syntax docs
  from the mermaid repo's raw docs, provenance noted.
- **Built:**
  - **M1 (`2b071c4`)** `loadMermaid(source)` → `DiagramMobject`. Core hard part
    was a **jsdom measurement shim** (geometry-aware recursive `getBBox` honoring
    child transforms — flowcharts were collapsing to ~45px because the final
    viewBox fit called `getBBox` on the root group; plus gantt `offsetWidth`, rAF
    teardown, canvas wiring for mindmap's cytoscape). Per-type friendly ids:
    `byId("A")`, `nodeIds()`, `edgeIds()`, `labels()`.
  - **M2/M3 (`bbcf8a5`)** `revealDiagram` (per-type staged reveals: topological
    nodes-before-edges, sequence actors→messages, gantt bars growing, mindmap
    radial) + the flagship `diffDiagrams(v1, v2, {keyMap})` — two Mermaid sources
    morph, kept nodes travel, labels glyph-morph through renames.
  - **M1.5 fix wave (`fc62c79`)** — six loader/SVG library fixes that the port
    wave exposed, two reaching **every SVG consumer**: SVG elliptical-arc (`A`)
    commands are now real arcs (were flattening to chords — pie charts rendered as
    triangles), and `Color.parse` handles `rgb()/rgba()/hsl()/hsla()` (were
    parsing to black). Plus CSS-class inlining, `<text>` extraction into `byId`
    labels, and viewBox cropping in the loader.
- **Ports:** `84e8f6c` harness; 13 frame-verified demos (12 types + the flagship
  diff), workarounds stripped after M1.5.
- **Shipped:** v0.6.0, matrix smoke entry, scorecard.

### 3.5 Campaign 5 — Lottie → **UNCUT / IN PROGRESS** (see §5)

This is where the session died. Full detail in §5; summary here: corpus + harness
+ the deterministic **L1 player** are committed and pushed; the **L2 demo sources**
(5 of them) are committed and type-check clean; **demo 05 has never been rendered**
because rendering a Lottie demo OOMs the machine. No release. Current npm/version
is still 0.6.0.

---

## 4. Conventions & architecture patterns (what recurs across campaigns)

**Module layout** (grounded in the README architecture tree and `src/`):
- `src/core/` — math (`vector.ts` `[x,y,z]` points + direction constants,
  `bezier.ts`, `paths.ts`), `color.ts` + `colors_data.ts` (~2200 palette),
  `constants.ts`, `noise.ts`, `watermark.ts`.
- `src/mobject/` — the `Mobject`→`VMobject` base tree plus every shape/text/3D/
  chart/graph class. New campaign primitives that are *mobjects* land here
  (`lottie_mobject.ts`, `mathtex.ts`, `surface.ts`, `probability.ts`, …).
- `src/animation/`, `src/scene/`, `src/camera/`, `src/renderer/`,
  `src/plugins/`, `src/reactive/` (signals), `src/layout/` (Yoga FlexGroup +
  d3 hierarchy), `src/loaders/` (geojson, mermaid, **lottie player**),
  `src/interchange/` (OTIO, **lottie static export**), `src/diagram/`,
  `src/authoring/`, `src/studio/`, `src/service/`, `src/physics/`,
  `src/voiceover/`, `src/captions/`, `src/video-*`, `src/templates/`.
- **Entry seams (the node vs browser rule):** the isomorphic core (`index.ts`)
  must stay free of Node imports and bare specifiers that break unbundled browser
  loading (opentype is lazily imported for exactly this reason). Node-only glue
  lives in `node.ts`; browser glue in `browser.ts`/`browser-three.ts`. The Node
  backend *injects* fonts/canvas into the core rather than the core importing
  them. Package `exports` map: `.`, `./node`, `./browser`, `./browser-three`,
  `./authoring`, `./studio`, `./service`, `./physics/rapier2d|3d`.
- **Build-free dev.** Node 25 runs `.ts` sources directly (type-stripping); `tsc`
  emits `dist/` + `.d.ts` only for publish/bundlers. Node's strip-only mode
  **cannot do TS enums** — use `const` objects (this bit MC4).

**Testing approach:** `node --test 'test/**/*.test.ts'` — ~850+ tests across
110+ files (the suite was at **1,368 passing** by the time Campaign 5 started).
Every campaign adds a `<target>-portfixes`/loader/reveal/diff test file for the
bugs its ports surface. Frame-snapshot visual-regression tests exist
(`test/snapshot.test.ts`, `test/golden/`). Type-check (`npm run type-check`,
`tsc --noEmit`) is the always-green gate; strict mode is on.

**Demos/corpus structure (per campaign), all under `examples/<target>-parity/`:**
- corpus refs / datasets / source docs (+ a `README.md`/provenance file),
- a shared harness: `_run.ts` (single-demo runner with coordinate + quality
  conventions) and/or `_all.ts` (renders the whole suite), driven by
  `npm run demos:<target>`,
- numbered demo files `01-*.ts … NN-*.ts`, each rendering to `out/` (gitignored
  except where receipts are kept),
- a README scorecard table; a claude.ai scorecard artifact; a per-suite CI smoke
  job folded into the `demo-smoke` matrix.

**Delegation discipline:** parallel agents only ever touch **distinct,
non-overlapping files**; the lead integrates and commits between rounds
(concurrent edits on a shared file were the source of several "transient" errors).
Agents self-verify; the lead independently frame-verifies before believing a
demo is done. Library-first: gaps become public API + tests, not per-demo hacks.

---

## 5. Current state: Campaign 5 (Lottie) — DETAILED

### What's committed & pushed on `main`
- `6c79a00` — **corpus**: 5 real lottie-web demos (MIT) + a feature census
  (precomps / masks / mattes / trim coverage). Files: `examples/lottie-parity/
  data/{bodymovin,gatin,happy2016,adrock,navidad}.json` + `data/README.md`, plus
  10 authored feature fixtures `examples/lottie-parity/fixtures/01-…10-*.json`
  (eased-keyframes, spatial-bezier, shapes, trim, gradient, repeater, parenting,
  precomp, solid, text).
- `27a0a1a` — **demo harness** `examples/lottie-parity/_run.ts`
  (`loadAnimationJson`, `demoRender`, quality via `ECMANIM_DEMO_QUALITY`).
- `b8e0504` — **L1: the deterministic Lottie player**. `loadLottie(json, …)` →
  `LottieMobject` (in `src/mobject/lottie_mobject.ts`): keyframe engine with
  cubic-bezier easing + spatial tangents, the full shape-item tree, layer
  parenting, precomps, CompositeGroup-based mattes/masks, scrub-safe `setTime`.
  28 tests (`test/lottie-loader.test.ts`); all 5 corpus files animate NaN-free
  (bodymovin trim verified 0→0.78). **Name-collision resolved:** the pre-existing
  static importer in `src/interchange/lottie.ts` was renamed
  `loadLottie → loadLottieShapes`; the new player owns the `loadLottie` name.
- `109533b` — **L2: 5 parity demo sources** `examples/lottie-parity/
  01-bodymovin.ts … 05-navidad.ts`. All type-check clean. **01–04 have rendered
  `.mp4`s** in `examples/lottie-parity/out/`; **`05-navidad.mp4` does NOT exist**
  — rendering it is what OOM-killed the session.

### What is NOT done (honest gaps)
- **`05-navidad` has never rendered** → the Lottie player is unverified on that
  input, and no demo has a frame-level receipt beyond 01–04.
- **The L2 agent's larger plan did not land.** The narrative shows the L2 agent
  was building **11** demos: the 5 corpus playthroughs (01–05) **plus 06–11** — a
  features grid, trim, masks, text, a composite flagship (bodymovin wordmark over
  an ecmanim bar chart), and a scrub-determinism showcase. Only 01–05 were
  committed. Demos 06–11 were in-progress in the background agent and are **not in
  the repo** — treat them as unfinished/lost unless found in that agent's
  transcript (§6). The 10 `fixtures/*.json` were committed to back these, so the
  fixtures exist even though the demos consuming them mostly don't.
- **No release.** No v0.7.0, no `lottie-smoke` CI job, no scorecard, no CHANGELOG
  entry, no memory update for Campaign 5.

### The blocker — render-path OOM (document prominently, do not render blindly)
Rendering a single Lottie demo through the canvas/frame path consumed **12 GB+ of
RAM and was OOM-killed every time** on 2026-07-10 — `05-navidad` specifically
killed the working session ~4 times. The memory is **native, off-JS-heap**
(`@napi-rs/canvas` buffers), so `--max-old-space-size` does **not** bound it.

**Root cause is almost certainly identified** (grounded in `src/node.ts`): the
**default caching render path accumulates every frame's PNG buffer in memory**
before encoding. In `render()` (around `src/node.ts:344–421`), the caching branch
does `segMap.get(activeSeg).push(buf)` in `frameHandler` for the *entire*
construct, then encodes segments only *after* `runConstruct` finishes. Held PNG
buffers are Node `Buffer`s (off-heap), which matches the "native memory,
unbounded, ignores `--max-old-space-size`" symptom. By contrast, the
**single-stream path** (`src/node.ts:423–439`, taken when caching is disabled or
range-filtering is active) pipes each buffer straight to ffmpeg and **does not
accumulate**. The Lottie harness calls `render()` with default options, so it
takes the accumulating path. (Lottie demos likely also render more frames /
heavier per-frame geometry than prior corpora, which is why this path tipped over
here specifically.)

**Safe way to render going forward — always cap memory in a cgroup:**
```bash
systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 \
  node --experimental-strip-types examples/lottie-parity/05-navidad.ts
```
so a runaway render dies as one process instead of taking the machine (and the
remote-control session) down.

### Concrete next steps (in order)
1. **Bound the render-loop memory.** Either (a) make the caching path stream each
   segment's frames to its partial encoder incrementally instead of buffering the
   whole `segMap`, or (b) as an immediate unblock, have the Lottie harness pass
   `disableCaching: true` (routes through the non-accumulating single-stream path)
   — add it in `demoRender` in `examples/lottie-parity/_run.ts`. Verify against
   `01-bodymovin` first (known-good) under the cgroup cap, watching RSS.
2. **Render `05-navidad`** under the cgroup cap; frame-verify it. Commit the mp4
   receipt.
3. **Decide the scope of L2.** Either rebuild demos 06–11 per the original plan
   (fixtures already exist) or consciously ship Campaign 5 with the 5 corpus
   playthroughs only. Frame-verify whatever ships.
4. **Run the release train** (§2 step 6): README scorecard + `lottie-smoke` CI
   matrix entry + CHANGELOG + version bump (→ v0.7.0) + GitHub release + npm +
   memory update + scorecard artifact.
5. **Work in a fresh session.** The prior session's transcript had grown to ~96 MB
   / ~750k tokens and cost 12+ GB just to load, which is what forced this
   recovery in the first place.

---

## 6. Full example inventory (the parity lists, campaign by campaign)

Every numbered file below is a committed, individually-runnable parity demo —
`npx tsx examples/<dir>/<file>.ts`. Filenames are the source-of-truth names
(kept close to the upstream original so `grep`/diffing against the reference is
easy); this section exists because the campaign summaries in §3 give counts,
not the itemized list. Each directory also has its own `README.md`/`ref/` with
provenance — check there for licensing and the exact upstream source per item.

### Foundation era — manim-gallery parity (v0.2.0) — 27 examples

Source: docs.manim.community official example gallery, ported 1:1. Directory: `examples/manim-parity/`

- `01-ManimCELogo.ts` — `02-BraceAnnotation.ts` — `03-VectorArrow.ts` —
  `04-GradientImageFromArray.ts` — `05-BooleanOperations.ts` —
  `06-PointMovingOnShapes.ts` — `07-MovingAround.ts` — `08-MovingAngle.ts` —
  `09-MovingDots.ts` — `10-MovingGroupToDestination.ts` —
  `11-MovingFrameBox.ts` — `12-RotationUpdater.ts` — `13-PointWithTrace.ts` —
  `14-SinAndCosFunctionPlot.ts` — `15-ArgMinExample.ts` —
  `16-GraphAreaPlot.ts` — `17-PolygonOnAxes.ts` — `18-HeatDiagramPlot.ts` —
  `19-FollowingGraphCamera.ts` — `20-MovingZoomedSceneAround.ts` —
  `21-FixedInFrameMObjectTest.ts` — `22-ThreeDLightSourcePosition.ts` —
  `23-ThreeDCameraRotation.ts` — `24-ThreeDCameraIllusionRotation.ts` —
  `25-ThreeDSurfacePlot.ts` — `26-OpeningManim.ts` —
  `27-SineCurveUnitCircle.ts`

### Foundation era — Remotion.dev/showcase parity (v0.1.0) — 18 examples

Source: Remotion.dev showcase reels. Directory: `examples/showcase-parity/`

- `01-hackreels.ts` — `02-nextjs-tutorial.ts` — `03-animstats.ts` —
  `04-mux.ts` — `05-github-unwrapped.ts` — `06-admove.ts` —
  `07-supermotion.ts` — `08-revid.ts` — `09-submagic.ts` —
  `10-mykaraoke.ts` — `11-relay.ts` — `12-hello-meteo.ts` —
  `13-electricity-maps.ts` — `14-watercolor-map.ts` — `15-banger-show.ts` —
  `16-fluidmotion.ts` — `17-remotion-recorder.ts` — `18-vibrantsnap.ts`

### Campaign 1 — Motion Canvas (v0.3.0) — 25 examples

Source: Motion Canvas example/docs gallery. Directory: `examples/motion-canvas-parity/`

- `01-quickstart.ts` — `02-bezier.ts` — `03-bezier-advanced.ts` —
  `04-spline.ts` — `05-path.ts` — `06-camera.ts` — `07-transitions.ts` —
  `08-index-gallery.ts` — `09-flow.ts` — `10-spawners.ts` —
  `11-logging.ts` — `12-time-events.ts` — `13-random.ts` —
  `14-signals.ts` — `15-tweening.ts` — `16-positioning.ts` —
  `17-layouts.ts` — `18-hierarchy.ts` — `19-media.ts` — `20-latex.ts` —
  `21-code.ts` — `22-effects.ts` — `23-filters.ts` —
  `24-showcase-logo.ts` — `25-showcase-signals.ts`

### Campaign 2 — D3.js top 25 (v0.4.0) — 25 examples

Source: observablehq.com/@d3/gallery. Directory: `examples/d3-parity/`

- `01-bar-chart.ts` — `02-bar-chart-transitions.ts` —
  `03-stacked-to-grouped-bars.ts` — `04-radial-stacked-bar.ts` —
  `05-pie-chart-update.ts` — `06-bar-chart-race.ts` —
  `07-connected-scatterplot.ts` — `08-streamgraph.ts` —
  `09-parallel-coordinates.ts` — `10-calendar-view.ts` — `11-treemap.ts` —
  `12-sunburst.ts` — `13-tree.ts` — `14-radial-tree.ts` —
  `15-circle-packing.ts` — `16-force-directed-graph.ts` —
  `17-disjoint-force-graph.ts` — `18-arc-diagram.ts` —
  `19-chord-diagram.ts` — `20-sankey.ts` — `21-edge-bundling.ts` —
  `22-choropleth.ts` — `23-volcano-contours.ts` — `24-hexbin.ts` —
  `25-brushable-scatterplot.ts`

### Campaign 3 — 3Blue1Brown canon (v0.5.0) — 10 examples

Source: 3Blue1Brown canonical visual recreations. Directory: `examples/threeb1b-parity/`

- `01-fourier-epicycles.ts` — `02-linear-transformation.ts` —
  `03-eigenvectors.ts` — `04-sum-of-odds.ts` — `05-prime-spiral.ts` —
  `06-hilbert-curve.ts` — `07-pendulum-phase.ts` — `08-taylor-series.ts` —
  `09-sphere-unwrap.ts` — `10-neural-network.ts`

### Campaign 4 — Mermaid diagrams (v0.6.0) — 13 examples

Source: Mermaid diagram-type syntax docs. Directory: `examples/mermaid-parity/`

- `01-flowchart.ts` — `02-sequence.ts` — `03-class.ts` — `04-state.ts` —
  `05-er.ts` — `06-gantt.ts` — `07-pie.ts` — `08-journey.ts` —
  `09-timeline.ts` — `10-mindmap.ts` — `11-quadrant.ts` —
  `12-gitgraph.ts` — `13-diagram-diff.ts`

### Campaign 5 — Lottie (uncut, in progress) — 5 examples

Source: lottie-web sample corpus. Directory: `examples/lottie-parity/`

- `01-bodymovin.ts` (rendered) — `02-gatin.ts` (rendered) —
  `03-happy2016.ts` (rendered) — `04-adrock.ts` (rendered) —
  `05-navidad.ts` (**not yet rendered** — see §5 render-OOM blocker)

**Total shipped across all campaigns to date: 123 individually-runnable parity
examples**, across 7 corpora. (Demos 06–11 the L2 agent was reportedly building
for Lottie are not among these 5 — see the ambiguity note at the end of this
doc.)

---

## 7. Planned but NOT YET STARTED: Campaigns 6–9

The roadmap (`~/.claude/plans/parity-campaigns-roadmap.md`) queues four more
campaigns after Lottie ships. None of this exists in the repo yet — no corpus,
no code — this is forward planning only, included so a continuer knows the
project isn't "done after Lottie."

- **Campaign 6 — ECharts gallery subset (target v0.8.0).** ~15 examples from
  echarts.apache.org/examples (Apache-2.0): bar race, smoothed line, stacked
  bars, scatter+visualMap, radar, gauge, funnel, candlestick, calendar
  heatmap, pie roseType, graph/sunburst/sankey/themeRiver (reusing D3-campaign
  layouts), waterfall. New mobjects needed: Gauge, Radar, Funnel, Candlestick,
  Waterfall; a `visualMap` continuous color-mapping helper.
- **Campaign 7 — GSAP patterns (target v0.9.0).** Not a gallery port — a
  ~15-item *pattern* canon from GSAP's docs proving the browser-player side:
  timeline labels, stagger distributions, text split reveal, shape morph,
  motionPath+autoRotate, FLIP transitions, scroll-scrubbed timelines
  (ScrollTrigger-equiv), pin+progress, parallax. Needs a browser
  scroll-binding in `src/player.ts`.
- **Campaign 8 — p5.js generative subset (target v0.10.0).** 12 examples from
  p5js.org/examples (LGPL): noise field, particle system, flocking/boids,
  fractal tree, L-system, Conway's Game of Life, ten-print maze, wave
  interference, recursive circles, softbody/spring, Perlin terrain, lerp
  color gradient. Needs a determinism policy for simulations (fixed-step +
  seeded, documented as cache-safe) and an L-system → turtle-path generator.
- **Campaign 9 — Reveal.js / Slidev decks (target v0.11.0).** The
  presentation finale: ~15 slides each from the reveal.js and Slidev demo
  decks (MIT), covering fragments, auto-animate, code-highlight steps,
  backgrounds, speaker notes. Needs a `Scene.step()` fragment API, a
  `deckFromMarkdown()` loader, and a presenter-mode player — this is what the
  playRecords/step substrate has been building toward.

Full gap-cluster and corpus detail for each is in the roadmap doc, §CAMPAIGN
6–9.

---

## 8. Where the full record lives

- **Git history** — the authoritative record of *what shipped*. `cd
  ~/Projects/ecmanim && git log --oneline`. 195 commits; every campaign's
  corpus/gap-fill/ports/release commits are cited by hash above.
- **CHANGELOG.md** — per-release "Added / Fixed" narrative (0.1.0 … 0.6.0 and the
  earlier phase/adoption tags).
- **Master roadmap** — `~/.claude/plans/parity-campaigns-roadmap.md` (the
  playbook, the GPU protocol, the campaign queue).
- **Archived full transcript** (pre-2026-07-10, the exhausted session):
  `~/.claude/projects/-home-christopher-claude-hub/2d90d953-880a-451d-b0e9-5abe7dbbcfd5.jsonl.full-backup-20260710`
  (~97 MB — do not load naively; grep/slice it).
- **Completed sub-agent final reports** — that session's `subagents/` dir:
  `~/.claude/projects/-home-christopher-claude-hub/2d90d953-880a-451d-b0e9-5abe7dbbcfd5/subagents/`
  (each `agent-*.jsonl` + `.meta.json`). The **Lottie L2 demo agent** is the place
  to look for demos 06–11 and any 05-navidad findings — the last-touched large
  agent log (`agent-a0bf6c8a1e4178d0d.jsonl`, ~748 KB, modified Jul 10 14:03) is a
  candidate, but confirm by reading its `.meta.json` rather than trusting the
  timestamp.
- **This session's narrative skeleton** (decision/narrative layer, tool outputs
  stripped): the 391 KB `ecmanim-narrative.txt` used to write this handoff (in the
  recovery session's scratchpad).
- **Superseded:** `HANDOFF-campaign5.md` — folded into §5 above; keep or delete.

---

_Ambiguities flagged, not invented: the exact contents/status of Lottie demos
06–11 (planned by the L2 agent, never committed); which subagent log holds the L2
work (candidate identified, not confirmed); and whether the OOM is 100% the
`segMap` accumulation vs. also involving a per-frame leak inside the player/
renderer — the accumulation is confirmed from source, a separate leak is
plausible and worth ruling out while fixing step 1._
