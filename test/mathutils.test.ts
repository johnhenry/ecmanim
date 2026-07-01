import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitBezier, subdivideBezier, bezierRemap, getSmoothCubicBezierHandlePoints,
  bezier, integerInterpolate, inverseInterpolate, matchInterpolate, isClosed,
} from "../src/core/math/bezier.ts";
import {
  rotationMatrix, rotationAboutZ, zToVector, complexToR3, R3ToComplex,
  lineIntersection, findIntersection, earclipTriangulation, quaternionFromAngleAxis,
  rotateVector, rotateVectorQuaternion, matrixVectorProduct, cartesianToSpherical,
  sphericalToCartesian, shoelace, shoelaceDirection, getWindingNumber, centerOfMass,
  compassDirections, regularVertices, angleBetweenVectors, getUnitNormal, cross2d,
} from "../src/core/math/vector.ts";
import { straightPath, pathAlongArc, clockwisePath, spiralPath } from "../src/core/math/paths.ts";

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const vclose = (a: number[], b: number[], eps = 1e-6) => a.every((x, i) => Math.abs(x - b[i]) < eps);

// 1. Bezier splitting: continuity at the split point.
test("splitBezier splits with C0 continuity at the split point", () => {
  const pts = [[0, 0, 0], [1, 2, 0], [2, -1, 0], [3, 3, 0]];
  const s = splitBezier(pts, 0.4);
  const joint = bezier(pts[0], pts[1], pts[2], pts[3], 0.4);
  assert.ok(vclose(s.slice(0, 4)[0], pts[0]));
  assert.ok(vclose(s[3], joint));
  assert.ok(vclose(s[4], joint));
  assert.ok(vclose(s[7], pts[3]));
});

// 2. Subdivide reconstructs the original curve shape.
test("subdivideBezier keeps the curve shape", () => {
  const pts = [[0, 0, 0], [1, 3, 0], [4, 3, 0], [5, 0, 0]];
  const sub = subdivideBezier(pts, 2);
  assert.equal(sub.length, 8);
  const orig = bezier(pts[0], pts[1], pts[2], pts[3], 0.25);
  const first = sub.slice(0, 4);
  const p = bezier(first[0], first[1], first[2], first[3], 0.5); // t=0.25 overall
  assert.ok(vclose(orig, p));
});

// 3. bezierRemap raises the curve count while preserving endpoints.
test("bezierRemap resamples to a new curve count", () => {
  const curves = [
    [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]],
    [[3, 0, 0], [4, 0, 0], [5, 0, 0], [6, 0, 0]],
  ];
  const r = bezierRemap(curves, 5);
  assert.equal(r.length, 5);
  assert.ok(vclose(r[0][0], [0, 0, 0]));
  assert.ok(vclose(r[4][3], [6, 0, 0]));
});

// 4. Smooth handle points produce a C1-continuous spline through the anchors.
test("getSmoothCubicBezierHandlePoints gives a smooth spline through anchors", () => {
  const anchors = [[0, 0, 0], [1, 1, 0], [2, -1, 0], [3, 0, 0], [4, 2, 0]];
  const [h1, h2] = getSmoothCubicBezierHandlePoints(anchors);
  assert.equal(h1.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.ok(vclose(bezier(anchors[i], h1[i], h2[i], anchors[i + 1], 0), anchors[i]));
    assert.ok(vclose(bezier(anchors[i], h1[i], h2[i], anchors[i + 1], 1), anchors[i + 1]));
  }
  for (let i = 1; i < 4; i++) {
    const incoming = [anchors[i][0] - h2[i - 1][0], anchors[i][1] - h2[i - 1][1], 0];
    const outgoing = [h1[i][0] - anchors[i][0], h1[i][1] - anchors[i][1], 0];
    assert.ok(close(cross2d(incoming, outgoing), 0, 1e-6));
  }
});

// 5. Interpolation helpers.
test("integer/inverse/match interpolate + isClosed", () => {
  const [iv, res] = integerInterpolate(0, 10, 0.46);
  assert.equal(iv, 4);
  assert.ok(close(res, 0.6, 1e-9));
  assert.ok(close(inverseInterpolate(2, 6, 4), 0.5));
  assert.ok(close(matchInterpolate(0, 100, 10, 20, 15), 50));
  assert.ok(isClosed([[0, 0, 0], [1, 2, 3], [0, 0, 0]]));
  assert.ok(!isClosed([[0, 0, 0], [1, 2, 3], [1, 1, 1]]));
});

// 6. Rotation matrices.
test("rotationMatrix and rotationAboutZ rotate X->Y at PI/2", () => {
  assert.ok(vclose(matrixVectorProduct(rotationMatrix(Math.PI / 2, [0, 0, 1]), [1, 0, 0]), [0, 1, 0], 1e-9));
  assert.ok(vclose(matrixVectorProduct(rotationAboutZ(Math.PI / 2), [1, 0, 0]), [0, 1, 0], 1e-9));
});

// 7. zToVector maps z to the target vector.
test("zToVector maps the z-axis onto the target vector", () => {
  const target = [1, 2, 2]; // length 3
  const m = zToVector(target);
  const mapped = matrixVectorProduct(m, [0, 0, 1]);
  assert.ok(vclose(mapped, [1 / 3, 2 / 3, 2 / 3], 1e-9));
  assert.ok(vclose(matrixVectorProduct(zToVector([0, 0, 1]), [0, 0, 1]), [0, 0, 1], 1e-9));
});

// 8. Complex conversions and intersections.
test("complex conversions and line intersections", () => {
  assert.ok(vclose(complexToR3({ re: 3, im: -2 }), [3, -2, 0]));
  const c = R3ToComplex([3, -2, 0]);
  assert.ok(close(c.re, 3) && close(c.im, -2));
  assert.ok(vclose(lineIntersection([[0, 0, 0], [1, 1, 0]], [[0, 2, 0], [1, 1, 0]]), [1, 1, 0], 1e-9));
  const fi = findIntersection([0, 0, 0], [1, 1, 0], [0, 2, 0], [1, -1, 0]);
  assert.ok(vclose(fi, [1, 1, 0], 1e-6));
});

// 9. Earclip triangulation covers a square.
test("earclipTriangulation of a square yields 2 covering triangles", () => {
  const square = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
  const tris = earclipTriangulation(square);
  assert.equal(tris.length, 6);
  let area = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = square[tris[i]], b = square[tris[i + 1]], c = square[tris[i + 2]];
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  assert.ok(close(area, 1, 1e-9));
});

// 10. Quaternions match rotation-matrix rotation.
test("quaternion rotation matches rotateVector", () => {
  const v = [1, 0.5, -0.3], angle = 0.7, axis = [0.2, 1, 0.4];
  assert.equal(quaternionFromAngleAxis(angle, axis).length, 4);
  assert.ok(vclose(rotateVectorQuaternion(v, angle, axis), rotateVector(v, angle, axis), 1e-9));
});

// 11. Spherical/cartesian round-trip and misc space_ops.
test("spherical round-trip, shoelace, winding, unit normal, compass", () => {
  const p = [1, 2, 3];
  assert.ok(vclose(sphericalToCartesian(cartesianToSpherical(p)), p, 1e-9));
  const sq = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
  assert.ok(close(Math.abs(shoelace(sq)), 1, 1e-9));
  assert.equal(typeof shoelaceDirection(sq), "string");
  assert.ok(vclose(centerOfMass(sq), [0.5, 0.5, 0]));
  const loop = compassDirections(8);
  assert.ok(close(getWindingNumber(loop), 1, 1e-6));
  assert.ok(vclose(getUnitNormal([1, 0, 0], [0, 1, 0]), [0, 0, 1], 1e-9));
  assert.ok(close(angleBetweenVectors([1, 0, 0], [0, 1, 0]), Math.PI / 2));
  const [verts, sa] = regularVertices(4, 1);
  assert.equal(verts.length, 4);
  assert.equal(sa, 0);
});

// 12. Path functions hit endpoints and bend.
test("path functions hit endpoints and arc bends", () => {
  const start = [[0, 0, 0], [1, 1, 0]];
  const end = [[2, 0, 0], [3, 1, 0]];
  assert.ok(vclose(straightPath()(start, end, 0.5)[0], [1, 0, 0]));
  for (const pf of [pathAlongArc(Math.PI / 2), clockwisePath(), spiralPath(Math.PI / 2)]) {
    assert.ok(vclose(pf(start, end, 0)[0], start[0], 1e-9));
    assert.ok(vclose(pf(start, end, 1)[0], end[0], 1e-6));
  }
  // arc midpoint deviates from straight-line midpoint => it actually bends.
  const arcMid = pathAlongArc(Math.PI / 2)(start, end, 0.5)[0];
  assert.ok(!vclose(arcMid, [1, 0, 0], 1e-3), "arc bends away from straight line");
});
