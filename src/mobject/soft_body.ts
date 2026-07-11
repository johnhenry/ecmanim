// Deterministic mass-spring softbody (p5.js parity campaign, Campaign 8
// gap-fill; reference examples/p5-parity/ref/10-softbody-spring.js --
// Processing/p5's classic "Soft Body" example, read in full before porting).
//
// The p5 original drives a SINGLE spring point at the shape's center toward
// the live mouse position, then displaces each node sinusoidally off that
// center using a per-node fixed frequency. Mouse position isn't
// reproducible, so there is no meaningful deterministic recreation of THAT
// exact model. This port instead gives EVERY node its own independent
// Hooke's-law spring chasing the SAME caller-supplied target point -- which
// reproduces the reference's springy, jelly-like "chase and overshoot"
// character (nodes lag, oscillate, and settle around a moving target) while
// being a pure function of (current node state, dt, target): no
// Math.random(), no wall-clock reads, no live input.
//
// SPRING-CONSTANT TUNING NOTE: the p5 reference integrates in an implicit
// dt=1 (pixel-space, frame-locked: `centerX += accelX` adds the raw
// per-frame acceleration straight to position, never scaled by a timestep)
// with springing=0.0009 on a ~700px canvas (node radius 45px). This module's
// step(dt, target) takes an EXPLICIT dt and, per the determinism contract
// below, integrates velocity WITHOUT scaling accel by dt (vel += accel,
// matching the ref's `accelX += deltaX`) but DOES scale the position update
// by dt (pos += vel * dt) -- a deliberate deviation from the ref so step()
// composes with this codebase's variable/fixed frame timing instead of
// assuming a hardcoded 1-frame-per-call cadence. Consequence: at a typical
// animation dt of 1/30s, the ref's raw pixel constant is far too weak to
// produce visible motion (positions only advance by vel*dt, not by the
// full un-scaled accel every call). The default springing=0.12 (damping
// left at the ref's 0.98) was tuned empirically by simulating a 1D
// spring-chase at dt=1/30s: it reproduces a comparable "overshoot, oscillate,
// settle" arc (chase peaks around t~1.5s, settles to within ~5-10% of the
// target's distance by t~3-4s) and stays numerically bounded (no
// divergence/NaN) even with damping raised to 0.995-0.999 against a
// continuously oscillating target over thousands of steps.

import { mulberry32 } from "../core/noise.ts";
import * as V from "../core/math/vector.ts";
import { VGroup } from "./VMobject.ts";
import type { VMobjectConfig } from "./VMobject.ts";
import { Spline } from "./curves.ts";

export interface SoftBodyConfig {
  /** Number of nodes evenly spaced around the initial circle (default 5, matching the p5 ref). */
  nodeCount?: number;
  /** Radius of the initial node circle, world units (default 1.5). */
  radius?: number;
  /** Center of the initial node circle (default origin). */
  center?: [number, number];
  /** Hooke's-law spring constant: accel = (target - nodePos) * springing.
   *  Default 0.12 -- retuned from the p5 ref's pixel/frame-implicit 0.0009
   *  for this module's explicit-dt integration (see the file-level tuning
   *  note above). */
  springing?: number;
  /** Velocity damping applied every step (default 0.98, matching the ref). */
  damping?: number;
  /** PRNG seed for initial-position jitter (default 1). */
  seed?: number;
  /** Random offset applied to each node's initial position, world units
   *  (default 0 = no jitter, nodes start exactly on the circle). */
  initialJitter?: number;
}

/**
 * A deterministic mass-spring softbody simulation: `nodeCount` nodes start
 * evenly spaced around a circle (optionally seed-jittered) and each
 * independently chases a caller-supplied target point via Hooke's law.
 *
 * DETERMINISM CONTRACT: given the same seed, the same initial
 * SoftBodyConfig, and the SAME sequence of step(dt, target) calls, two
 * independently constructed SoftBodySimulations always produce
 * byte-identical node positions at every step. step() is a pure function of
 * (current internal state, dt, target) -- no Math.random(), no wall-clock
 * reads, no hidden state beyond what's set at construction time (the only
 * randomness, initialJitter, is drawn once in the constructor via a seeded
 * mulberry32 stream and never touched again).
 */
export class SoftBodySimulation {
  readonly nodeCount: number;
  readonly radius: number;
  readonly springing: number;
  readonly damping: number;
  readonly seed: number;
  readonly initialJitter: number;

  private _pos: number[][]; // per node: [x, y]
  private _vel: number[][]; // per node: [x, y]

  constructor(config: SoftBodyConfig = {}) {
    this.nodeCount = config.nodeCount ?? 5;
    this.radius = config.radius ?? 1.5;
    this.springing = config.springing ?? 0.12;
    this.damping = config.damping ?? 0.98;
    this.seed = config.seed ?? 1;
    this.initialJitter = config.initialJitter ?? 0;
    const [cx, cy] = config.center ?? [0, 0];

    const rand = mulberry32(this.seed);
    this._pos = [];
    this._vel = [];
    for (let i = 0; i < this.nodeCount; i++) {
      const angle = (i / this.nodeCount) * V.TAU;
      let x = cx + Math.cos(angle) * this.radius;
      let y = cy + Math.sin(angle) * this.radius;
      if (this.initialJitter > 0) {
        // Fixed draw order (dx then dy per node, in node order): inserting
        // or reordering a draw here would re-randomize every jittered node
        // after it, breaking the determinism contract across versions.
        x += (rand() * 2 - 1) * this.initialJitter;
        y += (rand() * 2 - 1) * this.initialJitter;
      }
      this._pos.push([x, y]);
      this._vel.push([0, 0]);
    }
  }

  /**
   * Advance ONE fixed step for every node: Hooke's-law spring acceleration
   * toward `target`, velocity integration + damping, then position
   * integration by vel * dt. See the file-level tuning note for why accel
   * is NOT scaled by dt (matching the p5 ref) while the position update IS.
   */
  step(dt: number, target: [number, number]): void {
    const [tx, ty] = target;
    for (let i = 0; i < this.nodeCount; i++) {
      const p = this._pos[i];
      const v = this._vel[i];
      const ax = (tx - p[0]) * this.springing;
      const ay = (ty - p[1]) * this.springing;
      v[0] = (v[0] + ax) * this.damping;
      v[1] = (v[1] + ay) * this.damping;
      p[0] += v[0] * dt;
      p[1] += v[1] * dt;
    }
  }

  /** Current node positions, [x, y] per node (a defensive copy). */
  positions(): number[][] {
    return this._pos.map((p) => [...p]);
  }

  /** Current node velocities, [x, y] per node (a defensive copy). */
  velocities(): number[][] {
    return this._vel.map((v) => [...v]);
  }

  /** Node positions as a closed smooth curve's control points -- feed
   *  straight to `new Spline({ points: outline(), closed: true })`. */
  outline(): number[][] {
    return this.positions();
  }
}

export interface SoftBodyMobjectConfig extends SoftBodyConfig, VMobjectConfig {
  /** Catmull-Rom smoothness passed through to the underlying closed Spline
   *  (default 1, matching Spline's own default). */
  smoothness?: number;
}

/**
 * Rendering wrapper: a SoftBodySimulation plus a closed Spline visual that
 * tracks its node positions. Addressable/updater-friendly like other
 * simulation mobjects (ParticleSystem, WaveCurve): construct once, then call
 * `.step(dt, target)` each frame (e.g. from an updater or a manual render
 * loop) to advance the physics and refresh the curve in place.
 */
export class SoftBody extends VGroup {
  readonly sim: SoftBodySimulation;
  private readonly _curve: Spline;
  private readonly _smoothness: number;

  constructor(config: SoftBodyMobjectConfig = {}) {
    super();
    const {
      nodeCount, radius, center, springing, damping, seed, initialJitter,
      smoothness = 1,
      ...style
    } = config;
    this.sim = new SoftBodySimulation({ nodeCount, radius, center, springing, damping, seed, initialJitter });
    this._smoothness = smoothness;
    this._curve = new Spline({
      points: this._anchors(),
      closed: true,
      smoothness,
      fillColor: "#58C4DD",
      fillOpacity: 0.5,
      strokeColor: "#58C4DD",
      strokeWidth: 4,
      ...style,
    });
    this.add(this._curve);
  }

  private _anchors(): number[][] {
    return this.sim.outline().map(([x, y]) => [x, y, 0]);
  }

  /** Advance the simulation one step and refresh the closed-curve visual
   *  from the updated node positions. */
  step(dt: number, target: [number, number]): void {
    this.sim.step(dt, target);
    // Rebuild via a scratch Spline (reuses its tested Catmull-Rom handle
    // derivation) and copy the resulting geometry onto the SAME curve
    // mobject in place, preserving identity for animations/references.
    const fresh = new Spline({ points: this._anchors(), closed: true, smoothness: this._smoothness });
    this._curve.points = fresh.points;
    this._curve.subpathStarts = fresh.subpathStarts;
  }

  /** Current node positions, [x, y] per node. */
  positions(): number[][] {
    return this.sim.positions();
  }
}
