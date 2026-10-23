import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeShapeSpec, canonicalShapeType, planarLayout, marksPlan, shapePartNames, resolvePartName, solidCounts, SHAPE_TYPES, shapeCategory,
} from "../src/mobject/geometry_spec.ts";

const N = (raw: any, fb?: any) => normalizeShapeSpec(raw, fb);
const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const sides = (v: number[][]) => v.map((p, i) => dist(p, v[(i + 1) % v.length]));

test("type synonyms and named regular polygons", () => {
  assert.equal(canonicalShapeType("Diamond")?.type, "rhombus");
  assert.equal(canonicalShapeType("trapezium")?.type, "trapezoid");
  assert.equal(canonicalShapeType("right triangle")?.type, "right-triangle");
  assert.deepEqual(canonicalShapeType("hexagon"), { type: "regular-polygon", n: 6 });
  assert.deepEqual(canonicalShapeType("dodecagon"), { type: "regular-polygon", n: 12 });
  assert.equal(canonicalShapeType("pentagram"), undefined);
  const r = N({ shape: "octagon" });
  assert.equal(r.spec.type, "regular-polygon"); assert.equal(r.spec.n, 8);
  assert.ok(r.notes.some((x) => /normalized/.test(x)));
});

test("every type normalises to defaults and yields a layout or solid counts", () => {
  for (const t of SHAPE_TYPES) {
    const { spec, notes } = N({ type: t });
    assert.equal(spec.type, t);
    assert.deepEqual(notes, [], t);
    if (shapeCategory(t) === "solid") assert.ok(solidCounts(spec), t);
    else {
      const lay = planarLayout(spec)!;
      assert.ok(lay.vertices.length >= 3, t);
      assert.ok(lay.vertices.every((p) => p.every(Number.isFinite)), t);
      assert.ok(shapePartNames(spec).length > 6, t);
    }
  }
});

test("geometry is right: equal sides, parallel sides, right angles, hypotenuse", () => {
  const rt = planarLayout(N({ type: "right-triangle", a: 3, b: 4 }).spec)!;
  const s = sides(rt.vertices); // AB=c, BC=a, CA=b
  assert.ok(Math.abs(s[0] - 5) < 1e-9 && Math.abs(s[1] - 3) < 1e-9 && Math.abs(s[2] - 4) < 1e-9);
  const rh = sides(planarLayout(N("rhombus").spec)!.vertices);
  assert.ok(rh.every((x) => Math.abs(x - rh[0]) < 1e-9));
  const kite = sides(planarLayout(N("kite").spec)!.vertices);
  assert.ok(Math.abs(kite[0] - kite[3]) < 1e-9 && Math.abs(kite[1] - kite[2]) < 1e-9 && Math.abs(kite[0] - kite[1]) > 0.1);
  const it = planarLayout(N("isosceles-trapezoid").spec)!.vertices;
  assert.ok(Math.abs(dist(it[1], it[2]) - dist(it[3], it[0])) < 1e-9);
  const eq = sides(planarLayout(N("equilateral-triangle").spec)!.vertices);
  assert.ok(eq.every((x) => Math.abs(x - eq[0]) < 1e-9));
  const hex = sides(planarLayout(N("hexagon").spec)!.vertices);
  assert.ok(hex.every((x) => Math.abs(x - hex[0]) < 1e-9));
  const ob = N({ type: "obtuse-triangle" }).spec;
  const v = planarLayout(ob)!.vertices; // angle at C should be 115
  const ang = Math.acos(((v[0][0] - v[2][0]) * (v[1][0] - v[2][0]) + (v[0][1] - v[2][1]) * (v[1][1] - v[2][1])) / (dist(v[0], v[2]) * dist(v[1], v[2]))) * 180 / Math.PI;
  assert.ok(Math.abs(ang - 115) < 1e-6);
});

test("layouts are counter-clockwise (custom CW polygons are reversed)", () => {
  const area = (v: number[][]) => v.reduce((s, p, i) => s + p[0] * v[(i + 1) % v.length][1] - v[(i + 1) % v.length][0] * p[1], 0) / 2;
  for (const t of SHAPE_TYPES.filter((x) => shapeCategory(x) !== "solid")) assert.ok(area(planarLayout(N(t).spec)!.vertices) > 0, t);
  const cw = N({ type: "polygon", vertices: [[0, 0], [0, 3], [3, 3], [3, 0]] }).spec;
  assert.ok(area(planarLayout(cw)!.vertices) > 0);
});

test("marks: each subtype is recognisable", () => {
  const m = (t: string, extra: any = {}) => marksPlan(N({ type: t, ...extra }).spec);
  const rh = m("rhombus");
  assert.equal(rh.ticks.length, 4); assert.ok(rh.ticks.every((x) => x.count === 1));
  assert.equal(rh.parallels.filter((p) => p.count === 1).length, 2); assert.equal(rh.parallels.filter((p) => p.count === 2).length, 2);
  const kite = m("kite");
  assert.deepEqual(kite.ticks.map((x) => x.count).sort(), [1, 1, 2, 2]);
  assert.equal(kite.arcs.length, 2);
  const it = m("isosceles-trapezoid");
  assert.deepEqual(it.parallels.map((p) => p.side).sort(), [0, 2]);
  assert.deepEqual(it.ticks.map((x) => x.side).sort(), [1, 3]);
  assert.ok(it.arcs.length >= 2);
  assert.deepEqual(m("right-triangle").rightAngles, [2]);
  assert.equal(m("square").rightAngles.length, 4);
  assert.equal(m("parallelogram").parallels.length, 4);
  assert.equal(m("scalene-triangle").ticks.length, 0);
  assert.equal(m("regular-polygon", { n: 5 }).ticks.length, 5);
  // overrides
  assert.equal(m("rhombus", { marks: false }).ticks.length, 0);
  assert.equal(m("rhombus", { marks: { parallels: false } }).parallels.length, 0);
  assert.equal(m("rhombus", { marks: { parallels: false } }).ticks.length, 4);
});

test("parts: names, aliases and case rules", () => {
  const tri = N({ type: "right-triangle", a: 3, b: 4, squares: true, altitude: true, diagonals: true }).spec;
  assert.equal(tri.diagonals, undefined);
  const names = shapePartNames(tri);
  for (const x of ["A", "B", "C", "a", "b", "c", "angleC", "right", "rightAngles", "height", "squareA", "squareB", "squareC"]) assert.ok(names.includes(x), x);
  assert.equal(resolvePartName(tri, "a"), "a");
  assert.equal(resolvePartName(tri, "BC"), "a"); // side a is BC
  assert.equal(resolvePartName(tri, "ac"), "b");
  assert.equal(resolvePartName(tri, "SQUAREc"), "squareC");
  assert.equal(resolvePartName(tri, "A"), "A");
  assert.equal(resolvePartName(tri, "zzz"), undefined);
  assert.equal(resolvePartName(N("right-triangle").spec, "squareA"), undefined); // squares not drawn
  const rh = N({ type: "rhombus", diagonals: true }).spec;
  assert.ok(shapePartNames(rh).includes("diagonalAC") && shapePartNames(rh).includes("diagonalBD"));
  assert.equal(resolvePartName(rh, "diagonalca"), "diagonalAC");
  assert.equal(resolvePartName(rh, "ab"), "AB");
  assert.ok(shapePartNames(rh).includes("ticks") && shapePartNames(rh).includes("arrows"));
  assert.ok(!shapePartNames(N({ type: "rhombus", marks: false }).spec).includes("ticks"));
  const cube = N("cube").spec;
  assert.equal(shapePartNames(cube).length, 6 + 12 + 8);
  assert.equal(resolvePartName(cube, "Face5"), "face5");
  assert.equal(resolvePartName(cube, "face6"), undefined);
});

test("validation: bad params fall back with notes; never throws", () => {
  assert.deepEqual(N({ type: "right-triangle", sides: [3, 4, 6] }).spec.a, 3);
  assert.ok(N({ type: "right-triangle", sides: [3, 4, 6] }).notes.some((x) => /a\^2/.test(x)));
  assert.deepEqual([N({ type: "right-triangle", a: -1, b: 4 }).spec.a, N({ type: "right-triangle", a: -1, b: 4 }).spec.b], [3, 4]);
  assert.deepEqual([N({ type: "right-triangle", a: 1, b: 100 }).spec.a], [3]);
  assert.equal(N({ type: "regular-polygon", n: 2 }).spec.n, 6);
  assert.equal(N({ type: "regular-polygon", n: 50 }).spec.n, 6);
  assert.equal(N({ type: "scalene-triangle", a: 1, b: 1, c: 5 }).spec.c, 6);
  assert.deepEqual(N({ type: "obtuse-triangle", angles: [60, 60, 60] }).spec.angles, [35, 30, 115]);
  assert.equal(N({ type: "rhombus", angle: 5 }).spec.angle, 60);
  assert.equal(N({ type: "triangle", angles: [50, 60, 70] }).spec.angles?.length, 3);
  assert.equal(N({ type: "polygon", vertices: [[0, 0], [1, 1]] }).spec.vertices!.length, 5);
  assert.equal(N({ type: "banana" }).spec.type, "right-triangle");
  assert.equal(N({ type: "banana" }, "cube").spec.type, "cube");
  for (const bad of [null, undefined, 42, [], "", { type: 5 }, { type: "kite", width: "x" }]) assert.doesNotThrow(() => N(bad as any));
  assert.equal(N({ type: "kite", circle: "both" }).spec.circle, undefined);
  assert.equal(N({ type: "hexagon", circle: true }).spec.circle, "both");
  assert.equal(N({ type: "rhombus", squares: true }).spec.squares, undefined);
});

test("legacy triangle content {a,b,labels:{a,b,c},squares,rightAngle:false}", () => {
  const r = N({ type: "right-triangle", a: 3, b: 4, labels: { a: "x", c: "$h$" }, squares: true, rightAngle: false }).spec;
  assert.deepEqual(r.labels?.sides, { a: "x", c: "h" });
  assert.equal(r.squares, true);
  assert.equal(marksPlan(r).rightAngles.length, 0);
  assert.deepEqual(N({ a: 3, b: 4 }).spec.type, "right-triangle");
  assert.deepEqual(N({ legs: [5, 12] }).spec.b, 12);
  assert.deepEqual(N({ sides: [3, 4, 5] }, "right-triangle").spec.a, 3);
});
