// Shared helpers for the Rapier physics adapters (rapier2d.ts / rapier3d.ts).
// The per-dimension sync math lives in each adapter; only the genuinely
// identical bits — body option typing, bbox → collider-shape inference, and the
// carrier-updater that steps an engine each frame — live here to avoid drift.

import { Mobject } from "../mobject/Mobject.ts";

/** Options for `addBody(mob, opts)` on either Rapier engine. */
export interface RapierBodyOptions {
  /** Collider shape. Default inferred from the mobject (round types → ball, else cuboid). */
  shape?: "ball" | "cuboid" | "capsule";
  /** Ball/capsule radius (default: mean bbox half-extent). */
  radius?: number;
  /** Cuboid half-extents [hx, hy(, hz)] (default: from bbox). */
  halfExtents?: number[];
  /** Capsule half-height along Y (default: derived from bbox and radius). */
  halfHeight?: number;
  /** Initial linear velocity. */
  velocity?: number[];
  /** Initial angular velocity: a 3-vector in 3D, a scalar (about Z) in 2D. */
  angularVelocity?: number | number[];
  /** Explicit collider mass (overrides density). */
  mass?: number;
  /** Collider density (used if `mass` is not given). */
  density?: number;
  /** Fixed (immovable) body. */
  static?: boolean;
  /** Bounciness [0..1] (default: engine restitution). */
  restitution?: number;
  /** Friction coefficient (default: engine friction). */
  friction?: number;
}

export interface InferredShape {
  kind: "ball" | "cuboid" | "capsule";
  radius: number;
  /** Always length 3 ([hx, hy, hz]); 2D adapters use the first two. */
  halfExtents: number[];
  halfHeight: number;
}

// Round mobject types collide better as a ball; everything else as a cuboid.
// A bounding box alone can't distinguish a sphere from a cube, so we peek at the
// constructor name for the common round primitives and default to cuboid.
function autoKind(mob: any): "ball" | "cuboid" {
  const n = (mob?.constructor?.name ?? "").toLowerCase();
  if (n.includes("sphere") || n.includes("dot") || n.includes("circle") || n.includes("ball")) {
    return "ball";
  }
  return "cuboid";
}

/** Infer a collider shape from a mobject's bounding box, honoring explicit opts. */
export function inferShape(mob: any, opts: RapierBodyOptions, dims: 2 | 3): InferredShape {
  const bb = mob.getBoundingBox();
  const he = [
    Math.max((bb.max[0] - bb.min[0]) / 2, 1e-4),
    Math.max((bb.max[1] - bb.min[1]) / 2, 1e-4),
    Math.max((bb.max[2] - bb.min[2]) / 2, 1e-4),
  ];
  const halfExtents = opts.halfExtents
    ? [opts.halfExtents[0], opts.halfExtents[1], opts.halfExtents[2] ?? he[2]]
    : he;
  const usable = dims === 2 ? halfExtents.slice(0, 2) : halfExtents;
  const meanR = usable.reduce((a, b) => a + b, 0) / usable.length;
  const radius = opts.radius ?? meanR;
  const kind = opts.shape ?? autoKind(mob);
  return {
    kind,
    radius,
    halfExtents,
    halfHeight: opts.halfHeight ?? Math.max(halfExtents[1] - radius, 1e-3),
  };
}

/** Add an invisible carrier mobject that steps `engine` once per frame. Mirrors
 *  `SimpleEngine.attach` in rigid.ts. */
export function attachStepper(engine: { step(dt: number): void }, scene: any): void {
  const carrier = new Mobject();
  carrier.addUpdater((_m: any, dt: number) => engine.step(dt));
  scene.add(carrier);
}

// Bodies that already warned about a non-finite solver output, so a stuck
// solver doesn't spam a warning every single frame thereafter.
const warnedNonFinite = new WeakSet<object>();

/**
 * Warn (once per body) when a Rapier step produces a non-finite
 * (NaN/Infinity) position or rotation. A naive truthy guard (e.g.
 * `if (dp[0] || dp[1] || dp[2])`) treats NaN exactly like 0 -- `Boolean(NaN)`
 * is `false` -- so without this, a NaN solver output silently no-ops
 * forever: the mobject just freezes with no error or warning ever surfaced.
 * Callers should `continue` past the rest of that body's per-frame update
 * (and leave its tracked lastPos/lastAngle/lastQuat untouched) after calling
 * this, so NaN never gets written into state that feeds next frame's delta.
 */
export function warnNonFiniteRapierOutput(body: object, engineName: "Rapier2D" | "Rapier3D"): void {
  if (warnedNonFinite.has(body)) return;
  warnedNonFinite.add(body);
  console.warn(
    `[ecmanim physics] ${engineName} produced a non-finite (NaN/Infinity) position or rotation for a body -- ` +
    "skipping this step's update for it to avoid corrupting its mobject's point data. This body will no longer move.",
  );
}
