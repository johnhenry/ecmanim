// Regression tests for the library bugs surfaced by the Motion Canvas port
// wave: partial-cache hash collisions (play targets + family-deep waits),
// signal-chain raw .to() values, family-deep fill tweens, parametric camera
// roll (180-degree degeneration), matchTex/code.edit scene cleanup, and
// FlexGroup's Yoga world-unit rounding.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene } from "../src/scene/Scene.ts";
import { Circle, Square, Rectangle } from "../src/mobject/geometry.ts";
import { VGroup } from "../src/mobject/VMobject.ts";
import { FlexGroup } from "../src/mobject/flex_group.ts";
import { MovingCameraScene, CameraFrameTween } from "../src/scene/moving_camera_scene.ts";
import { Camera } from "../src/renderer/CanvasRenderer.ts";
import { Text } from "../src/mobject/text/Text.ts";
import { tweenTo, tweenSignal, tween } from "../src/animation/tween_chain.ts";
import { createSignal } from "../src/reactive/signal.ts";
import { Code, edit } from "../src/mobject/text/code.ts";

const close = (a: number, b: number, eps = 1e-6, msg?: string) =>
  assert.ok(Math.abs(a - b) < eps, msg ?? `${a} !~ ${b}`);

const silentScene = () => new Scene({ fps: 20, frameHandler: async () => {} });

// --- cache hash fixes ---------------------------------------------------------

test("two same-shaped tweens with different targets hash differently", () => {
  const scene = silentScene();
  const c = new Circle({ radius: 1 });
  const endTween = tweenTo(c, { end: 1 }, 1);
  const fillTween = tweenTo(c, { fillOpacity: 1 }, 1);
  assert.notEqual(
    scene.hashAnimations([endTween], "play"),
    scene.hashAnimations([fillTween], "play"),
    "an `end` tween is not a `fillOpacity` tween",
  );
  // Different targets on the same prop differ too.
  assert.notEqual(
    scene.hashAnimations([tweenTo(c, { x: 1 }, 1)], "play"),
    scene.hashAnimations([tweenTo(c, { x: 2 }, 1)], "play"),
  );
});

test("tween(cb) closures hash by their source", () => {
  const scene = silentScene();
  const a = tween(1, (t) => { void (t * 2); });
  const b = tween(1, (t) => { void (t * 3); });
  assert.notEqual(scene.hashAnimations([a], "play"), scene.hashAnimations([b], "play"));
});

test("wait fingerprint is family-deep: nested state changes the hash", async () => {
  // Two 0.5s waits over a Group whose CHILD moved between them must emit
  // different segment hashes (used to collide as "Group:0").
  const scene = silentScene();
  const child = new Circle({ radius: 0.5 });
  const group = new VGroup(child);
  scene.add(group);
  const hashes: string[] = [];
  scene.onSegment = (rec) => { hashes.push(rec.hash); return undefined; };
  await scene.wait(0.5);
  child.shift([2, 0, 0]);
  await scene.wait(0.5);
  child.setFill("#ff0000", 1);
  await scene.wait(0.5);
  assert.equal(new Set(hashes).size, 3, `all three holds distinct: ${hashes}`);
});

// --- signal chains + fill families ---------------------------------------------

test("tweenSignal(...).to(rawValue) tweens the signal (MC ergonomic)", () => {
  const sig = createSignal(0);
  const chain = tweenSignal(sig, 1, 1).to(0, 1);
  chain.begin();
  chain.interpolate(0.5);
  close(sig(), 1, 1e-9, "end of first leg");
  chain.finish();
  close(sig(), 0, 1e-9, "raw .to(0) actually tweens back");
});

test("fill tween reaches the glyph children of a vector-ish container", () => {
  const a = new Circle({ radius: 0.5, fillOpacity: 1, color: "#ffffff" });
  const b = new Circle({ radius: 0.5, fillOpacity: 1, color: "#ffffff" });
  const group = new VGroup(a, b);
  const chain = tweenTo(group, { fill: "#ff0000" }, 1);
  chain.begin();
  chain.finish();
  assert.equal((a as any).fillColor.toHex().toLowerCase(), "#ff0000", "child fill tweened");
  assert.equal((b as any).fillColor.toHex().toLowerCase(), "#ff0000");
});

// --- parametric camera roll -----------------------------------------------------

test("CameraFrameTween keeps the frame a real rectangle through a 180° roll", async () => {
  const scene = new MovingCameraScene({ fps: 20, frameHandler: async () => {} });
  const cam = new Camera({ pixelWidth: 800, pixelHeight: 450, frameHeight: 8 });
  (scene as any).camera = cam;
  scene.setupFrame();
  const w0 = cam.frameWidth;

  // Sample mid-animation widths via preRender each frame.
  const widths: number[] = [];
  const origHandler = scene.frameHandler;
  scene.frameHandler = async (...args: any[]) => {
    cam.preRender();
    widths.push(cam.frameWidth);
    return (origHandler as any)(...args);
  };
  await scene.rotateCamera(Math.PI, { runTime: 0.5 });
  cam.preRender();
  assert.ok(Math.abs(Math.abs(cam.rotation ?? 0) - Math.PI) < 1e-6, "ended at ±180°");
  const minW = Math.min(...widths);
  assert.ok(minW > w0 * 0.99, `frame never collapsed (min width ${minW} vs ${w0})`);
  await scene.resetCamera({ runTime: 0.5 });
  cam.preRender();
  close(cam.rotation ?? 0, 0, 1e-6, "reset un-rolls");
  close(cam.frameWidth, w0, 1e-6, "reset restores width");
});

// --- matchTex / code.edit scene cleanup ------------------------------------------

test("code.edit's animation swaps old for target on the scene", async () => {
  const scene = silentScene();
  const codeMob = new Code("var x;", { lineNumbers: false });
  scene.add(codeMob);
  const { animation, target } = codeMob.edit(0.2)`var x${edit(";", " = true;")}`;
  await scene.play(animation);
  assert.ok(!scene.mobjects.includes(codeMob), "old Code removed");
  assert.ok(scene.mobjects.includes(target), "target Code on scene");
  // No loose token groups left behind (everything visible belongs to target).
  const loose = scene.mobjects.filter((m) => m !== target);
  assert.equal(loose.length, 0, `no stragglers: ${loose.map((m) => m.name)}`);
});

// --- FlexGroup world-unit layout --------------------------------------------------

test("FlexGroup lays out world-unit sizes without integer quantization", async () => {
  const g = new FlexGroup({ direction: "row", gap: 0.25, width: 4, height: 1 });
  const a = new Square({ sideLength: 0.6 });
  const b = new Square({ sideLength: 0.6 });
  const c = new Square({ sideLength: 0.6 });
  g.add(a, b, c);
  await g.layout();
  const gapAB = (b.getCenter()[0] - b.getWidth() / 2) - (a.getCenter()[0] + a.getWidth() / 2);
  const gapBC = (c.getCenter()[0] - c.getWidth() / 2) - (b.getCenter()[0] + b.getWidth() / 2);
  close(gapAB, 0.25, 1e-3, `gap A-B is the configured 0.25 (got ${gapAB})`);
  close(gapBC, 0.25, 1e-3, `gap B-C is the configured 0.25 (got ${gapBC})`);
  close(a.getWidth(), 0.6, 1e-3, "child width not snapped to a pixel grid");
});
