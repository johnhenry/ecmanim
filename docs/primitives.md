# Primitives (expressions · timeline · vector numbers · presets · stills)

Phase-1 adoption additions. All isomorphic and dependency-free; exported from
`ecmanim`.

See also: [docs/flex-group.md](flex-group.md) for `FlexGroup`, an opt-in
Yoga-backed Flexbox layout primitive (an `optionalDependency`, async `layout()`).

## Expression drivers

Pure, deterministic (order-independent) functions of time — drive any property
from an updater. `wiggle` is value-noise, safe under scrubbing.

```js
import { wiggle, remap, ramp, compose } from "ecmanim";
const bob = wiggle(0.3, 2.5, /*seed*/ 7);      // ±0.3, ~2.5 Hz
mob.addUpdater(() => mob.moveTo([0, bob(scene.time), 0]));
const toScale = remap(0, 100, 0.5, 1.5);        // map a value range → scale
```

## Timeline (GSAP-style position grammar)

Place animations with a compact grammar, then `build()` one animation for
`scene.play()` — no manual `t` bookkeeping.

```js
import { Timeline } from "ecmanim";
const tl = new Timeline({ defaults: { runTime: 0.6 } });
tl.add(new Create(circle));
tl.add(new Create(square), "<");      // start together with the previous
tl.add(new FadeIn(label), "+=0.2");    // 0.2s gap after the timeline end
tl.addLabel("beat", ">");              // label the current end
tl.add(new Indicate(circle), "beat");  // place at a label
await scene.play(tl.build(), { _playConfig: true, runTime: tl.duration });
```

Positions: a number (absolute seconds), `"+=n"`/`"-=n"` (relative to the timeline
end), `"<"`/`"<n"`/`"<-n"` (previous start ± offset), `">"`/`">n"`/`">-n"`
(previous end ± offset), or a label name. Omitted = sequential append.

## Repeat + stagger helpers

`Repeat` wraps any leaf `Animation`, `AnimationGroup`, or built `Timeline` with
`count`/`yoyo`/`repeatDelay`, using only the public `Animation` contract (no
reaching into internals):

```js
import { Repeat } from "ecmanim";
await scene.play(new Repeat(new Indicate(circle), { count: 3, yoyo: true, repeatDelay: 0.2 }));
```

`yoyo` mirrors odd-indexed cycles (bounces back instead of resetting);
`repeatDelay` holds the previous cycle's end value between cycles. Infinite
repeat is out of scope (there's no infinite-time concept in this render
model) — `count: Infinity` throws.

`cycle()`/`staggerRange()` (`ecmanim`) are composable value-transform helpers
for `LaggedStartMap`'s `(mobject, index, total)` factory signature:

```js
import { cycle, staggerRange, LaggedStartMap } from "ecmanim";
const colorOf = cycle(["#E8833A", "#58C4DD", "#83C167"]);
const delayOf = staggerRange(0, 1);
scene.play(new LaggedStartMap(
  (m, i, total) => new Indicate(m, { color: colorOf(m, i, total) }),
  dots,
  { lagRatio: 0.05 },
));
```

## Timing presets (`linearTiming` / `springTiming`)

`crossFade`/`slide`/`wipe` (mobject-level transitions) and `PlayKeyframeTrack`
(below) accept a `timing` preset supplying the shared `rateFunc` and,
optionally, a suggested `runTime` — an explicit `config.runTime` always wins:

```js
import { crossFade, springTiming, linearTiming } from "ecmanim";
await scene.play(crossFade(a, b, { timing: springTiming(), fps: scene.fps }));
await scene.play(crossFade(a, b, { timing: linearTiming(smooth) })); // == today's default
```

`springTiming(config?, durationInFrames?)` measures its own natural settle
time via `measureSpring()` unless `durationInFrames` is given explicitly.

## KeyframeTrack — a structured, editable timeline

Unlike every other easing tool here (which compiles to an opaque function),
`KeyframeTrack` keeps its keyframe list mutable — a Studio scrub UI can splice
keyframes directly and `valueAt(t)` reflects it immediately.

```js
import { KeyframeTrack, PlayKeyframeTrack, animateSignal } from "ecmanim";

const track = new KeyframeTrack([
  { t: 0, value: 1 },
  { t: 2, value: 3, ease: "easeInOutSine" }, // per-keyframe ease, string or RateFunc
]);
await scene.play(new PlayKeyframeTrack(circle, track, (m, v) => m.scale(v)));

// Or drive a signal directly, with no mobject at all:
await scene.play(animateSignal(mySignal, track));
```

Default interpolation handles `number`/`number[]` via `V.lerp`;
`options.interpolate` is the escape hatch for other types (e.g. `Color.lerp`
for a color-typed track). See
[docs/authoring-studio.md](authoring-studio.md#property-keyframe-tracks--a-draggable-timeline-editor)
for the Studio-facing `scene.track()`/`bindTrack()`/draggable-timeline-editor
layer built on top of this.

## Coordinate-system reprojection

`reprojectCurve(domainSamples | curve, targetSystem, options?)` rebuilds a
curve — sampled in domain (coordinate) space — against a *different*
coordinate system, reusing the exact construction `Axes.plot()` uses so
fidelity matches a curve plotted directly against the target:

```js
import { Axes, PolarPlane, Transform, reprojectCurve } from "ecmanim";
const curve = axes.plot((x) => x * x); // stamps a hidden _domainSamples tag
const onPolar = reprojectCurve(curve, polarPlane); // reads the tag automatically
await scene.play(new Transform(curve.copy(), onPolar));
```

`targetSystem` only needs `coordsToPoint(a, b)`, so `Axes`/`PolarPlane`/
`ComplexPlane` all work as either source or target with no special-casing.

## VectorDecimalNumber

A live number as crisp vector glyph outlines (SVG-friendly, digits individually
animatable), mirroring `DecimalNumber` formatting + edge-fix.

```js
import { VectorDecimalNumber } from "ecmanim";
const n = new VectorDecimalNumber(0, { numDecimalPlaces: 0, fontSize: 0.8 });
counter.addUpdater(() => n.setValue(tracker.getValue())); // edge stays pinned
```

## Style + aspect-ratio presets

```js
import { render } from "ecmanim/node";
await render(MyScene, { style: "3b1b-dark", aspectRatio: "9:16", quality: "high" });
```

`STYLE_PRESETS` (named looks: `3b1b-dark`, `bold-neon`, `clean-corporate`,
`light`, `midnight`, `chalkboard`, `print`) set background + font. Aspect ratios
(`16:9`, `9:16`, `1:1`, `4:3`, `21:9`, or an arbitrary `"W:H"`) override
dimensions. Explicit `background`/`pixelWidth`/… still win. `resolveStyle` /
`resolveAspectRatio` are exported for programmatic use.

Register your own named preset the same way plugins register colors/rate-functions/mobjects:

```js
import { registerStylePreset } from "ecmanim";
registerStylePreset("my-brand", {
  name: "my-brand",
  background: "#0d1117",
  palette: ["#E8833A", "#58C4DD", "#83C167"],
  font: "Inter",
});
await render(MyScene, { style: "my-brand" });
```
`resolveStyle()` checks registered presets alongside the built-in
`STYLE_PRESETS` map, so a plugin can also override a built-in name.

## renderStill + composition registry

```js
import { renderStill } from "ecmanim/node";
await renderStill(MyScene, { output: "poster.png", time: 1.5 }); // or { frame: 45 }

import { registerComposition, compositionsToJSON } from "ecmanim";
registerComposition("intro", IntroScene, { fps: 30, width: 1920, height: 1080 });
// compositionsToJSON() -> enumerable renderable scenes (with params schema)
```
