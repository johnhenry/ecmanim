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
