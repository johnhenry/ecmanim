// p5.js parity demo 03: ref/03-flocking-boids.js — Craig Reynolds flocking
// (separation/alignment/cohesion) on a toroidal (wraparound) 2D field
// (p5.js gallery, LGPL). The ref seeds 100 boids at the canvas center with
// random initial velocities and lets mouse-drag spawn more; reproduced here
// with a fixed, seeded population spread across the world bounds (no mouse
// input in a headless render) via BoidsFlock's seeded mulberry32 init.
// Proves BoidsFlock (src/mobject/boids.ts, this campaign's gap-fill) driving
// BoidsSimulation (src/layout/boids.ts): deterministic seeded init (never
// Math.random()), weighted steering forces (separation/alignment/cohesion),
// toroidal wrap at the world bounds, and per-boid triangle orientation
// tracking each boid's heading.

import { Scene, BoidsFlock } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

class FlockingBoids extends Scene {
  async construct() {
    const flock = new BoidsFlock({
      count: 60,
      seed: 3,
      bounds: { width: 14, height: 8 },
      perceptionRadius: 3.5,
      separationRadius: 0.6,
      maxSpeed: 4,
      maxForce: 0.3,
      boidSize: 0.15,
      color: "#4ade80",
    });
    this.add(flock);

    // Fixed-step-simulation pattern (matches 06-game-of-life.ts): advance the
    // deterministic sim by exactly the frame's dt each updater tick, so the
    // flock visibly organizes (clusters via cohesion/alignment, spreads via
    // separation) over the demo's duration.
    flock.addUpdater((_m: any, dt: number) => {
      flock.step(dt);
    });

    await this.wait(6);
  }
}

await demoRender(FlockingBoids, import.meta.url);
