---
title: "Architecture"
---

ecmanim is a TypeScript port of ManimCommunity manim built around one principle:
**one isomorphic core, multiple render backends.** The same `Scene`, mobject, and
animation objects run unchanged in Node (headless video) and the browser (live
canvas + WebM), including an optional WebGL/Three.js path. This document maps the
modules, walks the render pipeline, and explains the registry and the TS/build
setup.

## The isomorphic core

Everything that does not touch a filesystem or a specific rendering context lives
under `src/` and is re-exported from `src/index.ts`. Importing `ecmanim`
(i.e. `src/index.ts`) gives you the full library **and** registers all built-ins
into the shared registry (`registerBuiltins()` runs at import time).

The three backend entry points wrap that core with the glue their target needs:

| Entry | File | Adds |
|-------|------|------|
| `ecmanim` | `src/index.ts` | isomorphic core; registers built-ins on import |
| `ecmanim/node` | `src/node.ts` | `render()` → `@napi-rs/canvas` → PNG frames → `ffmpeg`; caching + sections |
| `ecmanim/browser` | `src/browser.ts` | `play()` (rAF loop) + `record()` (`MediaRecorder` → WebM) on Canvas-2D |
| `ecmanim/browser-three` | `src/browser-three.ts` | `play()`/`record()` on a Three.js WebGL renderer |

Because the core never imports `node:fs`, `@napi-rs/canvas`, `three`, or DOM
globals directly, the browser bundles stay clean. Node-only helpers (config file
loading, manifest-from-file, WASM byte reads) use *dynamic* `import()` guarded by
a `process.versions.node` check, so the same modules are safe in the browser.

## Module map

```
src/
  core/          math, color, constants, shared types
    math/vector.ts   [x,y,z] vector math, direction constants, earclip triangulation
    math/bezier.ts   cubic bezier eval, arc→bezier, partial-curve splitting
    math/paths.ts    path_along_arc / straight / counterclockwise (MoveAlongPath, ArcBetweenPoints)
    color.ts         Color class + parsing/lerp utilities
    colors_data.ts   the ~2200-name palette (core + X11/XKCD/SVG/BS381/AS2700/DVIPS)
    constants.ts     buffers, screen edges, enums (RendererType/LineJointType/CapStyleType)
    types.ts         RateFunc and other shared types
  mobject/       the object model (see the tree in the README for the full listing)
    Mobject.ts       base node: submobject tree, transforms, bounds, .animate proxy, updaters
    VMobject.ts      Bézier-path mobject: fill/stroke, subpaths, point-count alignment
    …                geometry, tips, arcs, polygram, boolean_ops, matrix, table, brace, graph,
                     coordinate_systems, functions, probability, vector_field, surface, polyhedra,
                     value_tracker, text/*, vectorized_text, mathtex, svg_*, image_mobject
  scene/
    Scene.ts         play()/wait() timing, fixed-fps frame emission, sections
    three_d.ts       ThreeDScene, ThreeDCamera (projection), ThreeDAxes
    moving_camera_scene.ts / zoomed_scene.ts / vector_space_scene.ts
  camera/
    multi_camera.ts / mapping_camera.ts
  animation/       Animation base + the ~110-strong catalogue + rate_functions.ts
  renderer/
    CanvasRenderer.ts  isomorphic 2D drawer (works on any CanvasRenderingContext2D)
    zbuffer.ts         software rasterizer with a per-pixel depth buffer (3D)
    geometry_util.ts   mobject tree → vertex buffers (shared with ThreeRenderer)
    ThreeRenderer.ts   WebGL renderer (Three.js)
    fonts-node.ts      auto-register system fonts (Node)
  plugins/
    registry.ts        the shared Registry + use()
    builtins.ts        registers every built-in into the registry
    manifest.ts        loadManifest() — portable JSON manifest → registry
    expr.ts            safe recursive-descent expression evaluator (no eval)
  wasm.ts              loader for the shared Rust→WASM math core
  node.ts / browser.ts / browser-three.ts   backends
  index.ts             isomorphic entry point

packages/
  plugin-spec/               portable manifest JSON Schema + expression-grammar spec
  manim-portable-plugins/    Python adapter for the same manifest
  manim-wasm/                Rust lib.rs + compiled manim_core.wasm + wasmtime Python loader
```

### The object model

- **`Mobject`** is the base node. It owns a submobject tree, an affine transform,
  bounds computation, updaters (`addUpdater`), and the `.animate` proxy that
  records method calls into an animation.
- **`VMobject`** extends it with Bézier geometry: a flat point array grouped into
  cubic-Bézier subpaths, fill and stroke styling, and point-count *alignment* so
  any two VMobjects can be interpolated by `Transform`.
- Concrete shapes (Circle, Polygon, Axes, Surface, MathTex, VText, …) build their
  point arrays in their constructor. Text/MathTex convert glyph outlines (from
  opentype.js / MathJax SVG) into Bézier subpaths via `svg_path.ts`.

## Rendering pipeline

The scene is backend-agnostic; the backend only decides where frames go.

```
Scene.construct()
   │  await this.play(anim, …) / this.wait(t)
   ▼
Scene timing loop  ── advances animation alpha at a fixed fps, applies updaters
   │  emits one frame callback per tick
   ▼
CanvasRenderer.render(mobjects, ctx)          ← isomorphic 2D draw
   │   • 2D: fill + stroke each VMobject subpath with bezierCurveTo
   │   • 3D (ThreeDCamera active): project points, then
   │        zbuffer.ts rasterizes depth-tested triangles/lines per pixel
   ▼
   ├─ Node  (node.ts):   ctx → PNG buffer → piped to ffmpeg → mp4/webm/gif/mov
   ├─ Browser (browser.ts): ctx is the visible <canvas>; MediaRecorder → WebM
   └─ Browser (browser-three.ts): geometry_util.ts → Three.js meshes → WebGL
```

### 2D drawing

`CanvasRenderer` walks the mobject tree and draws each `VMobject` onto any
`CanvasRenderingContext2D`: subpaths become `moveTo`/`bezierCurveTo` paths, then
`fill()` and `stroke()` with the mobject's style. This is the same code in Node
(`@napi-rs/canvas`'s context) and the browser (the real DOM `<canvas>`).

### 3D drawing (CPU projection + z-buffer)

When a `ThreeDCamera` is active, points are projected (φ/θ orientation +
perspective) to 2D, and rendering switches to `zbuffer.ts`: a software rasterizer
that keeps a per-pixel depth buffer. Filled faces become depth-tested triangles
and strokes become depth-tested lines, so *interpenetrating* surfaces (a sphere
through a plane) resolve correctly per pixel instead of mis-sorting. Set
`camera.disableZBuffer = true` for per-face painter sorting (compared side-by-side
in `examples/interpenetrate.ts`). Parametric surfaces default to **Gouraud
shading** — each corner lit by an analytic normal, color interpolated across the
face — with `smooth: false` (or `camera.flatShading = true`) for flat per-face
shading (`examples/smooth.ts`).

### WebGL drawing (Three.js)

The optional browser backend keeps the identical `Scene`/mobject/animation code
and swaps only the draw step: `geometry_util.ts` turns the mobject tree into
GPU-ready vertex buffers, and `ThreeRenderer.ts` builds Three.js meshes (fills →
vertex-colored triangles, strokes → line segments, text → billboard sprites). It
gets a hardware depth buffer, MSAA, and real-time OrbitControls for free. It is a
browser-only accelerator; the Canvas backend remains the default and is the only
one used for headless Node video.

### Node encoding, caching, and sections

`render()` in `node.ts` buffers each `play()`/`wait()` segment's PNG frames and,
unless caching is disabled, writes each segment to a **partial movie file** in a
sibling `partial/` directory keyed by a **content hash**. On the next render,
segments whose hash is unchanged are reused (their frames are not re-buffered),
and all partials are concatenated with ffmpeg's concat demuxer into the final
output. `--disable_caching` bypasses this; `--flush_cache` deletes the `partial/`
directory first. If `--save_sections` is set (or `scene.nextSection(...)` markers
exist), each section is also written to `media/sections/<name>.<ext>` with a
manim-format JSON index. See [cli.md](/guides/cli/) for the flags.

## The registry

`src/plugins/registry.ts` defines a single shared `Registry` singleton. It holds
six name→value maps — `mobject`, `animation`, `rateFunction`, `color`,
`renderer`, `scene` — plus a `bases` record exposing the base classes
(`Mobject`, `VMobject`, `VGroup`, `Animation`, `Scene`, `Color`) so plugin
authors can extend without deep imports.

- **Built-ins register themselves.** `registerBuiltins()` (called on import of
  `index.ts`) reflects over every mobject/animation/scene module and registers
  each exported subclass of `Mobject`/`Animation`/`Scene` by name, plus all rate
  functions and every `#`-prefixed color string. It is idempotent (guarded by a
  `done` flag).
- **`use(plugin)`** runs a plugin's `install(api)` against the singleton (a bare
  `(api) => {…}` function works too), letting it register new entries or override
  built-ins by re-registering the same name. Chainable; the plugin is recorded in
  `registry.plugins`.
- **`loadManifest(json)`** parses a portable JSON manifest and registers its
  colors/rateFunctions/surfaces/shapes into the registry (expressions compiled by
  the safe evaluator — never `eval`). See [plugins.md](/guides/plugins/).
- **`ecmanim plugins`** (CLI) prints `registry.list(kind)` for each kind, so you
  can see everything currently registered.

Registered names are what the CLI's `plugins` subcommand lists and what a
manifest's `fillColor` references resolve against; the public typed exports in
`index.ts` are the ergonomic surface for direct `import`.

## TypeScript & build setup

- **Sources are `.ts` and run directly.** Node 25+ strips types at load time, so
  the CLI (`bin/ecmanim.ts`), the examples, and the tests all run against the
  `.ts` sources with no build step. Imports use explicit `.ts` extensions
  (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions` in
  `tsconfig.json`), which `tsc` rewrites to `.js` in `dist/`.
- **`tsc` emits `dist/`** with JS, `.d.ts`, and sourcemaps (`npm run build`), and
  `npm run type-check` runs `tsc --noEmit`. `dist/` is what the package `exports`
  map points at for publishing and browser bundlers — with subpaths `.`,
  `./node`, `./browser`, and `./browser-three`.
- **Optional native/peer deps.** `@napi-rs/canvas` (Node canvas) and `three`
  (WebGL) are `optionalDependencies`; the core degrades gracefully without them
  and only the corresponding backend requires them. `ffmpeg`/`ffprobe` are
  external binaries expected on `PATH` for Node video.
- **Config.** `src/_config.ts` implements a manim-style layered config
  (hard-coded defaults < mutable process `config` < per-call overrides) with
  snake_case/camelCase aliasing and quality-preset expansion; `loadConfigFile()`
  merges a `manim.config.{js,mjs,json}`.

## The cross-language core (`packages/`)

Two artifacts are shared verbatim between ecmanim and Python manim:

- **The manifest spec** (`packages/plugin-spec`): a JSON Schema plus a small
  arithmetic-expression grammar with reference evaluators in both TypeScript
  (`expr.ts`) and Python (`manim-portable-plugins`). The *same* manifest file
  loads into either engine.
- **The WASM math core** (`packages/manim-wasm`): a Rust `lib.rs` compiled to
  `manim_core.wasm` exposing cubic-Bézier eval, polygon ear-clipping, and 3×3
  matrix×vector. `src/wasm.ts` loads it in JS (Node `fs` or browser `fetch`) and
  wires the accelerator into the pure-JS core; `python_loader.py` loads the same
  bytes via `wasmtime`. Both are verified byte-identical. Loading is optional and
  degrades to the pure-JS implementations if the `.wasm` is unavailable.

See [plugins.md](/guides/plugins/) for how to author against all three extension points.
