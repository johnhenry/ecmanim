import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene } from "../src/scene/Scene.js";
import { Circle, Square } from "../src/mobject/geometry.js";
import { Axes } from "../src/mobject/coordinate_systems.js";
import { ValueTracker, DecimalNumber } from "../src/mobject/value_tracker.js";
import { AnimationGroup, LaggedStart } from "../src/animation/composition.js";
import { FadeIn, Create } from "../src/animation/Animation.js";
import { GrowFromCenter, Indicate } from "../src/animation/extra.js";
import * as V from "../src/core/math/vector.js";

test(".animate builder produces a working animation", async () => {
  const scene = new Scene({ fps: 10, frameHandler: async () => {} });
  const c = new Circle({ radius: 1 });
  scene.add(c);
  await scene.play(c.animate.shift([2, 0, 0]).scale(2));
  assert.ok(V.equals(c.getCenter(), [2, 0, 0], 0.1));
  assert.ok(Math.abs(c.getWidth() - 4) < 0.2);
});

test("ValueTracker tweens via .animate", async () => {
  const scene = new Scene({ fps: 10, frameHandler: async () => {} });
  const t = new ValueTracker(0);
  scene.add(t);
  await scene.play(t.animate.setValue(10));
  assert.ok(Math.abs(t.getValue() - 10) < 1e-6);
});

test("DecimalNumber updates its displayed text", () => {
  const d = new DecimalNumber(1.5, { numDecimalPlaces: 2 });
  assert.equal(d.text, "1.50");
  d.setValue(3.14159);
  assert.equal(d.text, "3.14");
});

test("AnimationGroup with lagRatio 0 runs animations in parallel", async () => {
  const frames = [];
  const scene = new Scene({ fps: 20, frameHandler: async () => frames.push(1) });
  const a = new Circle({ radius: 1 });
  const b = new Square({ sideLength: 1 });
  await scene.play(new AnimationGroup([new FadeIn(a), new FadeIn(b)], { runTime: 1 }));
  assert.equal(frames.length, 20);
  assert.ok(scene.mobjects.includes(a) && scene.mobjects.includes(b));
});

test("LaggedStart introduces all mobjects", async () => {
  const scene = new Scene({ fps: 15, frameHandler: async () => {} });
  const dots = [1, 2, 3].map(() => new Circle({ radius: 0.2 }));
  await scene.play(new LaggedStart(dots.map((d) => new FadeIn(d)), { runTime: 1 }));
  for (const d of dots) assert.ok(scene.mobjects.includes(d));
});

test("Axes.c2p maps origin to center and is invertible", () => {
  const ax = new Axes({ xRange: [-3, 3, 1], yRange: [-3, 3, 1], xLength: 6, yLength: 6 });
  const origin = ax.c2p(0, 0);
  assert.ok(V.equals(origin, ax.getCenter(), 0.2) || V.length(origin) < 0.5);
  const p = ax.c2p(2, 1);
  const back = ax.p2c(p);
  assert.ok(Math.abs(back[0] - 2) < 1e-6 && Math.abs(back[1] - 1) < 1e-6);
});

test("Axes.plot returns a finite curve", () => {
  const ax = new Axes({ xRange: [-2, 2, 1], yRange: [0, 4, 1] });
  const g = ax.plot((x) => x * x);
  assert.ok(g.points.length > 3);
  for (const pt of g.points) assert.ok(pt.every(Number.isFinite));
});

test("GrowFromCenter and Indicate run without error and restore state", () => {
  const c = new Circle({ radius: 1 });
  const g = new GrowFromCenter(c);
  g.begin(); g.interpolate(0); g.interpolate(0.5); g.finish();
  assert.ok(c.points.every((p) => p.every(Number.isFinite)));

  const w0 = c.getWidth();
  const ind = new Indicate(c);
  ind.begin(); ind.interpolate(0.5); ind.finish();
  assert.ok(Math.abs(c.getWidth() - w0) < 0.05); // restored
});

test("headless render to PNG sequence writes frames", async () => {
  const { render } = await import("../src/node.js");
  const os = await import("node:os");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const out = path.join(os.tmpdir(), `mjtest_${process.pid}.mp4`);
  const res = await render(async (scene) => {
    const c = new Circle({ radius: 1, color: "#58C4DD" });
    await scene.play(new Create(c), { _playConfig: true, runTime: 0.2 });
  }, { output: out, format: "png-sequence", quality: "low", fps: 10, verbose: false });
  const files = fs.readdirSync(res.output).filter((f) => f.endsWith(".png"));
  assert.ok(files.length >= 2);
  assert.ok(fs.statSync(path.join(res.output, files[0])).size > 0);
  fs.rmSync(res.output, { recursive: true, force: true });
});
