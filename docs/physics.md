# Physics

Phase-6 adoption (manim-physics-inspired). Analytic fields/waves are
dependency-free; rigid-body uses a built-in engine by default (pluggable).

## Electromagnetic fields (analytic)

```js
import { ElectricField, MagneticField } from "manim-js";
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
import { LinearWave, StandingWave } from "manim-js";
scene.add(new LinearWave({ amplitude: 1, wavelength: 3, frequency: 1 }));   // y = A·sin(kx − ωt)
scene.add(new StandingWave({ amplitude: 1, wavelength: 4 }));               // y = A·sin(kx)·cos(ωt)
```

The wave advances automatically (an updater increments its time). `setTime(t)`
sets it explicitly.

## Rigid-body

```js
import { physics, Pendulum } from "manim-js";
const engine = physics(scene, { gravity: [0, -9.8, 0], floor: -3, restitution: 0.6 });
engine.addBody(ball, { velocity: [1, 0, 0] });   // falls + bounces off the floor
scene.add(new Pendulum({ length: 2, initialAngle: 0.9 })); // ODE-integrated each frame
```

The default `SimpleEngine` (semi-implicit Euler + gravity + floor collision) is
dependency-free and stepped per frame. For heavy collision/constraints the engine
is **pluggable** (same `step(dt)` contract): use **planck.js** (pure-JS Box2D —
the recommended optional backend, no WASM) or **@dimforge/rapier2d** (WASM) when
cross-machine bit-exact determinism matters. `Pendulum` integrates
`θ'' = −(g/L)·sinθ` directly (no engine needed).
