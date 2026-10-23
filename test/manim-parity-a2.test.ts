// Wave A2/A6 of the manim-parity v2 epic (#114): `.animate(opts)` callable form
// (#116) and set_fill / set_stroke leaving an omitted opacity alone (#123).
// Expected values come from Manim Community.

import { test } from "node:test";
import assert from "node:assert/strict";
import { VGroup } from "../src/mobject/VMobject.ts";
import { Circle, Square, Dot } from "../src/mobject/geometry.ts";
import { linear, smooth } from "../src/animation/rate_functions.ts";

// --- #123: vectorized_mobject.py set_fill / set_stroke / update_rgbas_array ---
// "Only update rgb if color was not None, and only update alpha channel if
// opacity was passed in."

test("setFill(color) keeps the current fill opacity (CE Circle().set_fill(YELLOW) stays unfilled)", () => {
  const c = new Circle().setFill("#FFFF00");
  assert.equal(c.fillOpacity, 0); // CE Circle fill_opacity=0 (the SetFill docstring example)
  assert.equal(c.fillColor.toHex().toLowerCase(), "#ffff00");
  const s = new Square({ fillOpacity: 0.3 }).setFill("#FF0000");
  assert.equal(s.fillOpacity, 0.3);
});

test("setFill(color, opacity) and setFill(color, {opacity}) still set the opacity", () => {
  assert.equal(new Circle().setFill("#00FF00", 0.8).fillOpacity, 0.8);
  assert.equal(new Circle().setFill("#FF2135", { opacity: 0.2 }).fillOpacity, 0.2);
  assert.equal(new Circle().setFill("#FF2135", 1).fillOpacity, 1);
  assert.equal(new Circle({ fillOpacity: 0.6 }).setFill(null, 0.1).fillOpacity, 0.1);
});

test("setFill(color) per-family: each member keeps its own opacity", () => {
  const a = new Square({ fillOpacity: 0.25 });
  const b = new Square({ fillOpacity: 0.75 });
  const g = new VGroup(a, b).setFill("#FF0000");
  assert.equal(a.fillOpacity, 0.25);
  assert.equal(b.fillOpacity, 0.75);
  assert.equal(g.fillOpacity, 0); // the VGroup's own opacity is untouched
});

test("setStroke(color) keeps stroke width and opacity (CE width/opacity=None)", () => {
  const s = new Square({ strokeWidth: 7, strokeOpacity: 0.4 }).setStroke("#FF0000");
  assert.equal(s.strokeWidth, 7);
  assert.equal(s.strokeOpacity, 0.4);
  assert.equal(s.strokeColor.toHex().toLowerCase(), "#ff0000");
  const t = new Square({ strokeOpacity: 0.4 }).setStroke("#FF0000", 2);
  assert.equal(t.strokeWidth, 2);
  assert.equal(t.strokeOpacity, 0.4);
  assert.equal(new Square().setStroke("#FF0000", 2, 0.5).strokeOpacity, 0.5);
  assert.equal(new Square().setStroke("#FF0000", { opacity: 0.1 }).strokeOpacity, 0.1);
});

// --- #116: mobject.py _AnimationBuilder.__call__ ---

test("mob.animate({runTime, rateFunc, lagRatio, pathArc}).method() passes options to the animation", () => {
  const d = new Dot();
  const anim = d.animate({ runTime: 2, rateFunc: linear, lagRatio: 0.3, pathArc: 1 }).shift([1, 0, 0]).build();
  assert.equal(anim.runTime, 2);
  assert.equal(anim.rateFunc, linear);
  assert.equal(anim.lagRatio, 0.3);
  assert.equal(anim.pathArc, 1);
  assert.equal((anim as any).target.getCenter()[0], 1);
});

test("plain .animate.method() chains are unchanged (defaults: smooth, runTime 1)", () => {
  const anim = new Dot().animate.shift([1, 0, 0]).scale(2).build();
  assert.equal(anim.runTime, 1);
  assert.equal(anim.rateFunc, smooth);
  assert.equal((anim as any).target.getCenter()[0], 1);
});

test("options after a method, or passed twice, throw like CE", () => {
  assert.throws(() => (new Dot().animate.shift([1, 0, 0]) as any)({ runTime: 2 }), /before accessing methods/);
  assert.throws(() => (new Dot().animate({ runTime: 2 }) as any)({ runTime: 3 }), /only be passed once/);
});

test("options-only call with no method builds a no-op transform with those options", () => {
  const anim = new Dot().animate({ runTime: 3 }).build();
  assert.equal(anim.runTime, 3);
});

test("additive: animate(fn) applies fn to the animated copy and forbids later options", () => {
  const sq = new Square();
  const b = sq.animate((m: Square) => m.scale(2));
  const anim = b.build();
  assert.ok(Math.abs((anim as any).target.getWidth() - sq.getWidth() * 2) < 1e-9);
  assert.equal(sq.getWidth(), new Square().getWidth()); // original untouched
  assert.throws(() => b({ runTime: 2 }), /before accessing methods/);
});

