import { test } from "node:test";
import assert from "node:assert/strict";
import { Circle, Dot, Annulus, DashedLine, Line } from "../src/mobject/geometry.js";
import { FadeIn, FadeOut } from "../src/animation/Animation.js";
import { AnimationGroup } from "../src/animation/composition.js";
import { DecimalNumber } from "../src/mobject/value_tracker.js";
import { Torus, Cone, Cube } from "../src/mobject/surface.js";
import { Scene } from "../src/scene/Scene.js";
import { Color } from "../src/core/color.js";
import * as V from "../src/core/math/vector.js";

test("Circle defaults to a RED stroke, Dot stays WHITE", () => {
  const c = new Circle({ radius: 1 });
  assert.equal(c.strokeColor.toHex().toUpperCase(), "#FC6255");
  const d = new Dot();
  assert.equal(d.fillColor.toHex().toUpperCase(), "#FFFFFF");
});

test("Annulus defaults inner=1, outer=2", () => {
  const a = new Annulus();
  // Outer diameter ~4, so width ~4.
  assert.ok(Math.abs(a.getWidth() - 4) < 0.1);
});

test("DashedLine actually renders as multiple dash subpaths", () => {
  const d = new DashedLine([-2, 0, 0], [2, 0, 0], { numDashes: 10 });
  assert.equal(d.getSubpaths().length, 10); // solid Line would be 1
  // Endpoints preserved.
  assert.ok(V.equals(d.getStart(), [-2, 0, 0], 1e-9));
  assert.ok(V.equals(d.getEnd(), [2, 0, 0], 1e-6));
});

test("FadeIn applies the scale param (starts scaled, ends full size)", () => {
  const c = new Circle({ radius: 2 });
  const anim = new FadeIn(c, { scale: 0.5 });
  anim.begin();
  anim.interpolate(0);
  const startW = c.getWidth();
  anim.interpolate(1);
  const endW = c.getWidth();
  assert.ok(startW < endW - 0.5); // grew from half-size to full
  assert.ok(Math.abs(endW - 4) < 1e-6);
});

test("FadeOut applies the scale param", () => {
  const c = new Circle({ radius: 2 });
  const anim = new FadeOut(c, { scale: 2 });
  anim.begin();
  anim.interpolate(1);
  assert.ok(c.getWidth() > 5); // shrank? no — scaled UP toward 2x
  assert.ok(c.fillOpacity < 0.01 || c.strokeOpacity < 0.01);
});

test("AnimationGroup honors its rate function (default linear)", () => {
  const g = new AnimationGroup([]);
  assert.equal(g.rateFunc(0.3), 0.3); // linear, not smooth
});

test("DecimalNumber: commas, sign, and edge-fix", () => {
  const d = new DecimalNumber(1234.5, { numDecimalPlaces: 1, groupWithCommas: true });
  assert.equal(d.text, "1,234.5");
  const s = new DecimalNumber(5, { includeSign: true, numDecimalPlaces: 0 });
  assert.equal(s.text, "+5");
  // edge-fix LEFT: left edge stays put as the value widens.
  const n = new DecimalNumber(9, { numDecimalPlaces: 0 });
  const leftBefore = n.getBoundaryPoint([-1, 0, 0])[0];
  n.setValue(1000);
  const leftAfter = n.getBoundaryPoint([-1, 0, 0])[0];
  assert.ok(Math.abs(leftBefore - leftAfter) < 1e-6);
  assert.equal(n.getValue(), 1000);
  n.incrementValue(1);
  assert.equal(n.getValue(), 1001);
});

test("solid defaults: Torus 3/1, Cone height 1, Cube fill 0.75/stroke 0", () => {
  const t = new Torus();
  assert.ok(Math.abs(t.getWidth() - 8) < 0.3); // (major+minor)*2 = 8
  const cone = new Cone();
  const bb = cone.getBoundingBox();
  assert.ok(Math.abs((bb.max[2] - bb.min[2]) - 1) < 1e-6); // height 1
  const cube = new Cube({ sideLength: 2 });
  assert.ok(Math.abs(cube.submobjects[0].fillOpacity - 0.75) < 1e-9);
  assert.equal(cube.submobjects[0].strokeWidth, 0);
});
