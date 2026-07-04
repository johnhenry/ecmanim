import { test } from "node:test";
import assert from "node:assert/strict";

import { Camera } from "../src/renderer/CanvasRenderer.ts";
import { MovingCameraScene } from "../src/scene/moving_camera_scene.ts";

const CFG = { pixelWidth: 640, pixelHeight: 360, frameWidth: (640 / 360) * 8, frameHeight: 8 };

function silent(scene: any): void {
  scene.frameHandler = async () => {};
}

test("goToCameraStop moves and resizes the frame to the defined stop", async () => {
  const cam = new Camera(CFG);
  const scene = new MovingCameraScene({ camera: cam });
  silent(scene);

  scene.defineCameraStop("closeup", { center: [2, 1, 0], width: 4 });
  await scene.goToCameraStop("closeup");

  const frame = scene.getFrame();
  assert.ok(Math.abs(frame.getCenter()[0] - 2) < 1e-6);
  assert.ok(Math.abs(frame.getCenter()[1] - 1) < 1e-6);
  assert.ok(Math.abs(frame.getWidth() - 4) < 1e-6);
});

test("goToCameraStop's zoom scales the frame (1/zoom), distinct from camera.zoom", async () => {
  const cam = new Camera(CFG);
  const scene = new MovingCameraScene({ camera: cam });
  silent(scene);
  const widthBefore = scene.getFrame().getWidth();
  const heightBefore = scene.getFrame().getHeight();

  scene.defineCameraStop("zoomedIn", { zoom: 2 });
  await scene.goToCameraStop("zoomedIn");

  assert.ok(Math.abs(scene.getFrame().getWidth() - widthBefore / 2) < 1e-6);
  assert.ok(Math.abs(scene.getFrame().getHeight() - heightBefore / 2) < 1e-6);
  // camera.zoom (the interactive-camera multiplier) is untouched by this.
  assert.equal(cam.zoom ?? 1, 1);
});

test("multiple fields (center + width + height + zoom) change together in one animation, not racing", async () => {
  const cam = new Camera(CFG);
  const scene = new MovingCameraScene({ camera: cam });
  silent(scene);

  scene.defineCameraStop("combo", { center: [1, 1, 0], width: 6, height: 3 });
  await scene.goToCameraStop("combo");

  const frame = scene.getFrame();
  assert.ok(Math.abs(frame.getCenter()[0] - 1) < 1e-6);
  assert.ok(Math.abs(frame.getCenter()[1] - 1) < 1e-6);
  assert.ok(Math.abs(frame.getWidth() - 6) < 1e-6);
  assert.ok(Math.abs(frame.getHeight() - 3) < 1e-6);
});

test("goToCameraStop throws a clear error for an undefined stop name", async () => {
  const cam = new Camera(CFG);
  const scene = new MovingCameraScene({ camera: cam });
  silent(scene);
  await assert.rejects(() => scene.goToCameraStop("nonexistent"), /no camera stop named/);
});

test("an explicit config.runTime is honored", async () => {
  const cam = new Camera(CFG);
  const scene = new MovingCameraScene({ camera: cam });
  silent(scene);
  scene.defineCameraStop("s", { width: 5 });

  const start = scene.frameCount;
  await scene.goToCameraStop("s", { runTime: 2 });
  // fps default 30 -> 2s * 30fps = 60 frames emitted for this play() segment.
  assert.equal(scene.frameCount - start, 60);
});
