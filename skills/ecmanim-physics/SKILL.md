---
name: ecmanim-physics
description: Author physics visualizations in ecmanim — analytic electromagnetic fields (point charges, current loops), traveling/standing waves, paraxial thin-lens optics, rigid-body simulation (pendulum, gravity/floor drops, pluggable planck.js/@dimforge/rapier2d adapters), and deterministic seeded simulation mobjects (Reynolds boids flocking, Hooke's-law mass-spring soft-body). Use this skill when a scene needs an ElectricField/MagneticField, a LinearWave/StandingWave, ray/lens refraction math, falling/swinging bodies driven by a physics engine rather than hand-authored keyframes, or a flocking/soft-body simulation mobject.
metadata:
  tags: ecmanim, physics, electromagnetism, waves, optics, rigid-body, pendulum, planck.js, rapier, boids, soft-body, simulation
---

# ecmanim-physics

Domain skill for `ecmanim`'s physics module (Phase-6, manim-physics-inspired).
Read `skills/ecmanim/SKILL.md` first for the shared Plan→Code→Render→Verify→
Iterate loop and `checkhealth`-first convention — this skill assumes it and
only adds physics-specific workflow. Full reference: **[docs/physics.md](../../docs/physics.md)**
(read it before asserting any API shape not covered here — this module is
small enough that the doc is authoritative and short).

All physics mobjects are exported from the top-level `ecmanim` package (not a
separate subpath):

```ts
import { ElectricField, MagneticField, LinearWave, StandingWave, physics, Pendulum } from "@johnhenry/ecmanim";
```

## Electromagnetic fields (analytic, dependency-free)

`ElectricField` and `MagneticField` (`src/physics/fields.ts`) are
`ArrowVectorField` subclasses — formula-based, no solver, deterministic every
run:

```ts
scene.add(new ElectricField([
  { position: [-2, 0, 0], magnitude: 1 },   // + charge
  { position: [2, 0, 0], magnitude: -1 },   // − charge
]));
scene.add(new MagneticField([{ position: [0, 0, 0], magnitude: 1 }])); // out-of-plane current
```

- `electricFieldFunc(charges: PointCharge[])` sums scaled Coulomb fields and
  returns a raw `(p: number[]) => number[]` — use it anywhere a field function
  is wanted (e.g. as input to a `StreamLines` or a custom `VectorField`) without
  paying for the `ArrowVectorField` wrapper.
- `magneticFieldFunc(currents: PointCurrent[])` computes `B = I·(ẑ×r)/|r|²` for
  out-of-plane line currents at each `position`.
- Both accept the usual `ArrowVectorFieldConfig` (grid density, arrow length
  scaling, color) as a second constructor argument — same config surface as
  any other `ArrowVectorField`, so lean on the vector-field docs for grid/
  styling knobs rather than re-deriving them here.
- Arrows are auto-normalized for display, so relative `magnitude` values (not
  absolute field strength) are what drive visual difference between charges.

### Optics: thin-lens refraction

There is **no `Lens` or `Ray` mobject** — optics support is a single paraxial
math helper, `thinLensRefract(hitY, incomingDir, focal)`
(`src/physics/fields.ts`), which returns the outgoing ray direction after a
thin lens at the given hit height. Compose ray diagrams yourself: trace a
`Line` from source to the lens plane, call `thinLensRefract` at the
intersection height, then draw a second `Line` in the returned direction.
Converging lens ⇒ `focal > 0`.

## Waves

`LinearWave` and `StandingWave` (`src/physics/waves.ts`) are `VMobject`
polylines built from a shared `WaveCurve` base and rebuilt every frame via an
`addUpdater`:

```ts
scene.add(new LinearWave({ amplitude: 1, wavelength: 3, frequency: 1 }));   // y = A·sin(kx − ωt + φ)
scene.add(new StandingWave({ amplitude: 1, wavelength: 4 }));               // y = A·sin(kx + φ)·cos(ωt)
```

- Time advances automatically once the wave is added to a running scene (the
  updater does `this.time += dt`); call `setTime(t)` to jump to an exact time
  (e.g. for `renderStill(Scene, { time })` beats or to line up a wave phase
  with a caption).
- `WaveConfig`: `xRange: [min, max, step]` (default `[-5, 5, 0.1]`), `amplitude`,
  `wavelength`, `frequency` (this is the *ordinary* frequency — `ω = 2π·frequency`
  internally, not an angular frequency you pass directly), `phase`, `point`
  (baseline center, default origin), `color`, `strokeWidth`.
- Only linear (traveling) and standing waves exist today — there is no
  built-in radial/circular wave mobject. Build one by subclassing `WaveCurve`
  and implementing `yAt(x, t)` if you need radial falloff (e.g. `A/r·sin(kr − ωt)`
  over a 2D grid instead of a 1D `x` range) — nothing in `waves.ts` special-cases
  the 1D case beyond `_build()`'s single-axis loop, so a genuinely radial wave
  needs its own point-generation logic, not just a new `yAt`.

## Rigid-body simulation

The default engine, `SimpleEngine` (`src/physics/rigid.ts`), is a small
dependency-free semi-implicit-Euler stepper. Create and attach it with
`physics(scene, opts)`:

```ts
const engine = physics(scene, { gravity: [0, -9.8, 0], floor: -3, restitution: 0.6 });
engine.addBody(ball, { velocity: [1, 0, 0] });               // falls + bounces off the floor
engine.addBody(spinner, { angularVelocity: 2, static: false }); // kinematic spin, not collision-coupled
```

`physics()` is sugar for `new SimpleEngine(opts).attach(scene)`, where
`attach()` adds an invisible `Mobject` carrier whose updater calls
`engine.step(dt)` once per rendered frame — so the engine only advances while
its carrier is in the scene graph (removing it, or never `scene.add`-ing it if
you called `new SimpleEngine()` directly instead of `physics()`, freezes the
sim).

`SimpleEngine` limitations, worth knowing before reaching for it on anything
beyond "things fall and bounce":
- **Rotation is kinematic only.** `angularVelocity` spins a body at a constant
  rate; collisions never impart or change spin (no friction impulses, no
  moment of inertia).
- **The only collision is a floor plane** (`floor: y`, with `restitution`).
  No body–body collision, no walls, no arbitrary shapes, no joints/constraints.
- **Plain semi-implicit Euler** — fine for a single dropped/thrown object, not
  for stacking or resting contact (expect jitter or sinking).

### Pendulum

`Pendulum` (`src/physics/rigid.ts`) is a self-contained `VGroup` (rod `Line` +
bob `Dot`) that integrates `θ'' = −(g/L)·sinθ` itself each frame — it does
**not** go through `SimpleEngine`/`physics()`:

```ts
scene.add(new Pendulum({ length: 2, initialAngle: 0.9, gravity: 9.8 }));
```

`PendulumConfig`: `length` (default 2), `initialAngle` (radians from vertical,
default 0.5), `gravity` (default 9.8), `pivot` (default `[0, 2, 0]`), `color`,
`bobRadius`. It sub-steps internally (`dt / 0.01`, min 1 step) for stability
at low frame rates, and exposes `.energy()` (kinetic + potential) — handy for
a debug assertion that the integrator isn't drifting during a long render.

### Pluggable backends: planck.js and @dimforge/rapier2d

Anything beyond `SimpleEngine`'s scope means bringing your own engine behind
the same contract:

```ts
export interface PhysicsEngineLike { step(dt: number): void; }
```

**Neither adapter ships in the box.** `planck.js` (pure-JS Box2D, no WASM —
the recommended default if you need real collision/constraints) and
`@dimforge/rapier2d` (WASM) are both optional dependencies you install and
wrap yourself: write a class implementing `step(dt)` that advances the
underlying engine's world and syncs positions back onto your mobjects, then
hand an instance of it anywhere a `PhysicsEngineLike` is expected (e.g. drive
it from the same carrier-updater pattern `SimpleEngine.attach()` uses, or step
it manually inside your own `Scene.construct()` loop). There is no
`import { PlanckEngine } from "@johnhenry/ecmanim"` — check `docs/physics.md` and
`src/physics/rigid.ts`'s `PhysicsEngineLike`/`PhysicsEngineOptions` types
before assuming otherwise.

## Simulation mobjects: boids + soft-body

Two deterministic, seeded simulations from the p5.js-parity campaign — not
part of `SimpleEngine`/`physics()` above, and driven differently: each is a
self-advancing `Mobject` whose `.step(dt, ...)` you call yourself (typically
from `addUpdater`), not something `physics()`'s carrier-updater auto-attaches.

```ts
import { BoidsFlock, SoftBody } from "@johnhenry/ecmanim";

const flock = new BoidsFlock({ count: 30, seed: 1, boidSize: 0.15 }); // Reynolds separation/alignment/cohesion
scene.add(flock);
flock.addUpdater((_m, dt) => flock.step(dt));

const blob = new SoftBody({ nodeCount: 5, radius: 1.5, springing: 0.12 }); // Hooke's-law spring-chase, closed Spline outline
scene.add(blob);
blob.addUpdater((_m, dt) => blob.step(dt, [Math.sin(scene.time), 0])); // step(dt, target)
```

- **`BoidsFlock`** (`src/mobject/boids.ts`, wrapping `BoidsSimulation` in
  `src/layout/boids.ts`) is a `VGroup` of triangles, one per boid, re-posed
  from the underlying simulation each `step(dt)`. `BoidsConfig`: `count`
  (default 30), `seed` (default 1), `bounds: {width, height}` (default
  matches the default world frame, boids wrap toroidally at the edges),
  `perceptionRadius`/`separationRadius`, `maxSpeed`/`maxForce`, `weights:
  {separation, alignment, cohesion}`.
- **`SoftBody`** (`src/mobject/soft_body.ts`, wrapping `SoftBodySimulation`)
  is a closed `Spline` outline over `nodeCount` nodes (default 5), each
  independently Hooke's-law-chasing the SAME target point you pass to
  `step(dt, target)` — reproduces the classic p5 "jelly blob chases the
  mouse" look with a scripted target instead of live mouse input.
  `SoftBodyConfig`: `nodeCount`, `radius`, `center`, `springing` (default
  0.12), `damping` (default 0.98), `seed`, `initialJitter`.
- **Determinism contract**: both are "deterministic via fixed dt + seed, not
  closed-form" (same category as `ForceSimulation` in the D3-parity layer) —
  given the same seed/config and the exact same sequence of `step(dt, ...)`
  calls, two fresh instances produce byte-identical state at every step.
  Unlike `ParticleSystem` (a closed-form function of time, sampleable at any
  `t` in any order), these are genuine mutable simulations: reaching step N
  means replaying steps 0..N-1 from a fresh instance, so drive them
  monotonically as scene time advances, same as `SimpleEngine`.
- **Cache gotcha**: an updater closure that captures mutable state affecting
  the simulation trajectory (e.g. a moving target you feed into
  `SoftBody.step(dt, target)`, or a config value you vary from outside the
  mobject) is invisible to the partial-movie cache's content hash — it only
  sees the mobject's geometry/paint at `wait()`-time, not what an updater
  will DO during the hold. Tuning such a value between otherwise-identical
  renders can replay a stale cached segment silently. Fix with `addUpdater`'s
  opt-in `hashExtra` config (see `ecmanim-render-cli`'s Caching section):
  ```ts
  let target: [number, number] = [0, 0]; // mutated elsewhere in the scene
  blob.addUpdater((_m, dt) => blob.step(dt, target), {
    hashExtra: () => `${target[0]}:${target[1]}`,
  });
  ```

## Gotchas

- **Determinism differs by backend, and it matters for the render cache.**
  ecmanim's rendering assumes a given scene produces the same frames on
  re-render (that's what makes caching safe). `SimpleEngine` and `Pendulum`
  are plain deterministic math, so they're always safe. A `planck.js` adapter
  is reproducible *on one machine* (same binary, same floating-point
  environment) but is **not guaranteed bit-exact across machines/architectures**
  — fine for local iteration, risky if you render on one box and cache/compare
  frames on another. If you need cross-machine bit-exact frames (e.g. CI
  renders that must match a previously cached render byte-for-byte), that's
  specifically what `@dimforge/rapier2d` is for — its WASM execution is
  designed to be deterministic across platforms. Don't assume planck.js gives
  you that guarantee; it doesn't claim to.
- **These are optional, hand-wired dependencies, not first-class citizens.**
  Neither `planck.js` nor `@dimforge/rapier2d` is bundled, imported, or
  type-checked by ecmanim itself — there's no graceful "falls back to
  SimpleEngine" auto-detection to rely on. If you write code assuming a
  richer engine is present, it will fail hard (missing module), not degrade
  quietly the way `checkhealth`-covered tools (ffmpeg, canvas, TTS) do. Treat
  bringing in a real physics engine as an explicit user decision, not a
  default you reach for.
- **No `Lens`/`Ray` mobjects.** Optics is exactly the `thinLensRefract` math
  helper — don't invent a `new Lens(...)` API; compose ray paths from `Line`s
  yourself.
- **No radial/circular wave mobject exists** — only `LinearWave` and
  `StandingWave`. If a plan calls for ripples from a point source, that's a
  `WaveCurve` subclass you write, not a built-in.
- **`SimpleEngine` collision is floor-only.** Don't plan a scene around boxes
  stacking or bodies colliding with each other on the default engine — that
  needs a planck.js/rapier adapter.
