---
title: "Authoring layer & Studio"
---

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

**Bind address**: defaults to `host: "127.0.0.1"` (loopback-only — this dev
server has no auth). If you're viewing from a different device (another
machine on the LAN, or a remote/SSH-tunneled session where "127.0.0.1" only
means the *server's own* loopback), pass `host: "0.0.0.0"` and read
`studio.urls` for every address it's actually reachable at:

```js
const studio = await startStudio({ sceneModule: "scenes/demo.js", host: "0.0.0.0" });
console.log(studio.urls); // e.g. ["http://127.0.0.1:PORT/", "http://192.168.1.42:PORT/"]
```

**What Studio is today, honestly:** the hot-reload dev server, the interactive
camera controller, `<manim-chart>`, a rendered props panel (`{ props: true }`,
wired to parameter-only re-render — see below), and a waveform strip
(`{ waveform: true }`). Still **not implemented**: checkpoint replay (every
save, and every props-panel edit, re-renders the whole scene from scratch —
see the render-caching item for why that matters for scrub UX) and an
in-page eval REPL.

### Props panel + parameter-only re-render

```js
import { startStudio } from "ecmanim/studio";
await startStudio({ sceneModule: "scenes/demo.js", props: true });
```
When the scene exports a `static schema` (via `defineSchema`), the harness
renders one control per field (via `schemaToControls`), pre-filled from the
schema's own defaults. Editing a control (debounced 80ms) calls
`schema.safeParse()` and, on success, `<manim-player>.rerender(props)` —
which threads `props` into `Player.record(scene, { props })` again, re-running
`construct()` with the new values WITHOUT re-`import()`ing the module. A
real file save still does a full `load()` + panel reset (the schema itself
may have changed shape); the two triggers are kept structurally separate.

### Property-keyframe tracks + a draggable timeline editor

```js
// In a Scene's construct():
const radiusTrack = this.track([
  { t: 0, value: 1 },
  { t: 2, value: 3, ease: "easeInOutSine" },
]);
bindTrack(circle, "radius", radiusTrack); // rides on Mobject.update(dt) -- no Scene changes needed
```
`scene.track(keyframes)` (mirroring `addSound()`'s ergonomic) creates a
`PlayableKeyframeTrack` — Cluster 2's `KeyframeTrack` plus absolute-time
`tick(dt)`/`seek(t)`, kept in exact agreement so authoring playback and a
Studio scrub can never drift apart. `bindTrack(mobject, prop, track)` writes
`track.tick(dt)` into `mobject[prop]` every frame via the ordinary updater
mechanism.

For a draggable editor UI:
```js
import { attachKeyframeTimelineEditor, renderKeyframeTimeline } from "ecmanim/studio";

const axis = { duration: player.duration, pixelWidth: canvas.width };
function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderKeyframeTimeline(ctx, scene.keyframeTracks, axis);
}
redraw();
attachKeyframeTimelineEditor(canvas, scene.keyframeTracks, {
  ...axis,
  onChange: redraw,                    // cheap visual update on every drag-move
  onCommit: () => player.rerender(),   // rebake frames once, debounced, on release
});
```
**Critical wiring detail**: `Player.frames[]` are frozen bitmaps — dragging a
keyframe has no visible effect on already-recorded frames until a re-record
happens. `onCommit` is exactly item 7's parameter-only re-render primitive
(`player.rerender(...)`), debounced (default 150ms) so a drag gesture
triggers one re-record on release, not one per pointer-move tick.

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

### Named camera stops + sections

`MovingCameraScene.defineCameraStop()`/`goToCameraStop()` are sugar over the
frame's own `animate.moveTo()/setWidth()/setHeight()` chain, meant to be
paired with `nextSection()` so a presenter can jump straight to a named
viewpoint at each section boundary:

```js
class MyScene extends MovingCameraScene {
  async construct() {
    this.defineCameraStop("wide", { center: [0, 0, 0], width: 14 });
    this.defineCameraStop("closeup", { center: [3, 1, 0], zoom: 2 });

    this.nextSection("overview");
    await this.goToCameraStop("wide");
    await this.play(/* ... */);

    this.nextSection("detail");
    await this.goToCameraStop("closeup", { runTime: 1.5 });
    await this.play(/* ... */);
  }
}
```
`zoom` scales the frame's own width/height (`frame.animate.scale(1/zoom)`) —
a different concept from the interactive camera's `camera.zoom` multiplier
(`attachInteractiveCamera` above), which instead scales the projection at
render time without touching the frame mobject. Don't conflate the two.
