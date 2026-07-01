// Bezier curve utilities. manim's VMobject stores a flat list of points where
// cubic segments share anchors: n_curves = (n_points - 1) / 3.  Anchors are at
// indices 0, 3, 6, ...; the two control points sit between consecutive anchors.

import { lerp } from "./vector.ts";
import type { Vec3 } from "../types.ts";

// Evaluate a cubic bezier at parameter t in [0, 1]. p0,p3 anchors; p1,p2 controls.
export function bezier(p0: number[], p1: number[], p2: number[], p3: number[], t: number): Vec3 {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2],
  ];
}

// Approximate a quarter/section of a circular arc with cubic beziers. Returns
// the control points needed to draw an arc of `angle` radians. Uses the
// standard k = 4/3 * tan(theta/4) handle-length approximation per sub-arc.
export function arcBezierPoints(radius: number, startAngle: number, angle: number, center: number[] = [0, 0, 0]): Vec3[] {
  const nCurves = Math.max(1, Math.ceil(Math.abs(angle) / (Math.PI / 2)));
  const dAngle = angle / nCurves;
  const k = (4 / 3) * Math.tan(dAngle / 4);
  const points: Vec3[] = [];
  const onCircle = (a: number): Vec3 => [
    center[0] + radius * Math.cos(a),
    center[1] + radius * Math.sin(a),
    center[2],
  ];
  const tangent = (a: number): Vec3 => [-Math.sin(a), Math.cos(a), 0];

  let a0 = startAngle;
  points.push(onCircle(a0));
  for (let i = 0; i < nCurves; i++) {
    const a1 = a0 + dAngle;
    const P0 = onCircle(a0);
    const P3 = onCircle(a1);
    const t0 = tangent(a0);
    const t1 = tangent(a1);
    const c1: Vec3 = [
      P0[0] + k * radius * t0[0],
      P0[1] + k * radius * t0[1],
      P0[2],
    ];
    const c2: Vec3 = [
      P3[0] - k * radius * t1[0],
      P3[1] - k * radius * t1[1],
      P3[2],
    ];
    points.push(c1, c2, P3);
    a0 = a1;
  }
  return points;
}

// Given a straight segment from a to b, produce the two interior control points
// that make a cubic bezier trace a straight line (controls at the 1/3 marks).
export function straightControlPoints(a: number[], b: number[]): [Vec3, Vec3] {
  return [lerp(a, b, 1 / 3), lerp(a, b, 2 / 3)];
}

// Partial bezier: the sub-curve of [p0..p3] over parameter range [t0, t1].
// Used by Create/Write to draw a curve progressively (de Casteljau split).
export function partialBezier(p0: number[], p1: number[], p2: number[], p3: number[], t0: number, t1: number): Vec3[] {
  const split = (a: number[], b: number[], c: number[], d: number[], t: number) => {
    const ab = lerp(a, b, t);
    const bc = lerp(b, c, t);
    const cd = lerp(c, d, t);
    const abc = lerp(ab, bc, t);
    const bcd = lerp(bc, cd, t);
    const abcd = lerp(abc, bcd, t);
    return { ab, abc, abcd, bcd, cd };
  };
  // Restrict to [t0, 1] first, then to the remapped t1.
  const r0 = split(p0, p1, p2, p3, t0);
  const q0 = r0.abcd, q1 = r0.bcd, q2 = r0.cd, q3 = p3;
  const t = t1 >= 1 ? 1 : (t1 - t0) / (1 - t0 || 1);
  const r1 = split(q0, q1, q2, q3, Math.max(0, Math.min(1, t)));
  return [q0, r1.ab, r1.abc, r1.abcd];
}

// ---------------------------------------------------------------------------
// Interpolation helpers (ManimCommunity manim/utils/bezier.py). camelCase.
// ---------------------------------------------------------------------------

/** Linear interpolation: (1-alpha)*a + alpha*b, for scalars or points. */
export function interpolate(a: number, b: number, alpha: number): number;
export function interpolate(a: number[], b: number[], alpha: number): Vec3;
export function interpolate(a: number | number[], b: any, alpha: number): number | Vec3 {
  if (typeof a === "number") return (1 - alpha) * a + alpha * b;
  return [
    (1 - alpha) * a[0] + alpha * b[0],
    (1 - alpha) * a[1] + alpha * b[1],
    (1 - alpha) * a[2] + alpha * b[2],
  ];
}

/** Midpoint of two values or points. */
export function mid(a: number, b: number): number;
export function mid(a: number[], b: number[]): Vec3;
export function mid(a: number | number[], b: any): number | Vec3 {
  if (typeof a === "number") return (a + b) / 2;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

/** Inverse interpolation: alpha such that interpolate(start,end,alpha)=value. */
export function inverseInterpolate(start: number, end: number, value: number): number {
  return (value - start) / (end - start);
}

/** Remap oldValue from [oldStart,oldEnd] to [newStart,newEnd]. */
export function matchInterpolate(
  newStart: number,
  newEnd: number,
  oldStart: number,
  oldEnd: number,
  oldValue: number,
): number {
  const oldAlpha = inverseInterpolate(oldStart, oldEnd, oldValue);
  return interpolate(newStart, newEnd, oldAlpha);
}

/**
 * Variant of interpolate returning an integer and the residual.
 * Returns [floored value between start and end, residue in [0,1)].
 */
export function integerInterpolate(start: number, end: number, alpha: number): [number, number] {
  if (alpha >= 1) return [Math.trunc(end - 1), 1.0];
  if (alpha <= 0) return [Math.trunc(start), 0];
  const value = Math.trunc(interpolate(start, end, alpha));
  let residue = ((end - start) * alpha) % 1;
  if (residue < 0) residue += 1;
  return [value, residue];
}

/**
 * Split a cubic Bezier at parameter t into two cubic curves (de Casteljau).
 * Input is 4 control points; output is 8 points (first curve then second).
 */
export function splitBezier(points: number[][], t: number): Vec3[] {
  const [p0, p1, p2, p3] = points;
  const ab = lerp(p0, p1, t);
  const bc = lerp(p1, p2, t);
  const cd = lerp(p2, p3, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  const abcd = lerp(abc, bcd, t);
  return [
    [p0[0], p0[1], p0[2]], ab, abc, abcd,
    abcd, bcd, cd, [p3[0], p3[1], p3[2]],
  ];
}

/**
 * Subdivide a cubic Bezier into n sub-curves of the same overall shape.
 * Returns 4*n points (n consecutive cubic curves).
 */
export function subdivideBezier(points: number[][], n: number): Vec3[] {
  if (n <= 1) return points.map((p) => [p[0], p[1], p[2]] as Vec3);
  const out: Vec3[] = [];
  let remaining = points;
  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      out.push(...remaining.map((p) => [p[0], p[1], p[2]] as Vec3));
      break;
    }
    // Split off the piece over [0, 1/(n-i)] of the remaining curve.
    const t = 1 / (n - i);
    const split = splitBezier(remaining, t);
    out.push(split[0], split[1], split[2], split[3]);
    remaining = split.slice(4);
  }
  return out;
}

/**
 * Resample a list of cubic Bezier curves (each 4 points) to newNumber curves,
 * subdividing as needed. Mirrors manim's bezier_remap.
 */
export function bezierRemap(curves: number[][][], newNumber: number): Vec3[][] {
  const current = curves.length;
  if (newNumber <= current) return curves.map((c) => c.map((p) => [p[0], p[1], p[2]] as Vec3));

  const repeatIndices: number[] = [];
  for (let i = 0; i < newNumber; i++) repeatIndices.push(Math.floor((i * current) / newNumber));
  const splitFactors = new Array(current).fill(0);
  for (const idx of repeatIndices) splitFactors[idx] += 1;

  const out: Vec3[][] = [];
  for (let c = 0; c < current; c++) {
    const sf = splitFactors[c];
    if (sf <= 0) continue;
    const sub = subdivideBezier(curves[c], sf);
    for (let k = 0; k < sf; k++) {
      out.push([sub[4 * k], sub[4 * k + 1], sub[4 * k + 2], sub[4 * k + 3]]);
    }
  }
  return out;
}

/** Returns true if the first and last points of the spline are close. */
export function isClosed(points: number[][]): boolean {
  const start = points[0];
  const end = points[points.length - 1];
  const rtol = 1e-5;
  const atol = 1e-8;
  for (let i = 0; i < 3; i++) {
    const tol = atol + rtol * Math.abs(start[i]);
    if (Math.abs(end[i] - start[i]) > tol) return false;
  }
  return true;
}

/**
 * Smooth-spline handle points for an OPEN chain of anchors. Solves the
 * tridiagonal system with the Thomas algorithm (manim's
 * get_smooth_open_cubic_bezier_handle_points).
 */
function smoothOpenHandles(A: number[][]): [Vec3[], Vec3[]] {
  const N = A.length - 1;
  const dim = A[0].length;

  // cp (c prime) via forward substitution: cp[0] = 0.5, cp[i]=1/(4-cp[i-1]).
  const cp = new Array(N - 1);
  cp[0] = 0.5;
  for (let i = 1; i < N - 1; i++) cp[i] = 1 / (4 - cp[i - 1]);

  const Dp: number[][] = [];
  for (let i = 0; i < N; i++) Dp.push(new Array(dim).fill(0));
  for (let d = 0; d < dim; d++) Dp[0][d] = 0.5 * A[0][d] + A[1][d];

  // AUX[i-1] = 4*A[i] + 2*A[i+1] for i in 1..N-2
  for (let i = 1; i < N - 1; i++) {
    for (let d = 0; d < dim; d++) {
      const aux = 4 * A[i][d] + 2 * A[i + 1][d];
      Dp[i][d] = cp[i] * (aux - Dp[i - 1][d]);
    }
  }
  for (let d = 0; d < dim; d++) {
    Dp[N - 1][d] = (1 / (7 - 2 * cp[N - 2])) * (8 * A[N - 1][d] + A[N][d] - 2 * Dp[N - 2][d]);
  }

  // Backward substitution: H1.
  const H1: number[][] = Dp;
  for (let i = N - 2; i >= 0; i--) {
    for (let d = 0; d < dim; d++) H1[i][d] = Dp[i][d] - cp[i] * H1[i + 1][d];
  }

  // H2.
  const H2: number[][] = [];
  for (let i = 0; i < N; i++) H2.push(new Array(dim).fill(0));
  for (let i = 0; i < N - 1; i++) {
    for (let d = 0; d < dim; d++) H2[i][d] = 2 * A[i + 1][d] - H1[i + 1][d];
  }
  for (let d = 0; d < dim; d++) H2[N - 1][d] = 0.5 * (A[N][d] + H1[N - 1][d]);

  return [H1.map(toVec3), H2.map(toVec3)];
}

/**
 * Smooth-spline handle points for a CLOSED loop of anchors (manim's
 * get_smooth_closed_cubic_bezier_handle_points; Thomas + Sherman-Morrison).
 */
function smoothClosedHandles(A: number[][]): [Vec3[], Vec3[]] {
  const N = A.length - 1;
  const dim = A[0].length;

  const cp = new Array(N - 1);
  const up = new Array(N - 1);
  cp[0] = 1 / 3;
  up[0] = 1 / 3;
  for (let i = 1; i < N - 1; i++) {
    cp[i] = 1 / (4 - cp[i - 1]);
    up[i] = -cp[i] * up[i - 1];
  }

  const cpLastDivision = 1 / (3 - cp[N - 2]);
  const upLast = cpLastDivision * (1 - up[N - 2]);

  // q via backward substitution.
  const q: number[] = new Array(N);
  q[N - 1] = upLast;
  for (let i = N - 2; i >= 0; i--) q[i] = up[i] - cp[i] * q[i + 1];

  // Dp (D prime): AUX[i] = 4*A[i] + 2*A[i+1] for i in 0..N-1.
  const Dp: number[][] = [];
  for (let i = 0; i < N; i++) Dp.push(new Array(dim).fill(0));
  const AUX = (i: number, d: number) => 4 * A[i][d] + 2 * A[i + 1][d];
  for (let d = 0; d < dim; d++) Dp[0][d] = AUX(0, d) / 3;
  for (let i = 1; i < N - 1; i++) {
    for (let d = 0; d < dim; d++) Dp[i][d] = cp[i] * (AUX(i, d) - Dp[i - 1][d]);
  }
  for (let d = 0; d < dim; d++) Dp[N - 1][d] = cpLastDivision * (AUX(N - 1, d) - Dp[N - 2][d]);

  // Y (view of Dp): backward substitution.
  const Y = Dp;
  for (let i = N - 2; i >= 0; i--) {
    for (let d = 0; d < dim; d++) Y[i][d] = Dp[i][d] - cp[i] * Y[i + 1][d];
  }

  // H1 = Y - 1/(1+q[0]+q[N-1]) * q * (Y[0]+Y[N-1]).
  const denom = 1 + q[0] + q[N - 1];
  const H1: number[][] = [];
  for (let i = 0; i < N; i++) {
    const row = new Array(dim);
    for (let d = 0; d < dim; d++) {
      row[d] = Y[i][d] - (q[i] / denom) * (Y[0][d] + Y[N - 1][d]);
    }
    H1.push(row);
  }

  // H2.
  const H2: number[][] = [];
  for (let i = 0; i < N; i++) H2.push(new Array(dim).fill(0));
  for (let i = 0; i < N - 1; i++) {
    for (let d = 0; d < dim; d++) H2[i][d] = 2 * A[i + 1][d] - H1[i + 1][d];
  }
  for (let d = 0; d < dim; d++) H2[N - 1][d] = 2 * A[N][d] - H1[0][d];

  return [H1.map(toVec3), H2.map(toVec3)];
}

function toVec3(p: number[]): Vec3 {
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
}

/**
 * Given anchor points of a cubic spline, compute the two handle arrays
 * [h1, h2] making the spline smooth. Dispatches to open/closed solvers.
 * (manim's get_smooth_cubic_bezier_handle_points / get_smooth_handle_points.)
 */
export function getSmoothCubicBezierHandlePoints(anchors: number[][]): [Vec3[], Vec3[]] {
  const n = anchors.length;
  if (n <= 1) return [[], []];
  if (n === 2) {
    return [
      [interpolate(toVec3(anchors[0]), toVec3(anchors[1]), 1 / 3)],
      [interpolate(toVec3(anchors[0]), toVec3(anchors[1]), 2 / 3)],
    ];
  }
  const A = anchors.map((p) => [p[0], p[1], p[2] ?? 0]);
  return isClosed(A) ? smoothClosedHandles(A) : smoothOpenHandles(A);
}

/** Alias for getSmoothCubicBezierHandlePoints (manim's get_smooth_handle_points). */
export const getSmoothHandlePoints = getSmoothCubicBezierHandlePoints;

/**
 * Whether a point lies on the cubic bezier defined by `points` (samples the
 * curve; a lightweight numeric check rather than manim's polynomial-root form).
 */
export function pointLiesOnBezier(
  point: number[],
  points: number[][],
  tol = 1e-4,
): boolean {
  const [p0, p1, p2, p3] = points;
  const steps = 1000;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const b = bezier(p0, p1, p2, p3, t);
    const dx = b[0] - point[0];
    const dy = b[1] - point[1];
    const dz = b[2] - (point[2] ?? 0);
    if (dx * dx + dy * dy + dz * dz < tol * tol) return true;
  }
  return false;
}
