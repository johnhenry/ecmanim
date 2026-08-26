---
title: "Physics"
description: "Analytic electric and magnetic fields, linear and standing waves, a built-in rigid-body engine with Pendulum, and optional Rapier2D/Rapier3D integrations."
---

Phase-6 adoption (manim-physics-inspired). Analytic fields/waves are
dependency-free; rigid-body uses a built-in engine by default (pluggable).

## Electromagnetic fields (analytic)

```js
import { ElectricField, MagneticField } from "@johnhenry/ecmanim";
scene.add(new ElectricField([
  { position: [-2, 0, 0], magnitude: 1 },   // + charge
  { position: [2, 0, 0], magnitude: -1 },    // − charge
]));
scene.add(new MagneticField([{ position: [0, 0, 0], magnitude: 1 }])); // out-of-plane current
```

`electricFieldFunc(charges)` / `magneticFieldFunc(currents)` return the raw
field functions (Coulomb; `B = I·(ẑ×r)/|r|²`) for use anywhere a `(p) → vector`
is wanted.

## Waves

```js
import { LinearWave, StandingWave } from "@johnhenry/ecmanim";
scene.add(new LinearWave({ amplitude: 1, wavelength: 3, frequency: 1 }));   // y = A·sin(kx − ωt)
scene.add(new StandingWave({ amplitude: 1, wavelength: 4 }));               // y = A·sin(kx)·cos(ωt)
```

The wave advances automatically (an updater increments its time). `setTime(t)`
sets it explicitly.

## Rigid-body

```js
import { physics, Pendulum } from "@johnhenry/ecmanim";
const engine = physics(scene, { gravity: [0, -9.8, 0], floor: -3, restitution: 0.6 });
engine.addBody(ball, { velocity: [1, 0, 0] });   // falls + bounces off the floor
scene.add(new Pendulum({ length: 2, initialAngle: 0.9 })); // ODE-integrated each frame
```

The default `SimpleEngine` (semi-implicit Euler + gravity + floor collision) is
dependency-free and stepped per frame. `Pendulum` integrates
`θ'' = −(g/L)·sinθ` directly (no engine needed).

**SimpleEngine limitations — know what you're getting:**
- Rotation is **kinematic only**: `addBody(mob, { angularVelocity: 2 })` spins a
  body at a constant rate about its center, but collisions never impart or
  change spin (no friction impulses, no moment of inertia).
- The **only collision is the floor plane** (with restitution). There is no
  body–body collision, no walls, no arbitrary shapes, no constraints/joints.
- Integration is plain semi-implicit Euler — fine for demos, not for stacked
  or resting-contact scenes (objects will jitter or sink).

For anything beyond "things fall and bounce", ecmanim ships two real engines
built on [Rapier](https://rapier.rs) — a 2D and a 3D backend — both implementing
the same `PhysicsEngineLike` (`step(dt)`) contract, so they drop into a scene the
same way `physics()` does. They're **optional dependencies** imported from
subpaths, so the core bundle never pays for the WASM. (You can still implement
`PhysicsEngineLike` around any other engine, e.g. planck.js, yourself.)

## 2D rigid-body (Rapier2D)

```bash
npm i @dimforge/rapier2d-compat
```

```js
import { rapier2d } from "@johnhenry/ecmanim/physics/rapier2d";
const engine = await rapier2d(scene, { gravity: [0, -9.8, 0], floor: -3 });
engine.addBody(box, { velocity: [1, 0, 0], angularVelocity: 2 });
```

Unlike `SimpleEngine`, boxes actually **stack and collide** with one another (and
with walls) — real contacts, not just a floor plane. 2D lives in ecmanim's
`z = 0` plane; a body's rotation is a scalar angle about Z (matching
`SimpleEngine`'s `angularVelocity`).

## 3D rigid-body (Rapier3D)

```bash
npm i @dimforge/rapier3d-compat
```

```js
import { rapier3d } from "@johnhenry/ecmanim/physics/rapier3d";
const engine = await rapier3d(scene, { gravity: [0, -9.8, 0], floor: -3 });
engine.addBody(cube, { velocity: [1, 0, 0], angularVelocity: [0, 2, 0] });
```

Genuine 3D rigid-body dynamics — full orientation (bodies **tumble**, not just
spin about one axis), body↔body collision, friction, and arbitrary colliders.
`addBody` infers a collider from the mobject's bounding box (round types → ball,
else cuboid); override with `{ shape: "ball" | "cuboid" | "capsule", radius,
halfExtents }`.

**Notes for both adapters:**
- The factory is **async** (Rapier initializes its WASM once) — `await
  rapier3d(...)` before adding bodies. `step(dt)` itself is sync, so per-frame
  stepping via the attached carrier is unchanged.
- Engine options: `gravity`, `floor` (a wide fixed slab whose top sits at that
  `y`), `restitution`, `friction`. Per-body: `velocity`, `angularVelocity`,
  `mass`, `density`, `restitution`, `friction`, `static`, `shape`.
- These use the `@dimforge/rapier*-compat` builds (WASM inlined), so they load in
  Node and the browser without bundler plumbing. A browser live-demo is a
  follow-up (the current browser example copies only `dist/`).
