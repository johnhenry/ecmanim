# Authoring layer & Studio

Phase-7 adoption. Two opt-in subpath entries (`manim-js/authoring`,
`manim-js/studio`) keep the core `manim-js` entry lean.

## `manim-js/authoring`

### Plan IR + dry-run

```js
import { toPlanIR } from "manim-js/authoring";
const plan = await toPlanIR(MyScene, { fps: 30, width: 1920, height: 1080, promise: "motion-led" });
// { version, config, segments[], chapters[], estimatedFrames, durationSeconds, quality }
```
Harvests structure **without rendering** (dry-runs `construct()`). CLI:
`manim-js plan scene.ts [Scene] [--fps 30] [--promise motion-led] [--output plan.json]`.

### Quality gates

```js
import { runQualityGates, slideshowRisk } from "manim-js/authoring";
const report = runQualityGates(ctx);           // { ok, slideshowRisk, results[] }
```
`slideshowRisk` scores how static the output is; `checkDeliveryPromise` asserts the
output matches a declared intent (e.g. promising `"motion-led"` but delivering
mostly stills fails). `toPlanIR` runs these automatically.

### Formats + providers (prompt→video)

A `Format` runs `plan → generateAssets → compose` (with an optional `revise`
feedback step) against swappable `llm`/`tts`/`render` providers. The `render`
provider is backed by manim-js, so manim-js can be the renderer for
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
import { runFormat, manimRenderProvider } from "manim-js/authoring";

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

## `manim-js/studio`

### Live-preview dev server

```js
import { startStudio } from "manim-js/studio";
const studio = await startStudio({ sceneModule: "scenes/demo.js", root: process.cwd() });
console.log(studio.url); // open it; edit the scene file → the browser hot-reloads
// studio.close() when done
```
Serves your Scene in a `<manim-player>` and re-imports + re-renders on every save
(file-watch + Server-Sent Events, dependency-free).

**What Studio is today, honestly:** the hot-reload dev server above and the
`schemaToControls` data layer below — that's it. The heavier features you might
expect from a "studio" are **not implemented**: no checkpoint replay (every save
re-renders the whole scene from scratch), no mouse camera pan/zoom/orbit, no
in-page eval REPL, and no rendered props-panel UI (only the control *descriptors*
exist; nothing draws them). These are planned on top of this foundation.

### Schema → props controls

```js
import { schemaToControls } from "manim-js/studio";
const controls = schemaToControls(MyScene.schema); // [{ name, control, min, max, options, ... }]
```
Turns a `defineSchema` spec into control descriptors for a props panel. This is
data only — you render the controls with your own UI; Studio's harness page does
not (yet) draw them.
