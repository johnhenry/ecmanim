// Tests for the Animation base upgrades: per-submobject lag_ratio, reverse
// rate functions, Transform path_arc, and Scene.play updater suspension.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Circle, Square } from "../src/mobject/geometry.ts";
import { VGroup } from "../src/mobject/VMobject.ts";
import { Animation, Create, Transform, Uncreate } from "../src/animation/Animation.ts";
import { Scene } from "../src/scene/Scene.ts";
import * as V from "../src/core/math/vector.ts";

test("getSubAlpha: index 0 leads, last submobject lags", () => {
  const anim = new Animation(new Circle({ radius: 1 }), { lagRatio: 0.5 });
  const n = 3;
  // With lag 0.5 and n=3, fullLength = (3-1)*0.5 + 1 = 2. At alpha=0.5, value=1.
  // index 0 slice starts at 0 -> sub = clamp(1-0)=1; index 2 starts at 1 -> sub=0.
  const a0 = anim.getSubAlpha(0.5, 0, n);
  const a1 = anim.getSubAlpha(0.5, 1, n);
  const a2 = anim.getSubAlpha(0.5, 2, n);
  assert.ok(a0 > a1 && a1 > a2, "leading member has higher sub-alpha than lagging");
  assert.equal(a0, 1);
  assert.equal(a2, 0);
  // endpoints: alpha 0 -> all 0; alpha 1 -> all 1.
  assert.equal(anim.getSubAlpha(0, 0, n), 0);
  assert.equal(anim.getSubAlpha(1, 2, n), 1);
});

test("Create on a VGroup of 3 submobjects staggers strokeEnd at alpha=0.5", () => {
  const g = new VGroup(
    new Circle({ radius: 1 }),
    new Circle({ radius: 1 }),
    new Circle({ radius: 1 }),
  );
  const anim = new Create(g, { lagRatio: 0.5, rateFunc: (t: number) => t });
  anim.begin();
  anim.interpolate(0.5);
  // Family is [group, child0, child1, child2]; children should be staggered.
  const fam = g.getFamily();
  const ends = fam.map((m: any) => m.strokeEnd);
  // Strictly decreasing across the staggered members (leading draws more).
  const kids = ends.slice(1);
  assert.ok(kids[0] > kids[1] && kids[1] > kids[2], `expected staggered, got ${kids}`);
  assert.ok(kids[0] > 0 && kids[2] < 1);
});

test("single-mobject Create still animates strokeEnd 0 -> 1 exactly", () => {
  const c = new Circle({ radius: 1 });
  const anim = new Create(c); // lagRatio default 0
  anim.begin();
  anim.interpolate(0);
  assert.ok(c.strokeEnd <= 0.01);
  anim.interpolate(0.5);
  assert.ok(c.strokeEnd > 0.3 && c.strokeEnd < 0.7);
  anim.finish();
  assert.equal(c.strokeEnd, 1);
});

test("single-submobject family under lagRatio still reaches 1 at alpha=1", () => {
  const c = new Circle({ radius: 1 });
  const anim = new Create(c, { lagRatio: 0.5, rateFunc: (t: number) => t });
  anim.begin();
  anim.interpolate(1);
  assert.equal(c.strokeEnd, 1); // n=1 window is full width
});

test("Transform with pathArc bends the trajectory off the straight line", () => {
  // A degenerate single-point-ish move: translate a circle far right.
  const startMob = new Circle({ radius: 0.5 });
  const target = new Circle({ radius: 0.5 }).moveTo([4, 0, 0]);
  const straight = new Circle({ radius: 0.5 });
  const straightTarget = new Circle({ radius: 0.5 }).moveTo([4, 0, 0]);

  const arced = new Transform(startMob, target, { pathArc: Math.PI / 2, rateFunc: (t: number) => t });
  const flat = new Transform(straight, straightTarget, { rateFunc: (t: number) => t });
  arced.begin();
  flat.begin();
  arced.interpolate(0.5);
  flat.interpolate(0.5);
  const arcedCenter = startMob.getCenter();
  const flatCenter = straight.getCenter();
  // The straight path midpoint sits at ~x=2, y=0. The arc must deviate.
  const deviation = V.distance(arcedCenter, flatCenter);
  assert.ok(deviation > 0.1, `arc should bend off straight line, deviation=${deviation}`);
});

test("reverseRateFunc reverses the effective progress", () => {
  const base = new Animation(new Circle({ radius: 1 }), { rateFunc: (t: number) => t });
  const rev = new Animation(new Circle({ radius: 1 }), { rateFunc: (t: number) => t, reverseRateFunc: true });
  // running() wraps but linear stays linear; reversed(0.25) == 1 - 0.25.
  assert.ok(Math.abs(base.rateFunc(0.25) - 0.25) < 1e-9);
  assert.ok(Math.abs(rev.rateFunc(0.25) - 0.75) < 1e-9);
  assert.ok(Math.abs(rev.rateFunc(0) - 1) < 1e-9);
  assert.ok(Math.abs(rev.rateFunc(1) - 0) < 1e-9);
});

test("Uncreate erases: strokeEnd goes 1 -> 0", () => {
  const c = new Circle({ radius: 1 });
  const anim = new Uncreate(c);
  anim.begin();
  anim.interpolate(0);
  assert.ok(c.strokeEnd > 0.99, `start full, got ${c.strokeEnd}`);
  anim.finish();
  assert.equal(c.strokeEnd, 0);
});

test("Scene.play suspends an updater during the anim and resumes after", async () => {
  const scene = new Scene({ fps: 10, frameHandler: async () => {} });
  const c = new Circle({ radius: 1 });
  let ticks = 0;
  c.addUpdater(() => { ticks += 1; });
  scene.add(c);

  await scene.play(new Transform(c, new Square({ sideLength: 2 })), { _playConfig: true, runTime: 1 });
  const duringPlay = ticks;
  assert.equal(duringPlay, 0, "updater must not fire while suspended during play");

  await scene.wait(0.5);
  assert.ok(ticks > 0, "updater fires again after play resumes it");
});
