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
yet (an `angleLock` constraint on the effector bone covers orientation; see
Rig constraints below).

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
  IK `allowStretch`, or a connector).

**Graph.** Each constraint declares what it writes (bone angle/length) and
reads (joint geometry, or a driver's length); one depends on another when it
reads something the other writes. `ConstraintSet.order()` is a stable
topological order (insertion order among ready constraints). Adding a
constraint that forms a cycle -- including a constraint reading geometry its own
write moves -- throws `ConstraintSet: cycle detected ...` naming the
constraints and leaves the set unchanged. Two constraints cannot drive the same
channel of one bone (error names the owner). `enabled` toggles a constraint;
structural fields are fixed at `add()`.

`ConstraintSet` also works on a bare `SkeletonModel` (`new ConstraintSet(model).add(...).apply()`).
`Skeleton.copy()` copies the set rebound to the copy's model. IK/`PoseTween`
cache fingerprints include constraint values when any exist.

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
| Pose tweening / `setTime` / pose operators | yes (model-level, renderer-independent) | same | same |
| IK (`solveTwoBone`, `solveFABRIK`, `IKChain`) | yes (model-level; only writes angles/lengths, golden-tested) | same | same |
| `Clip` modes / speed / seek | yes (model-level, renderer-independent) | same | same |
| `Clip` `isolate: true` | offscreen layer | children drawn unscoped | children drawn unscoped |
| Rig constraints (connector, weighted, angle lock, stretch) | yes (model-level, renderer-independent; unit-tested) | same | same |

Only the Canvas-2D path has a golden-frame test; SVG/WebGL draw the same
`VMobject` geometry but are not separately pinned.

## Importing Stick Nodes figures (`loadStickNodes`)

```ts
import { loadStickNodes } from "@johnhenry/ecmanim/skeletal";

const bytes = new Uint8Array(await (await fetch("figure.nodes")).arrayBuffer()); // or fs.readFileSync
const { skeleton, track, poses, meta } = loadStickNodes(bytes, { unitsPerPixel: 0.01 });
scene.add(skeleton);
await scene.play(poses.tween(skeleton, "default"));   // saved pose -> the file's default pose
console.log(meta.warnings);                            // everything read but not represented
```

`parseStickNodes(bytes)` is the pure half: `Uint8Array` in, plain `StickNodesFigure`
data out (sync, no I/O, no `node:` imports, no mobjects). `loadStickNodes` is
sync and pure of I/O like `loadLottie`: read the file yourself.

- **Formats.** `.nodes` figures: raw big-endian (versions 160-423) and
  zlib-wrapped little-endian files, via a small built-in synchronous inflate
  (`DecompressionStream` is async; no dependency added). Per-version/build
  field differences follow sticknodes-rs up to Stick Nodes 4.2.3 build 72;
  newer files are read best-effort with a warning. Malformed input throws
  `StickNodesParseError`.
- **Mapping.** Each non-root node becomes a bone `n<drawIndex>` (parent = the
  parent node; children of the root are root bones). Node angles (degrees,
  relative, summed down the chain) become bone angles; the root node's angle
  becomes the skeleton's `rotation`. `length * unitsPerPixel` is the bone
  length; `thickness` becomes the stroke width; draw index is the bone's
  z offset; the figure colour (and per-segment colours/alpha) style the bones.
- **Result.** `skeleton`; `poses` (`"pose"` = the saved pose, `"default"` = the
  file's default angles/lengths); `track` (a one-key `KeyframeTrack<Pose>` at
  `t = 0`; `skeleton.bindPoseTrack(track)` + `setTime`); `meta` (version,
  build, `boneIdByDrawIndex`, the full parsed figure, `warnings`).
- **Provenance.** The layout follows MIT-licensed
  [sticknodes-rs](https://github.com/vinceTheProgrammer/sticknodes-rs); see
  `THIRD_PARTY_NOTICES.md`. Test fixtures are built by a test-only encoder
  (`test/helpers/sticknodes_encoder.ts`); no third-party sample files are
  committed.

### Stick Nodes import: honest divergences

- **Figures only, one pose.** sticknodes-rs documents `.nodes`; project
  (`.stknds`) and movieclip (`.nodemc`) files are listed there as future work,
  so animation frames are **not** imported (a zip container is rejected with a
  clear error). `track` has a single key.
- **Not simulated** (listed in `meta.warnings` with draw indices; the stored
  pose is kept): smart stretch, floaty motion, stretchy/static flags, angle
  locks, drag locks, connectors, per-segment scale.
- **Shapes.** Circle, triangle, ellipse, trapezoid and polygon nodes are drawn
  as plain bones; gradients, curve radius and polyfills are not rendered
  (polyfill data stays in `meta.figure.polyfills`). Compressed files' polyfill
  and connector-end tables are not read (as in sticknodes-rs); trailing bytes
  are reported.
- **Orientation/units.** The reference does not specify Stick Nodes' axis
  orientation: angles import as-is (CCW, y-up); pass `flipY: true` to mirror.
  The header `scale` is recorded in `meta.figure` but not applied.
- **Per-bone styling** (segment colour, alpha) is set on the bone mobjects at
  load and, like all Skeleton styles, is not interpolated by `interpolate()`.
  Renderer matrix: the result is an ordinary `Skeleton`, so Canvas-2D, SVG and
  WebGL behave as for any Skeleton.

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
- `Clip`: the clock is a float accumulator under live `update(dt)` (drift
  ~1e-16/frame, irrelevant in practice; use `seek`/a scene-time updater for
  exactness); `once-hide` detaches children while hidden, so code holding the
  clip must not rely on `clip.submobjects` being populated then; `Clip` is not
  golden-frame tested (it adds no drawing of its own).
- Pose operators work on whole poses (no per-bone filter, no easing curve on the amount, unlike Blender's Graph Editor).
- Rig constraints are 2D, drive bone angle/length only (never placement), run
  once per `refresh()` in dependency order (no iteration to a fixed point), and
  have no studio/editor UI, per-target stretch multipliers or width response.
  A constraint fighting IK on the same bone resolves to the constraint (it runs
  last). Not yet: IK effector-orientation lock (angle lock on the effector
  bone is the workaround), joint limits and pole targets.
