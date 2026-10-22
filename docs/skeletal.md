# Skeletal animation (`@johnhenry/ecmanim/skeletal`)

`Skeleton` is a stick-figure / rig mobject driven by a **pure, Mobject-free
model** (`SkeletonModel`): a bone hierarchy, forward kinematics (FK) and a
`Pose` value type. Poses tween with shortest-arc angle blending, so limbs keep
their length mid-tween (lerping joint points would shrink them).

```ts
import { Skeleton, PoseTween, PoseLibrary, poseTrack } from "@johnhenry/ecmanim/skeletal";

const D = Math.PI / 180;
const fig = new Skeleton(
  [
    { id: "torso", parent: null, length: 1.4, angle: 90 * D },
    { id: "neck", parent: "torso", length: 0.35 },
    { id: "armL", parent: "torso", length: 0.9, angle: 140 * D, bend: 0.4 },
    { id: "handL", parent: "armL", length: 0.8, angle: 20 * D },
  ],
  { joints: true, heads: [{ joint: "neck", radius: 0.3 }] },
);
this.add(fig);

fig.setPose({ bones: { armL: { angle: 60 * D } } });              // immediate
await this.play(fig.animate.setPose({ bones: { armL: { angle: 0 } } })); // .animate works
await this.play(new PoseTween(fig, { bones: { armL: { angle: -170 * D } } }, { runTime: 1 }));
```

The subpath is separate from the root barrel on purpose (root export surface
and bundle size stay stable); it can be re-exported from `.` later without a
break.

## The model (`SkeletonModel`) -- the contract other modules build on

Everything is documented at the top of `src/mobject/skeleton_model.ts`.

- **Stable ids.** A bone is `{ id, parent, length, angle, bend, width, zIndex }`.
  Ids are caller-chosen strings, never renamed or reindexed; poses, fills,
  heads and constraints refer to bones/joints only by id. `model.ids` is a
  topological order (parents first). The joint at the end of bone `b` has id
  `b`; the reserved id `"root"` is the origin where parent-less bones start.
- **Angles** are radians, counter-clockwise, y-up. `angle` is relative to the
  parent's world angle; the skeleton's `rotation` seeds root bones.
- **Reads:** `jointPosition(id)`, `jointPositions()`, `boneStart(id)`,
  `boneWorldAngle(id)`, `boneWorldAngles()`, `parentOf`, `childrenOf`,
  `ancestorsOf`, `descendantsOf`, `rootBones`, `specOf`.
- **Writes (drivable by IK, pose operators, constraints):** `setAngle`,
  `setWorldAngle` (local angle from a desired world angle), `setLength`,
  `setBend`, `setPlacement({root, rotation, scale})`, `setPose(partial)`.
  Every write bumps `model.version`; FK is cached per version.
- **`bend`** is the sweep of a circular arc drawn between a bone's endpoints.
  It affects drawing only; joints and world angles use the straight chord.
- **`Pose`** = `{ root, rotation, scale, bones: { [id]: { angle, length, bend } } }`.
  `PartialPose` makes every field optional (unlisted fields are untouched;
  unknown bone ids are ignored unless `setPose(p, { strict: true })`).
  `lerpPose(a, b, t)` blends angles/rotation by shortest arc and everything
  else linearly; it accepts partial poses.

A model owned by a `Skeleton` can be driven directly; call
`skeleton.refresh()` afterwards to rebuild the drawn geometry.

## The mobject (`Skeleton extends VGroup`)

Children (draw order): fills, bones, heads, joint dots -- plain `VMobject`s
whose points are rewritten in place, so `getBoneMobject(id)` references stay
valid. Options: `joints`, `heads: [{ joint, radius, ... }]`,
`fills: [{ joints: [ids], color, opacity }]` (closed polygons over joint ids,
`"root"` allowed), plus `root`/`rotation`/`scale` placement.

- `setPose(p)`, `getPose()`, `bindPoseTrack(track)` + `setTime(t)`: pure
  functions of absolute time (no integrated `dt`), so scrubbing, onion skins
  and parallel segment rendering can evaluate any `t`.
- **`copy()`** deep-clones the model and pose library (`Mobject.copy()` alone
  would alias them); `.animate`, `saveState`, `generateTarget` and `Transform`
  therefore work. The bound pose track is shared by reference.
- **`interpolate()`** blends poses, never joint points, and does not call
  `super.interpolate`. Bones are matched by id between start and target.
- **Moving the group** (`shift`, `scale`, `rotate`, `moveTo`, ...) is folded
  into the model's placement, so the next pose change does not snap back.
- **z-order.** Each bone's `zIndex` is an *offset* from the Skeleton's
  `zIndex`; `skeleton.setZIndex(n)` sets `n + offset` on every part (the base
  class would overwrite all children with `n`). Change one bone with
  `setBoneZIndex(id, offset)`.
- No updaters are installed, so there is no hidden state for `wait()`
  fingerprints: the cache key sees the geometry, which is rebuilt from the
  model on every change.

## Poses and tweening (`animation/pose.ts`)

- `PoseTween(skeleton, pose, config)` tweens from the current pose to a
  full/partial pose (modelled on `PlayKeyframeTrack.begin()`: no whole-mobject
  start-state copy).
- `PoseLibrary`: named poses (`set`, `get`, `capture`, `apply`, `tween`,
  `toJSON`/`fromJSON`); each `Skeleton` has one at `skeleton.poses`.
- `poseTrack(keyframes)`: a `KeyframeTrack<Pose>` (the existing
  `interpolate` option set to `lerpPose`). Use with `setTime`, or
  `new PlayKeyframeTrack(skeleton, track, (m, p) => m.setPose(p))`.

## Clip: nested animation with its own clock (`Clip extends Group`)

```ts
import { Clip } from "@johnhenry/ecmanim/skeletal";

fig.bindPoseTrack(walkCycle);                       // a Skeleton with a pose track
const walker = new Clip(fig, { mode: "loop", duration: 1.2, speed: 1.5 });
this.add(walker);
await this.wait(6);                                 // walker.update(dt) advances its own clock

walker.seek(0.3);                                   // pure: same t in, same frame out
const ghost = walker.copy().seek(0.3 + 0.1);        // independent clock (onion skin)
```

Content is any child exposing `setTime(t)` (a `Skeleton` with a bound pose
track, particle presets, other `Clip`s) or a builder `(t, clip) => void`.
Children without `setTime` are left alone (they keep normal `update` recursion).

| Mode | Local time for `raw = t * speed + startOffset` |
|---|---|
| `loop` (default) | `raw` wrapped into `[0, duration)` (negative speed works) |
| `once-hold` | `raw` clamped to `[0, duration]` (holds the last frame) |
| `once-hide` | as `once-hold` inside `[0, duration]`; **renders nothing** outside it (content is detached, not evaluated, while hidden) |
| `single-frame` | always `startOffset` (a pinned still) |

Without `duration` there is nothing to wrap or hide against: local time is
`raw` (clamped at 0 for the `once-*` modes).

- `localTime(t)` and `isVisibleAt(t)` are pure; `setTime(t)` / `seek(t)` set the
  clip's clock and evaluate deterministically (any order, any `t`).
- Live play: `update(dt)` advances the clock by `dt` (scaling by `speed` happens
  in the time model, never by feeding children a scaled `dt`) and does **not**
  recurse into time-driven children, which would otherwise receive the scene's
  unscaled `dt`. For fully scene-clock-locked playback you can instead drive it
  yourself: `clip.clearUpdaters(); clip.addUpdater(() => clip.setTime(scene.time - t0))`.
- **`play()` suspends updaters** on the animated mobject, so a Clip's clock
  pauses during `play(clip.animate...)`/`FadeIn(clip)` unless the animation sets
  `suspendMobjectUpdating: false`. `seek()` still works while suspended.
- **`copy()`** gives an independent clock and re-arms the driver (plain
  `Mobject.copy()` would drop the updater and freeze the copy); builders are shared.
- `wait()` fingerprints include the clip's mode/speed/offset/clock via an updater `hashExtra`.
- `isolate: true` renders the content into its own offscreen layer
  (`CompositeGroup` semantics: blend modes apply among siblings only; Canvas
  backends, degrades to unscoped drawing elsewhere).

**Why `./skeletal` and not the root `.`:** `Clip` is fully generic (duck-typed on
`setTime`, no skeleton imports), but the epic's packaging plan keeps the root
barrel (~390 exports) and bundle stable, and moving an export from a subpath into
`.` later is additive whereas the reverse would be a break. It is also
registered by `registerBuiltins()` like the other mobjects.

## Renderer support

| Feature | Canvas-2D (Node/browser) | SVG | WebGL (Three) |
|---|---|---|---|
| Bones (line/arc), joints, heads, fills | yes (golden-tested) | yes (plain `VMobject`s) | yes (plain `VMobject`s) |
| Pose tweening / `setTime` | yes (model-level, renderer-independent) | same | same |
| `Clip` modes / speed / seek | yes (model-level, renderer-independent) | same | same |
| `Clip` `isolate: true` | offscreen layer | children drawn unscoped | children drawn unscoped |

Only the Canvas-2D path has a golden-frame test; SVG/WebGL draw the same
`VMobject` geometry but are not separately pinned.

## Honest divergences / limits

- 2D only (z is dropped; the model is x/y).
- `Transform` between skeletons with *different* bone sets does not morph
  structure: bones are matched by id and unmatched ids are ignored.
- Bone/fill/head **styles** (colour, width) are not interpolated by
  `interpolate()`; only the pose and group opacity are.
- Non-similarity group transforms (`stretch`, mirror `flip`) distort the drawn
  geometry but cannot be represented in the model's placement (root, rotation,
  uniform scale), so the next pose change snaps back.
- Head radius and joint-dot size are fixed at construction (not part of a Pose).
- `Clip`: the clock is a float accumulator under live `update(dt)` (drift
  ~1e-16/frame, irrelevant in practice; use `seek`/a scene-time updater for
  exactness); `once-hide` detaches children while hidden, so code holding the
  clip must not rely on `clip.submobjects` being populated then; `Clip` is not
  golden-frame tested (it adds no drawing of its own).
- IK, pose operators, Stick Nodes import, studio overlays and rig
  constraints are separate follow-ups (epic #61).
