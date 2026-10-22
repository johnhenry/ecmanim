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

## Renderer support

| Feature | Canvas-2D (Node/browser) | SVG | WebGL (Three) |
|---|---|---|---|
| Bones (line/arc), joints, heads, fills | yes (golden-tested) | yes (plain `VMobject`s) | yes (plain `VMobject`s) |
| Pose tweening / `setTime` | yes (model-level, renderer-independent) | same | same |

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
  zlib-wrapped little-endian files, inflated synchronously with `fflate`
  (`DecompressionStream` is async) under a 64 MiB output cap that rejects
  decompression bombs. Per-version/build
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
  `THIRD_PARTY_NOTICES.md`. Two kinds of test fixture: synthetic ones from a
  test-only encoder (`test/helpers/sticknodes_encoder.ts`) and a cross-validation
  set in `test/fixtures/sticknodes/` — figures of our own design written by
  sticknodes-rs itself, read back by it, with its decoded values dumped to JSON;
  `test/sticknodes-crossval.test.ts` asserts `parseStickNodes` matches that dump
  field-by-field (see the folder's README for provenance and regeneration).
  No files saved by the Stick Nodes app are committed.

### Stick Nodes import: honest divergences

- **Figures only, one pose.** `.nodes` is the only format read. Projects
  (`.stknds`, a zip container) and movieclips (`.nodemc`) are rejected with a
  clear error: no permissive layout reference exists (sticknodes-rs lists them
  as future work) and none has been verified against a file saved by the app, so
  no frames are imported and `track` has a single key. Tracked as blocked
  upstream.
- **Not simulated** (listed in `meta.warnings` with draw indices; the stored
  pose is kept): smart stretch, floaty motion, stretchy/static flags, angle
  locks, drag locks, connectors, per-segment scale.
- **Shapes.** Circle, triangle, ellipse, trapezoid and polygon nodes are drawn
  as plain bones; gradients, curve radius and polyfills are not rendered
  (polyfill data stays in `meta.figure.polyfills`). Compressed files' polyfill
  and connector-end tables are not read (as in sticknodes-rs); trailing bytes
  are reported.
- **Orientation/units.** Angles import as-is: counter-clockwise, y-up, matching
  sticknodes-rs, whose writer derives each node's stored `localX/localY` as
  `length * (cos, sin)` of the summed ancestor angles (our parser agrees with it
  on every cross-validation fixture). That proves the reference's
  self-consistency, **not** how the Stick Nodes app orients its canvas: it has
  not been checked against a file saved by the app, so the figure may appear
  mirrored. Pass `flipY: true` to mirror. The header `scale` is recorded in
  `meta.figure` but not applied.
- **Reference quirks (sticknodes-rs).** Cross-validation found three places
  where the reference's *writer* is not round-trippable, so fixtures avoid them:
  build 36 (writes 8 zero bytes where its reader consumes 10), a connector node
  that shares a parent with a plain sibling (connector flags are written in
  child order but the children in reverse), and it discards the root node's own
  fields on read. Our parser follows the reader.
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
- IK, pose operators, clips, studio overlays and rig
  constraints are separate follow-ups (epic #61).
