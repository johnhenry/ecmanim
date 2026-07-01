// Bezier curve utilities. manim's VMobject stores a flat list of points where
// cubic segments share anchors: n_curves = (n_points - 1) / 3.  Anchors are at
// indices 0, 3, 6, ...; the two control points sit between consecutive anchors.

import { lerp } from "./vector.js";

// Evaluate a cubic bezier at parameter t in [0, 1]. p0,p3 anchors; p1,p2 controls.
export function bezier(p0, p1, p2, p3, t) {
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
export function arcBezierPoints(radius, startAngle, angle, center = [0, 0, 0]) {
  const nCurves = Math.max(1, Math.ceil(Math.abs(angle) / (Math.PI / 2)));
  const dAngle = angle / nCurves;
  const k = (4 / 3) * Math.tan(dAngle / 4);
  const points = [];
  const onCircle = (a) => [
    center[0] + radius * Math.cos(a),
    center[1] + radius * Math.sin(a),
    center[2],
  ];
  const tangent = (a) => [-Math.sin(a), Math.cos(a), 0];

  let a0 = startAngle;
  points.push(onCircle(a0));
  for (let i = 0; i < nCurves; i++) {
    const a1 = a0 + dAngle;
    const P0 = onCircle(a0);
    const P3 = onCircle(a1);
    const t0 = tangent(a0);
    const t1 = tangent(a1);
    const c1 = [
      P0[0] + k * radius * t0[0],
      P0[1] + k * radius * t0[1],
      P0[2],
    ];
    const c2 = [
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
export function straightControlPoints(a, b) {
  return [lerp(a, b, 1 / 3), lerp(a, b, 2 / 3)];
}

// Partial bezier: the sub-curve of [p0..p3] over parameter range [t0, t1].
// Used by Create/Write to draw a curve progressively (de Casteljau split).
export function partialBezier(p0, p1, p2, p3, t0, t1) {
  const split = (a, b, c, d, t) => {
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
