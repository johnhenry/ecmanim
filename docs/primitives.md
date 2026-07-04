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

## renderStill + composition registry

```js
import { renderStill } from "ecmanim/node";
await renderStill(MyScene, { output: "poster.png", time: 1.5 }); // or { frame: 45 }

import { registerComposition, compositionsToJSON } from "ecmanim";
registerComposition("intro", IntroScene, { fps: 30, width: 1920, height: 1080 });
// compositionsToJSON() -> enumerable renderable scenes (with params schema)
```
