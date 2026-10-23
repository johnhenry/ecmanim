import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene } from "../src/scene/Scene.ts";
import { GeometryFigure, GeometryReveal } from "../src/mobject/geometry_figure.ts";
import { SHAPE_TYPES, shapeCategory, shapePartNames } from "../src/mobject/geometry_spec.ts";
import { initMathTex } from "../src/mobject/mathtex.ts";

await initMathTex();
const fig = (spec: any, cfg: any = {}) => new GeometryFigure(spec, cfg);
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("every shape type builds, has finite geometry and resolvable parts", () => {
  for (const t of SHAPE_TYPES) {
    const f = fig({ type: t });
    assert.deepEqual(f.notes, [], t);
    for (const m of f.getFamily()) for (const p of m.points) assert.ok(p.every(Number.isFinite), t);
    for (const name of f.partNames()) {
      const part = f.part(name);
      assert.ok(part, `${t}.${name}`);
      assert.ok(part!.anchor.every(Number.isFinite) && part!.mobs.length > 0, `${t}.${name}`);
    }
  }
});

test("size controls the extent; parts follow the figure when it is moved and scaled", () => {
  const f = fig({ type: "rectangle", w: 4, h: 2 }, { size: 4 });
  close(f.getWidth(), 4, 0.5);
  const a0 = f.part("A")!.anchor;
  f.shift([2, 1, 0]).scale(0.5, { aboutPoint: [0, 0, 0] });
  const a1 = f.part("A")!.anchor;
  close(a1[0], (a0[0] + 2) * 0.5, 0.01); close(a1[1], (a0[1] + 1) * 0.5, 0.01);
});

test("triangle part aliases: a is BC, b is CA, c is the hypotenuse", () => {
  const f = fig({ type: "right-triangle", a: 3, b: 4 });
  const len = (n: string) => { const p = f.part(n)!.mobs[0].points; return Math.hypot(p[p.length - 1][0] - p[0][0], p[p.length - 1][1] - p[0][1]); };
  close(len("c") / len("a"), 5 / 3, 1e-6); close(len("b") / len("a"), 4 / 3, 1e-6);
  assert.equal(f.part("BC")!.name, "a");
  assert.equal(f.part("ac")!.name, "b");
  const mid = f.part("c")!.anchor, A = f.part("A")!.anchor, B = f.part("B")!.anchor;
  close(mid[0], (A[0] + B[0]) / 2, 1e-6);
  assert.equal(f.part("nonsense"), undefined);
});

test("marks make each subtype recognisable (mobject counts)", () => {
  const count = (spec: any, part: string) => fig(spec).part(part)?.mobs.length ?? 0;
  assert.equal(count("rhombus", "ticks"), 4);
  assert.equal(count("rhombus", "arrows"), 6); // 2 + 2*2
  assert.equal(count("kite", "ticks"), 6); // 1+1+2+2
  assert.equal(count("isosceles-trapezoid", "arrows"), 2);
  assert.equal(count("isosceles-trapezoid", "ticks"), 2);
  assert.equal(count("isosceles-trapezoid", "arcs"), 6); // 1+1+2+2
  assert.equal(count("right-triangle", "right"), 1);
  assert.equal(count("square", "rightAngles"), 4);
  assert.equal(count({ type: "rhombus", marks: false }, "ticks"), 0);
  assert.equal(fig({ type: "hexagon", circle: "both" }).part("circle")!.mobs.length, 2);
  assert.equal(fig({ type: "parallelogram", altitude: true }).part("height")!.mobs.length, 2);
  assert.ok(fig({ type: "rhombus", diagonals: true }).part("diagonalAC"));
  assert.ok(fig({ type: "right-triangle", squares: true }).part("squareC"));
});

test("solids: faces/edges/vertices, pure setTime, spin changes the view, frame survives moves", () => {
  const cube = fig({ type: "cube", spin: 40 });
  assert.equal(shapePartNames(cube.spec).length, 26);
  const snap = () => cube.part("vertex0")!.anchor.map((x) => +x.toFixed(6));
  cube.setTime(1.5);
  const t15 = snap();
  cube.setTime(3); const t3 = snap();
  cube.setTime(1.5);
  assert.deepEqual(snap(), t15); // pure in t
  assert.notDeepEqual(t15, t3);
  // moving the figure then re-projecting keeps it centred on the new spot
  cube.moveTo([4, -1, 0]);
  cube.setTime(2);
  const c = cube.part("face0")!.center;
  assert.ok(Math.abs(c[0] - 4) < 2.2 && Math.abs(c[1] + 1) < 2.2);
  assert.ok(Math.abs(cube.getCenter()[0] - 4) < 0.3);
  // back edges are dashed (more than one subpath), front edges solid
  const subpaths = cube.getFamily().filter((m: any) => m.subpathStarts?.length > 1).length;
  assert.ok(subpaths > 0 && subpaths < 12);
  // every platonic solid projects
  for (const t of ["tetrahedron", "octahedron", "dodecahedron", "icosahedron", "prism", "pyramid", "cuboid"]) {
    const f = fig({ type: t, spin: 10 }); f.setTime(2.2);
    assert.ok(f.getFamily().every((m: any) => m.points.every((p: number[]) => p.every(Number.isFinite))), t);
  }
});

test("reveal introduces the figure and ends with everything visible; highlight restores style", async () => {
  const f = fig({ type: "rhombus", labels: { vertices: true } });
  const sc = new Scene({ fps: 10 });
  sc.frameHandler = async () => {};
  const reveal = f.reveal();
  assert.ok(reveal instanceof GeometryReveal);
  assert.ok(reveal.runTime > 1.5);
  await sc.play(reveal, { _playConfig: true });
  assert.ok(sc.mobjects.includes(f));
  assert.equal(sc.mobjects.length, 1); // children are not introduced separately
  const side = f.part("AB")!.mobs[0];
  assert.equal(side.strokeEnd, 1);
  const before = { w: side.strokeWidth, o: side.strokeOpacity, fo: side.fillOpacity };
  await sc.play(f.highlight("AB"), { _playConfig: true });
  assert.deepEqual({ w: side.strokeWidth, o: side.strokeOpacity, fo: side.fillOpacity }, before);
  // an invisible placeholder (angle without a default arc) can be highlighted too
  const f2 = fig({ type: "scalene-triangle" });
  const arc = f2.part("angleA")!.mobs[0];
  assert.equal(arc.strokeOpacity, 0);
  const anim = f2.highlight("angleA");
  anim.begin(); anim.interpolate(0.5);
  assert.ok(arc.strokeOpacity > 0.9);
  anim.finish();
  assert.equal(arc.strokeOpacity, 0);
  assert.throws(() => f2.highlight("zzz"), /unknown part/);
});

test("falls back to plain text labels when MathJax is not initialised? (no throw)", () => {
  assert.doesNotThrow(() => fig({ type: "triangle", labels: { vertices: true, sides: true, angles: true } }));
});

test("shape categories", () => {
  assert.equal(shapeCategory("cube"), "solid");
  assert.equal(shapeCategory("kite"), "quadrilateral");
});
