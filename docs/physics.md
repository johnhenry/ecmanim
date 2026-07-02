# Physics

Phase-6 adoption (manim-physics-inspired). Analytic fields/waves are
dependency-free; rigid-body uses a built-in engine by default (pluggable).

## Electromagnetic fields (analytic)

```js
import { ElectricField, MagneticField } from "ecmanim";
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
import { LinearWave, StandingWave } from "ecmanim";
scene.add(new LinearWave({ amplitude: 1, wavelength: 3, frequency: 1 }));   // y = A·sin(kx − ωt)
scene.add(new StandingWave({ amplitude: 1, wavelength: 4 }));               // y = A·sin(kx)·cos(ωt)
```

The wave advances automatically (an updater increments its time). `setTime(t)`
sets it explicitly.

## Rigid-body

```js
import { physics, Pendulum } from "ecmanim";
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

For anything beyond "things fall and bounce", bring a real engine — the
interface is **pluggable** (same `step(dt)` contract): **planck.js** (pure-JS
Box2D — recommended, no WASM) or **@dimforge/rapier2d** (WASM) when cross-machine
bit-exact determinism matters. Note that neither adapter ships in the box yet;
you implement `PhysicsEngineLike` around the engine of your choice.
