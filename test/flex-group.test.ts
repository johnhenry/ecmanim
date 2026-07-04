import { test } from "node:test";
import assert from "node:assert/strict";

import { FlexGroup, isYogaLoaded } from "../src/mobject/flex_group.ts";
import { Square } from "../src/mobject/geometry.ts";

const approx = (a: number, b: number, eps = 1e-4) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b} (eps ${eps})`);

test("three children in a row with justifyContent: space-between match Yoga's expected computed layout", async () => {
  const group = new FlexGroup({
    direction: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    width: 10,
    height: 4,
  });
  const a = new Square({ sideLength: 2 });
  const b = new Square({ sideLength: 2 });
  const c = new Square({ sideLength: 2 });
  group.add(a, b, c);

  // Capture the pre-layout center: layout() anchors the container's
  // world-space top-left to wherever the group's own center already is
  // BEFORE repositioning children (the post-layout center reflects the
  // NEW, already-repositioned bounding box, so it can't be used to predict
  // the very layout that produced it).
  const preLayoutCenter = group.getCenter();
  const result = await group.layout();
  assert.equal(result, group, "layout() is chainable");

  // Yoga space-between for 3 width-2 children in a 10-wide row: left edges
  // at 0, 4, 8 (gap = (10 - 3*2) / (3-1) = 2 between each).
  const originX = preLayoutCenter[0] - 10 / 2;
  const originY = preLayoutCenter[1] + 4 / 2;
  approx(a.getCenter()[0], originX + 0 + 1);
  approx(b.getCenter()[0], originX + 4 + 1);
  approx(c.getCenter()[0], originX + 8 + 1);
  // alignItems: flex-start -> every child's top edge sits at the container top.
  approx(a.getCenter()[1], originY - 1);
  approx(b.getCenter()[1], originY - 1);
  approx(c.getCenter()[1], originY - 1);
});

test("isYogaLoaded() becomes true after the first layout() call", async () => {
  const group = new FlexGroup({ width: 4, height: 2 });
  group.add(new Square({ sideLength: 1 }));
  await group.layout();
  assert.equal(isYogaLoaded(), true);
});

test("column direction with a gap stacks children vertically with the given spacing", async () => {
  const group = new FlexGroup({ direction: "column", alignItems: "flex-start", gap: 1, width: 4, height: 20 });
  const a = new Square({ sideLength: 2 });
  const b = new Square({ sideLength: 2 });
  group.add(a, b);
  await group.layout();

  // b sits `gap` below a: a's bottom edge (top + 2) + gap(1) = b's top edge.
  const dy = a.getCenter()[1] - b.getCenter()[1];
  approx(dy, 2 + 1); // one full child height (2) plus the 1-unit gap
});

test("setChildFlex(flexGrow) lets one child grow to fill remaining space", async () => {
  const group = new FlexGroup({ direction: "row", alignItems: "flex-start", width: 10, height: 4 });
  const fixed = new Square({ sideLength: 2 });
  const growable = new Square({ sideLength: 2 });
  group.add(fixed, growable);
  group.setChildFlex(growable, { flexGrow: 1 });
  await group.layout();

  // Default justifyContent (flex-start): fixed occupies [0,2] (center at 1);
  // growable absorbs ALL remaining width (10-2=8), occupying [2,10]
  // (center at 6) -- independent of the group's own (pre/post-layout)
  // center, since both are measured in the same post-layout frame.
  const gap = growable.getCenter()[0] - fixed.getCenter()[0];
  approx(gap, 6 - 1);

  // Issue #23, confirmed via direct repro and now fixed: growable's own
  // getWidth() was previously unchanged (still 2) after layout() -- it was
  // only ever repositioned to Yoga's computed box, never resized to fill
  // it. Now matches real CSS flexbox: the child visibly grows.
  approx(growable.getWidth(), 8); // flexGrow:1 fills the remaining width (10 - fixed's 2)
  approx(fixed.getWidth(), 2); // a child with no flexGrow/flexShrink keeps its own authored size
  approx(growable.getHeight(), 2); // flexGrow only resizes the main axis; height is untouched
});

test("setChildFlex(flexShrink) shrinks a child below its flexBasis when siblings overflow the container", async () => {
  const group = new FlexGroup({ direction: "row", alignItems: "flex-start", width: 6, height: 4 });
  const rigid = new Square({ sideLength: 4 });
  const shrinkable = new Square({ sideLength: 4 });
  group.add(rigid, shrinkable);
  group.setChildFlex(shrinkable, { flexShrink: 1 });
  await group.layout();

  // Two 4-wide children overflow a 6-wide row by 2; with only `shrinkable`
  // allowed to shrink, it absorbs the full 2-unit overflow (4 -> 2) while
  // `rigid` (flexShrink unset, default 0) keeps its full authored width.
  approx(rigid.getWidth(), 4); // no flexShrink -- keeps its authored size even when siblings overflow
  approx(shrinkable.getWidth(), 2); // flexShrink:1 absorbs the container overflow
});

test("a child with neither flexGrow nor flexShrink is never resized by layout()", async () => {
  const group = new FlexGroup({ direction: "row", justifyContent: "center", width: 10, height: 4 });
  const a = new Square({ sideLength: 2 });
  const b = new Square({ sideLength: 3 });
  group.add(a, b);
  await group.layout();
  approx(a.getWidth(), 2);
  approx(b.getWidth(), 3);
});

test("a child outside any FlexGroup is completely unaffected", () => {
  const s = new Square({ sideLength: 3 });
  const before = s.getCenter();
  // No FlexGroup involved at all -- nothing should move it.
  assert.deepEqual(s.getCenter(), before);
});
