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

### Joint limits, pole targets and effector lock (#92)

All optional; without them every solve is exactly as before.

**Joint limits.** `BoneSpec.limits = { min?, max? }` (or `model.setLimits(id, limits | null)`,
`model.limitsOf(id)`) bounds a bone's *local* angle (relative to its parent's
world angle, radians, either end optional). FK, `setAngle` and poses stay
unconstrained -- only IK honours limits:

- `solveTwoBone(..., { limits: { parentAngle, a, b } })` keeps the preferred
  bend branch if it satisfies both ranges, else takes the other branch
  (`result.limited === true`); if neither does it clamps the less-violating
  branch (lengths kept, `reached` false unless the clamped pose still lands on
  the target). `limited` exists only when `limits` was passed.
- `solveFABRIK(..., { limits: [rangeOrNull, ...], parentAngle })` projects the
  seed into the limits and clamps every link in each forward pass, so the
  returned pose always satisfies them; backward passes are unconstrained, so a
  target that needs a violation ends with `reached: false` and `error > 0`.
- `IKChain` reads the limits from the model automatically (including the
  effector bone's, see below) and adds them to `ikFingerprint()`.
- One-sided ranges are never wrapped; a two-sided range is also tested modulo
  2*PI, so `[0, 4]` admits an angle of -2.5.
- **Unsatisfiable** (target beyond what the limits allow): the chain ends as
  close as the clamping allows, still inside the limits, and reports it through
  `IKSolveResult.reached/error`; it never throws. FABRIK clamping is a
  heuristic (not an optimal constrained solve) and can stall short of a target a
  cleverer solver could reach.

**Pole target.** `pole` (any `IKTargetSource`) picks the side a chain bends to:
interior joints end up on the pole's side of the root -> target line. 2 bones:
overrides `bendSide`. 3+ bones: the seed is mirrored to that side (a straight
chain is nudged toward it) and a converged result left on the wrong side is
mirrored across the root -> effector line (lengths preserved). 2D has no
bend *plane*, so "pole" here only decides the side; it does not pull the elbow
toward the point. A pole on the root -> target line has no side and is ignored;
with active joint limits the limits win. No pole = the previous behaviour.

**Effector orientation lock.** `effectorAngle: number | () => number` keeps the
*effector bone* at that WORLD angle. The effector bone is a child of the last
chain bone (the hand/foot beyond the chain; `effectorBone` picks one when there
are several, and a missing child throws): the chain's last bone ends at the
target and the hand is re-aimed after every solve, so it holds while pinned and
while the figure moves. The effector bone's own limits clamp it. A rig
`angleLock` on the same bone runs later and wins.

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

Scope: without `effectorAngle` the effector's own children rotate with their
parent (FK). There is no multi-chain solving yet.

## Rig constraints (`mobject/skeleton_constraints.ts`)

Constraints are declared on a rig and re-applied automatically. Evaluation
order per frame: **pose -> IK -> constraints -> refresh**. `Skeleton.refresh()`
applies the constraint set first, and `setPose`, `interpolate`, `PoseTween` and
`IKChain.solve()` all end in `refresh()`, so constraints hold after every pose
or IK write (including `PoseTween` with `{ ik }`). A skeleton with no
constraints takes exactly the old path (`skeleton.constraints === null`).

```ts
fig.addConstraint({ type: "connector", id: "belt", bone: "belt", a: "hipL", b: "hipR", slide: 0.5 });
fig.addConstraint({ type: "weighted", bone: "chest", origin: "spine",
  anchors: [{ joint: "armL", weight: 0.5 }, { joint: "armR", weight: 0.5 }] });
fig.addConstraint({ type: "angleLock", bone: "head", reference: "world", multiplier: 0 }); // stays upright
fig.addConstraint({ type: "stretch", driver: "armL", min: 0.5, max: 2 });
fig.constraints!.get("belt")!.slide = 0.25;   // value fields are live
```

Our own semantics (`joint` = a bone id, meaning that bone's end, or `"root"`):

- **connector** `{ bone, a, b, slide }`: the end joint of `bone` sits at
  `A + slide * (B - A)`. `slide` is a number or `() => number`; it is not
  clamped. The bone keeps its start (its parent's end) and has its **angle and
  length** driven to land there; its children follow.
- **weighted** `{ bone, origin, anchors: [{ joint, weight }] }`: end joint =
  `O + sum(w_i * (J_i - O))`, 1-16 distinct anchors, signed weights. Angle and
  length driven like a connector.
- **angleLock** `{ bone, reference = "parent", multiplier = 1, offset = 0 }`:
  world angle = `offset + multiplier * R`, `R` = the parent bone's world angle
  (the placement rotation for a root bone) or, for `"world"`, the figure's
  placement rotation. Multiplier 1 is parallel to the reference; 0 pins the bone
  at `offset` in world space.
- **stretch** `{ driver, targets?, exclude?, restLength?, min?, max? }`:
  `ratio = clamp(length(driver) / rest, min, max)` (`rest` = `restLength` or the
  driver's authored length); each target's length becomes its authored length
  times `ratio`. Targets default to all descendants of the driver; `exclude`
  bones keep their length. The driver is never written (stretch it with a pose,
  IK `allowStretch`, or a connector). Optional extras (#92):
  `multipliers: { bone: k }` scales the stretch *amount* per target
  (`length = authored * (1 + (ratio - 1) * k)`, floored at 0; k = 0 leaves it
  alone, k > 1 exaggerates; keys must be targets), and `widthResponse: w` with
  `widthBones` (default all targets) scales those bones' drawn stroke width by
  `ratio ** -w` (w = 1 thins as the bone lengthens, area-style). The width is
  stored as a per-bone runtime scale (`model.getWidthScale`) and applied by
  `Skeleton.refresh()`; it is not part of a `Pose` and is derived each refresh.

**Graph.** Each constraint declares what it writes (bone angle/length) and
reads (joint geometry, or a driver's length); one depends on another when it
reads something the other writes. `ConstraintSet.order()` is a stable
topological order (insertion order among ready constraints). Adding a
constraint that forms a cycle -- including a constraint reading geometry its own
write moves -- throws `ConstraintSet: cycle detected ...` naming the
constraints and leaves the set unchanged. Two constraints cannot drive the same
channel of one bone (error names the owner). `enabled` toggles a constraint;
structural fields are fixed at `add()`.

**Fixed point.** `apply()` makes one pass by default. `new ConstraintSet(model,
{ iterations: n, tolerance })` (or `skeleton.ensureConstraints({ iterations })`,
or `cs.configure(...)`) repeats the pass up to `n` times until the largest bone
angle/length change is <= `tolerance` (default 1e-9); `apply()` returns
`{ passes, residual }`. The declared graph is acyclic, so one pass is already
exact for declared dependencies; extra passes matter for state the graph cannot
see, such as a `slide` callback that reads the rig it drives. If it does not
converge within `n` passes the last pass stands (no throw). This does not loop
IK <-> constraints; that order stays pose -> IK -> constraints.

`ConstraintSet` also works on a bare `SkeletonModel` (`new ConstraintSet(model).add(...).apply()`).
`Skeleton.copy()` copies the set rebound to the copy's model. IK/`PoseTween`
cache fingerprints include constraint values when any exist.

## Renderer support

| Feature | Canvas-2D (Node/browser) | SVG | WebGL (Three) |
|---|---|---|---|
| Bones (line/arc), joints, heads, fills | yes (golden-tested) | yes (plain `VMobject`s) | yes (plain `VMobject`s) |
| Pose tweening / `setTime` | yes (model-level, renderer-independent) | same | same |
| IK (`solveTwoBone`, `solveFABRIK`, `IKChain`) | yes (model-level; only writes angles/lengths, golden-tested) | same | same |
| Joint limits, pole target, effector lock, stretch multipliers / width response, constraint iterations | yes (model-level; width response changes the drawn stroke width, which every backend honours) | same | same |
| Rig constraints (connector, weighted, angle lock, stretch) | yes (model-level, renderer-independent; unit-tested) | same | same |

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
- IK is 2D and per-chain: no shared-bone conflict detection; joint-limit
  clamping inside FABRIK is a heuristic (see Joint limits); a pole picks a
  side only (no bend plane in 2D); `"auto"` bend continuity is
  path-dependent (see above); long chains may keep a small residual at the
  iteration limit (`IKSolveResult.error`).
- Rig constraints are 2D, drive bone angle/length only (never placement), run
  once per `refresh()` in dependency order by default (opt-in `iterations`
  fixed point, which never loops IK <-> constraints). A constraint fighting IK
  on the same bone resolves to the constraint (it runs last).
- Studio (`@johnhenry/ecmanim/studio`): `rigToControls` / `applyRigControl`
  describe and edit constraint values, IK options and joint limits as
  `PropControl`-shaped controls, and `createIKDrag` / `attachIKDrag` drag an IK
  target (or pin) in a 2D viewport. There is no visual constraint-graph editor,
  no creating/removing constraints or editing structural fields (bones,
  anchors) from the UI, and no joint-limit arc gizmo yet.
- Pose operators, clips, Stick Nodes import and studio overlays are separate
  follow-ups (epic #61).
