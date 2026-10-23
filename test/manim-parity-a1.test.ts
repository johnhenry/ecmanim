// Wave A1 of the manim-parity v2 epic (#114, #115): style family recursion,
// arrange centering, nextTo alignedEdge, add() cycle guard. Expected numbers
// come from Manim Community (mobject.py / vectorized_mobject.py), see comments.

import { test } from "node:test";
import assert from "node:assert/strict";
import { VGroup, VMobject } from "../src/mobject/VMobject.ts";
import { Mobject } from "../src/mobject/Mobject.ts";
import { Circle, Square } from "../src/mobject/geometry.ts";
import * as V from "../src/core/math/vector.ts";

const close = (a: number[], b: number[], eps = 1e-9) =>
  a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < eps, `${a} vs ${b}`));

test("setFill/setStroke recurse into the family by default (CE family=True)", () => {
  const g = new VGroup(new Circle(), new Square());
  g.setFill("#ff0000", 0.5);
  assert.deepEqual(g.submobjects.map((m) => (m as VMobject).fillOpacity), [0.5, 0.5]);
  g.setStroke("#00ff00", 8);
  assert.deepEqual(g.submobjects.map((m) => (m as VMobject).strokeWidth), [8, 8]);
  const nested = new VGroup(new VGroup(new Circle()));
  nested.setFill("#ff0000", 0.25);
  assert.equal(((nested.submobjects[0] as VGroup).submobjects[0] as VMobject).fillOpacity, 0.25);
});

test("family:false restyles only the parent; setStyle/setSheen/setBackgroundStroke recurse", () => {
  const g = new VGroup(new Circle());
  const kid = g.submobjects[0] as VMobject;
  g.setFill("#ff0000", 0.5, false);
  assert.equal(kid.fillOpacity, 0);
  g.setStroke("#00ff00", { width: 8, family: false });
  assert.equal(kid.strokeWidth, 4);
  g.setStyle({ fillOpacity: 0.7, strokeWidth: 2 });
  assert.equal(kid.fillOpacity, 0.7);
  assert.equal(kid.strokeWidth, 2);
  g.setBackgroundStroke({ width: 6 });
  assert.equal(kid.backgroundStrokeWidth, 6);
  g.setSheen(0.3);
  assert.equal(kid.sheenFactor, 0.3);
});

test("VGroup.arrange(RIGHT, 0.5) recenters (CE center=True)", () => {
  const g = new VGroup(new Square(), new Square(), new Square());
  g.arrange(V.RIGHT, 0.5);
  // 3 squares of side 2 + 2 gaps of 0.5 = width 7, centered at the origin.
  close(g.getCenter(), [0, 0, 0]);
  close(g.getLeft(), [-3.5, 0, 0]);
  const g2 = new VGroup(new Square(), new Square());
  g2.arrange(V.RIGHT, { buff: 0.5, center: false });
  close(g2.submobjects[0].getCenter(), [0, 0, 0]);
  close(g2.submobjects[1].getCenter(), [2.5, 0, 0]);
});

test("arrange forwards alignedEdge / coorMask to nextTo", () => {
  const a = new Square({ sideLength: 2 });
  const b = new Square({ sideLength: 1 });
  const g = new VGroup(a, b).arrange(V.RIGHT, { buff: 0.25, alignedEdge: V.UP, center: false });
  assert.ok(Math.abs(b.getTop()[1] - a.getTop()[1]) < 1e-9);
  assert.ok(Math.abs(g.getTop()[1] - 1) < 1e-9 || g.getTop()[1] > 0);
});

test("nextTo honours alignedEdge (CE next_to)", () => {
  const b = new Square({ sideLength: 2 }); // top at y=1
  const a = new Square({ sideLength: 1 });
  a.nextTo(b, V.RIGHT, 0.25, V.UP);
  close(a.getTop(), [a.getCenter()[0], 1, 0]);
  close(a.getLeft(), [1.25, a.getCenter()[1], 0]);
  // options-object form
  const c = new Square({ sideLength: 1 });
  c.nextTo(b, V.RIGHT, { buff: 0.25, alignedEdge: V.UP });
  close(c.getCenter(), a.getCenter());
  // default (no alignedEdge) stays centered perpendicular
  const d = new Square({ sideLength: 1 }).nextTo(b, V.RIGHT, 0.25);
  close(d.getCenter(), [1.75, 0, 0]);
});

test("nextTo coorMask and submobjectToAlign / indexOfSubmobjectToAlign", () => {
  const b = new Square({ sideLength: 2 });
  const a = new Square({ sideLength: 1 });
  a.nextTo(b, V.RIGHT, 0.25, V.UP, null, null, [1, 0, 1]); // no y motion
  close(a.getCenter(), [1.75, 0, 0]);
  const parts = new VGroup(new Square({ sideLength: 1 }), new Square({ sideLength: 1 }).shift([5, 0, 0]));
  const t = new Square({ sideLength: 1 });
  t.nextTo(parts, V.RIGHT, 0, null, t, 0); // CE: aligner = submobject_to_align
  // aligns to submobject 0 (right edge x=0.5), not to the group's right edge.
  close(t.getLeft(), [0.5, 0, 0]);
});

test("add() rejects self-add and ancestors (CE ValueError)", () => {
  const s = new Mobject();
  assert.throws(() => s.add(s), /itself/);
  const parent = new Mobject();
  const child = new Mobject();
  parent.add(child);
  assert.throws(() => child.add(parent), /cycle|contains/);
  assert.equal(child.getFamily().length, 1);
});
