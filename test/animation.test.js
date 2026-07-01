import { test } from "node:test";
import assert from "node:assert/strict";
import { Circle, Square } from "../src/mobject/geometry.js";
import { Create, FadeIn, FadeOut, Transform, ApplyMethod, Shift } from "../src/animation/Animation.js";
import { Scene } from "../src/scene/Scene.js";
import * as rf from "../src/animation/rate_functions.js";
import * as V from "../src/core/math/vector.js";

test("rate functions are clamped in [0,1] and monotone endpoints", () => {
  assert.equal(rf.smooth(0), 0);
  assert.equal(rf.smooth(1), 1);
  assert.equal(rf.linear(0.3), 0.3);
  assert.ok(rf.smooth(0.5) > 0.4 && rf.smooth(0.5) < 0.6);
});

test("Create sets strokeEnd from 0 to 1", () => {
  const c = new Circle({ radius: 1 });
  const anim = new Create(c);
  anim.begin();
  anim.interpolate(0);
  assert.ok(c.strokeEnd <= 0.01);
  anim.interpolate(0.5);
  assert.ok(c.strokeEnd > 0.3 && c.strokeEnd < 0.7);
  anim.finish();
  assert.equal(c.strokeEnd, 1);
});

test("FadeIn ends fully opaque", () => {
  const c = new Circle({ radius: 1, fillColor: "#fff", fillOpacity: 1 });
  const anim = new FadeIn(c);
  anim.begin();
  anim.interpolate(0);
  assert.ok(c.fillOpacity <= 0.01);
  anim.finish();
  assert.ok(Math.abs(c.fillOpacity - 1) < 1e-6);
});

test("Transform morphs circle center to target center", async () => {
  const c = new Circle({ radius: 1 });
  const target = new Square({ sideLength: 2 }).moveTo([4, 0, 0]);
  const anim = new Transform(c, target);
  anim.begin();
  anim.interpolate(1);
  assert.ok(V.equals(c.getCenter(), [4, 0, 0], 0.05));
});

test("Scene.play produces the expected frame count", async () => {
  const frames = [];
  const scene = new Scene({ fps: 30, frameHandler: async () => frames.push(1) });
  const c = new Circle({ radius: 1 });
  await scene.play(new Create(c), { _playConfig: true, runTime: 1 });
  assert.equal(frames.length, 30);
  assert.ok(scene.mobjects.includes(c)); // introducer added it
});

test("Scene.play with ApplyMethod moves the mobject", async () => {
  const scene = new Scene({ fps: 10, frameHandler: async () => {} });
  const c = new Circle({ radius: 1 });
  scene.add(c);
  await scene.play(Shift(c, [2, 0, 0]));
  assert.ok(V.equals(c.getCenter(), [2, 0, 0], 0.05));
});

test("FadeOut removes mobject from scene", async () => {
  const scene = new Scene({ fps: 10, frameHandler: async () => {} });
  const c = new Circle({ radius: 1 });
  scene.add(c);
  await scene.play(new FadeOut(c));
  assert.ok(!scene.mobjects.includes(c));
});
