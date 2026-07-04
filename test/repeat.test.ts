import { test } from "node:test";
import assert from "node:assert/strict";

import { Repeat } from "../src/animation/repeat.ts";
import { ApplyMethod } from "../src/animation/Animation.ts";
import { AnimationGroup } from "../src/animation/composition.ts";
import { Timeline } from "../src/animation/timeline.ts";
import { Circle } from "../src/mobject/geometry.ts";
import { linear } from "../src/animation/rate_functions.ts";

// A deterministic, linearly-eased 1-second shift by +1 on the x axis.
function shiftAnim(mob: any, dx = 1, runTime = 1): any {
  const a = new ApplyMethod(mob, "shift", [dx, 0, 0]);
  a.rateFunc = linear;
  a.runTime = runTime;
  return a;
}

test("count: Infinity throws", () => {
  const c = new Circle();
  assert.throws(() => new Repeat(shiftAnim(c), { count: Infinity }), RangeError);
});

test("count=3 repeats identically: each cycle reproduces the same forward motion", () => {
  const c = new Circle();
  const rep = new Repeat(shiftAnim(c), { count: 3 });
  assert.equal(rep.runTime, 3);
  rep.begin();

  rep.interpolate((1 / 3) * 0.5); // cycle 0, halfway
  assert.ok(Math.abs(c.getCenter()[0] - 0.5) < 1e-6, `cycle0 mid, got ${c.getCenter()[0]}`);

  rep.interpolate(1 / 3 + (1 / 3) * 0.5); // cycle 1, halfway -- resets, not compounding
  assert.ok(Math.abs(c.getCenter()[0] - 0.5) < 1e-6, `cycle1 mid (reset), got ${c.getCenter()[0]}`);

  rep.interpolate(1); // cycle 2, end
  assert.ok(Math.abs(c.getCenter()[0] - 1) < 1e-6, `end at x=1, got ${c.getCenter()[0]}`);
});

test("yoyo mirrors odd cycles: count=2 ends back at the start value", () => {
  const c = new Circle();
  const rep = new Repeat(shiftAnim(c), { count: 2, yoyo: true });
  assert.equal(rep.runTime, 2);
  rep.begin();

  rep.interpolate(0.25); // cycle 0 (forward), quarter-way through the full runtime = half of cycle0
  assert.ok(Math.abs(c.getCenter()[0] - 0.5) < 1e-6, `cycle0 mid, got ${c.getCenter()[0]}`);

  rep.interpolate(0.5); // cycle 0 end
  assert.ok(Math.abs(c.getCenter()[0] - 1) < 1e-6, `cycle0 end at x=1, got ${c.getCenter()[0]}`);

  rep.interpolate(1); // cycle 1 (reversed) end -- yoyo means this lands back at the start value
  assert.ok(Math.abs(c.getCenter()[0] - 0) < 1e-6, `yoyo end back at x=0, got ${c.getCenter()[0]}`);

  // Contrast: the same count=2 WITHOUT yoyo ends at x=1 (forward twice), not x=0.
  const c2 = new Circle();
  const repNoYoyo = new Repeat(shiftAnim(c2), { count: 2 });
  repNoYoyo.begin();
  repNoYoyo.interpolate(1);
  assert.ok(Math.abs(c2.getCenter()[0] - 1) < 1e-6, `non-yoyo end at x=1, got ${c2.getCenter()[0]}`);
});

test("repeatDelay holds the end value between cycles", () => {
  const c = new Circle();
  const rep = new Repeat(shiftAnim(c), { count: 2, repeatDelay: 1 });
  assert.equal(rep.runTime, 3); // 1 + 1(delay) + 1
  rep.begin();

  rep.interpolate(1 / 3); // exactly cycle0's end
  assert.ok(Math.abs(c.getCenter()[0] - 1) < 1e-6, `cycle0 end x=1, got ${c.getCenter()[0]}`);

  rep.interpolate(0.5); // mid-gap -- held at cycle0's end value, not reset toward cycle1's start
  assert.ok(Math.abs(c.getCenter()[0] - 1) < 1e-6, `held during gap at x=1, got ${c.getCenter()[0]}`);

  rep.interpolate(2 / 3); // cycle1 starts here
  assert.ok(Math.abs(c.getCenter()[0] - 0) < 1e-6, `cycle1 restarts at x=0, got ${c.getCenter()[0]}`);
});

test("wraps a leaf Animation, an AnimationGroup, and a built Timeline identically", () => {
  const trajectories: number[] = [];

  const cLeaf = new Circle();
  const repLeaf = new Repeat(shiftAnim(cLeaf), { count: 2 });
  repLeaf.begin();

  const cGroup = new Circle();
  const group = new AnimationGroup([shiftAnim(cGroup)], { runTime: 1 });
  const repGroup = new Repeat(group, { count: 2 });
  repGroup.begin();

  const cTimeline = new Circle();
  const tl = new Timeline();
  tl.add(shiftAnim(cTimeline));
  const built = tl.build();
  const repTimeline = new Repeat(built, { count: 2 });
  repTimeline.begin();

  for (const t of [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1]) {
    repLeaf.interpolate(t);
    repGroup.interpolate(t);
    repTimeline.interpolate(t);
    const xs = [cLeaf.getCenter()[0], cGroup.getCenter()[0], cTimeline.getCenter()[0]];
    trajectories.push(...xs);
    assert.ok(
      Math.abs(xs[0] - xs[1]) < 1e-6 && Math.abs(xs[1] - xs[2]) < 1e-6,
      `at t=${t}, expected identical x across leaf/group/timeline wraps, got ${JSON.stringify(xs)}`,
    );
  }
  assert.ok(trajectories.length > 0);
});
