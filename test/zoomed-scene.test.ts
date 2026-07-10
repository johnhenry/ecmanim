// ZoomedScene render-to-region compositing (M5 of the manim-parity program):
// the display rect must actually show the source frame's region, magnified.
// Real-pixel checks via @napi-rs/canvas (skip when unavailable).

import { test } from "node:test";
import assert from "node:assert/strict";
import { ZoomedScene } from "../src/scene/zoomed_scene.ts";
import { CanvasRenderer, Camera } from "../src/renderer/CanvasRenderer.ts";
import { Dot, Circle } from "../src/mobject/geometry.ts";
import { UpdateFromFunc, UpdateFromAlphaFunc } from "../src/animation/specialized.ts";
import { Scene } from "../src/scene/Scene.ts";

const canvasMod = await import("@napi-rs/canvas").then((m) => m, () => null);
const skip = !canvasMod && "@napi-rs/canvas not available";

function px(canvas: any, x: number, y: number): number[] {
  const d = canvas.getContext("2d").getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

test("zoomed display shows the framed region magnified", { skip }, () => {
  const { createCanvas } = canvasMod!;
  const W = 640, H = 360;
  const canvas = createCanvas(W, H);
  const camera = new Camera({ pixelWidth: W, pixelHeight: H, background: "#000000" });
  const renderer = new CanvasRenderer(canvas.getContext("2d"), camera, {
    createCanvas: (w: number, h: number) => createCanvas(w, h),
  });

  const scene = new ZoomedScene({ camera, zoomFactor: 0.3, zoomedDisplayHeight: 3, zoomedDisplayWidth: 3 });
  // A small red dot inside the (origin-centered) zoom frame; nothing else near it.
  const dot = new Dot({ point: [0.1, 0.1, 0], radius: 0.08, color: "#FF0000", fillOpacity: 1 });
  scene.add(dot);
  scene.zoomedCamera.frame.moveTo([0, 0, 0]);
  scene.activated = true;
  scene.add(scene.zoomedCamera.frame);
  scene.addForegroundMobject(scene.zoomedDisplay);

  renderer.renderScene(scene.mobjects);

  // The display sits in the upper-right corner: probe where the magnified dot
  // must land. Display center in world = display.getCenter(); the dot at
  // (0.1, 0.1) inside a 0.9x0.9 frame maps to center + (0.1/0.9)*3 world.
  const dc = scene.zoomedDisplay.getCenter();
  const mag = 3 / (3 * 0.3); // display / frame = 3.33x
  const target = camera.toPixel([dc[0] + 0.1 * mag, dc[1] + 0.1 * mag, 0]);
  const [r, g, b] = px(canvas, Math.round(target[0]), Math.round(target[1]));
  assert.ok(r > 150 && g < 90 && b < 90, `magnified dot is red at display (${r},${g},${b})`);

  // And the ORIGINAL dot still renders at the origin.
  const orig = camera.toPixel([0.1, 0.1, 0]);
  const [r2] = px(canvas, Math.round(orig[0]), Math.round(orig[1]));
  assert.ok(r2 > 150, "source dot still drawn");

  // A point inside the display but far from the magnified dot shows the
  // (black) zoomed background, not bleed-through of what's behind the display.
  const empty = camera.toPixel([dc[0] - 1.2, dc[1] - 1.2, 0]);
  const [r3, g3, b3] = px(canvas, Math.round(empty[0]), Math.round(empty[1]));
  assert.ok(r3 < 40 && g3 < 40 && b3 < 40, `display interior is opaque background (${r3},${g3},${b3})`);
});

test("moving the source frame moves what the display shows", { skip }, () => {
  const { createCanvas } = canvasMod!;
  const W = 640, H = 360;
  const canvas = createCanvas(W, H);
  const camera = new Camera({ pixelWidth: W, pixelHeight: H, background: "#000000" });
  const renderer = new CanvasRenderer(canvas.getContext("2d"), camera, {
    createCanvas: (w: number, h: number) => createCanvas(w, h),
  });
  const scene = new ZoomedScene({ camera });
  const marker = new Circle({ radius: 0.2, color: "#00FF00", fillColor: "#00FF00", fillOpacity: 1, point: [-3, -1, 0] });
  scene.add(marker);
  scene.add(scene.zoomedCamera.frame);
  scene.addForegroundMobject(scene.zoomedDisplay);

  // Frame NOT over the marker: display center shows background.
  scene.zoomedCamera.frame.moveTo([3, 1, 0]);
  renderer.renderScene(scene.mobjects);
  const dc = scene.zoomedDisplay.getCenter();
  const center = camera.toPixel(dc);
  const [, gBefore] = px(canvas, Math.round(center[0]), Math.round(center[1]));

  // Frame over the marker: display center shows green.
  scene.zoomedCamera.frame.moveTo([-3, -1, 0]);
  renderer.renderScene(scene.mobjects);
  const [, gAfter] = px(canvas, Math.round(center[0]), Math.round(center[1]));
  assert.ok(gBefore < 60, `background before (g=${gBefore})`);
  assert.ok(gAfter > 150, `marker visible after moving the frame (g=${gAfter})`);
});

test("pop-out animation starts ON the frame and restores to the corner", () => {
  const scene = new ZoomedScene({ frameHandler: async () => {} } as any);
  scene.zoomedCamera.frame.moveTo([1, -2, 0]);
  const cornerCenter = [...scene.zoomedDisplay.getCenter()];
  const anim = scene.getZoomedDisplayPopOutAnimation();
  // After building the animation, the display's CURRENT state sits on the frame.
  const onFrame = scene.zoomedDisplay.getCenter();
  assert.ok(Math.hypot(onFrame[0] - 1, onFrame[1] + 2) < 1e-6, "display starts on the frame");
  anim.begin();
  anim.finish();
  const restored = scene.zoomedDisplay.getCenter();
  assert.ok(Math.hypot(restored[0] - cornerCenter[0], restored[1] - cornerCenter[1]) < 1e-3, "restores to corner");
});

test("UpdateFromFunc and UpdateFromAlphaFunc drive mobjects during play", async () => {
  const scene = new Scene({ fps: 10, frameHandler: async () => {} });
  const a = new Dot({ point: [0, 0, 0] });
  const b = new Dot({ point: [2, 2, 0] });
  scene.add(a, b);
  // Keep `a` glued to `b` while `b` animates.
  await scene.play(
    (b as any).animate.shift([1, 0, 0]),
    new UpdateFromFunc(a, (m: any) => m.moveTo(b.getCenter())),
  );
  assert.ok(Math.hypot(a.getCenter()[0] - 3, a.getCenter()[1] - 2) < 1e-6, "UpdateFromFunc tracked");
  const alphas: number[] = [];
  await scene.play(new UpdateFromAlphaFunc(a, (_m: any, alpha: number) => alphas.push(alpha)), { runTime: 0.3 });
  assert.ok(alphas.length > 1 && alphas[alphas.length - 1] === 1, "alpha swept to 1");
});
