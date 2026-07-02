// Analytic electromagnetism: point charges → electric field, currents → magnetic
// field, as VectorField/ArrowVectorField subclasses. These are formula-based (no
// solver), so they're cheap and deterministic — mirroring manim-physics' EM half.

import { ArrowVectorField } from "../mobject/vector_field.ts";
import type { ArrowVectorFieldConfig } from "../mobject/vector_field.ts";

export interface PointCharge { position: number[]; magnitude: number; }
export interface PointCurrent { position: number[]; magnitude: number; } // +out of plane

const K = 1; // scaled Coulomb constant (arrows are auto-normalized by ArrowVectorField)
const EPS = 1e-3;

/** The electric field function E(p) for a set of point charges (Coulomb, summed). */
export function electricFieldFunc(charges: PointCharge[]): (p: number[]) => number[] {
  return (p: number[]) => {
    let ex = 0, ey = 0;
    for (const q of charges) {
      const rx = p[0] - q.position[0];
      const ry = p[1] - q.position[1];
      const r2 = rx * rx + ry * ry + EPS;
      const r = Math.sqrt(r2);
      const s = (K * q.magnitude) / (r2 * r);
      ex += s * rx; ey += s * ry;
    }
    return [ex, ey, 0];
  };
}

/** The magnetic field B(p) for a set of out-of-plane line currents (B = I·(ẑ×r)/|r|²). */
export function magneticFieldFunc(currents: PointCurrent[]): (p: number[]) => number[] {
  return (p: number[]) => {
    let bx = 0, by = 0;
    for (const c of currents) {
      const rx = p[0] - c.position[0];
      const ry = p[1] - c.position[1];
      const r2 = rx * rx + ry * ry + EPS;
      // ẑ × (rx, ry, 0) = (-ry, rx, 0)
      const s = c.magnitude / r2;
      bx += s * -ry; by += s * rx;
    }
    return [bx, by, 0];
  };
}

/** An arrow vector field for the electric field of the given charges. */
export class ElectricField extends ArrowVectorField {
  charges: PointCharge[];
  constructor(charges: PointCharge[], config: ArrowVectorFieldConfig = {}) {
    super(electricFieldFunc(charges), config);
    this.charges = charges;
  }
}

/** An arrow vector field for the magnetic field of the given out-of-plane currents. */
export class MagneticField extends ArrowVectorField {
  currents: PointCurrent[];
  constructor(currents: PointCurrent[], config: ArrowVectorFieldConfig = {}) {
    super(magneticFieldFunc(currents), config);
    this.currents = currents;
  }
}

// --- geometric optics (thin lens) -----------------------------------------

/**
 * Thin-lens refraction of a ray hitting a lens plane at x = `lensX` with focal
 * length `focal`. Given an incoming point + direction, returns the outgoing
 * direction after the lens (paraxial approximation): a ray at height y bends
 * toward the focal point. Converging lens: focal > 0.
 */
export function thinLensRefract(hitY: number, incomingDir: number[], focal: number): number[] {
  // Paraxial: outgoing slope = incoming slope - y/f.
  const inSlope = incomingDir[0] !== 0 ? incomingDir[1] / incomingDir[0] : 0;
  const outSlope = inSlope - hitY / focal;
  const norm = Math.hypot(1, outSlope) || 1;
  return [1 / norm, outSlope / norm, 0];
}
