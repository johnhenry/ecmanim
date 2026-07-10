# Motion Canvas → ecmanim porting conventions

Every port is a line-for-line translation of a Motion Canvas doc/example
scene (original in `ref/`). Follow `01-quickstart.ts` / `02-bezier.ts` as
exemplars. These conventions are the whole mapping:

## Structure
- JSX `<Circle x={-300} width={140} fill="#e13238"/>` → constructor configs.
- `export default makeScene2D(function* (view) {...})` → `class X extends
  Scene { async construct() {...} }` + `await demoRender(X, import.meta.url)`.
- `view.add(<.../>)` → `this.add(mob)`.
- `yield* anim` → `await this.play(anim)`; `yield* all(a, b)` →
  `await this.play(a, b)`; `yield* chain(a, b)` → sequential plays.
- `yield* waitFor(s)` → `await this.wait(s)`; `yield* waitUntil("name")` →
  `await this.waitUntil("name")`; bare `yield` → `await this.nextFrame()`.
- `yield spawnedTask()` / `spawn(...)` → `this.spawn(function* () {...})`
  (yield Animations or idle seconds); infinite `loop(...)` →
  `this.loopForever(() => anim)`.

## Coordinates (the #1 gotcha)
MC scenes are 1920×1080 PIXELS, center origin, **y-down**. ecmanim world is
8 units tall, **y-up**. From `_run.ts`:
- position: `px(x, y)` (divides by 135, negates y)
- lengths (width/height/radius/size/fontSize): `pxLen(n)`
- `lineWidth` → `strokeWidth` UNCHANGED (both ≈ px at 1080p)
- MC `width={140}` on a Circle means DIAMETER → `radius: pxLen(140) / 2`.
- MC `size` on Rect = [width, height]; `rotation` is DEGREES (y-down means
  positive MC rotation is CLOCKWISE) → ecmanim radians CCW: negate and
  convert `(-deg * Math.PI) / 180`.

## Properties & tweens
- `fill` → `fillColor` + `fillOpacity: 1`; `stroke` → `strokeColor` (+
  `strokeWidth`). Shapes default to fillOpacity 0 in ecmanim — set it.
- `node().prop(v, dur)` → `tweenTo(node, { prop: v }, dur)`; chained
  `.to(v2, d2)` / `.wait(d)` / `.back(d)` map 1:1 on the TweenChain.
  Supported props: x, y, position, opacity, fill, stroke, fillOpacity,
  strokeWidth, width, height, rotation, scale, end, start.
- `end`/`start` (partial stroke draw) are `strokeEnd`/`strokeStart` fields;
  initialize via `(mob as any).strokeEnd = 0` and tween with
  `tweenTo(mob, { end: 1 }, dur)`.
- Signals: `createSignal(v)` from `src/reactive/signal.ts`; derived values
  via `computed(() => ...)`; tween a signal with `tweenSignal(sig, v, dur)`.
- `map(a, b, t)`, `tween(dur, cb)`, spring presets + `springTween`, and
  `useRandom(seed)` come from the barrel and map 1:1.
- Easing: `easeInOutCubic` etc. → rate funcs from `src/rate_functions.ts`
  (pass as the 3rd arg to tweenTo / in AnimationConfig). `linear` exists.

## Cameras, code, transitions, media
- `<Camera.Stage>` scenes → `MovingCameraScene`: `centerOn(mobOrPoint,
  {runTime})`, `rotateCamera(rad)`, `resetCamera()`, or animate
  `this.getFrame()` directly (`frame.animate.scale(0.5).moveTo(p)`).
- Code: `new Code(source, { language, lineNumbers: false })`;
  `code.edit(dur)\`...\`` with `insert()/remove()/edit()` markers returns
  `{animation, target}` — play the animation, keep using `target`.
  `code.selection(lines(a, b))` / `word(l, c, len)` / `findFirstRange(re)`;
  instant `setCode/replace/prepend/append`.
- Scene transitions: `slideTransition(scene, Direction.Left, incoming,
  {runTime})`, `fadeTransition`, `zoomInTransition(scene, area, incoming)`;
  `finishScene()` is a no-op marker.
- Latex: `new MathTex("x^2")` (call `demoRender(..., { mathTex: true })`);
  animated tex swaps: `matchTex(old, "{{a^2}} + {{b^2}}")` →
  `{animation, target}`.
- Video/Img: `ImageMobject` / `VideoMobject` (media ports may synthesize a
  tiny clip or gradient image at runtime into `out/_gen/` rather than
  committing binaries).
- Effects: `mob.blur(r)/glow(r, color)/dropShadow(...)/colorAdjust({...})`
  fluent helpers; `compositeOperation` + `CompositeGroup` for blend modes.

## Rendering + receipts (MANDATORY, per port)
```bash
ECMANIM_DEMO_QUALITY=low npx tsx examples/motion-canvas-parity/NN-name.ts
ffmpeg -y -loglevel error -i examples/motion-canvas-parity/out/NN-name.mp4 \
  -vf "select='eq(n\,10)+eq(n\,40)+eq(n\,80)'" -vsync 0 /tmp/frames-NN-%d.png
```
READ the extracted frames and confirm the picture matches what the MC
original would show (shapes, colors, positions, motion phase). A black or
empty frame means a bug — fix it, don't ship it. After editing library or
scene code, `rm -rf examples/motion-canvas-parity/out/partial` (stale
partial-movie cache does NOT hash pre-play static state).

## Known footguns
- `Color` constructor is (r, g, b) floats — always `Color.parse("#hex")`.
  CSS named colors work ("lightseagreen").
- ApplyMethod/Animation constructors do NOT take `{runTime}` as a trailing
  arg (needs `_animConfig` marker) — set `anim.runTime = d` after building,
  or use tweenTo (whose duration arg is real).
- Node runner is `npx tsx` for examples (top-level await), but tests run
  under `node --test` (type-strip only: NO TS enums, no `import x = ...`).
- Header comment: name the ref file(s) + one line on what the scene shows.
  Note any honest divergence explicitly.
