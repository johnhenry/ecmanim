// Regression tests for issue #5: `Mobject.color` was a dead field for
// rendering purposes -- raw assignment (`mob.color = "#..."`) never synced
// VMobject's strokeColor/fillColor, which the renderer actually reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Mobject } from "../src/mobject/Mobject.ts";
import { VMobject } from "../src/mobject/VMobject.ts";
import { Line } from "../src/mobject/geometry.ts";
import { Color } from "../src/core/color.ts";

test("issue #5 repro: raw `.color = ` assignment on a Line now syncs strokeColor", () => {
  const l = new Line([0, 0, 0], [1, 0, 0]);
  l.color = "#E8833A";
  assert.deepEqual(l.color, l.strokeColor);
  assert.deepEqual(l.strokeColor, Color.parse("#E8833A"));
  assert.deepEqual(l.fillColor, Color.parse("#E8833A"));
});

test("raw `.color = ` assignment on a plain Mobject still works (base class has no stroke/fill)", () => {
  const m = new Mobject();
  m.color = "#123456";
  assert.deepEqual(m.color, Color.parse("#123456"));
});

test("setColor and raw assignment now agree on the resulting color", () => {
  const a = new Line([0, 0, 0], [1, 0, 0]);
  const b = new Line([0, 0, 0], [1, 0, 0]);
  a.setColor("#4C6FD9");
  b.color = "#4C6FD9";
  assert.deepEqual(a.strokeColor, b.strokeColor);
  assert.deepEqual(a.fillColor, b.fillColor);
  assert.deepEqual(a.color, b.color);
});

test("VMobject.setColor does not infinitely recurse through the color setter", () => {
  const l = new Line([0, 0, 0], [1, 0, 0]);
  assert.doesNotThrow(() => l.setColor("#00FF00"));
  assert.deepEqual(l.color, Color.parse("#00FF00"));
});

test("raw `.color = ` assignment on a VGroup propagates to submobjects (like setColor)", () => {
  const group = new VMobject();
  const child = new Line([0, 0, 0], [1, 0, 0]);
  group.add(child);
  group.color = "#FF00FF";
  assert.deepEqual(child.strokeColor, Color.parse("#FF00FF"));
});

test("become() copies color without recoloring the target's stale/discarded submobjects", () => {
  const src = new Line([0, 0, 0], [1, 0, 0]);
  src.setColor("#00FF00");

  const target = new VMobject();
  const stale = new Line([0, 0, 0], [1, 0, 0]);
  stale.setColor("#000000");
  target.add(stale);

  target.become(src);
  // The stale submobject was never part of `src` and must be untouched --
  // become() must not recurse setColor() into the target's old children.
  assert.deepEqual(stale.strokeColor, Color.parse("#000000"));
  assert.deepEqual(target.color, Color.parse("#00FF00"));
});

test("copy() clones submobjects, so recoloring the clone leaves the original untouched", () => {
  const src = new VMobject();
  const child = new Line([0, 0, 0], [1, 0, 0]);
  src.add(child);
  src.setColor("#222222"); // recursive by design: recolors child too

  const clone = src.copy();
  clone.color = "#333333"; // must not reach back into src's own (live) child

  assert.deepEqual(child.strokeColor, Color.parse("#222222"));
  assert.deepEqual(src.color, Color.parse("#222222"));
  assert.deepEqual(clone.color, Color.parse("#333333"));
});

test("Mobject.interpolate() blends the base color field via the backing field (no recursion overhead)", () => {
  const start = new Mobject();
  start.color = "#000000";
  const target = new Mobject();
  target.color = "#FFFFFF";
  const mid = new Mobject();

  mid.interpolate(start, target, 0.5);
  assert.ok(mid.color.r > 0.4 && mid.color.r < 0.6);
});
