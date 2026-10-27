import { test } from "node:test";
import assert from "node:assert/strict";
import { Animation } from "../src/animation/Animation.ts";
import { Scene } from "../src/scene/Scene.ts";
import { Mobject, Group } from "../src/mobject/Mobject.ts";
import { Camera } from "../src/renderer/CanvasRenderer.ts";
import { ThreeDScene } from "../src/scene/three_d.ts";

function recording(scene = new Scene({ fps: 8 })) {
  const frames: { repeat: boolean; frame: number; time: number }[] = [];
  scene.frameHandler = Object.assign(
    async (_m: Mobject[], frame: number, time: number) => { frames.push({ repeat: false, frame, time }); },
    { repeat: async (_m: Mobject[], frame: number, time: number) => { frames.push({ repeat: true, frame, time }); } },
  );
  return { scene, frames };
}

test("static waits repeat only within a hold and preserve the frame clock and records", async () => {
  const { scene, frames } = recording();
  await scene.wait(0.5);
  await scene.wait(0.25);
  await scene.wait(0);
  assert.deepEqual(frames.map(f => f.repeat), [false, true, true, true, false, true, false]);
  assert.deepEqual(frames.map(f => f.frame), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(frames.map(f => f.time), [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.75]);
  assert.deepEqual(scene.playRecords.map(r => [r.startFrame, r.endFrame]), [[0, 4], [4, 6], [6, 7]]);
  assert.equal(scene.frameCount, 7);
});

test("ordinary frame handlers still run for every hold frame", async () => {
  const scene = new Scene({ fps: 8 });
  let calls = 0;
  scene.frameHandler = () => { calls++; };
  await scene.wait(1);
  assert.equal(calls, 8);
});

for (const kind of ["nested updater", "custom mobject update", "custom scene update", "background task", "camera effects", "custom camera", "ambient camera"]) {
  test(`hold reuse falls back for ${kind}`, async () => {
    const scene = kind === "ambient camera" ? new ThreeDScene({ fps: 8 }) : new Scene({ fps: 8 });
    const { frames } = recording(scene);
    const mob = new Mobject();
    scene.add(new Group(mob));
    if (kind === "nested updater") mob.addUpdater(m => m.shift([0.1, 0, 0]));
    if (kind === "custom mobject update") mob.update = function() { this.shift([0.1, 0, 0]); return this; };
    if (kind === "custom scene update") scene.updateMobjects = () => { mob.shift([0.1, 0, 0]); };
    if (kind === "background task") scene.spawn(function* () { while (true) { mob.shift([0.1, 0, 0]); yield 0.125; } });
    if (kind === "camera effects") { scene.camera = new Camera().addEffect(t => ({ dx: t })); }
    if (kind === "custom camera") { scene.camera = new Camera(); scene.camera.preRender = () => {}; }
    if (kind === "ambient camera") (scene as ThreeDScene).beginAmbientCameraRotation();
    await scene.wait(0.5);
    assert.equal(frames.length, 4);
    assert.ok(frames.every(f => !f.repeat));
  });
}

test("skipped waits advance time and render the next hold's first frame", async () => {
  const { scene, frames } = recording();
  scene.onSegment = r => r.index === 0 ? { skip: true } : undefined;
  await scene.wait(0.5);
  await scene.wait(0.5);
  assert.deepEqual(frames.map(f => f.repeat), [false, true, true, true]);
  assert.deepEqual(frames.map(f => f.frame), [4, 5, 6, 7]);
  assert.equal(scene.time, 1);
});

test("repeat writes are awaited and failures propagate without advancing the frame", async () => {
  const { scene, frames } = recording();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const error = new Error("encoder closed");
  scene.frameHandler.repeat = async () => { entered(); await blocked; throw error; };
  const render = scene.wait(0.5);
  const rejected = assert.rejects(render, error);
  await started;
  assert.equal(scene.frameCount, 1);
  assert.equal(scene.time, 0.25);
  assert.equal(frames.length, 1);
  release();
  await rejected;
  assert.equal(scene.frameCount, 1);
});

test("play and explicit emitFrame never repeat a preceding hold", async () => {
  const { scene, frames } = recording();
  await scene.wait(0.25);
  await scene.emitFrame();
  await scene.play(new Animation(new Mobject(), { runTime: 0.25 }));
  assert.deepEqual(frames.map(f => f.repeat), [false, true, false, false, false]);
});
