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

## Inverse kinematics (`mobject/ik.ts`)

Two layers. **Pure solvers** (no Mobject, no state, deterministic):

- `solveTwoBone(root, l1, l2, target, bendSide, { allowStretch })`: analytic
  law-of-cosines solve returning `{ mid, end, reached, scale, lengths }`.
- `solveFABRIK(points, lengths, target, { iterations = 32, tolerance = 1e-4, allowStretch })`:
  root fixed, inputs never mutated, returns `{ points, reached, scale, iterations, error }`.
- Out of reach: a straight, fully extended limb pointing at the target, or --
  with `allowStretch` -- every bone scaled by the same factor so the effector
  lands on it. Inside the minimum reach the limb folds and stops at
  `|l1 - l2|`. Target on the root, zero lengths and coincident points all give
  finite, deterministic results.

**`IKChain`** binds bone ids (root to effector, each the child of the previous)
to a target and writes *derived angles* into the model (`setWorldAngle`; lengths
are only written when stretching), then calls `skeleton.refresh()`:

```ts
import { IKChain, ikTargetXY } from "@johnhenry/ecmanim/skeletal";

const hand = new Dot();
const leg = new IKChain(fig, { bones: ["legL", "footL"], target: hand, bendSide: "right" });
leg.solve();                 // one-shot
leg.attach();                // or: re-solve every frame via an updater
leg.pin();                   // plant the foot at its current world position
fig.shift(RIGHT);            // the body moves, the foot stays planted
leg.unpin();
```

- **Target** is a `() => [x, y]`; `ikTarget(src)` adapts a fixed point, a
  function, any Mobject (its center: `Dot`, `ComplexValueTracker`, ...) or
  `{ track: KeyframeTrack<number[]>, time: () => number }`. `ikTargetXY(xTracker,
  yTracker)` wraps two `ValueTracker`s. Assign `chain.target = ikTarget(...)` to retarget.
- **`bendSide`**: `"left"` is the counter-clockwise side of the root-to-target
  direction, `"right"` the mirror. **`"auto"` (default) keeps the branch the
  limb is currently on**, read from the pose (sign of
  `cross(effector - root, mid - root)`). When the limb is straight there is
  no current side, so the chain uses the last side it saw while bent
  (initially `autoFallback`, default `"left"`; exposed as `chain.autoSide`).
  That memory is the only hidden state: `"auto"` is path-dependent, so use an
  explicit side when you need to evaluate an arbitrary time (scrubbing,
  parallel segment rendering).
- **Chains of 3+ bones** use FABRIK seeded from the current pose (so the shape
  is continuous frame to frame). `bendSide` only matters there to nudge an
  exactly straight chain off its line.
- **`allowStretch`** stretches uniformly only when the target is out of reach;
  authored lengths (`restLengths`, default: lengths at construction) are
  restored as soon as the target is back in reach. Without it the effector stops
  at full extension.
- **`pin(position?)`** fixes the effector's *world* position (default: where it
  is now); the chain keeps reaching for it while the skeleton moves, ignoring
  `target` until `unpin()`. Out-of-reach pins behave like out-of-reach targets.
- Model placement (`root`, `rotation`, `scale`) is honoured; the solve is in
  world units.

### IK, `play()` and `PoseTween`

`attach()` installs an ordinary updater, and `Scene.play` **suspends the
animated mobject's updaters** for the duration of the animation. So an attached
chain **freezes under a `PoseTween` on the same skeleton** by default.
Decision: rather than silently changing suspension semantics, `PoseTween`
accepts an optional `ik` config -- `new PoseTween(fig, pose, { ik: chain })` (or an
array) -- and re-solves those chains after every pose write, so IK wins over FK for the
bones it drives and the foot stays planted while the body tweens. The
alternative, `suspendMobjectUpdating: false`, also works but lets *all*
updaters on the skeleton run. Chains whose target is driven by something else
being animated (a `ValueTracker` moved by `play(tracker.animate...)`) need
nothing: the skeleton is not the animated mobject then, so its updater keeps
running. `Skeleton.copy()` (and therefore `.animate`, `saveState`) does not copy
updaters (base `Mobject.copy()` behaviour); recreate/`attach()` on the copy.
`attach()` supplies a `hashExtra` so `wait()` caches see the target/pin/bend
state, and `PoseTween` now salts its cache key with its target pose and IK
fingerprint.

Scope: the effector's own children rotate with their parent (FK); there is no
effector-orientation lock, joint limits, pole targets or multi-chain solving
yet (see rig constraints, epic #61).

## Pose operators (`animation/pose_ops.ts`)

Pure `Pose -> Pose` in-between tools after Blender's In-Betweens manual
(Breakdowner / Blend to Neighbour / Relax / Push); angles take the shortest arc.

- `breakdown(prev, next, t)`: 0 = prev, 1 = next.
- `blendToNeighbor(prev, cur, next, amount)`: -1 prev, 0 cur, +1 next (clamped).
- `relax(prev, cur, next, tPrev, tCur, tNext, factor)`: move `cur` toward the
  in-between at `cur`'s proportional time (`factor` 1 = exactly it).
- `push(...)`: same args; reflects the relax displacement (exaggerates). `scale`
  and bone `length` are floored at 0.
- `applyPoseOp(track, index, {op, amount})` rewrites a `poseTrack` key from its
  strict neighbours; `insertBreakdown(track, t, amount)` adds a key.

## Renderer support

| Feature | Canvas-2D (Node/browser) | SVG | WebGL (Three) |
|---|---|---|---|
| Bones (line/arc), joints, heads, fills | yes (golden-tested) | yes (plain `VMobject`s) | yes (plain `VMobject`s) |
| Pose tweening / `setTime` / pose operators | yes (model-level, renderer-independent) | same | same |
| IK (`solveTwoBone`, `solveFABRIK`, `IKChain`) | yes (model-level; only writes angles/lengths, golden-tested) | same | same |

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
- IK is 2D and per-chain: no joint limits, effector-orientation lock, pole
  targets or shared-bone conflict detection; `"auto"` bend continuity is
  path-dependent (see above); long chains may keep a small residual at the
  iteration limit (`IKSolveResult.error`).
- Pose operators work on whole poses (no per-bone filter, no easing curve on the amount, unlike Blender's Graph Editor). Clips, Stick Nodes import, studio overlays and rig
  constraints are separate follow-ups (epic #61).
