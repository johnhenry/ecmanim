// Deterministic Craig Reynolds flocking simulation (separation/alignment/
// cohesion boids), ported from the classic p5.js boids sketch
// (examples/p5-parity/ref/03-flocking-boids.js, p5.js gallery, LGPL).
//
// Like layout/force.ts's ForceSimulation, this is a pure-math, render-agnostic
// simulation that lives in src/layout/ (not src/mobject/) -- it has no
// renderer, Mobject, or node:* imports. A thin Mobject wrapper (BoidsFlock)
// lives in src/mobject/boids.ts and drives visuals from this class's state.
// This mirrors the codebase's existing split between "simulation math"
// (src/layout/, pure/stateful but render-agnostic) and "mobject" (src/mobject/,
// IS the renderable thing) -- see force.ts vs. any Mobject that wires a
// ForceSimulation in.
//
// DETERMINISM CONTRACT (matches ForceSimulation's "BYTE-DETERMINISTIC" precedent
// documented at the top of force.ts):
// - All randomness (initial positions/velocities) is drawn from a seeded
//   mulberry32(seed) PRNG (src/core/noise.ts) -- never Math.random(), never
//   Date.now(), never anything wall-clock-derived.
// - step(dt) advances the simulation exactly ONE fixed step. Calling step(dt)
//   N times in a row from a freshly-constructed BoidsSimulation with the same
//   seed ALWAYS produces the exact same sequence of boid states (positions +
//   velocities), regardless of when/how often step() is invoked in real time.
// - In other words: deterministic via fixed dt + seed, not closed-form. Unlike
//   ParticleSystem (a closed-form function of (seed, index, time), sampleable
//   at any t in any order), BoidsSimulation is a genuine mutable simulation --
//   like ForceSimulation, reaching step N requires replaying steps 0..N-1
//   from a fresh instance (or restoring/cloning prior state). Scenes that use
//   this must step it forward monotonically as scene time advances; the
//   partial-movie render cache then works exactly as it does for
//   ForceSimulation-backed scenes: re-rendering the same scene at the same
//   time replays the identical step sequence and produces byte-identical
//   output. A repeat-render / cache-compat test lives in test/boids.test.ts.
//
// DOCUMENTED DIVERGENCES FROM THE REFERENCE SKETCH:
// - The reference accumulates each of the three steering forces already
//   clamped to maxForce, sums the (weighted) forces into ONE unclamped
//   acceleration, then clamps only the resulting VELOCITY to maxSpeed. We
//   match this exactly -- each of separation/alignment/cohesion is
//   independently clamped to maxForce, and the weighted sum is NOT re-clamped
//   -- rather than a more generic "clamp the summed force to maxForce" reading,
//   which would make combined maneuvers (e.g. separating while also turning to
//   align) weaker than the classic Reynolds/p5 behavior.
// - Edge handling: the reference wraps (toroidal) a boid's position when it
//   exits the canvas bounds (see `borders()` in the reference). We do the
//   same, wrapping at +-bounds.width/2 and +-bounds.height/2 around the
//   origin -- this codebase's world frame is centered at [0,0,0], not
//   top-left like a canvas, so the wrap planes are centered rather than [0,w].
// - The reference re-seeds each boid's initial velocity via `random(-1, 1)`
//   on each axis independently (not a random heading + fixed speed); we match
//   that exactly via the same seeded PRNG draws.

import { mulberry32 } from "../core/noise.ts";
import { add, sub, scale, normalize, length } from "../core/math/vector.ts";
import type { Vec3 } from "../core/types.ts";

export interface BoidsConfig {
  /** Number of boids. Default 30. */
  count?: number;
  /** PRNG seed for initial positions/velocities. Default 1. Same seed -> byte-identical simulation runs. */
  seed?: number;
  /** World bounds boids wrap around, centered at the origin. Default {width: 14, height: 8} (matches the default world frame). */
  bounds?: { width: number; height: number };
  /** Radius within which alignment/cohesion neighbors are considered. Default 2. */
  perceptionRadius?: number;
  /** Radius within which separation pushes boids apart. Default 1. */
  separationRadius?: number;
  /** Maximum boid speed, world units/s. Default 4. */
  maxSpeed?: number;
  /** Maximum steering force per behavior, world units/s^2. Default 0.3. */
  maxForce?: number;
  /** Per-behavior weights. Defaults match the classic reference: separation 1.5, alignment 1.0, cohesion 1.0. */
  weights?: { separation?: number; alignment?: number; cohesion?: number };
}

/** One boid's simulation state. */
export interface BoidState {
  position: Vec3;
  velocity: Vec3;
}

function limitMagnitude(v: Vec3, max: number): Vec3 {
  const len = length(v);
  return len > max && len > 0 ? scale(v, max / len) : v;
}

/**
 * Reynolds steering: turn `desired` into a unit vector scaled to maxSpeed,
 * subtract the current velocity, and clamp the result to maxForce. Returns
 * the zero vector if `desired` has no direction (mirrors the reference's
 * `if (steer.mag() > 0)` / `if (count > 0)` guards).
 */
function steer(desired: Vec3, velocity: Vec3, maxSpeed: number, maxForce: number): Vec3 {
  if (length(desired) === 0) return [0, 0, 0];
  const target = scale(normalize(desired), maxSpeed);
  return limitMagnitude(sub(target, velocity), maxForce);
}

export class BoidsSimulation {
  private _boids: BoidState[];
  readonly count: number;
  readonly bounds: { width: number; height: number };
  readonly perceptionRadius: number;
  readonly separationRadius: number;
  readonly maxSpeed: number;
  readonly maxForce: number;
  readonly weights: { separation: number; alignment: number; cohesion: number };

  constructor(config: BoidsConfig = {}) {
    this.count = config.count ?? 30;
    this.bounds = config.bounds ?? { width: 14, height: 8 };
    this.perceptionRadius = config.perceptionRadius ?? 2;
    this.separationRadius = config.separationRadius ?? 1;
    this.maxSpeed = config.maxSpeed ?? 4;
    this.maxForce = config.maxForce ?? 0.3;
    this.weights = {
      separation: config.weights?.separation ?? 1.5,
      alignment: config.weights?.alignment ?? 1.0,
      cohesion: config.weights?.cohesion ?? 1.0,
    };

    // FIXED draw order per boid (position x, position y, velocity x, velocity
    // y) -- inserting/reordering a draw here would re-randomize every scene
    // built on top of a given seed.
    const random = mulberry32(config.seed ?? 1);
    const hw = this.bounds.width / 2;
    const hh = this.bounds.height / 2;
    this._boids = [];
    for (let i = 0; i < this.count; i++) {
      const x = (random() * 2 - 1) * hw;
      const y = (random() * 2 - 1) * hh;
      const vx = random() * 2 - 1;
      const vy = random() * 2 - 1;
      this._boids.push({ position: [x, y, 0], velocity: [vx, vy, 0] });
    }
  }

  /**
   * Advance the simulation exactly one fixed step. See the module-level
   * determinism contract: no randomness or wall-clock reads happen here, so
   * the same sequence of step(dt) calls from the same seed always reproduces
   * the same states.
   */
  step(dt: number): void {
    const n = this._boids.length;
    const accelerations: Vec3[] = new Array(n);

    for (let i = 0; i < n; i++) {
      const boid = this._boids[i];
      let sepSum: Vec3 = [0, 0, 0];
      let sepCount = 0;
      let aliSum: Vec3 = [0, 0, 0];
      let aliCount = 0;
      let cohSum: Vec3 = [0, 0, 0];
      let cohCount = 0;

      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const other = this._boids[j];
        const diff = sub(boid.position, other.position);
        const d = length(diff);

        if (d > 0 && d < this.separationRadius) {
          // Weighted by inverse distance, like the reference's diff.div(d).
          sepSum = add(sepSum, scale(normalize(diff), 1 / d));
          sepCount++;
        }
        if (d > 0 && d < this.perceptionRadius) {
          aliSum = add(aliSum, other.velocity);
          aliCount++;
          cohSum = add(cohSum, other.position);
          cohCount++;
        }
      }

      const separation = sepCount > 0
        ? steer(sepSum, boid.velocity, this.maxSpeed, this.maxForce)
        : ([0, 0, 0] as Vec3);
      const alignment = aliCount > 0
        ? steer(aliSum, boid.velocity, this.maxSpeed, this.maxForce)
        : ([0, 0, 0] as Vec3);
      const cohesion = cohCount > 0
        ? steer(sub(scale(cohSum, 1 / cohCount), boid.position), boid.velocity, this.maxSpeed, this.maxForce)
        : ([0, 0, 0] as Vec3);

      accelerations[i] = add(
        add(scale(separation, this.weights.separation), scale(alignment, this.weights.alignment)),
        scale(cohesion, this.weights.cohesion),
      );
    }

    const hw = this.bounds.width / 2;
    const hh = this.bounds.height / 2;
    for (let i = 0; i < n; i++) {
      const boid = this._boids[i];
      const velocity = limitMagnitude(add(boid.velocity, scale(accelerations[i], dt)), this.maxSpeed);
      let position = add(boid.position, scale(velocity, dt));

      // Toroidal wrap at the world bounds (matches the reference's borders()).
      if (position[0] < -hw) position = [hw, position[1], position[2]];
      else if (position[0] > hw) position = [-hw, position[1], position[2]];
      if (position[1] < -hh) position = [position[0], hh, position[2]];
      else if (position[1] > hh) position = [position[0], -hh, position[2]];

      boid.velocity = velocity;
      boid.position = position;
    }
  }

  /** Current boid positions, one [x, y, z] per boid, in construction order. */
  positions(): Vec3[] {
    return this._boids.map((b) => [b.position[0], b.position[1], b.position[2]] as Vec3);
  }

  /** Current boid velocities, one [x, y, z] per boid, in construction order. */
  velocities(): Vec3[] {
    return this._boids.map((b) => [b.velocity[0], b.velocity[1], b.velocity[2]] as Vec3);
  }

  /** Current heading angle (radians, atan2(vy, vx)) per boid. */
  headings(): number[] {
    return this._boids.map((b) => Math.atan2(b.velocity[1], b.velocity[0]));
  }
}

/** Create a deterministic boids simulation (functional-style convenience). */
export function boidsSimulation(config: BoidsConfig = {}): BoidsSimulation {
  return new BoidsSimulation(config);
}
