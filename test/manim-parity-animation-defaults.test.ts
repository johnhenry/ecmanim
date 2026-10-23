// Wave A3 (#117, epic #114): animation defaults and rate functions pinned to
// Manim Community. Expected numbers come from CE's source:
//   creation.py Create (lag_ratio=1.0), Write._set_default_config_from_length,
//   updaters/update.py UpdateFromFunc (suspend_mobject_updating=False),
//   utils/rate_functions.py there_and_back_with_pause / running_start.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Create, Write, Uncreate } from "../src/animation/Animation.ts";
import { UpdateFromFunc, UpdateFromAlphaFunc } from "../src/animation/specialized.ts";
import { smooth, thereAndBackWithPause, runningStart } from "../src/animation/rate_functions.ts";
import { Circle } from "../src/mobject/geometry.ts";
import { VGroup } from "../src/mobject/VMobject.ts";

const circles = (n: number) => new VGroup(...Array.from({ length: n }, (_, i) => new Circle({ radius: 0.2 }).shift([i * 0.1, 0, 0])));
const kidEnds = (g: any) => g.submobjects.map((m: any) => m.strokeEnd);
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("Create defaults to lagRatio 1 (CE creation.py Create.__init__)", () => {
  const a = new Create(circles(3));
  assert.equal(a.lagRatio, 1);
  assert.equal(new Create(circles(3), { lagRatio: 0 }).lagRatio, 0, "explicit 0 still honoured");
  assert.equal(new Uncreate(circles(3)).lagRatio, 1, "Uncreate extends Create in CE");
});

test("Create on 3 children at alpha 0.5 draws them in sequence", () => {
  const g = circles(3);
  const a = new Create(g, { rateFunc: (t: number) => t });
  a.begin();
  a.interpolate(0.5);
  // CE get_sub_alpha: full_length=(n-1)*lag+1 = 3; value=1.5 -> [1, .5, 0]
  const [e0, e1, e2] = kidEnds(g);
  near(e0, 1); near(e1, 0.5); near(e2, 0);
});

test("Write run time / lag ratio derive from family length (CE Write._set_default_config_from_length)", () => {
  const w3 = new Write(circles(3));
  assert.equal(w3.runTime, 1);
  near(w3.lagRatio, 0.2); // min(4/3, 0.2)
  const w14 = new Write(circles(14));
  assert.equal(w14.runTime, 1);
  near(w14.lagRatio, 0.2); // min(4/14=.2857, .2)
  const w15 = new Write(circles(15));
  assert.equal(w15.runTime, 2, "length >= 15 -> 2s");
  near(w15.lagRatio, 0.2);
  const w40 = new Write(circles(40));
  assert.equal(w40.runTime, 2);
  near(w40.lagRatio, 0.1); // 4/40
  const w1 = new Write(new Circle());
  assert.equal(w1.runTime, 1);
  near(w1.lagRatio, 0.2);
  // explicit values win
  const e = new Write(circles(40), { runTime: 3, lagRatio: 0.5 });
  assert.equal(e.runTime, 3);
  assert.equal(e.lagRatio, 0.5);
});

test("Write counts only family members with points (not the empty VGroup)", () => {
  // 20 circles with points -> 2s; if the empty parent counted it would still
  // be 2s, so pin the 4/n boundary: n=20 -> 0.2 (4/20), n=21 -> 4/21.
  near(new Write(circles(21)).lagRatio, 4 / 21 > 0.2 ? 0.2 : 4 / 21);
  near(new Write(circles(50)).lagRatio, 0.08); // 4/50, would be 4/51 if the group counted
});

test("Write rate function defaults to linear", () => {
  const w = new Write(new Circle());
  near(w.rateFunc(0.3), 0.3);
});

test("Write reverse: remover true, introducer false, last child draws first", () => {
  const fwd = new Write(circles(3));
  assert.equal(fwd.remover, false);
  assert.equal(fwd.introducer, true);
  const g = circles(3);
  const rev = new Write(g, { reverse: true, lagRatio: 1 });
  assert.equal(rev.remover, true);
  assert.equal(rev.introducer, false);
  assert.equal(new Write(circles(3), { reverse: true, remover: false }).remover, false, "explicit remover wins");
  rev.begin();
  rev.interpolate(0.4);
  const [e0, e1, e2] = kidEnds(g);
  near(e2, 1); near(e1, 0.4); near(e0, 0); assert.ok(e2 > e1 && e1 >= e0, `reverse should lead with the last child: ${[e0, e1, e2]}`);
  rev.finish();
  assert.deepEqual(kidEnds(g), [1, 1, 1]);
});

test("Write draws the border first, then fills (CE DrawBorderThenFill)", () => {
  const c = new Circle({ radius: 1, fillOpacity: 0.8 });
  const w = new Write(c);
  w.begin();
  w.interpolate(0.25);
  near(c.strokeEnd, 0.5);
  assert.equal(c.fillOpacity, 0, "no fill during the border phase");
  w.interpolate(0.75);
  near(c.strokeEnd, 1);
  near(c.fillOpacity, 0.4);
  w.finish();
  near(c.fillOpacity, 0.8);
});

test("UpdateFromFunc / UpdateFromAlphaFunc do not suspend mobject updating by default (CE update.py)", () => {
  const c = new Circle();
  assert.equal(new UpdateFromFunc(c, () => {}).suspendMobjectUpdating, false);
  assert.equal(new UpdateFromAlphaFunc(c, () => {}).suspendMobjectUpdating, false);
  assert.equal(new UpdateFromFunc(c, () => {}, { suspendMobjectUpdating: true }).suspendMobjectUpdating, true);
});

test("thereAndBackWithPause uses a = 2/(1-pauseRatio) (CE rate_functions.py)", () => {
  // default pause 1/3 -> a = 3 (identical to the old formula only here)
  near(thereAndBackWithPause(0.1), smooth(0.3));
  near(thereAndBackWithPause(0.5), 1);
  near(thereAndBackWithPause(0.9), smooth(3 - 2.7));
  // pause 0.5 -> a = 4; old code used a = 2
  near(thereAndBackWithPause(0.1, 0.5), smooth(0.4));
  near(thereAndBackWithPause(0.9, 0.5), smooth(4 - 3.6));
  assert.equal(thereAndBackWithPause(0.4, 0.5), 1);
  // pause 0.2 -> a = 2.5; t = 0.2 -> smooth(0.5) = 0.5 (old code: smooth(1) = 1)
  near(thereAndBackWithPause(0.2, 0.2), 0.5);
  assert.equal(thereAndBackWithPause(0), 0);
  near(thereAndBackWithPause(1), 0);
});

test("runningStart is the 7-point Bezier [0,0,p,p,1,1,1] (CE rate_functions.py)", () => {
  // Closed form copied from CE running_start.
  const ce = (t: number, p: number) => {
    const mt = 1 - t;
    return 15 * t ** 2 * mt ** 4 * p + 20 * t ** 3 * mt ** 3 * p + 15 * t ** 4 * mt ** 2 + 6 * t ** 5 * mt + t ** 6;
  };
  near(runningStart(0.5), 0.0703125);
  for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    near(runningStart(t), ce(t, -0.5));
    near(runningStart(t, -1), ce(t, -1));
  }
  assert.equal(runningStart(0), 0);
  near(runningStart(1), 1);
  assert.ok(runningStart(0.15) < 0, "still dips below zero first");
});
