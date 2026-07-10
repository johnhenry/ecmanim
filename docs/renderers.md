# Renderers

ecmanim's scene graph is backend-agnostic: every renderer consumes the same
`mobjects[]` tree that `Scene` produces. The default is a CPU Canvas-2D
rasterizer, and two alternate targets share the same scenes.

| Renderer | Where | Output | Deterministic | Needs |
|----------|-------|--------|:-------------:|-------|
| **Canvas-2D** (default) | Node + browser | raster (mp4/webm/gif/mov/png) | ✅ | `@napi-rs/canvas`, `ffmpeg` (Node) |
| **SVG / vector** | Node + browser | `.svg` frame(s) | ✅ | nothing |
| **Three.js / WebGL** | browser | live `<canvas>` + WebM | ❌ (GPU) | a WebGL2 context |
| **Headless GPU** (`renderGL`) | Node | mp4/webm/mov | ❌ (GPU) | a CDP-accessible Chrome |

The CPU Canvas-2D backend stays the default because its determinism is what
makes the content-hash partial-movie cache and reproducible CI snapshots sound.
The two alternate renderers below are opt-in.

## The `SceneRenderer` interface

Each backend class also exposes an additive `renderFrame(mobjects)` method
satisfying one shared shape (`{ renderFrame(mobjects): void | string }`),
purely delegating to that class's existing named method
(`CanvasRenderer.renderScene`/`ThreeRenderer.render`/
`SVGRenderer.renderToString`, all unchanged and still the primary API):

```js
import { CanvasRenderer, SVGRenderer } from "ecmanim";

function drawWith(renderer, mobjects) {
  renderer.renderFrame(mobjects); // works the same across all three backends
}
```

## Static-subtree render caching (Canvas-2D)

`mobject.cacheStatic()` opts a mobject into `CanvasRenderer`'s per-mobject
render cache: on an unchanged frame (a content-based fingerprint of its
geometry/style, *and* the camera state), the renderer blits a small cached
offscreen bitmap instead of re-walking the bezier path.

```js
const grid = buildBackgroundGrid(); // many unchanging line segments
grid.cacheStatic();
scene.add(grid);
```

Screen-space, MVP-scoped: invalidated on *any* camera-state change
(`frameCenter`/`frameWidth`/`frameHeight`/`zoom`), so it mainly helps
static-camera scenes with many unchanging elements (dense axis labels,
background grids) — not scenes with continuous camera motion, where it
invalidates every cached mobject each frame anyway. Requires a synchronous
offscreen-canvas backend (`OffscreenCanvas`, or a detached `<canvas>` in a
DOM environment); gracefully no-ops under headless Node (where only an async
`@napi-rs/canvas` import is available) — calling `cacheStatic()` there is
harmless, it just draws directly every frame like normal.

## WebGL raster-text batching (Three.js)

`ThreeRenderer` automatically batches every raster `Text` mobject present in
a frame into ONE shared texture atlas + ONE merged quad mesh (via
`src/renderer/text_atlas.ts`'s `buildTextAtlas()`), instead of one
`THREE.Sprite` (own `CanvasTexture`) per mobject — converting N draw calls
into 1 for scenes with many small text labels. This needs no opt-in and no
API change; it's automatic whenever the camera is 2D-orthographic (where a
flat quad looks identical to a billboarded sprite). A genuine 3D/perspective
camera keeps the original per-mobject sprite path, since real billboarding
needs each label to actually face the viewer.

---

## SVG / vector output

A second render backend that walks the same tree the CanvasRenderer walks and
emits an SVG document per frame instead of drawing to a canvas. VMobjects become
`<path>` elements (cubic Béziers, `M`/`C`), styled with the mobject's
fill/stroke; raster `Text` becomes `<text>`; `ImageMobject` becomes `<image>`.
Projection goes through the exact same `camera.toPixel`, so the geometry matches
the canvas output pixel-for-pixel — just resolution-independent, tiny, and
editable.

### Node (`format: "svg"`)

```js
import { render } from "ecmanim/node";

// A single final frame -> one .svg
await render(MyScene, { output: "out.svg", format: "svg", saveLastFrame: true });

// The whole animation -> a numbered sequence: out_svg/frame_000000.svg, ...
await render(MyScene, { output: "out.svg", format: "svg" });
```

### Isomorphic (`SVGRenderer` / `mobjectsToSVG`)

Available from the core entry (works in Node and the browser):

```js
import { Camera, SVGRenderer, mobjectsToSVG } from "ecmanim";

const camera = new Camera({ pixelWidth: 1920, pixelHeight: 1080 });
const svg = new SVGRenderer(camera, { precision: 2, background: "#0d1117" });
const doc = svg.renderToString(scene.mobjects); // a full <svg>…</svg> string

// or, one-shot with an implicit camera:
const doc2 = mobjectsToSVG(scene.mobjects, { pixelWidth: 800, pixelHeight: 450 });
```

Options: `precision` (coordinate decimal places, default 2) and `background`
(`null` = transparent, default).

### Limitations

- **3D is a vector approximation.** Points are still projected via
  `camera.toPixel` and drawn in painter's order, but there is no per-pixel
  z-buffer in vector mode (unlike the raster 3D path). Interpenetrating surfaces
  won't resolve correctly. It never throws on a 3D scene.
- **Raster assets stay raster.** `ImageMobject` is embedded as an `<image>` data
  URL when one is obtainable, otherwise a placeholder rect.
- To turn a `.svg` sequence into a video, rasterize it (e.g. `resvg`/`sharp`)
  and feed the PNGs to ffmpeg, or just use the default raster renderer.

---

## Headless GPU (`renderGL`, Node)

The GPU-quality alternative to the CPU renderer: it runs the existing
Three.js/WebGL backend (`ecmanim/browser-three`) inside a headless Chrome that
exposes WebGL2, then captures the video back to disk in Node. You get real
per-pixel lighting, MSAA, and GPU strokes — headless, with **no physical GPU**
(Chrome's ANGLE + Mesa llvmpipe is a software rasterizer).

This is *not* the Remotion "screenshot the DOM" model: ecmanim renders its own
mobjects via `ThreeRenderer` onto a canvas and reads that canvas back. The
browser is used only as a WebGL host.

### Usage

```js
import { renderGL } from "ecmanim/node";

const res = await renderGL({
  sceneModule: "scenes/my-gl-scene.ts", // browser-importable ES module (runs in the page)
  sceneExport: "default",               // the Scene class export (default "default")
  root: process.cwd(),                  // dir served over http; must contain dist/browser-three.js
  cdpUrl: "http://localhost:9222",      // or env MANIM_CDP_URL
  output: "out.mp4",
  format: "mp4",                        // "webm" (native) | "mp4" | "mov" (transcoded via ffmpeg)
  quality: "medium",
  fps: 30,
});
// -> { output, format, bytes, renderer: "gl" }
```

Because the scene executes in the browser page, it must be its own
**browser-importable module** that imports from `"ecmanim/browser-three"` (the
`renderGL` harness maps that specifier to the built `dist/browser-three.js`).
This mirrors how `renderParallel` takes a scene by module path rather than an
in-process class. Run `npm run build` first so `dist/browser-three.js` exists.

### Providing a CDP Chrome

`renderGL` connects to an existing Chrome over the DevTools Protocol (zero
dependencies — it uses Node's global `fetch`/`WebSocket`). Point it at any
`--remote-debugging-port` Chrome:

```bash
google-chrome --headless=new --remote-debugging-port=9222 \
  --use-gl=angle --use-angle=swiftshader-webgl --disable-gpu-sandbox
```

If no CDP endpoint is reachable, `renderGL` throws with an actionable message
(and the default CPU `render(...)` needs none). `probeCDP(cdpUrl)` is exported
from `ecmanim/node` for a graceful check.

> **Shared-machine coordination (trycooy).** On this workstation the CDP Chrome
> (`gl-chrome.service`, port 9222) is a single instance shared by concurrent
> agent sessions. Before driving it (via `renderGL`, `agent-browser`, or the
> node-gl e2e tests), create `~/gpu.lock` and remove it when done — if it already
> exists, another session holds the GPU, so wait rather than retry. See the
> "GPU/Chrome lock convention" note in the system `CLAUDE.md`.

### Determinism

GPU output varies by driver/rasterizer, so `renderGL` output is **not** fed into
the content-hash partial-movie cache. Use it for final high-fidelity renders;
keep the CPU renderer for cache-friendly, reproducible builds.

### Capture is real-time (wall-clock), not frame-clock

`record()` (in `ecmanim/browser-three`, and the CPU `ecmanim/browser` backend)
captures frames through `canvas.captureStream()` + `MediaRecorder`. That API
stamps every captured frame with the *real* wall-clock time it was pushed —
there is no way to hand it a synthetic per-frame duration. To get a WebM whose
embedded timestamps actually match the scene's intended `fps`, each frame is
throttled to its real target time (`start + frame * 1000 / fps`) before the
next one is captured, exactly like the live `play()` path.

The practical consequence: **`renderGL()` (and browser `record()`) take at
least as long in wall-clock time as the scene's total `runTime`.** A 1.4s
scene takes at least 1.4 real seconds to capture, no matter how fast the
GPU/rasterizer can draw each frame — the bottleneck is intentionally the
frame-pacing loop, not the renderer. If a *previous* build produced an output
video with an implausibly short duration and a nonsensical `avg_frame_rate`
(e.g. ffprobe reporting ~100+ fps instead of the requested `fps`), that was a
pacing bug (frames were pushed on every `requestAnimationFrame` tick with no
throttling, and rAF can fire far faster than the target fps under a
headless/software backend) — not an inherent limitation of live capture, and
not an ffmpeg/transcode issue. It has since been fixed; if you see it again,
check that `record()`'s frame handler still throttles to `fps` before
capturing the next frame.

## Visual effects support matrix

Per-mobject effects (`mob.blur(4)`, `.glow()`, `.dropShadow()`,
`.colorAdjust()`, `.noise()` — see `src/core/effects.ts`) and camera-level
frame grading (`new Camera({ frameEffects: [...] })`, adding `vignette`)
render differently per backend:

| Effect | CanvasRenderer 2D | CanvasRenderer 3D | SVGRenderer | ThreeRenderer |
|---|---|---|---|---|
| blur (per-mobject) | ✅ offscreen + `ctx.filter` | overlay text/images and fixed-in-frame only¹ | ✅ `feGaussianBlur` | ❌² |
| glow | ✅ chained `drop-shadow()` filters³ | overlay/fixed only¹ | ✅ chained `feDropShadow` | ❌² (use bloom) |
| shadow | ✅ `drop-shadow()` filter³ | overlay/fixed only¹ | ✅ `feDropShadow` | ❌² |
| colorAdjust | ✅ `ctx.filter` | overlay/fixed only¹ | ✅ `feColorMatrix`/`feComponentTransfer` | ❌² (use LUT) |
| noise (per-mobject) | ✅ seeded tile, alpha-clipped | overlay/fixed only¹ | best-effort `feTurbulence`⁴ | ❌² (use film pass) |
| frameEffects grading | ✅ full-frame offscreen composite | ✅ post-blit composite | ✅ body-level `<g filter>` | ❌² (use post-processing) |
| vignette (frame) | ✅ radial gradient | ✅ | ✅ radial-gradient rect | ❌² |
| grain (frame noise) | ✅ tiled overlay | ✅ | best-effort⁴ | ❌² (use film pass) |

1. In a 3D scene, z-buffered solid geometry writes raw RGBA with no
   per-mobject compositing surface — effects on those mobjects are silently
   skipped (same convention as the Mesh3D skip). Frame-level grading covers
   the whole 3D frame instead.
2. ThreeRenderer ignores per-mobject effects entirely — its equivalents are
   the GPU post-processing pipeline (bloom / LUT color grading / film grain /
   custom shader passes; see the post-processing section).
3. Glow and drop shadow deliberately ride CSS `filter: drop-shadow(...)`
   rather than the `shadowBlur`/`shadowColor` context properties:
   `@napi-rs/canvas` (Skia) ignores the shadow properties on `drawImage`
   entirely, while filter `drop-shadow()` behaves identically in Skia and
   browsers.
4. SVG noise uses `feTurbulence`, whose fractal character differs from the
   canvas path's uniform seeded tile — visually similar, not byte-comparable.

Determinism: seeded noise (and every other effect) is a pure function of its
parameters, so the content-hash partial-movie render cache stays sound.
Prefer `frameEffects` for scene-wide looks — per-mobject effects cost one
offscreen composite per affected leaf per frame.
