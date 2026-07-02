// Rigid-body physics. The DEFAULT is a small dependency-free Euler engine
// (gravity + optional floor collision) that steps mobjects each frame via an
// updater — enough for projectiles, drops, and simple stacks. For heavy
// collision/constraints, swap in a pluggable backend implementing the same
// `step(dt)` contract (planck.js — pure-JS Box2D, recommended default optional
// dep — or @dimforge/rapier2d for cross-machine determinism).
//
// A closed-form Pendulum (ODE integrated per frame) is also provided.

import { Mobject } from "../mobject/Mobject.ts";
import { VGroup } from "../mobject/VMobject.ts";
import { Line, Dot } from "../mobject/geometry.ts";
import * as V from "../core/math/vector.ts";

export interface PhysicsBody {
  mob: any;
  velocity: number[];
  mass: number;
  static?: boolean;
  restitution?: number;
}

export interface PhysicsEngineOptions {
  gravity?: number[];   // default [0, -9.8, 0]
  floor?: number;       // y of a floor plane (bodies bounce off it), or undefined
  restitution?: number; // default bounciness 0.6
}

export interface PhysicsEngineLike { step(dt: number): void; }

/** Dependency-free semi-implicit Euler engine. */
export class SimpleEngine implements PhysicsEngineLike {
  bodies: PhysicsBody[] = [];
  gravity: number[];
  floor?: number;
  restitution: number;

  constructor(opts: PhysicsEngineOptions = {}) {
    this.gravity = opts.gravity ?? [0, -9.8, 0];
    this.floor = opts.floor;
    this.restitution = opts.restitution ?? 0.6;
  }

  addBody(mob: any, opts: Partial<PhysicsBody> = {}): PhysicsBody {
    const body: PhysicsBody = {
      mob,
      velocity: opts.velocity ? opts.velocity.slice() : [0, 0, 0],
      mass: opts.mass ?? 1,
      static: opts.static ?? false,
      restitution: opts.restitution,
    };
    this.bodies.push(body);
    return body;
  }

  step(dt: number): void {
    for (const b of this.bodies) {
      if (b.static) continue;
      // Semi-implicit Euler: integrate velocity then position.
      b.velocity = V.add(b.velocity, V.scale(this.gravity, dt));
      const delta = V.scale(b.velocity, dt);
      b.mob.shift(delta);
      // Floor collision (approximate: use the body's lowest point).
      if (this.floor != null) {
        let bottom = b.mob.getCenter()[1];
        try { bottom = b.mob.getBoundaryPoint([0, -1, 0])[1]; } catch { /* fallback to center */ }
        if (bottom < this.floor) {
          b.mob.shift([0, this.floor - bottom, 0]);
          const rest = b.restitution ?? this.restitution;
          if (b.velocity[1] < 0) b.velocity[1] = -b.velocity[1] * rest;
          if (Math.abs(b.velocity[1]) < 0.05) b.velocity[1] = 0;
        }
      }
    }
  }

  /** Attach this engine to a scene: adds an invisible carrier that steps it each frame. */
  attach(scene: any): this {
    const carrier = new Mobject();
    carrier.addUpdater((_m: any, dt: number) => this.step(dt));
    scene.add(carrier);
    return this;
  }
}

/** Create a SimpleEngine, attach it to the scene, and return it. */
export function physics(scene: any, opts: PhysicsEngineOptions = {}): SimpleEngine {
  return new SimpleEngine(opts).attach(scene);
}

export interface PendulumConfig {
  length?: number;
  initialAngle?: number;  // radians from vertical (default 0.5)
  gravity?: number;       // default 9.8
  pivot?: number[];
  color?: string;
  bobRadius?: number;
}

/** A simple pendulum whose angle is integrated (θ'' = −(g/L)·sinθ) each frame. */
export class Pendulum extends VGroup {
  theta: number;
  omega = 0;
  length: number;
  g: number;
  pivot: number[];
  private rod: any;
  private bob: any;

  constructor(config: PendulumConfig = {}) {
    super();
    this.length = config.length ?? 2;
    this.theta = config.initialAngle ?? 0.5;
    this.g = config.gravity ?? 9.8;
    this.pivot = config.pivot ?? [0, 2, 0];
    this.rod = new Line(this.pivot, this._bobPos(), { color: config.color ?? "#B0B0B0" });
    this.bob = new Dot({ point: this._bobPos(), radius: config.bobRadius ?? 0.2, color: config.color ?? "#FC6255" });
    this.add(this.rod);
    this.add(this.bob);
    this.addUpdater((_m: any, dt: number) => this._step(dt));
  }

  private _bobPos(): number[] {
    return [this.pivot[0] + this.length * Math.sin(this.theta), this.pivot[1] - this.length * Math.cos(this.theta), 0];
  }

  private _place(): void {
    const p = this._bobPos();
    this.bob.moveTo(p);
    // Rebuild the rod from pivot to bob.
    this.rod.put_start_and_end_on?.(this.pivot, p) ?? this.rod.setPointsAsCorners?.([this.pivot, p]);
  }

  private _step(dt: number): void {
    // Sub-step for stability with large dt.
    const steps = Math.max(1, Math.ceil(dt / 0.01));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const alpha = -(this.g / this.length) * Math.sin(this.theta);
      this.omega += alpha * h;
      this.theta += this.omega * h;
    }
    this._place();
  }

  /** Total mechanical energy (for conservation checks). */
  energy(): number {
    const kinetic = 0.5 * (this.length * this.omega) ** 2;
    const height = -this.length * Math.cos(this.theta);
    return kinetic + this.g * height;
  }
}
