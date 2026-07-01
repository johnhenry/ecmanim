import { test } from "node:test";
import assert from "node:assert/strict";
import { Circle, Square, Line, Rectangle, RegularPolygon, Dot } from "../src/mobject/geometry.js";
import { VMobject, VGroup } from "../src/mobject/VMobject.js";
import * as V from "../src/core/math/vector.js";

test("circle geometry: center, radius, bounds", () => {
  const c = new Circle({ radius: 2 });
  assert.ok(V.equals(c.getCenter(), [0, 0, 0], 1e-6));
  assert.ok(Math.abs(c.getWidth() - 4) < 1e-3);
  assert.ok(Math.abs(c.getHeight() - 4) < 1e-3);
});

test("shift and moveTo", () => {
  const s = new Square({ sideLength: 2 });
  s.shift([3, 0, 0]);
  assert.ok(V.equals(s.getCenter(), [3, 0, 0], 1e-9));
  s.moveTo([0, 5, 0]);
  assert.ok(V.equals(s.getCenter(), [0, 5, 0], 1e-9));
});

test("scale changes size about center", () => {
  const r = new Rectangle({ width: 4, height: 2 });
  r.scale(2);
  assert.ok(Math.abs(r.getWidth() - 8) < 1e-9);
  assert.ok(Math.abs(r.getHeight() - 4) < 1e-9);
  assert.ok(V.equals(r.getCenter(), [0, 0, 0], 1e-9));
});

test("rotate 90deg swaps width/height of a rectangle", () => {
  const r = new Rectangle({ width: 4, height: 2 });
  r.rotate(Math.PI / 2);
  assert.ok(Math.abs(r.getWidth() - 2) < 1e-6);
  assert.ok(Math.abs(r.getHeight() - 4) < 1e-6);
});

test("line start/end/length", () => {
  const l = new Line([0, 0, 0], [3, 4, 0]);
  assert.ok(V.equals(l.getStart(), [0, 0, 0]));
  assert.ok(V.equals(l.getEnd(), [3, 4, 0]));
  assert.ok(Math.abs(l.getLength() - 5) < 1e-6);
});

test("VMobject bezier point count invariant (1 + 3k per subpath)", () => {
  const c = new Circle({ radius: 1 });
  for (const sp of c.getSubpaths()) assert.equal((sp.length - 1) % 3, 0);
  assert.ok(c.getNumCurves() >= 4);
});

test("alignPointsWith equalizes point counts for Transform", () => {
  const a = new Circle({ radius: 1 });          // ~4 curves
  const b = new RegularPolygon(7, { radius: 1 }); // 7 curves
  const ac = a.copy(), bc = b.copy();
  ac.alignPointsWith(bc);
  bc.alignPointsWith(ac);
  assert.equal(ac.points.length, bc.points.length);
});

test("VGroup arrange lays out submobjects without overlap", () => {
  const g = new VGroup(new Square({ sideLength: 1 }), new Square({ sideLength: 1 }), new Square({ sideLength: 1 }));
  g.arrange(V.RIGHT, 0.5);
  const xs = g.submobjects.map((m) => m.getCenter()[0]);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2]);
});

test("copy is deep (independent points)", () => {
  const c = new Circle({ radius: 1 });
  const d = c.copy();
  d.shift([10, 0, 0]);
  assert.ok(V.equals(c.getCenter(), [0, 0, 0], 1e-9));
  assert.ok(V.equals(d.getCenter(), [10, 0, 0], 1e-6));
});

test("dot is small and positioned", () => {
  const d = new Dot({ point: [1, 1, 0] });
  assert.ok(V.equals(d.getCenter(), [1, 1, 0], 1e-6));
  assert.ok(d.getWidth() < 0.3);
});
