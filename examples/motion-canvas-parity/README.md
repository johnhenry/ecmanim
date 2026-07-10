# Motion Canvas parity suite

Line-for-line ports of the [Motion Canvas](https://motioncanvas.io) example
corpus — every runnable scene from the official docs plus the two production
showcase scenes from
[motion-canvas/examples](https://github.com/motion-canvas/examples) — built
on ecmanim's public API. Original `.tsx` sources are committed beside the
ports in [`ref/`](./ref/) (MIT, © Motion Canvas contributors); provenance
and extraction notes are in each ref header.

```bash
# Render one (low quality for speed):
ECMANIM_DEMO_QUALITY=low npx tsx examples/motion-canvas-parity/01-quickstart.ts

# Render everything:
for f in examples/motion-canvas-parity/[0-9]*.ts; do npx tsx "$f"; done
```

Porting conventions (JSX → constructors, generators → async construct,
MC's 1920×1080 y-down pixel space → world units via `px()`/`pxLen()`) are
documented in [PORTING.md](./PORTING.md).

## Scorecard

| # | Port | Ref scene(s) | Features proven |
|---|------|--------------|-----------------|
| 01 | quickstart | quickstart-1/2 | tweenTo chains (`.to()`), parallel play, fill tween |
| 02 | bezier | bezier-1 | CubicBezier/QuadBezier nodes, strokeEnd/strokeStart draw-on |
| 03 | bezier-advanced | bezier-2/3 | pointFromProportion + tangentAtProportion (marker riding a curve, rotated to the tangent) |
| 04 | spline | spline-1/2/3 | Spline smoothness, explicit Knot handles, closed heart |
| 05 | path | path-1/2 | SVG `Path` node, progressive draw + fill, point-following |
| 06 | camera | camera-1/2/3 | MovingCameraScene centerOn / zoom / 180° roll / reset (parametric CameraFrameTween) |
| 07 | transitions | transitions-1/2 | slideTransition / fadeTransition / zoomInTransition, Direction, finishScene |
| 08 | index-gallery | index-1/2/3 | Code node, edit() template, selection dimming, signals |
| 09 | flow | flow-1/2/3 | all/chain composition, bare-`yield` nextFrame flicker |
| 10 | spawners | spawners | signal-driven node spawning (reactive count → row of circles) |
| 11 | logging | logging | scene.logger debug/info/warn/error → onLog |
| 12 | time-events | composite-time-events | waitUntil + SceneConfig.timeEvents retiming |
| 13 | random | composite-random | useRandom(seed) determinism (byte-identical re-renders) |
| 14 | signals | composite-signals | createSignal/computed/tweenSignal live readout |
| 15 | tweening | composite-tweening | tween+map, chained tweenTo, springTween presets |
| 16 | positioning | composite-positioning | px-space absolute/relative positioning, rotated parents |
| 17 | layouts | layouts | edge-gluing layout relationships under rotation |
| 18 | hierarchy | hierarchy | nested FlexGroups (gap/padding), family color tweens |
| 19 | media | media-1/2/3 | ImageMobject (runtime-generated), VideoMobject playback |
| 20 | latex | latex-1/2 | MathTex + matchTex `{{...}}` group morphs, chained |
| 21 | code | composite-code | code.edit tagged template with insert/remove/edit markers |
| 22 | effects | effects | reactive effect() over signals driving spawned tweens |
| 23 | filters | filters-and-effects | blur() fluent + signal-driven, CompositeGroup destination-out masking |
| 24 | showcase-logo | showcase-logo (examples repo) | full CompositeGroup layer tree: destination-in trail masks, destination-out star cutout, spawn loops, rotated assembly |
| 25 | showcase-signals | showcase-signals (examples repo) | seeded network pulses (TweenChain groups from spawn), typewriter, waitUntil events, reactive vignette |

Every port was rendered and pixel-checked frame-by-frame against what the
MC original draws (shapes, colors, positions, motion phase) — the receipts
workflow that has now caught **10 real ecmanim bugs** across this campaign
(CSS named colors parsing to black, partial-cache hash collisions, signal
chain `.to(raw)` silently holding, family-blind fill tweens, per-chain
scale/rotation drift, Yoga integer rounding, the 180° camera-roll collapse,
matchTex/edit scene cleanup, …). See CHANGELOG.

## Honest divergences

The conventions that are *translations*, not gaps — plus the real ones:

- **World-space transforms**: ecmanim mobjects hold world-space points; MC
  nodes keep retained parent-relative transforms. Group operations
  reproduce the visuals; per-node `absolutePosition` reads are computed at
  port time. Motion inside rotated parents moves along explicitly rotated
  axes (see 24-showcase-logo).
- **Generators → async construct**: `yield*` becomes `await this.play()`;
  MC's background `yield task()` becomes `this.spawn(function* () {...})`
  yielding Animations or idle seconds.
- **Spline smoothing** approximates MC's algorithm (Catmull-Rom-style
  handles scaled by `smoothness`); knot handles match exactly.
- **`waitUntil` durations** come from `SceneConfig.timeEvents` (config, not
  editor-draggable).
- **Video** advances with scene time (no editor play/pause); `seek()`
  matches MC's time control.
- **ImageMobject rotation** is a known renderer limitation (axis-aligned
  draw) — 19-media omits MC's `absoluteRotation` beat.
- **Dashed strokes on curves**: 25's dashed arc arrow renders solid (only
  straight `DashedLine` exists today) with a manual tip.
