<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/ecmanim-logo-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/ecmanim-logo-light.png">
  <img alt="ecmanim" src="docs/assets/ecmanim-logo-light.png" width="450">
</picture>

A **TypeScript** port of [manim](https://github.com/ManimCommunity/manim) — the
Mathematical Animation Engine popularized by 3Blue1Brown — that renders the same
`Scene` code in **Node** (MP4/WebM/GIF/MOV/PNG via ffmpeg) and in the **browser**
(live Canvas-2D playback + WebM, plus an optional WebGL/Three.js backend).

```js
import { render, Scene, Circle, Square, Transform, Create, BLUE, GREEN } from "ecmanim/node";

class Demo extends Scene {
  async construct() {
    const c = new Circle({ radius: 1.5, color: BLUE, fillColor: BLUE, fillOpacity: 0.5 });
    await this.play(new Create(c));
    await this.play(new Transform(c, new Square({ sideLength: 3, color: GREEN })));
    await this.play(c.animate.shift([3, 0, 0]).rotate(Math.PI / 4));
  }
}

await render(Demo, { output: "demo.mp4", quality: "high" });
```

## What makes it different

- **TypeScript, build-free in dev.** Node 25 runs the `.ts` sources directly via
  type-stripping — no compile step to iterate. `tsc` emits `dist/` + `.d.ts` for
  publishing and browser bundlers. See `npm run build` / `type-check` / `test`.
- **Three render targets, one Scene.** The *exact same* mobject/animation/scene
  code drives (1) headless Node video, (2) a live browser `<canvas>` with WebM
  export, and (3) an optional GPU **WebGL/Three.js** backend. 3D uses a CPU
  projection camera with a per-pixel software z-buffer and Gouraud shading, so it
  renders headlessly with no GPU.
- **Plugins, three ways.** A native `use(plugin)` registry (register mobjects,
  animations, rate functions, colors, scenes), a portable **JSON manifest** that
  loads into *both* ecmanim and Python manim, and a shared **Rust→WASM math
  core** callable from JS and Python (verified byte-identical). See
  [docs/plugins.md](docs/plugins.md).
- **Near-complete manim parity.** ~390 exports, ~120 registered mobjects, ~67
  animations, all 45 registered rate functions (51 exported), and the full
  ~2200-color palette. See the [parity table](#api-parity-with-manim).

## Install

```bash
npm install            # pulls @napi-rs/canvas + three as optional deps
# ffmpeg (and ffprobe) must be on PATH for Node video output
```

`@napi-rs/canvas` ships prebuilt binaries — **no system Cairo required**, so it
works on NixOS out of the box. Run `npx ecmanim checkhealth` to verify node,
ffmpeg, ffprobe, canvas, and fonts — plus the optional tools (system TTS, TeX,
headless Chrome). ecmanim shells out to a few system programs rather than
bundling them; see [docs/external-tools.md](docs/external-tools.md) for the
full list and what degrades when each is missing.

## Quickstart

### Node (render to a file)

```js
import { render, Scene, Circle, Text, Create, YELLOW, BLUE } from "ecmanim/node";

class Intro extends Scene {
  async construct() {
    const t = new Text("Hello, ecmanim", { fontSize: 0.8, color: YELLOW, point: [0, 3, 0] });
    await this.play(new Create(t));
    await this.play(new Create(new Circle({ radius: 1.5, color: BLUE })));
    await this.wait(0.5);
  }
}

await render(Intro, { output: "intro.mp4", quality: "medium" });   // low | medium | high | fourk | production
```

Or from the CLI (see [docs/cli.md](docs/cli.md)):

```bash
npx ecmanim render intro.ts Intro -q high -o intro.mp4
```

### Browser (live playback + WebM)

```html
<canvas id="stage" width="1280" height="720"></canvas>
<script type="module">
  import { play, record, Scene, Circle, Create } from "ecmanim/browser";

  class Demo extends Scene {
    async construct() { await this.play(new Create(new Circle({ radius: 2 }))); }
  }

  const canvas = document.getElementById("stage");
  await play(Demo, { canvas, quality: "medium" });      // real-time playback
  const blob = await record(Demo, { quality: "high" }); // -> WebM Blob for download
</script>
```

See `examples/browser/index.html` for a full page and
`examples/browser-three/index.html` for the WebGL backend.

## Backends

| Entry point | Target | Output | Notes |
|-------------|--------|--------|-------|
| `ecmanim` | isomorphic core | — | all mobjects/animations/scenes/colors + the plugin API; no renderer glue |
| `ecmanim/node` | Node.js | mp4, webm, gif, mov, png-sequence, png, **svg** | `@napi-rs/canvas` → PNG frames piped to `ffmpeg`; partial-movie caching + sections |
| `ecmanim/browser` | browser (Canvas-2D) | live `<canvas>` + WebM | `play()` for real-time, `record()` → WebM `Blob` via `MediaRecorder` |
| `ecmanim/browser-three` | browser (WebGL) | live `<canvas>` + WebM | Three.js: hardware depth buffer, MSAA, OrbitControls; same `play`/`record` API |
| `ecmanim/authoring` | Node | plan IR / formats | plan-IR dry-run, quality gates, pluggable Format lifecycle + llm/tts/render providers ([docs/authoring-studio.md](docs/authoring-studio.md)) |
| `ecmanim/studio` | Node + browser | live-preview dev server | hot-reloading `<manim-player>` preview + schema→props controls ([docs/authoring-studio.md](docs/authoring-studio.md)) |

The Canvas-2D CPU backend is the default and the only one needed for headless
Node video. The Three.js backend is a browser-only GPU accelerator that swaps
only the draw step (fills → vertex-colored meshes, strokes → line segments, text
→ billboards). Architecture details: [docs/architecture.md](docs/architecture.md).

Two **alternate render targets** share the same scene graph — see
[docs/renderers.md](docs/renderers.md):

- **SVG / vector output** (`format: "svg"`, or the isomorphic `SVGRenderer` /
  `mobjectsToSVG`): resolution-independent, tiny, editable frames. Deterministic,
  no GPU, no browser. `render(Scene, { format: "svg" })` writes a single `.svg`
  (with `saveLastFrame`) or a numbered `.svg` sequence.
- **Opt-in headless GPU** (`renderGL`, Node): renders the Three.js/WebGL backend
  inside a CDP-accessible Chrome (real per-pixel lighting, MSAA, GPU strokes),
  headless with no physical GPU (Mesa llvmpipe). Non-deterministic vs. the CPU
  path, so it stays out of the content-hash cache.

## CLI

```bash
npx ecmanim render scene.ts MyScene -q high -o out.mp4
npx ecmanim render scene.ts --scene IntroScene --format webm
npx ecmanim render scene.ts -s            # just the final frame as PNG
npx ecmanim render scene.ts -n 2,5        # only play() indices 2..5
npx ecmanim cfg --write                   # write manim.config.json
npx ecmanim init scene.ts                 # scaffold a starter scene
npx ecmanim plugins                       # list registered mobjects/animations/…
npx ecmanim checkhealth                   # node / ffmpeg / canvas / fonts
```

Full flag and subcommand reference, config-file format, caching, and sections:
[docs/cli.md](docs/cli.md).

## Plugins

Extend the engine three ways — see [docs/plugins.md](docs/plugins.md):

```js
import { use, loadManifest, loadWasm } from "ecmanim";
import heartPlugin from "./examples/plugins/heart-plugin.ts";
import cyberpunk from "./examples/plugins/cyberpunk.manifest.json" with { type: "json" };

use(heartPlugin);        // native: register a Heart mobject, Heartbeat animation, color, rate func
loadManifest(cyberpunk); // portable JSON manifest: colors/rateFunctions/surfaces/shapes (also loads in Python manim)
await loadWasm();         // shared Rust→WASM math core (also callable from Python via wasmtime)
```

## Examples

Render any of these with `node examples/<name>.ts` (writes to `examples/out/`):

| File | Shows |
|------|-------|
| `examples/basic.ts` | shapes, Create, Transform, FadeOut, Text |
| `examples/graph.ts` | Axes, `plot()`, ValueTracker, alwaysRedraw, LaggedStart, Indicate |
| `examples/hello-scene.ts` | minimal Scene + `nextSection()` (used by the CLI docs) |
| `examples/morph.ts` | VText — glyph outlines traced by Write, morphed by Transform |
| `examples/mathtex.ts` | MathTex — LaTeX (Euler's identity, sums, integrals) as Béziers |
| `examples/threed.ts` | ThreeDScene — projection camera orbiting a 3D scene |
| `examples/surfaces.ts` | Sphere, Torus, Cube, parametric saddle — shaded, depth-sorted |
| `examples/interpenetrate.ts` | z-buffer vs painter sorting on a sphere through a plane |
| `examples/smooth.ts` | smooth (Gouraud) vs flat shading on spheres + a torus |
| `examples/media.ts` | ImageMobject + SVGMobject + sound (MP4 with an audio track) |
| `examples/video.ts` | VideoMobject — ingest an external clip (frames + audio), play it in-scene ([docs/video.md](docs/video.md)) |
| `examples/svg-output.ts` | vector output — a single `.svg` + a numbered `.svg` sequence (`format: "svg"`) |
| `examples/render-gl.ts` | opt-in headless GPU render via `renderGL` (needs a CDP Chrome; see docs/renderers.md) |
| `examples/metadata.ts` | schema.org `VideoObject` + IIIF manifest export — chapters from `nextSection()` ([docs/metadata.md](docs/metadata.md)) |
| `examples/primitives.ts` | Timeline + `wiggle` driver + `VectorDecimalNumber` + style preset + `renderStill` ([docs/primitives.md](docs/primitives.md)) |
| `examples/audio-reactive.ts` | FFT spectrum bars + `CaptionTrack` + muxed audio ([docs/captions-audio.md](docs/captions-audio.md)) |
| `examples/voiceover.ts` | TTS-synced narration with `<bookmark>` cues ([docs/voiceover.md](docs/voiceover.md)) |
| `examples/diagram.ts` | diagram-as-code + animated board transition via auto-matching ([docs/animation-presentation.md](docs/animation-presentation.md)) |
| `examples/interchange.ts` | watermarked render + `.otio` + Lottie export ([docs/interchange.md](docs/interchange.md)) |
| `examples/physics.ts` | analytic E-field + pendulum + bouncing rigid bodies ([docs/physics.md](docs/physics.md)) |
| `examples/authoring.ts` | Format lifecycle → real render + plan-IR dry-run ([docs/authoring-studio.md](docs/authoring-studio.md)) |
| `examples/browser/index.html` | browser Canvas-2D backend (live + WebM export) |
| `examples/browser-three/index.html` | browser WebGL/Three.js backend (+ "Explore" orbit mode) |
| `examples/plugins/heart-plugin.ts` | native `use()` plugin |
| `examples/plugins/cyberpunk.manifest.json` | portable cross-language manifest |

## Architecture

```
src/
  core/
    math/vector.ts     [x,y,z] point/vector math + direction constants (UP, RIGHT, …)
    math/bezier.ts     cubic bezier eval, arc approximation, partial-curve splitting
    math/paths.ts      path functions (straight/arc/counterclockwise) for MoveAlongPath etc.
    color.ts           Color class + color utilities
    colors_data.ts     the full ~2200-color palette (core + X11/XKCD/SVG/BS381/AS2700/DVIPS)
    constants.ts       buffers, screen edges, enums (RendererType, LineJointType, CapStyleType)
    types.ts           shared types (RateFunc, …)
  mobject/
    Mobject.ts         base: submobject tree, transforms, bounds, .animate, updaters
    VMobject.ts        bezier shapes, fill/stroke, subpaths, point-count alignment
    geometry.ts        Arc Circle Dot Ellipse Annulus Line Arrow DashedLine Polygon Rectangle Square …
    tips.ts arcs.ts    arrow tips; ArcBetweenPoints, CurvedArrow, Sector, Angle, AnnularSector
    polygram.ts        Polygram, RegularPolygram, Star, RoundedRectangle
    boolean_ops.ts     Union/Difference/Intersection/Exclusion (polygon-clipping)
    matrix.ts table.ts Matrix, IntegerMatrix, DecimalMatrix; Table, MathTable, MobjectTable
    brace.ts           Brace, BraceLabel, BraceBetweenPoints, BraceText
    graph.ts           Graph, DiGraph (network graphs + layouts)
    vectors.ts         Vector, Arrow-based vector helpers
    labeled.ts         LabeledLine, LabeledArrow
    shape_matchers.ts  SurroundingRectangle, BackgroundRectangle, Cross, Underline
    coordinate_systems.ts NumberLine, Axes, NumberPlane, PolarPlane, ComplexPlane, UnitInterval
    functions.ts       ParametricFunction, FunctionGraph, ImplicitFunction
    graphing_scale.ts  LogBase and axis scaling helpers
    probability.ts     BarChart, SampleSpace
    vector_field.ts    VectorField, ArrowVectorField, StreamLines
    surface.ts         Surface/ParametricSurface, Sphere, Torus, Cylinder, Cone, Box, Cube,
                       Prism, Dot3D, Line3D, Arrow3D, ThreeDVMobject (+ caps)
    polyhedra.ts       Polyhedron, Tetrahedron, Octahedron, Icosahedron, Dodecahedron, ConvexHull3D
    value_tracker.ts   ValueTracker, DecimalNumber, Integer, alwaysRedraw
    complex_value_tracker.ts  ComplexValueTracker
    text/Text.ts       Text/MarkupText (Canvas glyphs, .chars, t2c) + RasterText
    text/paragraph.ts  Paragraph, Title
    text/code.ts       Code (syntax-highlighted listings)
    text/variable.ts   Variable (label = tracked DecimalNumber)
    text/tex_extras.ts Tex text-mode helpers
    vectorized_text.ts VText — real glyph outlines as Béziers (opentype.js)
    mathtex.ts         MathTex / Tex / SingleStringMathTex — LaTeX via MathJax → Bézier glyphs (token/part model)
    svg_path.ts        SVG path `d` → cubic-Bézier subpaths (powers MathTex/VText)
    svg_mobject.ts     SVGMobject — load an .svg → animatable VMobjects
    image_mobject.ts   ImageMobject — a raster bitmap in the scene
  scene/
    Scene.ts           play()/wait(), fixed-fps frame emission, sections (nextSection)
    three_d.ts         ThreeDScene, ThreeDCamera (projection), ThreeDAxes
    moving_camera_scene.ts  MovingCameraScene, ScreenRectangle, FullScreenRectangle
    zoomed_scene.ts    ZoomedScene
    vector_space_scene.ts   VectorScene, LinearTransformationScene
  camera/
    multi_camera.ts    MultiCamera
    mapping_camera.ts  MappingCamera
  animation/
    Animation.ts       Animation base, Transform, Create, Write, Fade*, ApplyMethod, MoveTo, …
    composition.ts     AnimationGroup, LaggedStart, LaggedStartMap, Succession, the .animate builder
    extra.ts           GrowFrom*, SpinInFromNothing, Indicate, Flash, Wiggle, Circumscribe, FocusOn, …
    creation_extra.ts  DrawBorderThenFill, Unwrite, TypeWithCursor, SpiralIn, letter/word reveals
    transform_extra.ts TransformFromCopy, MoveToTarget, Restore, ApplyMatrix, ApplyComplexFunction, …
    transform_matching.ts  TransformMatchingShapes, TransformMatchingTex
    movement.ts        Homotopy, SmoothedVectorizedHomotopy, ComplexHomotopy, PhaseFlow
    indication_extra.ts ShowPassingFlash, ApplyWave, Blink
    changing.ts        AnimatedBoundary, TracedPath
    numbers.ts         ChangingDecimal, ChangeDecimalToValue
    specialized.ts     Broadcast, ChangeSpeed
    rate_functions.ts  all 58 rate curves (45 registered by name)
  renderer/
    CanvasRenderer.ts  isomorphic: draws mobjects to any 2D context (+ 3D z-buffer path)
    zbuffer.ts         software rasterizer w/ per-pixel depth buffer (3D)
    geometry_util.ts   mobject tree → GPU-ready vertex buffers (shared by ThreeRenderer)
    ThreeRenderer.ts   WebGL renderer (Three.js) — GPU depth buffer, MSAA
    fonts-node.ts      auto-registers system fonts (@napi-rs/canvas + opentype)
  plugins/
    registry.ts        the shared Registry + use()
    builtins.ts        registers all built-in mobjects/animations/rate-funcs/colors/scenes
    manifest.ts        loadManifest() — portable JSON manifest → registry
    expr.ts            safe recursive-descent expression evaluator (no eval)
  wasm.ts              loader for the shared Rust→WASM math core
  node.ts              Node backend: @napi-rs/canvas → ffmpeg (+ caching, sections)
  browser.ts           Browser backend (Canvas-2D): live play() + record() → WebM
  browser-three.ts     Browser backend (WebGL/Three.js): GPU play() + record()
  index.ts             isomorphic entry point (registers built-ins on import)

packages/
  plugin-spec/         portable manifest JSON Schema + expression grammar (the shared spec)
  manim-portable-plugins/  Python adapter: load the same manifest into Python manim
  manim-wasm/          Rust source (lib.rs) + compiled manim_core.wasm + Python (wasmtime) loader
```

Deeper module map, rendering pipeline, and registry mechanics:
[docs/architecture.md](docs/architecture.md).

## API parity with manim

| Area | manim | ecmanim | Notes |
|------|-------|----------|-------|
| Scene | `class S(Scene): def construct` | `class S extends Scene { async construct() }` | `await this.play(...)`, `await this.wait(t)` |
| Play | `self.play(a, b, run_time=2)` | `await this.play(a, b, { _playConfig: true, runTime: 2 })` | parallel by default |
| `.animate` | `mob.animate.shift(RIGHT)` | `mob.animate.shift([1,0,0])` | chainable proxy |
| Geometry | Circle, Square, Line, Polygon, … | ✅ same | Arc Circle Dot Ellipse Annulus Line Arrow DashedLine Polygon RegularPolygon Triangle Rectangle Square |
| Tips / arcs | ArrowTip, ArcBetweenPoints, CurvedArrow, Sector, Angle | ✅ same | tips.ts, arcs.ts — Sector/AnnularSector/Angle/RightAngle |
| Polygrams | Polygram, RegularPolygram, Star, RoundedRectangle | ✅ same | polygram.ts |
| Boolean ops | Union, Difference, Intersection, Exclusion | ✅ same | via `polygon-clipping` |
| Matrix | Matrix, IntegerMatrix, DecimalMatrix | ✅ same | brackets, entries, `get_rows/get_columns` |
| Table | Table, MathTable, MobjectTable | ✅ same | row/col labels, lines, highlights |
| Brace | Brace, BraceLabel, BraceBetweenPoints, BraceText | ✅ same | |
| Graphs | Graph, DiGraph | ✅ same | vertices/edges + layouts |
| Text (raster) | Text | ✅ `Text` / `RasterText` | fast Canvas text, typewriter reveal for Write/Create, `.chars`, `t2c` |
| Text (vector) | Text (Pango glyph paths) | ✅ `VText` | **real glyph outlines as Béziers** (opentype.js) — Write traces, Transform morphs |
| Markup | MarkupText | ✅ `MarkupText` | inline color/style spans |
| LaTeX | `MathTex`, `Tex` (shells out to LaTeX) | ✅ `MathTex`, `Tex`, `SingleStringMathTex` | **MathJax → SVG → Béziers, no LaTeX binary**; token/part model, text-mode `Tex` |
| Code / prose | Code, Paragraph, Title, Variable | ✅ same | syntax-highlighted `Code`, `Paragraph`, `Title`, tracked `Variable` |
| Coordinates | Axes, NumberPlane, NumberLine, `plot` | ✅ same | `axes.c2p(x,y)`, `axes.plot(fn)` |
| Axes helpers | area, Riemann rects, secant/tangent, labels | ✅ same | `get_area`, Riemann rectangles, secant/tangent lines, axis labels |
| Planes | PolarPlane, ComplexPlane, LogBase | ✅ same | polar/complex planes, log-scaled axes |
| Function plots | ParametricFunction, FunctionGraph, ImplicitFunction | ✅ same | functions.ts |
| Charts | BarChart, SampleSpace | ✅ same | probability.ts |
| Vector fields | VectorField, ArrowVectorField, StreamLines | ✅ same | vector_field.ts |
| 3D | ThreeDScene, ThreeDAxes, move_camera | ✅ same | projection camera (φ/θ + perspective), `moveCamera`, ambient rotation, gamma/light, fixed-in-frame |
| 3D solids | Sphere, Torus, Cylinder, Cone, Cube, Box, Prism | ✅ same | + caps, Dot3D, Line3D, Arrow3D, ThreeDVMobject |
| Polyhedra | Tetrahedron, Octahedron, Icosahedron, Dodecahedron | ✅ same | + Polyhedron, ConvexHull3D |
| Surfaces | Surface, checkerboard, shading | ✅ `Surface`/`ParametricSurface` | quad-mesh faces, **smooth (Gouraud) or flat shading**, checkerboard/`colorFunc`, **per-pixel z-buffer** |
| Creation | Create, Write, Uncreate, DrawBorderThenFill | ✅ same | + Unwrite, SpiralIn, letter/word/typewriter reveals |
| Transform | Transform, ReplacementTransform | ✅ same | automatic Bézier point-count alignment |
| Transform (matching) | TransformMatchingShapes, TransformMatchingTex | ✅ same | transform_matching.ts |
| Transform (extra) | MoveToTarget, Restore, ApplyMatrix, ApplyComplexFunction, … | ✅ same | transform_extra.ts |
| Fading | FadeIn, FadeOut (+shift/scale), FadeTransform | ✅ same | |
| Growth | GrowFromCenter/Point/Edge, SpinInFromNothing, ShrinkToCenter | ✅ same | |
| Motion | MoveAlongPath, Rotate, Rotating, ApplyMethod, Homotopy, PhaseFlow | ✅ same | movement.ts |
| Emphasis | Indicate, Flash, Wiggle, Circumscribe, FocusOn, ApplyWave, Blink | ✅ same | |
| Groups | AnimationGroup, LaggedStart, LaggedStartMap, Succession | ✅ same | `lagRatio` timing matches manim |
| Changing | AnimatedBoundary, TracedPath | ✅ same | |
| Trackers | ValueTracker, DecimalNumber, Integer, ComplexValueTracker, always_redraw | ✅ same | `alwaysRedraw`; DecimalNumber is raster-backed (see below) |
| Updaters | `mob.add_updater(fn)` | `mob.addUpdater((mob, dt) => …)` | run each frame during play/wait |
| Rate funcs | smooth, rush_into, there_and_back, … (58) | ✅ camelCase (58 exported, 45 registered) | `smooth`, `rushInto`, `thereAndBack`, … |
| Colors | WHITE, BLUE, RED, … | ✅ same names + ~2200 palette | X11/XKCD/SVG/BS381/AS2700/DVIPS namespaces + `Color.lerp`, hex parsing |
| Images | `ImageMobject` | ✅ `ImageMobject` | positioned, scaled, faded |
| SVG files | `SVGMobject` | ✅ `SVGMobject` | parses paths/shapes/groups/transforms → animatable VMobjects |
| Sound | `self.add_sound(file, time)` | ✅ `scene.addSound(file, {timeOffset, gain})` | Node muxes via ffmpeg; browser plays live |
| Cameras | MovingCamera, MultiCamera, MappingCamera | ✅ MovingCameraScene, ZoomedScene, MultiCamera, MappingCamera | |
| Vector scenes | VectorScene, LinearTransformationScene | ✅ same | vector_space_scene.ts |
| Sections | `self.next_section(...)` | ✅ `scene.nextSection(...)` | `--save_sections` writes per-section videos + JSON index |
| Config / caching | `manim.cfg`, partial-movie cache | ✅ `manim.config.{js,json}`, partial-movie cache | layered config, content-hash partials, `--disable_caching`/`--flush_cache` |
| Render targets | `-ql/-qm/-qh`, mp4/gif/png | ✅ quality presets, mp4/webm/gif/mov/png | **+ browser (Canvas live + WebM), + WebGL (Three.js) GPU backend** |
| Renderers | Cairo (2D) / OpenGL (GL) | ✅ Canvas-2D (CPU, Node+browser, z-buffer for 3D) + Three.js (WebGL, browser) | same Scene/mobjects drive both |
| Plugins | `manim.plugins` entry points | ✅ `use()` + portable JSON manifest + WASM core | manifest loads in ecmanim *and* Python manim; WASM callable from both |

### Honest divergences

- **`DecimalNumber` is raster-backed.** It extends `RasterText` (Canvas glyphs),
  not vector glyphs, so number labels are drawn as bitmap text rather than Béziers.
- **`MathTex` / `VText` in the browser need a font/bundler.** They expect MathJax
  and an opentype font to be available (via a bundler, import-map, or
  `setDefaultFont`). The Node path auto-initializes both.
- **No true LaTeX binary.** `MathTex`/`Tex` render via **MathJax → SVG → Béziers**,
  not a real LaTeX/dvipng toolchain, so exotic LaTeX packages are out of scope.
- **3D is CPU-projection, not GPU-lit.** The default renderer is a software
  projection camera with a per-pixel z-buffer and Gouraud/flat shading — there is
  no per-pixel Phong lighting model. The optional Three.js backend adds GPU depth
  and MSAA but the same shading approximation.
- **`ImageMobject` in 3D** is drawn at its projected bounding box in the CPU
  renderer (not perspective-warped); the WebGL backend places it as a true 3D quad.
- **Python side of manifest/WASM needs its own runtimes.** Loading a manifest into
  Python manim requires `manim` installed (`manim-portable-plugins[manim]`), and
  calling the WASM core from Python requires `wasmtime`.

## Testing

```bash
npm test    # node --test — ~300 tests across 38 files (math, mobjects, animations,
            # 3D/z-buffer, plugins, manifest, CLI/config, integration + headless renders)
```

## Building

```bash
npm run type-check   # tsc --noEmit (strict-ish; see tsconfig.json)
npm run build        # tsc → dist/ (JS + .d.ts + sourcemaps) for publish/bundlers
```

Node 25+ runs the `.ts` sources directly (type-stripping), so no build is needed
for local development, the CLI, or the examples — `dist/` exists for publishing
and browser bundlers via the package `exports` map (`.`, `./node`, `./browser`,
`./browser-three`).

## License

MIT
