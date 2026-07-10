// MC4 (Motion Canvas parity campaign): scene-to-scene transitions in the
// single-scene model — slideTransition/fadeTransition/zoomInTransition treat
// current content as outgoing and provided/callback-added content as
// incoming; outgoing mobjects leave the scene afterwards.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene } from "../src/scene/Scene.ts";
import { Circle, Square } from "../src/mobject/geometry.ts";
import { Camera } from "../src/renderer/CanvasRenderer.ts";
import {
  Direction, slideTransition, fadeTransition, zoomInTransition, finishScene,
} from "../src/scene/scene_transitions.ts";

const close = (a: number, b: number, eps = 1e-6, msg?: string) =>
  assert.ok(Math.abs(a - b) < eps, msg ?? `${a} !~ ${b}`);

function makeScene() {
  const scene = new Scene({ fps: 20, frameHandler: async () => {} });
  (scene as any).camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameHeight: 8 });
  return scene;
}

test("slideTransition swaps content: outgoing removed, incoming lands home", async () => {
  const scene = makeScene();
  const oldMob = new Circle({ radius: 1 });
  scene.add(oldMob);
  const next = new Square({ sideLength: 2 });
  next.moveTo([1, 1, 0]); // authored FINAL position

  await slideTransition(scene, Direction.Left, next, { runTime: 0.3 });

  assert.ok(!scene.mobjects.includes(oldMob), "outgoing mobject removed");
  assert.ok(scene.mobjects.includes(next), "incoming mobject present");
  close(next.getCenter()[0], 1, 1e-4, "incoming ends at its authored x");
  close(next.getCenter()[1], 1, 1e-4, "incoming ends at its authored y");
});

test("slideTransition moves incoming in from the named edge", async () => {
  const scene = makeScene();
  scene.add(new Circle({ radius: 1 }));
  const next = new Square({ sideLength: 1 });
  const startXs: number[] = [];
  // Sample the incoming x on the first emitted frame via an updater.
  next.addUpdater(() => { startXs.push(next.getCenter()[0]); });

  await slideTransition(scene, Direction.Left, next, { runTime: 0.3 });
  next.clearUpdaters();
  // Direction.Left: enters FROM the left => early positions are negative x.
  assert.ok(startXs[0] < -3, `first-frame x well left of center (${startXs[0]})`);
  close(next.getCenter()[0], 0, 1e-4, "and it ends home");
});

test("fadeTransition accepts a callback that adds the incoming content", async () => {
  const scene = makeScene();
  const oldMob = new Circle({ radius: 1 });
  scene.add(oldMob);
  const a = new Square({ sideLength: 1 });
  const b = new Square({ sideLength: 0.5 });

  await fadeTransition(scene, () => { scene.add(a, b); }, { runTime: 0.2 });

  assert.ok(!scene.mobjects.includes(oldMob), "outgoing removed");
  assert.ok(scene.mobjects.includes(a) && scene.mobjects.includes(b), "callback content in");
  assert.ok((a.opacity ?? 1) > 0.99, "incoming faded fully in");
});

test("zoomInTransition grows incoming from the area to its authored layout", async () => {
  const scene = makeScene();
  scene.add(new Circle({ radius: 1 }));
  const next = new Square({ sideLength: 4 });
  next.moveTo([0, 0, 0]);

  const grew: number[] = [];
  next.addUpdater(() => { grew.push(next.getWidth()); });
  await zoomInTransition(scene, { center: [3, 2, 0], width: 1, height: 1 }, next, { runTime: 0.3 });
  next.clearUpdaters();

  assert.ok(grew[0] < 1.5, `starts collapsed into the area (${grew[0]})`);
  close(next.getWidth(), 4, 1e-3, "ends at full size");
  close(next.getCenter()[0], 0, 1e-3, "ends at its authored center");
});

test("finishScene is a no-op marker", () => {
  const scene = makeScene();
  assert.equal(finishScene(scene), undefined);
  assert.equal(finishScene(), undefined);
});
