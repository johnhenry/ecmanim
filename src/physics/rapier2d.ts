// Real 2D rigid-body physics backed by @dimforge/rapier2d-compat (an optional
// dependency). Implements the same `PhysicsEngineLike { step(dt) }` contract as
// SimpleEngine, so it drops into a scene the same way — but with genuine
// body↔body collision (stacking, walls), arbitrary colliders, and friction.
//
//   import { rapier2d } from "ecmanim/physics/rapier2d";
//   const engine = await rapier2d(scene, { gravity: [0, -9.8, 0], floor: -3 });
//   engine.addBody(box, { velocity: [1, 0, 0], angularVelocity: 2 });
//
// 2D lives in ecmanim's z = 0 plane: translations map {x, y} → [x, y, 0], and a
// body's rotation is a scalar angle about Z — exactly SimpleEngine's convention,
// so no quaternions are involved. Construction is async (WASM init); `step(dt)`
// is sync.

import * as V from "../core/math/vector.ts";
import type { PhysicsEngineLike } from "./rigid.ts";
import { type RapierBodyOptions, inferShape, attachStepper, warnNonFiniteRapierOutput } from "./rapier-common.ts";

export interface Rapier2DEngineOptions {
  gravity?: number[];   // default [0, -9.8, 0]; only x, y are used
  floor?: number;       // y of a floor; a wide fixed slab is built with its top at this y
  restitution?: number; // default collider bounciness 0.3
  friction?: number;    // default collider friction 0.5
  /** Inject an already-imported RAPIER module (tests / custom builds). */
  rapier?: any;
}

export interface Rapier2DBody {
  mob: any;
  /** The Rapier RigidBody. */
  rb: any;
  static: boolean;
  lastPos: number[];
  /** Last orientation angle (radians about Z). */
  lastAngle: number;
}

async function loadRapier(opts: Rapier2DEngineOptions): Promise<any> {
  return opts.rapier ?? (await import("@dimforge/rapier2d-compat"));
}

export class Rapier2DEngine implements PhysicsEngineLike {
  readonly world: any;
  private RAPIER: any;
  bodies: Rapier2DBody[] = [];
  restitution: number;
  friction: number;

  private constructor(RAPIER: any, world: any, opts: Rapier2DEngineOptions) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.restitution = opts.restitution ?? 0.3;
    this.friction = opts.friction ?? 0.5;
    if (opts.floor != null) {
      // A wide, thin fixed slab whose top surface sits at y = floor.
      const slabHalf = 0.5;
      const rb = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, opts.floor - slabHalf),
      );
      const cd = RAPIER.ColliderDesc.cuboid(1000, slabHalf)
        .setRestitution(this.restitution)
        .setFriction(this.friction);
      world.createCollider(cd, rb);
    }
  }

  /** Async factory: initializes Rapier's WASM, builds the world (+ optional floor). */
  static async create(opts: Rapier2DEngineOptions = {}): Promise<Rapier2DEngine> {
    const RAPIER = await loadRapier(opts);
    await RAPIER.init();
    const g = opts.gravity ?? [0, -9.8, 0];
    const world = new RAPIER.World({ x: g[0], y: g[1] });
    return new Rapier2DEngine(RAPIER, world, opts);
  }

  addBody(mob: any, opts: RapierBodyOptions = {}): Rapier2DBody {
    const RAPIER = this.RAPIER;
    const center = mob.getCenter();
    const shape = inferShape(mob, opts, 2);
    const isStatic = opts.static ?? false;

    const rbDesc = (isStatic ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(center[0], center[1]);
    if (opts.velocity) rbDesc.setLinvel(opts.velocity[0] ?? 0, opts.velocity[1] ?? 0);
    if (opts.angularVelocity != null) {
      const a = Array.isArray(opts.angularVelocity) ? (opts.angularVelocity[2] ?? 0) : opts.angularVelocity;
      rbDesc.setAngvel(a);
    }
    const rb = this.world.createRigidBody(rbDesc);

    let cd: any;
    if (shape.kind === "ball") cd = RAPIER.ColliderDesc.ball(shape.radius);
    else if (shape.kind === "capsule") cd = RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius);
    else cd = RAPIER.ColliderDesc.cuboid(shape.halfExtents[0], shape.halfExtents[1]);
    cd.setRestitution(opts.restitution ?? this.restitution).setFriction(opts.friction ?? this.friction);
    if (opts.mass != null) cd.setMass(opts.mass);
    else if (opts.density != null) cd.setDensity(opts.density);
    this.world.createCollider(cd, rb);

    const body: Rapier2DBody = {
      mob, rb, static: isStatic, lastPos: center.slice(), lastAngle: 0,
    };
    this.bodies.push(body);
    return body;
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
    for (const b of this.bodies) {
      if (b.static) continue;
      const t = b.rb.translation();   // {x, y}
      const angle = b.rb.rotation();  // scalar radians about Z
      const pos = [t.x, t.y, 0];

      // A NaN/Infinity solver output must not reach `b.mob.shift()`/`.rotate()`
      // (would corrupt the mobject's point data) NOR `b.lastPos`/`b.lastAngle`
      // (would permanently poison next frame's delta too) -- bail before
      // touching either, once we've warned.
      if (!Number.isFinite(pos[0]) || !Number.isFinite(pos[1]) || !Number.isFinite(angle)) {
        warnNonFiniteRapierOutput(b, "Rapier2D");
        continue;
      }

      // Rotate by the delta about the OLD center, then translate (same ordering
      // rationale as the 3D adapter).
      const dAngle = angle - b.lastAngle;
      if (dAngle) b.mob.rotate(dAngle, { axis: V.OUT, aboutPoint: b.lastPos });
      const dp = V.sub(pos, b.lastPos);
      if (dp[0] || dp[1] || dp[2]) b.mob.shift(dp);

      b.lastPos = pos;
      b.lastAngle = angle;
    }
  }

  /** Attach to a scene: an invisible carrier steps the engine each frame. */
  attach(scene: any): this {
    attachStepper(this, scene);
    return this;
  }
}

/** Create a Rapier2D engine, attach it to the scene, and return it (async). */
export async function rapier2d(scene: any, opts: Rapier2DEngineOptions = {}): Promise<Rapier2DEngine> {
  const engine = await Rapier2DEngine.create(opts);
  return engine.attach(scene);
}
