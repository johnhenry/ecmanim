// Mobject wrapper around BoidsSimulation (src/layout/boids.ts): a VGroup of
// small Triangles, one per boid, positioned/rotated from the simulation's
// current state. Advancing the flock steps the underlying simulation AND
// re-poses the visuals together, so BoidsFlock is addressable/updater-
// friendly like any other Mobject (compare ParticleSystem, which instead
// wraps a closed-form emitter -- BoidsFlock wraps a genuine stateful sim).
//
// Orientation: Triangle's default orientation (src/mobject/geometry.ts) points
// a vertex toward +Y ("up", angle PI/2 in atan2 terms). Each boid's triangle
// is rotated so it points along its current heading (atan2(vy, vx)) instead.
// This is the same visual intent as the reference sketch's
// `theta = velocity.heading() + radians(90); rotate(theta)`, adapted to this
// engine's Y-up world (the reference's p5 canvas is Y-down, hence its +90deg
// rather than -90deg offset) -- both conventions make the shape's tip track
// the direction of travel.
//
// Rotation is applied incrementally via Mobject#rotate (there is no absolute
// "setRotation" on Mobject), tracking each boid's previous heading and
// rotating by the shortest-path delta each step -- this avoids a visual
// full-turn glitch when a boid's heading crosses the atan2 branch cut at
// +-PI, without affecting the underlying simulation state (positions/
// velocities), which is exact regardless.

import { VGroup } from "./VMobject.ts";
import { Triangle } from "./geometry.ts";
import { BoidsSimulation } from "../layout/boids.ts";
import type { BoidsConfig } from "../layout/boids.ts";

export interface BoidsFlockConfig extends BoidsConfig {
  /** Triangle circumradius per boid (visual size, independent of simulation radii). Default 0.15. */
  boidSize?: number;
  /** Fill color for each boid triangle. Default "#FFFFFF". */
  color?: string;
}

/** Wraps the shortest-path angle difference into (-PI, PI]. */
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class BoidsFlock extends VGroup {
  /** The underlying deterministic simulation -- see its determinism contract in src/layout/boids.ts. */
  readonly simulation: BoidsSimulation;
  // Raw (unwrapped) heading last applied per boid, seeded at Triangle's
  // default "points up" orientation (PI/2) so the very first sync rotates
  // each triangle from its default pose to the boid's initial heading.
  private _prevHeadings: number[];

  constructor(config: BoidsFlockConfig = {}) {
    const sim = new BoidsSimulation(config);
    const size = config.boidSize ?? 0.15;
    const color = config.color ?? "#FFFFFF";
    const triangles = sim.positions().map((p) =>
      new Triangle({ radius: size, fillColor: color, fillOpacity: 1 }).moveTo(p),
    );
    super(...triangles);
    this.simulation = sim;
    this._prevHeadings = new Array(sim.count).fill(Math.PI / 2);
    this._syncOrientations();
  }

  private _syncOrientations(): void {
    const headings = this.simulation.headings();
    for (let i = 0; i < this.submobjects.length; i++) {
      const delta = wrapAngle(headings[i] - this._prevHeadings[i]);
      if (delta !== 0) this.submobjects[i].rotate(delta);
      this._prevHeadings[i] = headings[i];
    }
  }

  /** Advance the simulation one fixed step and re-pose the visuals to match. */
  step(dt: number): void {
    this.simulation.step(dt);
    const positions = this.simulation.positions();
    for (let i = 0; i < this.submobjects.length; i++) {
      this.submobjects[i].moveTo(positions[i]);
    }
    this._syncOrientations();
  }
}
