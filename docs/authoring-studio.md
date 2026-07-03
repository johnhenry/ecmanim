# Authoring layer & Studio

Phase-7 adoption. Two opt-in subpath entries (`ecmanim/authoring`,
`ecmanim/studio`) keep the core `ecmanim` entry lean.

## `ecmanim/authoring`

### Plan IR + dry-run

```js
import { toPlanIR } from "ecmanim/authoring";
const plan = await toPlanIR(MyScene, { fps: 30, width: 1920, height: 1080, promise: "motion-led" });
// { version, config, segments[], chapters[], estimatedFrames, durationSeconds, quality }
```
Harvests structure **without rendering** (dry-runs `construct()`). CLI:
`ecmanim plan scene.ts [Scene] [--fps 30] [--promise motion-led] [--output plan.json]`.

### Quality gates

```js
import { runQualityGates, slideshowRisk } from "ecmanim/authoring";
const report = runQualityGates(ctx);           // { ok, slideshowRisk, results[] }
```
`slideshowRisk` scores how static the output is; `checkDeliveryPromise` asserts the
output matches a declared intent (e.g. promising `"motion-led"` but delivering
mostly stills fails). `toPlanIR` runs these automatically.

### Formats + providers (prompt→video)

A `Format` runs `plan → generateAssets → compose` (with an optional `revise`
feedback step) against swappable `llm`/`tts`/`render` providers. The `render`
provider is backed by ecmanim, so ecmanim can be the renderer for
scrollmark/showrunner-style pipelines. Register your own with `registerFormat`
/ `registerProvider`.

Four formats ship built in. All of them run with **zero network access** — an
LLM provider only ever *enhances* the plan (e.g. expanding a topic into
sections); every format has a deterministic fallback.

| format | params | output |
|--------|--------|--------|
| `explainer` | `title`, `subtitle?`, `sections: [{heading, bullets?, diagram?, narration?, holdSeconds?}]`, `outro?`, `tts?`, `style?` | multi-section explainer: title card → per-section heading + bullets (+ inline diagram DSL) with optional TTS narration → outro. Emits real scene `sections`. |
| `chart-reveal` | `title?`, `data: [{label, value}]`, `unit?`, `color?`, `holdSeconds?` | animated bar chart — bars `GrowFromEdge` the baseline, staggered, with value labels scaled to the max. Validates data. |
| `quote-card` | `quote`, `attribution?`, `aspectRatio?` (`16:9`/`1:1`/`9:16`), `holdSeconds?` | social-format quote clip using the aspect-ratio presets. |
| `title-card` | `title?`, `bullets?` | the original minimal example. |

```js
import { runFormat, manimRenderProvider } from "ecmanim/authoring";

const res = await runFormat("explainer", {
  params: {
    title: "How caching works",
    sections: [
      { heading: "The problem", bullets: ["recomputing is slow"], narration: "Recomputing every frame is slow." },
      { heading: "The idea", diagram: "A[Input] --> B[Hash]\nB --> C[Store]" },
    ],
    outro: "Cache it.",
    tts: "system",                                  // or "silent" | "openai" | "elevenlabs"
    renderOptions: { output: "out.mp4", quality: "high" },
  },
  providers: { render: manimRenderProvider },
});
```

## `ecmanim/studio`

### Live-preview dev server

```js
import { startStudio } from "ecmanim/studio";
const studio = await startStudio({ sceneModule: "scenes/demo.js", root: process.cwd() });
console.log(studio.url); // open it; edit the scene file → the browser hot-reloads
// studio.close() when done
```
Serves your Scene in a `<manim-player>` and re-imports + re-renders on every save
(file-watch + Server-Sent Events, dependency-free).

**What Studio is today, honestly:** the hot-reload dev server, the interactive
camera controller, `<manim-chart>`, and the `schemaToControls` data layer —
that's it. The heavier features you might expect from a "studio" are **not
implemented**: no checkpoint replay (every save re-renders the whole scene
from scratch), no in-page eval REPL, and no rendered props-panel UI (only the
control *descriptors* exist; nothing draws them). These are planned on top of
this foundation.

### Interactive camera (pan/zoom/orbit/pick)

```js
import { attachInteractiveCamera } from "ecmanim/studio";

const handle = attachInteractiveCamera(canvas, camera, {
  render: () => renderer.renderScene(mobjects), // called after every camera mutation
  mobjects,                                       // enables click/hover picking
  onClick: (hit) => console.log(hit?.mobject),
  onHover: (hit) => console.log(hit?.mobject),
});
// handle.detach() removes all listeners
```
Attaches pointer/wheel handlers to any `<canvas>` and mutates a `Camera` in
place: drag pans `frameCenter` (2D) or orbits `phi`/`theta` (3D, detected via
`camera.projectionDepth`), wheel adjusts the new `camera.zoom` field (shared
by `CanvasRenderer` 2D, `ThreeRenderer` 2D-ortho, and `ThreeRenderer` 3D).
Picking (`onClick`/`onHover`) is screen-space bounding-box hit-testing —
each candidate mobject's world AABB is forward-projected through the
camera's own `toPixel()`; there is no GPU/triangle-precise picking. The
module never calls `renderer.renderScene()` itself — you supply `render()`,
which keeps it usable by any renderer/mobject-store combination, including
`<manim-player>`'s live preview (pass `interactive: true` to `startStudio`) and
`<manim-chart>` below.

### `<manim-chart>` — interactive graphs

```html
<script type="module">
  import { defineManimChart } from "ecmanim/studio";
  defineManimChart(); // registers <manim-chart>
</script>
<manim-chart width="800" height="450"></manim-chart>
<script type="module">
  import { Axes } from "ecmanim";
  const chart = document.querySelector("manim-chart");
  chart.graph = () => {
    const axes = new Axes({ xRange: [-3, 3], yRange: [-2, 2] });
    const curve = axes.plot((x) => Math.sin(x));
    return [axes, curve];
  };
</script>
```
A static (non-timed) custom element: your `graph` builder runs once through
`CanvasRenderer.renderScene()` — no `Player`/frame-recording involved — then
pointer pan/zoom/click/hover is layered on via `attachInteractiveCamera()`.
Call `chart.refresh()` after mutating data the builder closes over to
re-render. Listens for clicks/hovers and dispatches `manim-chart-pick` /
`manim-chart-hover` `CustomEvent`s with `{ hit: { mobject, index } | null }`
in `detail`. `disconnectedCallback` detaches the camera listeners.

### Schema → props controls

```js
import { schemaToControls } from "ecmanim/studio";
const controls = schemaToControls(MyScene.schema); // [{ name, control, min, max, options, ... }]
```
Turns a `defineSchema` spec into control descriptors for a props panel. This is
data only — you render the controls with your own UI; Studio's harness page does
not (yet) draw them.
