---
name: ecmanim-timeline
description: Sequence and time ecmanim animations with the GSAP-style Timeline position grammar, drive properties with pure expression functions (wiggle/remap/ramp/compose), display live numbers as vector glyphs with VectorDecimalNumber, apply named STYLE_PRESETS/ASPECT_RATIO_PRESETS, render a single frame with renderStill, and enumerate scenes via the registerComposition/compositionsToJSON registry. Use this skill when the user needs multi-beat timing control tighter than sequential play()/wait(), a noise/remap-driven updater, a crisp animated counter, a named visual look or social aspect ratio, or a fast still-frame/poster render.
metadata:
  tags: ecmanim, timeline, expressions, wiggle, remap, presets, renderStill, composition
---

# ecmanim-timeline

Child of the root `ecmanim` skill — read `../ecmanim/SKILL.md` first for the
shared Plan → Code → Render → Verify → Iterate loop and `checkhealth`
guidance; this skill only covers the domain specifics below and does not
repeat that loop. Full API detail lives in
[../../docs/primitives.md](../../docs/primitives.md) — read it before
asserting any signature not shown here, since these primitives are Phase-1
additions layered on top of core manim parity and are easy to misremember.

All five primitives here are exported from top-level `"ecmanim"` (isomorphic,
dependency-free); `renderStill` is Node-only, from `"ecmanim/node"`.

## Timeline: GSAP-style position grammar

Reach for `Timeline` once a scene needs more than sequential `play()`/`wait()`
pacing — overlapping entrances, a beat labeled and referenced later, or a
"start 0.2s after the last thing ends" gap.

```ts
import { Timeline } from "ecmanim";

const tl = new Timeline({ defaults: { runTime: 0.6 } }); // fps? too, rarely needed
tl.add(new Create(circle));
tl.add(new Create(square), "<");       // start together with the previous add
tl.add(new FadeIn(label), "+=0.2");    // 0.2s gap after the *timeline* end (cursor)
tl.addLabel("beat", ">");              // label the current end
tl.add(new Indicate(circle), "beat");  // place at a label
await scene.play(tl.build(), { _playConfig: true, runTime: tl.duration });
```

Position grammar (`add(animation, position?)`):

| Position | Meaning |
|---|---|
| omitted | sequential — same as `">"`, at the running end cursor |
| `number` | absolute seconds |
| `"+=n"` / `"-=n"` | relative to the timeline's end cursor |
| `"<"` / `"<n"` / `"<-n"` | relative to the *previous add's start* |
| `">"` / `">n"` / `">-n"` | relative to the *previous add's end* |
| `"labelName"` | at a label set with `addLabel(name, position?)` |

Notes grounded in `src/animation/timeline.ts`:
- `defaults.runTime` (if set) is applied to *every* added animation, overwriting
  its own `runTime`; `defaults.rateFunc` likewise overwrites `anim.rateFunc`.
  Omit `defaults` if animations should keep their individual timings.
- Each `add()` accepts either a built animation or an `.animate` proxy builder
  (`mob.animate.shift(...)`) — the Timeline calls `.build()` on it internally.
- `addLabel()` also resets the "previous start/end" anchors used by `"<"`/`">"`,
  so a label doubles as a sequencing checkpoint, not just a bookmark.
- `tl.build()` returns an `AnimationGroup` with its `timings`/`maxEnd`/`runTime`
  overwritten to the resolved absolute schedule — pass `tl.duration` as
  `runTime` and `{ _playConfig: true }` to `scene.play()` so the group's own
  runTime is honored rather than recomputed. This mirrors how
  `AnimationGroup` is otherwise used directly; see `ecmanim-render-cli` or
  `docs/primitives.md` if `_playConfig` behavior is unclear.

## Expression drivers: wiggle / remap / ramp / compose

From `src/animation/expressions.ts` — all are **pure functions of their scalar
input** (no `Date.now`/`Math.random`), so they're safe to sample out of order
under scrubbing or the render cache.

```ts
import { wiggle, remap, ramp, compose } from "ecmanim";

const bob = wiggle(0.3, 2.5, /* seed */ 7);      // amplitude, frequency(Hz), seed
mob.addUpdater(() => mob.moveTo([0, bob(scene.time), 0]));

const toScale = remap(0, 100, 0.5, 1.5, easeFn?); // (inMin,inMax,outMin,outMax,ease?) -> (value)=>number, clamped
const grow = ramp(0, 1, easeFn?);                 // (a,b,ease?) -> (t in [0,1], clamped)=>number
const pipeline = compose(f, g, h);                // left-to-right: compose(f,g)(x) === g(f(x))
```

- `wiggle(amplitude=1, frequency=2, seed=0)` returns a `Driver` (`(t) => number`)
  producing smooth value-noise centered on 0, roughly within
  `[-amplitude, amplitude]`. Deterministic per `seed`; different `t` values are
  independent, so it's the right choice for "jitter this property forever"
  updaters rather than one-shot animations.
- `remap` and `ramp` both clamp their input/output to the given range and take
  an optional `ease` (any rate function, e.g. from `rate_functions`).
- `valueAtTime(driver, t)` is a thin `driver(t)` helper for readability at call
  sites; not required.
- These compose with `addUpdater` (per-frame) — they are not themselves
  `Animation` subclasses and are not passed to `scene.play()`.

## VectorDecimalNumber

A live number rendered as vector glyph outlines (one `VMobject` per digit),
mirroring `DecimalNumber`'s formatting and edge-pinning but SVG-exportable and
individually animatable per digit — from
`src/mobject/vector_value_tracker.ts`.

```ts
import { VectorDecimalNumber } from "ecmanim";

const n = new VectorDecimalNumber(0, { numDecimalPlaces: 0, fontSize: 0.8 });
counter.addUpdater(() => n.setValue(tracker.getValue())); // edge stays pinned
```

Config: `numDecimalPlaces`, `unit`, `includeSign`, `groupWithCommas`,
`showEllipsis`, `fontSize`, `font`, `color`/`fillColor`/`strokeColor`,
`fillOpacity`/`strokeWidth`/`strokeOpacity`, `point`, and `edgeToFix` (default
left edge `[-1,0,0]`) — the edge that stays anchored in place as the digit
count changes across `setValue()` calls.

**Gotcha:** it needs a loaded vector font and throws if none is available. In
Node this is auto-loaded lazily on first use (via fontconfig), so it normally
just works; if no system font can be found, or you want a non-default
pattern, call `loadVectorFont()` (from `ecmanim/node`, also used for `VText`)
before constructing one, or pass `config.font` explicitly. In the browser
call `await setDefaultFont(url)` first — there's no fontconfig to auto-resolve
from. A `VectorDecimalNumber` built with no font available (browser with none
loaded, or Node with no system font found) throws immediately in `_layout()`.

## Style + aspect-ratio presets

From `src/core/presets.ts`, consumed by `render()`/`renderStill()` in
`ecmanim/node`:

```ts
import { render } from "ecmanim/node";
await render(MyScene, { style: "3b1b-dark", aspectRatio: "9:16", quality: "high" });
```

`STYLE_PRESETS` (7 named looks): `3b1b-dark`, `bold-neon`, `clean-corporate`,
`light`, `midnight`, `chalkboard`, `print`. Each is `{ name, description,
background, palette: string[], font?, strokeWidth?, pacing? }` — a background
color, an ordered accent palette, default font/stroke width, and a playback
pacing multiplier.

`ASPECT_RATIO_PRESETS`: `16:9`, `9:16`, `1:1`, `4:3`, `21:9`, each `{ label,
pixelWidth, pixelHeight }` at a sensible default resolution; an arbitrary
`"W:H"` string is also accepted and derives dimensions (rounded to even, for
encoder friendliness) from either the preset's default height or an explicit
`pixelHeight`.

Precedence in `render()`: quality preset dimensions < aspect-ratio preset
dimensions < any explicit `pixelWidth`/`pixelHeight`/`resolution`/`background`
you pass — explicit fields always win. `resolveStyle(name)` and
`resolveAspectRatio(ratio, height?)` are exported directly for programmatic
use (e.g. picking a palette color for a mobject without going through
`render()`).

**Gotcha:** `STYLE_PRESETS.font` is only applied "when the backend supports
it" per the source comment — don't assume every renderer path threads font
selection through; verify visually if font matters for a given style.

## renderStill + the composition registry

`renderStill` (Node-only, `ecmanim/node`) is the cheapest way to check a
specific beat without a full video render — prefer it over full renders during
iteration (per the root skill's Render step):

```ts
import { renderStill } from "ecmanim/node";
await renderStill(MyScene, { output: "poster.png", time: 1.5 }); // or { frame: 45 }
```

It accepts the same `RenderOptions` as `render()` plus `time` (seconds,
converted to a frame using `fps`/`quality`) or `frame` (exact frame index) —
`frame` wins if both are given. Internally it's `render()` with
`stillFrame` set, so `style`/`aspectRatio`/`watermark`/etc. all apply.

The composition registry (`src/scene/compositions.ts`) lets tooling enumerate
renderable scenes, similar to Remotion's `<Composition>` list:

```ts
import { registerComposition, compositionsToJSON, getComposition, listCompositions } from "ecmanim";

registerComposition("intro", IntroScene, { fps: 30, width: 1920, height: 1080 });
compositionsToJSON(); // -> [{ name, description, fps, width, height, durationInFrames, schema, defaultParams }]
```

- `registerComposition(name, scene, config?)` — later calls with the same
  `name` overwrite the earlier registration. `config.schema` falls back to a
  static `schema` on the Scene class/constructor if present (see the
  authoring-pipeline's params-schema convention).
- `getComposition(name)` / `listCompositions()` / `unregisterComposition(name)`
  round out the registry; `compositionsToJSON()` is what feeds a `--json` CLI
  listing.
- This registry is pure in-memory bookkeeping — registering a composition does
  not render it; you still call `render`/`renderStill` separately.

## Gotchas summary

- `Timeline.defaults.runTime`/`rateFunc`, when set, overwrite *every* added
  animation's own values — don't set them if you need per-animation timing.
- `tl.build()` must be played with `{ _playConfig: true, runTime: tl.duration }`
  or the resolved absolute schedule won't be honored by `scene.play()`.
- `VectorDecimalNumber` throws immediately if no font is loaded — call
  `loadVectorFont()` (Node) / `setDefaultFont()` (browser) first, or pass
  `config.font`.
- Style preset `font` is not guaranteed to apply on every backend — check the
  render visually rather than assuming it always takes effect.
- Expression drivers (`wiggle`/`remap`/`ramp`) are plain functions for use in
  `addUpdater`, not `Animation` instances — they never go into `scene.play()`.
