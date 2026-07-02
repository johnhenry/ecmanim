---
name: ecmanim-authoring-pipeline
description: Covers ecmanim's own prompt-to-video layer, the "ecmanim/authoring" subpath — plan-IR generation via toPlanIR() (a dry-run that harvests scene structure without rendering), the ecmanim plan CLI, quality gates (runQualityGates, slideshowRisk, checkDeliveryPromise), the Format lifecycle (plan → generateAssets → compose → revise) with swappable llm/tts/render providers (registerFormat/registerProvider), and the four built-in formats (explainer, chart-reveal, quote-card, title-card). Use this skill when turning a topic/brief/outline into a finished video without hand-writing Scene code, when wiring ecmanim as the render backend for an external prompt-to-video or scrollmark/showrunner-style pipeline, or when checking a plan/render for slideshow risk or a broken delivery promise before declaring it done.
metadata:
  tags: ecmanim, authoring, prompt-to-video, plan-ir, quality-gates, formats, providers
---

# ecmanim-authoring-pipeline

Read `../ecmanim/SKILL.md` first for shared conventions — the
Plan→Code→Render→Verify→Iterate loop and "ground claims in docs, not memory"
apply here too. This skill covers one specific package: `ecmanim/authoring`,
a subpath entry kept out of the lean core `ecmanim` import so it's opt-in.

`ecmanim/authoring` is ecmanim's *native* answer to external prompt-to-video
pipelines (scrollmark/showrunner, OpenMontage, etc.) — instead of gluing an
LLM outliner to a separate renderer, it implements the same plan → assets →
compose → revise shape as a real, in-repo API, with ecmanim itself as the
render backend. This is the highest-leverage skill in the set: it is the
fastest path from "topic" to "finished video" of anything ecmanim offers.

Full reference: [`../../docs/authoring-studio.md`](../../docs/authoring-studio.md)
(the `ecmanim/authoring` half only — the `ecmanim/studio` half of that doc is
a separate skill, `ecmanim-studio`).

## Workflow

1. **Prefer `toPlanIR()` before any real render**, once scope is non-trivial
   (more than a one-shot title card). It dry-runs `construct()` — no frames
   are emitted — and returns an inspectable JSON plan with segments,
   chapters, estimated duration, and a quality report. This is dramatically
   cheaper than a real render and catches structural problems (empty scene,
   wrong duration, too many wait-only segments) before you pay for ffmpeg.
2. **Run quality gates and read the report** before declaring any authoring
   output done — `toPlanIR` runs them automatically, but re-run
   `runQualityGates` explicitly after a real render if you have measured
   `motionFraction`, since that improves the `slideshowRisk` estimate beyond
   what the dry-run's wait/play ratio alone can infer.
3. **Reach for a built-in `Format` first** (`explainer`, `chart-reveal`,
   `quote-card`, `title-card`) instead of constructing a plan by hand — they
   already encode sensible defaults, validation, and Scene-building. Only
   drop to hand-written `Scene` code (the root skill's loop) when no format
   fits the shape of the video.
4. **If building or integrating an external prompt-to-video pipeline**,
   register a custom `render` provider (or reuse `manimRenderProvider`) so
   that pipeline can drive ecmanim as its renderer — see "Providers as an
   integration point" below.

## Plan IR + dry-run

```js
import { toPlanIR } from "ecmanim/authoring";

const plan = await toPlanIR(MyScene, { fps: 30, width: 1920, height: 1080, promise: "motion-led" });
// { version, scene, config, segments[], chapters[], estimatedFrames, durationSeconds, quality }
```

`toPlanIR(sceneOrConstruct, options)` accepts either a `Scene` subclass or a
`(scene) => Promise<void>` construct function. It instantiates the scene with
a no-op frame handler (`onSegment` returns `{ skip: true }` so time still
advances but no pixels are drawn), runs `construct()`, then reads back
`scene.playRecords`/`scene.sections`/`scene.frameCount` to build:

- `segments: PlanSegment[]` — one per `play`/`wait`, each with
  `index`, `kind`, `startFrame`, `endFrame`, `hash?`.
- `chapters: PlanChapter[]` — from `scene.nextSection(name)` calls, each
  `{ name, startFrame, endFrame }`.
- `estimatedFrames` / `durationSeconds`.
- `quality: QualityReport` — `runQualityGates` is invoked automatically over
  the harvested segments plus the declared `promise`.

`PlanOptions`: `fps?`, `width?`, `height?`, `quality?`, `format?`,
`background?`, `style?`, `aspectRatio?`, `promise?` (delivery-promise intent,
e.g. `"motion-led"`), `name?`. `toPlanString(sceneOrConstruct, options)` is
the same thing pre-serialized to pretty JSON.

**CLI:**

```bash
ecmanim plan scene.ts [Scene] [--fps 30] [--promise motion-led] [--output plan.json]
```

Loads `scene.ts`, resolves `Scene` by export name (falls back to `default`,
then the first exported `Scene` subclass found), calls `toPlanIR`, and prints
the JSON to stdout or writes it to `--output` if given.

## Quality gates

```js
import { runQualityGates, slideshowRisk, checkDeliveryPromise } from "ecmanim/authoring";

const report = runQualityGates(ctx);   // { ok, slideshowRisk, results[] }
```

`ctx: QualityContext` is `{ fps, width, height, durationSeconds, segments: [{kind, startFrame, endFrame}], motionFraction?, promise? }`.

- **`slideshowRisk(ctx)`** returns a `[0,1]` score for "is this mostly a
  slideshow of stills?". Without a measured `motionFraction` it's purely the
  wait-frame ratio across segments; with `motionFraction` supplied (e.g. from
  a real frame-diff pass) it blends `0.6·(1 − motionFraction) + 0.4·waitRatio`.
- **`checkDeliveryPromise(ctx)`** asserts the output matches a declared
  intent in `ctx.promise`: `"motion-led"`/`"animated"` fails if risk `> 0.6`;
  `"static"` fails if risk `< 0.2`; anything else always passes.
- **`runQualityGates(ctx, extra?)`** runs `DEFAULT_QUALITY_GATES` (`min_fps`
  ≥ 12, `even_dimensions`, `nonempty` segments, `slideshow_risk` ≤ 0.8,
  `delivery_promise`) plus any `extra: QualityGate[]` you pass, and returns
  `{ ok, slideshowRisk, results: [{gate, ok, message, severity}] }`. `ok` is
  `false` only if an `"error"`-severity gate failed — `min_fps`,
  `slideshow_risk`, and `delivery_promise` are `"warn"`, so `report.ok`
  can be `true` even with a high slideshow-risk warning; read `results`,
  don't just check `ok`.

## Format lifecycle + providers

A `Format` turns a topic/params into finished output via a fixed lifecycle:

```
plan(ctx) → generateAssets(plan, ctx)?  → compose(plan, assets, ctx) → output
                                            revise(plan, feedback, ctx)?  (feedback loop)
```

```ts
interface Format {
  name: string;
  description?: string;
  requiredProviders?: ProviderKind[];      // e.g. ["render"]
  plan(ctx: FormatContext): Promise<any> | any;
  generateAssets?(plan: any, ctx: FormatContext): Promise<any> | any;
  compose(plan: any, assets: any, ctx: FormatContext): Promise<any> | any;
  revise?(plan: any, feedback: any, ctx: FormatContext): Promise<any> | any;
}
```

`runFormat(format, ctx)` looks up the format by name (or takes a `Format`
object directly), checks `requiredProviders` are present in `ctx.providers`,
then runs `plan → generateAssets? → compose` and returns
`{ plan, assets, output }`. `revise` is not called automatically — invoke it
yourself with feedback and re-run `compose` for an iteration loop.

`ProviderKind` is `"llm" | "tts" | "render"`. A `Provider` is
`{ kind, name, available?(), invoke(input, opts?) }`. Register your own with
`registerProvider(p)`; look one up with `getProvider(kind, name)`, or enumerate
with `listProviders(kind?)`. Pass the set you want a given run to use via
`ctx.providers: { llm?, tts?, render? }` — providers are per-call, not global
defaults, so every `runFormat` call must supply what it needs.

### Providers as an integration point

`manimRenderProvider` (from `ecmanim/authoring`, kind `"render"`, name
`"ecmanim"`) wraps `render()` from `ecmanim/node`: `invoke({ scene, options })`
calls `render(scene, options)` where `scene` is a construct function or Scene
class. Because the `render` provider is just this narrow interface, **any**
external tool — a scrollmark/showrunner-style outline-to-video pipeline, a
custom agent loop, a batch job — can register its own `Format`s and reuse
`manimRenderProvider` as the actual renderer, or supply its own `render`
provider if it wants ecmanim's Format layer to drive a different backend.
This is the concrete mechanism behind "ecmanim as a renderer for other
pipelines": swap the provider, keep the lifecycle.

## The 4 built-in formats

All four are registered automatically on import of `ecmanim/authoring`
(`explainerFormat`, `chartRevealFormat`, `quoteCardFormat` from
`formats_builtin.ts`; `titleCardFormat` from `showrunner.ts`). Each requires
only a `render` provider — pass `manimRenderProvider` unless you have your own.

| format | params (`ctx.params`) | output |
|---|---|---|
| `explainer` | `title?`, `subtitle?`, `sections: [{heading, bullets?, diagram?, narration?, holdSeconds?}]`, `outro?`, `style?`, `tts?` (`"system"` \| `"silent"` \| `"openai"` \| `"elevenlabs"`, default `"silent"`), `renderOptions?` | Title card → per-section heading + bullets (+ inline diagram DSL via `sec.diagram`) with optional TTS narration per section (via `voiceover()`) → outro. Falls back to a single section built from `topic` if no `sections` and no `llm` provider are given. Emits real `scene.nextSection()` chapters. |
| `chart-reveal` | `title?`, `data: [{label, value}]` (required, validated: finite, ≥ 0), `unit?`, `color?` (default `#58C4DD`), `holdSeconds?` (default 2), `style?`, `renderOptions?` | Animated bar chart: baseline drawn, then bars `GrowFromEdge` from it staggered, value labels scaled to the max bar. Throws if `data` is empty or has a bad value. |
| `quote-card` | `quote` (required, or falls back to `topic`), `attribution?`, `aspectRatio?` (`"16:9"` \| `"1:1"` \| `"9:16"`, default `"1:1"`), `holdSeconds?` (default 2.5), `style?`, `renderOptions?` | Social-format quote clip: quoted text `Write`s in, attribution fades in below, using the aspect-ratio preset. |
| `title-card` | `title?` (falls back to `topic`, then `"Untitled"`), `bullets?` (falls back to LLM-expanded bullets if an `llm` provider is present, else 3 placeholder bullets), `style?`, `renderOptions?` | The minimal example: title `Write`s in, bullets appear as a static list. |

All defaults use `style: "3b1b-dark"` unless overridden. `renderOptions` is
passed straight through to the `render` provider's `invoke({ options })`
(e.g. `{ output, quality }`); `quote-card` additionally forces
`aspectRatio` from the plan.

### Working example (verbatim)

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

`res` is `{ plan, assets, output }`; `output` is whatever `manimRenderProvider`
returns (the `render()` result, so the usual `render.ts`/`ecmanim-render-cli`
output shape applies — check that skill for what to do with it).

## Gotchas

- **Zero network access, by design.** All four built-in formats run fully
  offline with deterministic fallbacks. An `llm` provider is *only* ever an
  optional enhancer (e.g. expanding a bare topic into `explainer` sections,
  or expanding `title-card` bullets) — never required. Don't assume a format
  silently degrades to "worse" output without an LLM; it degrades to a fixed,
  documented fallback (single generic section, three placeholder bullets).
- `runQualityGates`'s top-level `ok` only reflects `"error"`-severity gates
  (`even_dimensions`, `nonempty`). `slideshow_risk` and `delivery_promise`
  are `"warn"` — a report can say `ok: true` while still warning that your
  video is basically a slideshow. Always inspect `results`, not just `ok`.
- `revise()` exists on `explainerFormat`, `chartRevealFormat`, and
  `titleCardFormat` but is **not** called automatically by `runFormat` — the
  feedback loop is manual (call `format.revise(plan, feedback, ctx)`, then
  `format.compose(revisedPlan, assets, ctx)` yourself).
- `chart-reveal`'s `plan()` throws synchronously on bad `data` (empty array,
  non-finite or negative `value`) — validate/catch before calling `runFormat`
  if `data` comes from an untrusted or LLM-generated source.
- `toPlanIR`'s dry-run still executes your `construct()` code fully (timers,
  side effects, `voiceover()` calls, etc.) — it only skips frame *rendering*.
  Don't assume a dry-run is side-effect-free for scenes that do real I/O
  inside `construct()`.
