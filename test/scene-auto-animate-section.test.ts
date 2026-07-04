import { test } from "node:test";
import assert from "node:assert/strict";

import { Scene } from "../src/scene/Scene.ts";
import { Circle, Square } from "../src/mobject/geometry.ts";

test("autoAnimateToNextSection: moved + new mobjects end up as the live scene state, matched via TransformMatchingAuto", async () => {
  const scene = new Scene({ fps: 30 });
  const circle: any = new Circle();
  circle.matchId = "hero";
  scene.add(circle);

  const framesBefore = scene.frameCount;

  await scene.autoAnimateToNextSection("next", () => {
    circle.moveTo([2, 0, 0]);
    const sq: any = new Square();
    sq.matchId = "new-thing";
    scene.add(sq);
  });

  // "after" state: exactly the mutated circle + the newly-added square --
  // and the *same* circle instance (identity preserved for later code that
  // holds a reference to it), not a disposable driver copy.
  assert.equal(scene.mobjects.length, 2);
  assert.ok(scene.mobjects.includes(circle), "the original circle instance is still the live one");
  assert.ok(Math.abs(circle.getCenter()[0] - 2) < 1e-6, `circle ended moved, got ${circle.getCenter()[0]}`);

  const sq = scene.mobjects.find((m: any) => m !== circle);
  assert.ok(sq, "the new square is present");
  assert.equal((sq as any).matchId, "new-thing");

  // Section boundary recorded at the frame play() started.
  assert.equal(scene.sections.length, 1);
  assert.equal(scene.sections[0].name, "next");
  assert.equal(scene.sections[0].startFrame, framesBefore);
  assert.ok(scene.frameCount > framesBefore, "frames were actually emitted by the transform");
});

test("autoAnimateToNextSection: a removed mobject fades out and is not left behind", async () => {
  const scene = new Scene({ fps: 30 });
  const circle: any = new Circle();
  circle.matchId = "stays";
  const gone: any = new Circle();
  gone.matchId = "leaving";
  scene.add(circle, gone);

  await scene.autoAnimateToNextSection("cut", () => {
    scene.remove(gone);
  });

  assert.equal(scene.mobjects.length, 1);
  assert.ok(scene.mobjects.includes(circle));
  assert.ok(!scene.mobjects.includes(gone));
});

test("autoAnimateToNextSection is strictly opt-in: plain nextSection() never triggers matching", () => {
  const scene = new Scene();
  const circle = new Circle();
  scene.add(circle);
  scene.nextSection("plain");
  assert.equal(scene.sections.length, 1);
  assert.equal(scene.mobjects.length, 1);
  assert.ok(scene.mobjects.includes(circle));
});
