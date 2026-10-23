# Authoring layer & Studio

Phase-7 adoption. Two opt-in subpath entries (`ecmanim/authoring`,
`ecmanim/studio`) keep the core `ecmanim` entry lean.

## `ecmanim/authoring`

### Plan IR + dry-run

```js
import { toPlanIR } from "@johnhenry/ecmanim/authoring";
const plan = await toPlanIR(MyScene, { fps: 30, width: 1920, height: 1080, promise: "motion-led" });
// { version, config, segments[], chapters[], estimatedFrames, durationSeconds, quality }
```
Harvests structure **without rendering** (dry-runs `construct()`). CLI:
`ecmanim plan scene.ts [Scene] [--fps 30] [--promise motion-led] [--output plan.json]`.

### Quality gates

```js
import { runQualityGates, slideshowRisk } from "@johnhenry/ecmanim/authoring";
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
import { runFormat, manimRenderProvider } from "@johnhenry/ecmanim/authoring";

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

### `character-explainer` — a stick-figure presenter synced to narration

An animated presenter (built-in `Skeleton` rig, IK pointing, named poses) narrates a
topic while visuals appear on the right. Gestures, pointing, camera beats and
particle effects are scheduled on **voiceover bookmarks**. The plan is *choices
from fixed vocabularies, never code*, so an LLM can write it safely.

```ts
import { runFormat, manimRenderProvider, ollamaLLMProvider } from "@johnhenry/ecmanim/authoring";

await runFormat("character-explainer", {
  params: {
    title: "The Pythagorean Theorem",
    tts: "system",                                   // silent | system | openai | elevenlabs
    visuals: [
      { id: "formula", kind: "math", content: "a^2 + b^2 = c^2" },
      { id: "squares", kind: "chart", content: [{ label: "a squared", value: 9 }, { label: "b squared", value: 16 }] },
    ],
    beats: [
      { narration: "It says <bookmark mark=\"f\"/> a squared plus b squared equals c squared.",
        show: ["formula"],
        cues: [{ at: "start", do: "pose", pose: "wave" }, { at: "f", do: "point", target: "formula" }] },
      { narration: "Nine plus sixteen <bookmark mark=\"s\"/> is twenty five!",
        show: ["squares"],
        cues: [{ at: "s", do: "point", target: "squares" }, { at: "s", do: "camera", camera: "impact" },
               { at: "end", do: "pose", pose: "celebrate" }, { at: "end", do: "fx", fx: "explosion", target: "squares" }] },
    ],
    renderOptions: { output: "out.mp4", quality: "medium" },
  },
  providers: { render: manimRenderProvider },
});
```

**Plan schema** (`CharacterExplainerPlan`):

| field | meaning |
|---|---|
| `title` | shown small at the top |
| `visuals[]` | `{ id, kind, content, at? }`. `text`/`math`/`diagram`: a string (math = LaTeX; diagram = the inline diagram DSL used by `explainer`). `chart`: `[{label, value>=0}]` (or `{data: [...]}`), drawn as a small bar chart. `at`: `"right"` (default) / `"top"` / `"bottom"`. |
| `beats[]` | `{ narration, show?, cues? }`. `narration` may hold `<bookmark mark="x"/>` tags. `show` = visual ids revealed in this beat. |
| `cues[]` | `{ at, do, target?, pose?, camera?, fx? }`. `at` = a bookmark name from *this* beat's narration, `"start"`, or `"end"` (fires `END_LEAD` = 0.5 s before the line ends so the gesture lands on it). |
| `tts` | voiceover provider name (`silent` is the default). |

**Vocabularies:** `do`: `point` (needs `target`), `pose`, `camera`, `fx` (optional `target`). `pose`: `neutral wave point think excited shrug celebrate`. `camera`: `impact pulse shake` (`CameraImpact` / `ZoomPulse` / `CameraShake`). `fx`: `aura explosion smoke beam` (particle presets, at the target visual, or at the presenter when there is none). Visual `kind`: `text math diagram chart`.

**How a cue plays.** Each beat runs under `voiceover()`. `scheduleCues(beat, bookmarkTimes, duration)` (pure, exported) turns cues into time-ordered events: exact when the TTS provider returns word boundaries, proportional to character position otherwise (the `silent` and `system` providers are proportional, so expect a few hundred ms of drift). `point` blends an `IKChain` on the right arm toward the nearest edge point of the target visual (the figure steps and leans toward far targets, and the arm stays straight and aims when the target is out of reach), holds ~2.4 s, then eases back. `pose` is a `PoseTween` to a named pose of `createPresenterPoseLibrary()`. The presenter never freezes: breathing, sway and head drift are layered on top of whatever pose is active.

**Validation and repair.** `validateCharacterPlan(raw)` never throws: unknown poses / cameras / fx / `do`, cues whose `at` is not a bookmark in the narration, `point` targets that are not visuals, unknown `show` ids and malformed visuals are **dropped**, and each repair is recorded in `plan.warnings`. A visual that is pointed at before being shown is auto-added to that beat's `show`. If nothing usable survives, the format falls back to `buildFallbackPlan(topic)`, a deterministic 3-beat plan built from the topic alone. With no `llm` provider and no `params.beats`, that fallback is the plan (zero network).

**Quality gates.** `compose` returns the render result plus `quality`: the default gates and `characterExplainerGates(plan)` — `targets_exist` (error: every cue target / `show` id is a visual) and `beat_has_cue` (warn) — with `promise: "motion-led"`.

**Offline LLM planning with Ollama.**

```ts
const llm = ollamaLLMProvider({ model: "qwen2.5:3b", baseUrl: "http://localhost:11434", timeoutMs: 300_000 });
await runFormat("character-explainer", {
  topic: "Why the sky is blue",
  params: { tts: "system", renderOptions: { output: "sky.mp4" } },
  providers: { render: manimRenderProvider, llm },
});
```

`ollamaLLMProvider({ model, baseUrl, timeoutMs, keepAlive, options })` is a `kind: "llm"` provider: `available()` pings `/api/tags`; `invoke({ prompt, system?, json? })` POSTs `/api/generate` (`stream: false`, `format: "json"` when `json`) and returns parsed JSON or text. It uses the global `fetch` (pass `{ fetch }` to inject one), streams the response (Node's fetch gives up on a request whose headers take over 300 s, which `stream: false` hits on slow CPUs), aborts after `timeoutMs` (default 15 minutes), sends `keep_alive: "15m"` so the model stays loaded, and passes `options` through to Ollama (default `{ num_predict: 1024 }`; add `num_ctx`, `temperature`, ...), and throws on HTTP errors or non-JSON output in JSON mode; the format catches that and falls back. The prompt (`buildPlanPrompt(topic)`) contains the schema, the allowed values and one short example.

**CPU latency.** On a CPU-only host a 3B model generates roughly 1-2 tokens/s (about 1 tok/s on a loaded 4-core box), and prompt evaluation alone can take a minute or more, so planning can take several minutes. The example's `--llm` prints a progress line and accepts `--model <name>` and `--timeout <sec>`. Planning can never block output: if the call times out, fails, or returns unusable JSON, the format falls back to `buildFallbackPlan` and still renders (the reason is in `plan.warnings`). Repair also normalizes common near-miss shapes (e.g. `{do:"camera", impact:true}`, `{do:"celebrate"}`, `{do:"zoom"}`) instead of dropping them, noting each in `plan.warnings`.

Runnable example: `node examples/character-explainer/pythagoras.ts` (about 40 s, espeak-ng narration; add `--llm` to plan from just the topic with Ollama; `QUALITY=low` for a fast draft).

**Honest limitations.**
- Small local models (3B) often produce plans that need repair; expect dropped cues and some fallback. The result is valid but can be generic.
- The presenter is one fixed rig and one look; there is no lip-sync, facial expression or walking. Pointing aims at the *edge of a whole visual*, not at a part of it (you cannot point at just the `b^2` term).
- At most two visuals per region are shown at once; older ones fade out when a third arrives. There is no per-beat layout control beyond `at`.
- With `silent` / `system` TTS, bookmark times are proportional estimates, not word-aligned. A cue plays after the previous gesture finishes (gestures are sequential), so dense cues can run late.
- Camera effects and particle presets need the Canvas-2D renderer (SVG/WebGL warn or ignore them).
- The `motion-led` gate counts the idle sway as motion (`motionFraction` is a heuristic from the share of `play` frames, not a measured frame diff), so it is a weak slideshow check.

## `ecmanim/studio`

### Live-preview dev server

```js
import { startStudio } from "@johnhenry/ecmanim/studio";
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
import { startStudio } from "@johnhenry/ecmanim/studio";
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
import { attachKeyframeTimelineEditor, renderKeyframeTimeline } from "@johnhenry/ecmanim/studio";

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
import { attachInteractiveCamera } from "@johnhenry/ecmanim/studio";

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
  import { defineManimChart } from "@johnhenry/ecmanim/studio";
  defineManimChart(); // registers <manim-chart>
</script>
<manim-chart width="800" height="450"></manim-chart>
<script type="module">
  import { Axes } from "@johnhenry/ecmanim";
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
import { schemaToControls } from "@johnhenry/ecmanim/studio";
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
