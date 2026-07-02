---
name: ecmanim-studio
description: Run ecmanim's live-reload dev server (startStudio() from ecmanim/studio — serves a Scene in a <manim-player>, watches files, and hot-reloads the browser via SSE on save) and convert a defineSchema() spec into props-panel control descriptors (schemaToControls() — data only). Use this skill when the user wants a local live-preview loop for a Scene, or wants prop controls derived from a schema. Also use it when the user asks for heavier "studio" features — checkpoint replay, mouse camera pan/zoom/orbit, an in-page eval REPL, or a rendered props-panel UI — because none of those are implemented yet; this skill states that plainly instead of overselling.
metadata:
  tags: ecmanim, studio, dev-server, hot-reload, live-preview, schema, props-panel
---

# ecmanim-studio

Child skill of `ecmanim` (read `../ecmanim/SKILL.md` first for the shared
Plan→Code→Render→Verify→Iterate loop and `checkhealth`-first convention — not
repeated here). This skill covers the `ecmanim/studio` subpath: a live-reload
dev server and a schema→controls data helper. Full detail, read before
asserting an API shape: [../../docs/authoring-studio.md](../../docs/authoring-studio.md)
(the `ecmanim/studio` half of that file).

## What Studio is today, honestly

Quoting the docs verbatim, because this is the single most important thing to
get right when talking about Studio:

> What Studio is today, honestly: the hot-reload dev server above and the
> `schemaToControls` data layer below — that's it. The heavier features you
> might expect from a "studio" are not implemented: no checkpoint replay
> (every save re-renders the whole scene from scratch), no mouse camera
> pan/zoom/orbit, no in-page eval REPL, and no rendered props-panel UI (only
> the control descriptors exist; nothing draws them). These are planned on top
> of this foundation.

If a user asks for any of the missing pieces — checkpoint replay, camera
orbit/pan/zoom via mouse, an eval REPL, or a props panel that actually
renders and updates the scene live — the correct answer is **"not
implemented yet"**, not an attempt to fake it with unrelated primitives.
Don't improvise a REPL from `eval()` or a camera orbit from ad hoc mouse
listeners and present it as "Studio's camera orbit" — that's a bespoke
feature, not this one. It's fine to build one-off demo code the user asks
for; just don't describe it as an existing Studio capability.

## Live-preview dev server (`startStudio`)

```ts
import { startStudio } from "ecmanim/studio";

const studio = await startStudio({
  sceneModule: "scenes/demo.js",   // browser-importable ES module, relative to `root`
  sceneExport: "default",          // named export to use (default: "default")
  root: process.cwd(),             // static root; must contain dist/browser.js
  watch: ["scenes"],               // dirs/files to watch (default: sceneModule's dir)
  port: 0,                         // default: OS-assigned free port
  quality: "medium",               // <manim-player> quality attr
  background: "#0d1117",           // <manim-player> background attr
});
console.log(studio.url);           // open it; edit the scene file → browser hot-reloads
studio.close();                    // stop the server + file watchers when done
```

Node-only (`node:http` + `node:fs.watch`, zero dependencies). Mechanics:

- Serving `/` returns an HTML harness (`buildStudioHarness`, also exported)
  that imports `ecmanim/browser` via an import map pointed at `/dist/browser.js`,
  defines `<manim-player>`, dynamically `import()`s `sceneModule` with a
  cache-busting `?t=timestamp` query, and assigns `mod[sceneExport] ?? mod.default`
  to the player's `.scene`.
- `sceneModule` must resolve to a real static file under `root` reachable at
  a URL path — `startStudio` computes that path via `path.relative(root, ...)`,
  so `sceneModule` and `root` need to agree on where the file actually lives.
  This is a browser `import()` of built/compiled JS, not a TS file the server
  transpiles on the fly — point it at compiled output (e.g. `dist/scenes/demo.js`),
  not a raw `.ts` source file, unless something upstream is compiling for you.
- On file change under any `watch` target, the server debounces (80ms) and
  writes `data: reload\n\n` to every connected `/__studio_events` SSE client;
  the harness page's `EventSource.onmessage` re-runs the dynamic `import()`
  and reassigns `.scene`. There is no diffing — this is a full re-render from
  scratch on every save (consistent with "no checkpoint replay" above), so
  expect the same latency as re-running the scene from `construct()` each
  time, not incremental updates.
- `root` must contain `dist/browser.js` (the browser bundle) since the
  harness's import map hardcodes `browserUrl: "/dist/browser.js"`; if that
  path doesn't exist under `root`, the page will fail to load `ecmanim/browser`.

## Schema → props controls (`schemaToControls`)

```ts
import { schemaToControls } from "ecmanim/studio";
import { defineSchema } from "ecmanim"; // core/schema.ts — see ecmanim/SKILL.md's primitives doc

const MyScene = { schema: defineSchema({
  title: { type: "string", default: "Hello" },
  count: { type: "number", min: 0, max: 100, default: 1 },
  mode:  { type: "enum", values: ["fast", "slow"], default: "fast" },
}) };

const controls = schemaToControls(MyScene.schema);
// [{ name: "title", control: "text",     label: "title", default: "Hello" },
//  { name: "count", control: "number",   label: "count", default: 1, min: 0, max: 100 },
//  { name: "mode",  control: "select",   label: "mode",  default: "fast", options: ["fast","slow"] }]
```

`schemaToControls(schema: any): PropControl[]` accepts either a `Schema`
(reads `.spec`) or a bare `SchemaSpec`. Field-type → control mapping is fixed:
`string→"text"`, `number→"number"`, `boolean→"checkbox"`, `color→"color"`,
`enum→"select"` (unknown/missing types fall back to `"text"`). Each
`PropControl` is `{ name, control, label, default?, min?, max?, options?,
description? }` — `label` is always just `name` (no prettifying), `options`
comes from the field's `values`, `min`/`max` only apply to `number`.

**This is data only.** `schemaToControls` returns plain descriptor objects;
nothing in ecmanim renders them into inputs/sliders/dropdowns. If a user wants
an actual props panel, you're building UI yourself (React/vanilla/whatever
the project uses) that maps each `PropControl` to a form element and feeds
edited values back into the scene's props — Studio does not wire this up for
you, and the dev server above does not currently consume `schemaToControls`
output at all (no props-panel pane exists in the harness page).

## Gotchas

- **Full re-render on every save, always.** There's no partial/checkpoint
  replay; a scene with a slow `construct()` (heavy geometry, TeX, TTS calls)
  will feel that cost on every single edit. If iteration feels slow, that's
  expected today, not a bug to chase.
- **No camera controls in the harness.** `<manim-player controls>` gives
  playback controls (play/pause/seek), not a 3D camera — there's no mouse
  pan/zoom/orbit wired into the Studio page. If 3D scenes need to be inspected
  from other angles, do that via scene code (camera mobject / render angle),
  not runtime mouse interaction.
- **No REPL.** There's no in-page console to poke at mobjects/state at
  runtime; the only feedback loop is edit-file → save → SSE reload.
- **`sceneModule` is browser-imported, not server-transpiled.** Point it at
  compiled JS output under `root`, and make sure `root` actually contains
  `dist/browser.js`, or the harness page will fail silently in the browser
  console rather than on the Node side.
- **`schemaToControls` and `startStudio` are unconnected today.** Don't assume
  passing a `schema` to `startStudio` does anything — it doesn't accept one;
  the two exports are independent building blocks, not one integrated feature.
