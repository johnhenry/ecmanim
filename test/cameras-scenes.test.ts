import { test } from "node:test";
import assert from "node:assert/strict";

import { Camera, CanvasRenderer } from "../src/renderer/CanvasRenderer.ts";
import { MovingCameraScene } from "../src/scene/moving_camera_scene.ts";
import { ZoomedScene } from "../src/scene/zoomed_scene.ts";
import { VectorScene, LinearTransformationScene } from "../src/scene/vector_space_scene.ts";
import { MappingCamera } from "../src/camera/mapping_camera.ts";
import { MultiCamera } from "../src/camera/multi_camera.ts";
import { Arrow } from "../src/mobject/geometry.ts";

const CFG = { pixelWidth: 640, pixelHeight: 360, frameWidth: (640 / 360) * 8, frameHeight: 8 };

// A no-op frame handler so play() can run without a real backend.
function silent(scene: any): void {
  scene.frameHandler = async () => {};
}

test("MovingCameraScene exposes a camera.frame matching the viewport", () => {
  const cam = new Camera(CFG);
  const scene = new MovingCameraScene({ camera: cam });
  assert.ok(cam.frame, "camera has a frame mobject");
  assert.ok(Math.abs(cam.frame.getWidth() - cam.frameWidth) < 1e-9, "frame width ~= frameWidth");
  assert.ok(Math.abs(cam.frame.getHeight() - cam.frameHeight) < 1e-9, "frame height ~= frameHeight");
  assert.strictEqual(scene.getFrame(), cam.frame, "getFrame returns the frame");
});

test("animating the frame smaller + preRender zooms the camera in", async () => {
  const cam = new Camera(CFG);
  const scene = new MovingCameraScene({ camera: cam });
  silent(scene);
  const beforeH = cam.frameHeight;
  // Scale the frame down (zoom in), then let the renderer sync the viewport.
  await scene.play(scene.getFrame().animate.scale(0.5));
  cam.preRender();
  assert.ok(cam.frameHeight < beforeH, "frameHeight shrank (zoomed in)");
  assert.ok(Math.abs(cam.frameHeight - beforeH * 0.5) < 1e-6, "frameHeight halved");
});

test("preRender is a no-op when no frame is set (renderer unaffected)", () => {
  const cam = new Camera(CFG);
  const h = cam.frameHeight, w = cam.frameWidth;
  const renderer = new CanvasRenderer({} as any, cam);
  cam.preRender();
  assert.strictEqual(cam.frameHeight, h);
  assert.strictEqual(cam.frameWidth, w);
  assert.ok(renderer);
});

test("ZoomedScene has a zoomedCamera.frame region and a zoomedDisplay", () => {
  const scene = new ZoomedScene({ camera: new Camera(CFG) });
  // manim shape: the source region is `zoomedCamera.frame` (a Rectangle).
  assert.ok(scene.zoomedCamera.frame, "has zoomedCamera.frame");
  assert.ok(scene.zoomedDisplay, "has zoomedDisplay");
  assert.ok(scene.zoomedDisplay.displayFrame, "display carries its border frame");
  // The region is smaller than the display it magnifies into.
  assert.ok(scene.zoomedCamera.frame.getHeight() < scene.zoomedDisplay.getHeight());
  assert.ok(scene.getZoomFactor() > 0 && scene.getZoomFactor() < 1);
});

test("VectorScene.addVector returns an Arrow from the origin", () => {
  const scene = new VectorScene({ camera: new Camera(CFG) });
  const arrow = scene.addVector([2, 1]);
  assert.ok(arrow instanceof Arrow, "returns an Arrow");
  assert.deepEqual(arrow.getStart(), [0, 0, 0], "starts at origin");
  assert.deepEqual(arrow.getEnd(), [2, 1, 0], "ends at the vector");
  assert.ok(scene.mobjects.includes(arrow), "vector was added");
});

test("LinearTransformationScene.applyMatrix transforms the plane and basis", async () => {
  const scene = new LinearTransformationScene({ camera: new Camera(CFG) });
  silent(scene);
  const plane = scene.plane!;
  // Find a plane geometry point with a non-trivial x, to observe the transform.
  const findPt = (m: any): number[] | null => {
    if (m.points && m.points.length) for (const p of m.points) if (Math.abs(p[0]) > 0.5) return p.slice();
    for (const s of m.submobjects) { const r = findPt(s); if (r) return r; }
    return null;
  };
  const before = findPt(plane)!;
  const iBefore = scene.iHat.getEnd();
  const anims = await scene.applyMatrix([[2, 0], [0, 1]]);
  assert.ok(anims.length >= 1, "played at least one animation");
  const after = findPt(plane)!;
  // Under [[2,0],[0,1]] the x-coordinate doubles.
  assert.ok(Math.abs(after[0] - before[0] * 2) < 1e-6, "plane point x doubled");
  assert.ok(Math.abs(scene.iHat.getEnd()[0] - iBefore[0] * 2) < 1e-6, "i-hat x doubled");
});

test("MappingCamera.toPixel applies its mapping function", () => {
  const mc = new MappingCamera({ ...CFG, mappingFunc: (p) => [p[0] * 2, p[1], p[2]] });
  const plain = new Camera(CFG);
  // Mapping [1,0,0] -> [2,0,0] should match projecting [2,0,0] on a plain camera.
  assert.deepEqual(mc.toPixel([1, 0, 0]), plain.toPixel([2, 0, 0]));
  // Default (no func) behaves like the base camera.
  const idc = new MappingCamera(CFG);
  assert.deepEqual(idc.toPixel([1, 0, 0]), plain.toPixel([1, 0, 0]));
});

test("MultiCamera tracks image mobjects fitted from sub-cameras", () => {
  const sub = new Camera(CFG);
  const display = { getWidth: () => 3, getHeight: () => 2, getCenter: () => [1, 1, 0] };
  const mc = new MultiCamera(CFG);
  mc.addImageMobjectFromCamera(display, sub);
  assert.strictEqual(mc.imageMobjects.length, 1);
  assert.strictEqual(sub.frameWidth, 3, "sub-camera fit to display width");
  assert.strictEqual(sub.frameHeight, 2, "sub-camera fit to display height");
});
