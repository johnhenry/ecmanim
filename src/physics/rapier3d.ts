// Real 3D rigid-body physics backed by @dimforge/rapier3d-compat (an optional
// dependency). Implements the same `PhysicsEngineLike { step(dt) }` contract as
// SimpleEngine, so it drops into a scene the same way — but with genuine
// body↔body collision, arbitrary colliders, friction, and full 3D orientation
// (things SimpleEngine cannot do).
//
//   import { rapier3d } from "ecmanim/physics/rapier3d";
//   const engine = await rapier3d(scene, { gravity: [0, -9.8, 0], floor: -3 });
//   engine.addBody(cube, { velocity: [1, 0, 0], angularVelocity: [0, 2, 0] });
//
// Construction is async (Rapier initializes WASM); `step(dt)` is sync, so the
// per-frame carrier updater works unchanged.

import * as V from "../core/math/vector.ts";
import type { PhysicsEngineLike } from "./rigid.ts";
import { type RapierBodyOptions, inferShape, attachStepper, warnNonFiniteRapierOutput } from "./rapier-common.ts";

export interface Rapier3DEngineOptions {
  gravity?: number[];   // default [0, -9.8, 0]
  floor?: number;       // y of a floor; a wide fixed slab is built with its top at this y
  restitution?: number; // default collider bounciness 0.3
  friction?: number;    // default collider friction 0.5
  /** Inject an already-imported RAPIER module (tests / custom builds). */
  rapier?: any;
}

export interface Rapier3DBody {
  mob: any;
  /** The Rapier RigidBody. */
  rb: any;
  static: boolean;
  lastPos: number[];
  /** Last orientation in ecmanim quaternion order [w, x, y, z]. */
  lastQuat: number[];
}

async function loadRapier(opts: Rapier3DEngineOptions): Promise<any> {
  return opts.rapier ?? (await import("@dimforge/rapier3d-compat"));
}

export class Rapier3DEngine implements PhysicsEngineLike {
  readonly world: any;
  private RAPIER: any;
  bodies: Rapier3DBody[] = [];
  restitution: number;
  friction: number;

  private constructor(RAPIER: any, world: any, opts: Rapier3DEngineOptions) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.restitution = opts.restitution ?? 0.3;
    this.friction = opts.friction ?? 0.5;
    if (opts.floor != null) {
      // A wide, thin fixed slab whose top surface sits at y = floor.
      const slabHalf = 0.5;
      const rb = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, opts.floor - slabHalf, 0),
      );
      const cd = RAPIER.ColliderDesc.cuboid(1000, slabHalf, 1000)
        .setRestitution(this.restitution)
        .setFriction(this.friction);
      world.createCollider(cd, rb);
    }
  }

  /** Async factory: initializes Rapier's WASM, builds the world (+ optional floor). */
  static async create(opts: Rapier3DEngineOptions = {}): Promise<Rapier3DEngine> {
    const RAPIER = await loadRapier(opts);
    await RAPIER.init();
    const g = opts.gravity ?? [0, -9.8, 0];
    const world = new RAPIER.World({ x: g[0], y: g[1], z: g[2] ?? 0 });
    return new Rapier3DEngine(RAPIER, world, opts);
  }

  addBody(mob: any, opts: RapierBodyOptions = {}): Rapier3DBody {
    const RAPIER = this.RAPIER;
    const center = mob.getCenter();
    const shape = inferShape(mob, opts, 3);
    const isStatic = opts.static ?? false;

    // Seed the rigid body at the mob's current center with identity rotation —
    // we only ever apply *deltas* from here (see step()), never absolute state.
    const rbDesc = (isStatic ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(center[0], center[1], center[2]);
    if (opts.velocity) {
      rbDesc.setLinvel(opts.velocity[0] ?? 0, opts.velocity[1] ?? 0, opts.velocity[2] ?? 0);
    }
    if (opts.angularVelocity != null) {
      const a = (Array.isArray(opts.angularVelocity) ? opts.angularVelocity : [0, 0, opts.angularVelocity]);
      rbDesc.setAngvel({ x: a[0] ?? 0, y: a[1] ?? 0, z: a[2] ?? 0 });
    }
    const rb = this.world.createRigidBody(rbDesc);

    let cd: any;
    if (shape.kind === "ball") cd = RAPIER.ColliderDesc.ball(shape.radius);
    else if (shape.kind === "capsule") cd = RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius);
    else cd = RAPIER.ColliderDesc.cuboid(shape.halfExtents[0], shape.halfExtents[1], shape.halfExtents[2]);
    cd.setRestitution(opts.restitution ?? this.restitution).setFriction(opts.friction ?? this.friction);
    if (opts.mass != null) cd.setMass(opts.mass);
    else if (opts.density != null) cd.setDensity(opts.density);
    this.world.createCollider(cd, rb);

    const body: Rapier3DBody = {
      mob, rb, static: isStatic, lastPos: center.slice(), lastQuat: [1, 0, 0, 0],
    };
    this.bodies.push(body);
    return body;
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
    for (const b of this.bodies) {
      if (b.static) continue;
      const t = b.rb.translation();          // {x, y, z}
      const rq = b.rb.rotation();            // Rapier quaternion order {x, y, z, w}
      // Convert to ecmanim quaternion order [w, x, y, z] AT THE BOUNDARY, once.
      const q = [rq.w, rq.x, rq.y, rq.z];
      const pos = [t.x, t.y, t.z];

      // A NaN/Infinity solver output must not reach `b.mob.shift()`/`.rotate()`
      // (would corrupt the mobject's point data) NOR `b.lastPos`/`b.lastQuat`
      // (would permanently poison next frame's delta too) -- bail before
      // touching either, once we've warned.
      if (!pos.every(Number.isFinite) || !q.every(Number.isFinite)) {
        warnNonFiniteRapierOutput(b, "Rapier3D");
        continue;
      }

      // Mobjects have no settable orientation — only in-place point rotation. So
      // apply the *delta* rotation (from last frame's orientation to this one)
      // about the OLD center, THEN translate to the new center. Rotating about
      // the new center after shifting would pivot about the wrong point and add
      // an orbit/swirl artifact.
      const qd = V.quaternionMult(q, V.quaternionConjugate(b.lastQuat));
      const w = Math.max(-1, Math.min(1, qd[0]));
      const vlen = Math.hypot(qd[1], qd[2], qd[3]);
      if (vlen > 1e-9) {
        const angle = 2 * Math.atan2(vlen, w); // stable, sign-correct (avoids the clamp in angleAxisFromQuaternion)
        const axis = [qd[1] / vlen, qd[2] / vlen, qd[3] / vlen];
        b.mob.rotate(angle, { axis, aboutPoint: b.lastPos });
      }
      const dp = V.sub(pos, b.lastPos);
      if (dp[0] || dp[1] || dp[2]) b.mob.shift(dp);

      // Track our own values — never re-read getCenter() mid-loop (bbox center of
      // a rotated body can drift from Rapier's center of mass).
      b.lastPos = pos;
      b.lastQuat = q;
    }
  }

  /** Attach to a scene: an invisible carrier steps the engine each frame. */
  attach(scene: any): this {
    attachStepper(this, scene);
    return this;
  }
}

/** Create a Rapier3D engine, attach it to the scene, and return it (async). */
export async function rapier3d(scene: any, opts: Rapier3DEngineOptions = {}): Promise<Rapier3DEngine> {
  const engine = await Rapier3DEngine.create(opts);
  return engine.attach(scene);
}
