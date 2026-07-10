// D6 (D3-parity campaign): keyed data joins (enter/update/exit against a
// data array), race keyframe interpolation, and the van Wijk camera zoom
// path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene } from "../src/scene/Scene.ts";
import { Circle } from "../src/mobject/geometry.ts";
import { Camera } from "../src/renderer/CanvasRenderer.ts";
import { MovingCameraScene, CameraFrameTween } from "../src/scene/moving_camera_scene.ts";
import { dataJoin, interpolateFrames, rankFrame } from "../src/animation/data_join.ts";
import { tweenTo } from "../src/animation/tween_chain.ts";

const close = (a: number, b: number, eps = 1e-6, msg?: string) =>
  assert.ok(Math.abs(a - b) < eps, msg ?? `${a} !~ ${b}`);

const silentScene = () => new Scene({ fps: 20, frameHandler: async () => {} });

type Datum = { name: string; x: number };

const make = (d: Datum) => {
  const c = new Circle({ radius: 0.3, fillOpacity: 1 });
  c.moveTo([d.x, 0, 0]);
  return c;
};

test("dataJoin classifies enter/update/exit by key and plays them", async () => {
  const scene = silentScene();
  const frame1: Datum[] = [{ name: "a", x: -2 }, { name: "b", x: 0 }];
  let join = dataJoin([], frame1, (d) => d.name, { make });
  assert.equal(join.enter.length, 2);
  assert.equal(join.update.length, 0);
  await scene.play(join.animation);
  assert.ok(scene.mobjects.includes(join.mobs[0]) && scene.mobjects.includes(join.mobs[1]));

  const frame2: Datum[] = [{ name: "b", x: 2 }, { name: "c", x: 3 }];
  join = dataJoin(join.mobs, frame2, (d) => d.name, {
    make,
    update: (mob, d) => tweenTo(mob, { x: d.x }, 0.2),
    runTime: 0.2,
  });
  assert.equal(join.enter.length, 1, "c enters");
  assert.equal(join.update.length, 1, "b updates");
  assert.equal(join.exit.length, 1, "a exits");
  const exiting = join.exit[0];
  await scene.play(join.animation);
  assert.ok(!scene.mobjects.includes(exiting), "exited mobject removed");
  close(join.update[0][0].getCenter()[0], 2, 1e-4, "b tweened to its new x");
  assert.ok(scene.mobjects.includes(join.enter[0]), "c on scene");
});

test("dataJoin tracks identity across joins via stamped keys", () => {
  const j1 = dataJoin([], [{ name: "a", x: 0 }], (d) => d.name, { make });
  const j2 = dataJoin(j1.mobs, [{ name: "a", x: 5 }], (d) => d.name, { make });
  assert.equal(j2.update[0][0], j1.mobs[0], "same mobject persisted");
  assert.equal(j2.enter.length, 0);
});

test("enterFrom positions entering mobjects before their FadeIn", () => {
  const join = dataJoin([], [{ name: "a", x: 4 }], (d) => d.name, {
    make,
    enterFrom: (mob) => mob.moveTo([0, -5, 0]),
  });
  close(join.enter[0].getCenter()[1], -5, 1e-9, "entry position applied");
});

test("interpolateFrames lerps values over the union of keys", () => {
  const a: [number, Map<string, number>] = [0, new Map([["x", 10], ["y", 0]])];
  const b: [number, Map<string, number>] = [10, new Map([["x", 20], ["z", 4]])];
  const frames = interpolateFrames(a, b, 4);
  assert.equal(frames.length, 4);
  close(frames[0][1].get("x")!, 10);
  close(frames[2][1].get("x")!, 15, 1e-9, "halfway");
  close(frames[2][1].get("z")!, 2, 1e-9, "missing-in-A key lerps from 0");
  close(frames[2][1].get("y")!, 0, 1e-9, "missing-in-B key lerps to 0");
  close(frames[2][0], 5, 1e-9, "time lerps too");
});

test("rankFrame ranks descending with deterministic tie-breaks and clamps", () => {
  const ranks = rankFrame(new Map([["b", 5], ["a", 5], ["c", 9], ["d", 1]]), 2);
  assert.equal(ranks[0].key, "c");
  assert.equal(ranks[0].rank, 0);
  assert.equal(ranks[1].key, "a", "value tie broken by key order");
  assert.equal(ranks[3].rank, 2, "ranks clamp at n");
});

test("CameraFrameTween zoom path bows outward on long pans (van Wijk)", async () => {
  const scene = new MovingCameraScene({ fps: 20, frameHandler: async () => {} });
  const cam = new Camera({ pixelWidth: 800, pixelHeight: 450, frameHeight: 8 });
  (scene as any).camera = cam;
  scene.setupFrame();
  const frame = scene.getFrame();

  // Long pan at constant target width: the zoom path must widen (zoom out)
  // mid-flight; the linear path must not.
  const widths: number[] = [];
  scene.frameHandler = async () => {
    cam.preRender();
    widths.push(cam.frameWidth);
  };
  const w0 = cam.frameWidth;
  const anim = new CameraFrameTween(frame, { center: [40, 0, 0], width: w0 }, { path: "zoom" });
  anim.runTime = 0.5;
  await scene.play(anim);
  const maxW = Math.max(...widths);
  assert.ok(maxW > w0 * 1.5, `zoomed out mid-pan (peak ${maxW.toFixed(2)} vs ${w0.toFixed(2)})`);
  cam.preRender();
  close(cam.frameWidth, w0, 1e-6, "lands at the target width");
  close(cam.frameCenter[0], 40, 1e-6, "lands at the target center");
});
