// 3D vector / point math. Points are plain [x, y, z] arrays, mirroring manim's
// numpy points of shape (3,). All functions are pure and return new arrays.

import type { Vec3 } from "../types.ts";

export const vec = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];

export const add = (a: number[], b: number[]): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: number[], b: number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: number[], s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const mul = (a: number[], b: number[]): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const neg = (a: number[]): Vec3 => [-a[0], -a[1], -a[2]];

export const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: number[], b: number[]): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const length = (a: number[]): number => Math.hypot(a[0], a[1], a[2]);
export const distance = (a: number[], b: number[]): number => length(sub(a, b));

export const normalize = (a: number[]): Vec3 => {
  const l = length(a);
  return l === 0 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};

// Linear interpolation between two points (or numbers).
export function lerp(a: number, b: number, t: number): number;
export function lerp(a: number[], b: number[], t: number): Vec3;
export function lerp(a: number | number[], b: any, t: number): number | Vec3 {
  return typeof a === "number" ? a + (b - a) * t : [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export const midpoint = (a: number[], b: number[]): Vec3 => lerp(a, b, 0.5);
export const clone = (a: number[]): Vec3 => [a[0], a[1], a[2]];
export const equals = (a: number[], b: number[], eps = 1e-8): boolean =>
  Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;

// Angle of a 2D vector (radians), and rotate a point about z-axis.
export const angleOf = (a: number[]): number => Math.atan2(a[1], a[0]);

export function rotateVector(a: number[], angle: number, axis: number[] = [0, 0, 1]): Vec3 {
  // Rodrigues' rotation formula.
  const k = normalize(axis);
  const cosT = Math.cos(angle);
  const sinT = Math.sin(angle);
  const term1 = scale(a, cosT);
  const term2 = scale(cross(k, a), sinT);
  const term3 = scale(k, dot(k, a) * (1 - cosT));
  return add(add(term1, term2), term3);
}

// Common direction constants (manim uses unit vectors for these).
export const ORIGIN = [0, 0, 0];
export const UP = [0, 1, 0];
export const DOWN = [0, -1, 0];
export const RIGHT = [1, 0, 0];
export const LEFT = [-1, 0, 0];
export const OUT = [0, 0, 1];
export const IN = [0, 0, -1];
export const UL = [-1, 1, 0];
export const UR = [1, 1, 0];
export const DL = [-1, -1, 0];
export const DR = [1, -1, 0];

export const PI = Math.PI;
export const TAU = 2 * Math.PI;
export const DEGREES = Math.PI / 180;

// ---------------------------------------------------------------------------
// space_ops parity (ManimCommunity manim/utils/space_ops.py). Matrices are
// number[][] (3x3), points are Vec3. camelCase names.
// ---------------------------------------------------------------------------

/** Multiply a 3x3 matrix by a 3-vector: M @ p. */
export function matrixVectorProduct(matrix: number[][], point: number[]): Vec3 {
  return [
    matrix[0][0] * point[0] + matrix[0][1] * point[1] + matrix[0][2] * point[2],
    matrix[1][0] * point[0] + matrix[1][1] * point[1] + matrix[1][2] * point[2],
    matrix[2][0] * point[0] + matrix[2][1] * point[1] + matrix[2][2] * point[2],
  ];
}

/** Alias of matrixVectorProduct. */
export const applyMatrix = matrixVectorProduct;

/** Transpose a square matrix. */
export function transpose(m: number[][]): number[][] {
  const n = m.length;
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    out.push([]);
    for (let j = 0; j < n; j++) out[i].push(m[j][i]);
  }
  return out;
}

/**
 * Rotation matrix in R^3 about a given axis (Rodrigues). Returns 3x3.
 * Matches manim's rotation_matrix(angle, axis).
 */
export function rotationMatrix(angle: number, axis: number[] = [0, 0, 1]): number[][] {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

/** Rotation matrix about the z-axis. */
export function rotationAboutZ(angle: number): number[][] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}

/** Transpose of the rotation matrix (manim's rotation_matrix_transpose). */
export function rotationMatrixTranspose(angle: number, axis: number[] = [0, 0, 1]): number[][] {
  if (axis[0] === 0 && axis[1] === 0) {
    return transpose(rotationAboutZ(angle * Math.sign(axis[2])));
  }
  return transpose(rotationMatrix(angle, axis));
}

/** Rotation matrix in SO(3) taking the z-axis to the given (normalized) vector. */
export function zToVector(vector: number[]): number[][] {
  const axisZ = normalize(vector);
  let axisY = normalize(cross(axisZ, RIGHT));
  let axisX: Vec3;
  if (length(axisY) === 0) {
    axisX = normalize(cross(UP, axisZ));
    axisY = neg(cross(axisX, axisZ));
  } else {
    axisX = cross(axisY, axisZ);
  }
  // np.array([axis_x, axis_y, axis_z]).T -> columns are the axes.
  return [
    [axisX[0], axisY[0], axisZ[0]],
    [axisX[1], axisY[1], axisZ[1]],
    [axisX[2], axisY[2], axisZ[2]],
  ];
}

/** Angle between two vectors, always in [0, PI]. */
export function angleBetweenVectors(v1: number[], v2: number[]): number {
  const a = normalize(v1);
  const b = normalize(v2);
  return 2 * Math.atan2(length(sub(a, b)), length(add(a, b)));
}

/** Unit normal of two vectors (manim's get_unit_normal). */
export function getUnitNormal(v1: number[], v2: number[], tol = 1e-6): Vec3 {
  const div1 = Math.max(Math.abs(v1[0]), Math.abs(v1[1]), Math.abs(v1[2]));
  const div2 = Math.max(Math.abs(v2[0]), Math.abs(v2[1]), Math.abs(v2[2]));
  let u: Vec3;
  if (div1 === 0) {
    if (div2 === 0) return [0, -1, 0]; // DOWN
    u = scale(v2, 1 / div2);
  } else if (div2 === 0) {
    u = scale(v1, 1 / div1);
  } else {
    const u1 = scale(v1, 1 / div1);
    const u2 = scale(v2, 1 / div2);
    const cp = cross(u1, u2);
    const cpNorm = length(cp);
    if (cpNorm > tol) return scale(cp, 1 / cpNorm);
    u = u1;
  }
  if (Math.abs(u[0]) < tol && Math.abs(u[1]) < tol) return [0, -1, 0]; // DOWN
  const cp: Vec3 = [-u[0] * u[2], -u[1] * u[2], u[0] * u[0] + u[1] * u[1]];
  return scale(cp, 1 / length(cp));
}

/** 2D cross product (z-component): a.x*b.y - a.y*b.x. */
export function cross2d(a: number[], b: number[]): number {
  return a[0] * b[1] - a[1] * b[0];
}

/** Center of mass (average) of a list of points. */
export function centerOfMass(points: number[][]): Vec3 {
  const sum: Vec3 = [0, 0, 0];
  for (const p of points) {
    sum[0] += p[0];
    sum[1] += p[1];
    sum[2] += p[2];
  }
  const n = points.length || 1;
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

/** Convert a complex number (as {re,im} or [re,im]) to an R^3 point. */
export function complexToR3(z: { re: number; im: number } | number[]): Vec3 {
  if (Array.isArray(z)) return [z[0], z[1] ?? 0, 0];
  return [z.re, z.im, 0];
}

/** Convert an R^3 point to a complex number {re, im}. */
export function R3ToComplex(p: number[]): { re: number; im: number } {
  return { re: p[0], im: p[1] };
}

/**
 * Intersection of two lines, each defined by a pair of distinct 2D/3D points
 * (in the xy-plane). Throws if parallel. Uses homogeneous cross products.
 */
export function lineIntersection(line1: number[][], line2: number[][]): Vec3 {
  const homog = (pair: number[][]): Vec3 =>
    cross([pair[0][0], pair[0][1], 1], [pair[1][0], pair[1][1], 1]);
  const l1 = homog(line1);
  const l2 = homog(line2);
  const [x, y, z] = cross(l1, l2);
  if (z === 0) {
    throw new Error("The lines are parallel, there is no unique intersection point.");
  }
  return [x / z, y / z, 0];
}

/**
 * Intersection of the line through p0 in direction v0 with the line through p1
 * in direction v1 (single-point form of manim's find_intersection).
 */
export function findIntersection(
  p0: number[],
  v0: number[],
  p1: number[],
  v1: number[],
  threshold = 1e-5,
): Vec3 {
  const normal = cross(v1, cross(v0, v1));
  const denom = Math.max(dot(v0, normal), threshold);
  const t = dot(sub(p1, p0), normal) / denom;
  return add(p0, scale(v0, t));
}

/** Number of times a polygon winds around the origin. */
export function getWindingNumber(points: number[][]): number {
  let total = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    let dAngle = angleOf(p2) - angleOf(p1);
    dAngle = ((dAngle + PI) % TAU) - PI;
    if (dAngle < -PI) dAngle += TAU; // JS % can be negative
    total += dAngle;
  }
  return total / TAU;
}

/** 2D shoelace formula (signed, via trapezoid integration of y over x). */
export function shoelace(points: number[][]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    // np.trapezoid(y, x) form: sum of (x2-x1)*(y1+y2)/2 over adjacent pairs.
    area += (x2 - x1) * (y1 + y2) / 2;
  }
  return area;
}

/** "CW" if shoelace area > 0, otherwise "CCW". */
export function shoelaceDirection(points: number[][]): "CW" | "CCW" {
  return shoelace(points) > 0 ? "CW" : "CCW";
}

/**
 * Ear-clipping triangulation of a simple polygon (optionally with holes given
 * by ringEnds). Returns a flat list of vertex-index triples.
 */
export function earclipTriangulation(points: number[][], ringEnds?: number[]): number[] {
  const ends = ringEnds && ringEnds.length ? ringEnds : [points.length];

  // Build the traversal order, bridging holes to the outer ring by nearest
  // vertices (mirrors manim's loop_connections logic in a simplified 2D form).
  const rings: number[][] = [];
  let start = 0;
  for (const e of ends) {
    const ring: number[] = [];
    for (let i = start; i < e; i++) ring.push(i);
    rings.push(ring);
    start = e;
  }

  let indices: number[];
  if (rings.length === 1) {
    indices = rings[0].slice();
  } else {
    // Bridge each hole into the outer ring at the mutually-closest vertices.
    const outer = rings[0].slice();
    const holes = rings.slice(1);
    for (const hole of holes) {
      let best = { d: Infinity, oi: 0, hi: 0 };
      for (let a = 0; a < outer.length; a++) {
        for (let b = 0; b < hole.length; b++) {
          const pa = points[outer[a]];
          const pb = points[hole[b]];
          const dx = pa[0] - pb[0];
          const dy = pa[1] - pb[1];
          const d = dx * dx + dy * dy;
          if (d < best.d) best = { d, oi: a, hi: b };
        }
      }
      // Insert the hole loop (starting at hi, closing back) plus bridge verts.
      const bridged: number[] = [];
      for (let k = 0; k <= hole.length; k++) bridged.push(hole[(best.hi + k) % hole.length]);
      bridged.push(outer[best.oi]);
      outer.splice(best.oi + 1, 0, ...bridged);
    }
    indices = outer;
  }

  const area = (a: number, b: number, c: number): number => {
    const pa = points[a], pb = points[b], pc = points[c];
    return (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
  };
  const pointInTriangle = (p: number, a: number, b: number, c: number): boolean => {
    const pp = points[p], pa = points[a], pb = points[b], pc = points[c];
    const d1 = (pp[0] - pb[0]) * (pa[1] - pb[1]) - (pa[0] - pb[0]) * (pp[1] - pb[1]);
    const d2 = (pp[0] - pc[0]) * (pb[1] - pc[1]) - (pb[0] - pc[0]) * (pp[1] - pc[1]);
    const d3 = (pp[0] - pa[0]) * (pc[1] - pa[1]) - (pc[0] - pa[0]) * (pp[1] - pa[1]);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };

  // Determine winding: ensure CCW by measuring signed area.
  let signedArea = 0;
  for (let i = 0; i < indices.length; i++) {
    const p = points[indices[i]];
    const q = points[indices[(i + 1) % indices.length]];
    signedArea += p[0] * q[1] - q[0] * p[1];
  }
  const vlist = signedArea < 0 ? indices.slice().reverse() : indices.slice();

  const result: number[] = [];
  let guard = 0;
  const maxGuard = vlist.length * vlist.length + 10;
  while (vlist.length > 3 && guard++ < maxGuard) {
    let earFound = false;
    for (let i = 0; i < vlist.length; i++) {
      const prev = vlist[(i - 1 + vlist.length) % vlist.length];
      const cur = vlist[i];
      const next = vlist[(i + 1) % vlist.length];
      if (area(prev, cur, next) <= 0) continue; // reflex or degenerate
      let anyInside = false;
      for (let j = 0; j < vlist.length; j++) {
        const v = vlist[j];
        if (v === prev || v === cur || v === next) continue;
        if (pointInTriangle(v, prev, cur, next)) {
          anyInside = true;
          break;
        }
      }
      if (anyInside) continue;
      result.push(prev, cur, next);
      vlist.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) break; // avoid infinite loop on degenerate input
  }
  if (vlist.length === 3) result.push(vlist[0], vlist[1], vlist[2]);
  return result;
}

/** n directions equally spaced around the circle, starting from startVect. */
export function compassDirections(n = 4, startVect: number[] = [1, 0, 0]): Vec3[] {
  const angle = TAU / n;
  const out: Vec3[] = [];
  for (let k = 0; k < n; k++) out.push(rotateVector(startVect, k * angle));
  return out;
}

/** Regularly spaced vertices around a circle at origin. Returns [vertices, startAngle]. */
export function regularVertices(
  n: number,
  radius = 1,
  startAngle?: number,
): [Vec3[], number] {
  const sa = startAngle === undefined ? (n % 2 === 0 ? 0 : TAU / 4) : startAngle;
  const startVector = rotateVector([radius, 0, 0], sa);
  return [compassDirections(n, startVector), sa];
}

/** Cartesian point to spherical [r, theta, phi] (manim convention). */
export function cartesianToSpherical(vec: number[]): Vec3 {
  const norm = length(vec);
  if (norm === 0) return [0, 0, 0];
  const r = norm;
  const phi = Math.acos(vec[2] / r);
  const theta = Math.atan2(vec[1], vec[0]);
  return [r, theta, phi];
}

/** Spherical [r, theta, phi] to Cartesian point. */
export function sphericalToCartesian(spherical: number[]): Vec3 {
  const [r, theta, phi] = spherical;
  return [
    r * Math.cos(theta) * Math.sin(phi),
    r * Math.sin(theta) * Math.sin(phi),
    r * Math.cos(phi),
  ];
}

// --- Quaternions: stored as [w, x, y, z]. ---

/** Hamilton product of one or more quaternions [w,x,y,z]. */
export function quaternionMult(...quats: number[][]): number[] {
  if (quats.length === 0) return [1, 0, 0, 0];
  let result = quats[0];
  for (let i = 1; i < quats.length; i++) {
    const [w1, x1, y1, z1] = result;
    const [w2, x2, y2, z2] = quats[i];
    result = [
      w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
      w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
      w1 * y2 + y1 * w2 + z1 * x2 - x1 * z2,
      w1 * z2 + z1 * w2 + x1 * y2 - y1 * x2,
    ];
  }
  return result;
}

/** Quaternion [w,x,y,z] from an angle and axis. */
export function quaternionFromAngleAxis(
  angle: number,
  axis: number[],
  axisNormalized = false,
): number[] {
  const a = axisNormalized ? axis : normalize(axis);
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), s * a[0], s * a[1], s * a[2]];
}

/** Recover [angle, axis] from a quaternion [w,x,y,z]. */
export function angleAxisFromQuaternion(q: number[]): [number, Vec3] {
  const vpart: Vec3 = [q[1], q[2], q[3]];
  let axis: Vec3;
  if (length(vpart) === 0) axis = [1, 0, 0];
  else axis = normalize(vpart);
  let angle = 2 * Math.acos(Math.max(-1, Math.min(1, q[0])));
  if (angle > TAU / 2) angle = TAU - angle;
  return [angle, axis];
}

/** Conjugate of a quaternion [w,x,y,z]. */
export function quaternionConjugate(q: number[]): number[] {
  return [q[0], -q[1], -q[2], -q[3]];
}

/** Rotate a vector by an angle-axis expressed via quaternions. */
export function rotateVectorQuaternion(vector: number[], angle: number, axis: number[] = [0, 0, 1]): Vec3 {
  const q = quaternionFromAngleAxis(angle, axis);
  const qConj = quaternionConjugate(q);
  const p = [0, vector[0], vector[1], vector[2] ?? 0];
  const r = quaternionMult(quaternionMult(q, p), qConj);
  return [r[1], r[2], r[3]];
}
