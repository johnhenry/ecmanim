import { test } from "node:test";
import assert from "node:assert/strict";

import { Scene } from "../src/scene/Scene.ts";
import { Circle } from "../src/mobject/geometry.ts";
import { FadeIn, FadeOut } from "../src/animation/Animation.ts";
import { AnimationGroup } from "../src/animation/composition.ts";

function silentScene(): Scene {
  const scene = new Scene({ fps: 30 });
  scene.frameHandler = async () => {};
  return scene;
}

// Regression test for GitHub issue #19: scene.play(new FadeIn(field), { runTime: 0.5 })
// -- exactly as written in real-world code and in the issue's own repro --
// used to throw "a.begin is not a function", because Scene.play()'s config
// detection only recognized a trailing config object if it carried the
// undocumented internal `_playConfig: true` marker; every other call site in
// THIS codebase remembers to set that marker, but it's an easy, unmarked trap
// for anyone else. A bare `{ runTime, rateFunc, ... }` object landed in the
// animations list instead of being treated as config, and crashed on
// `a.begin()`. Fixed by also recognizing config structurally: a trailing
// plain object with neither `.begin` (Animation-shaped) nor
// `_isAnimateBuilder` can only ever have been config (anything else in that
// shape was already guaranteed to crash).
test("issue #19: scene.play(anim, config) works even when config lacks the internal _playConfig marker", async () => {
  const scene = silentScene();
  const c = new Circle({ fillOpacity: 1 });
  scene.add(c);
  // No throw reaching this line is the main assertion (this used to throw
  // "a.begin is not a function" before the fix).
  await scene.play(new FadeIn(c), { runTime: 0.5 });
  assert.ok(c.strokeOpacity > 0.9, "FadeIn should have actually run and completed");
});

test("issue #19: the unmarked-config fix also covers a multi-submobject VGroup", async () => {
  const { VGroup } = await import("../src/mobject/VMobject.ts");
  const { Arrow } = await import("../src/mobject/geometry.ts");
  const scene = silentScene();
  const arrows = Array.from({ length: 15 }, (_, i) => new Arrow([i, -1, 0], [i, 1, 0]));
  const group = new VGroup(...arrows);
  scene.add(group);
  await scene.play(new FadeIn(group), { runTime: 0.5 });
  for (const m of group.getFamily()) {
    if (m.points?.length && (m as any).strokeOpacity != null) {
      assert.ok((m as any).strokeOpacity > 0.9, "every leaf should end fully (not near-zero) opaque");
    }
  }
});

test("an explicitly-marked _playConfig object still works exactly as before (no regression)", async () => {
  const scene = silentScene();
  const c = new Circle();
  scene.add(c);
  const before = scene.frameCount;
  await scene.play(new FadeIn(c), { _playConfig: true, runTime: 0.4 });
  // fps=30, runTime=0.4 -> 12 frames.
  assert.equal(scene.frameCount - before, 12);
});

test("a real second Animation (not config) is never misidentified as config", async () => {
  const scene = silentScene();
  const a = new Circle({ fillOpacity: 1 });
  const b = new Circle({ fillOpacity: 1 });
  scene.add(a, b);
  await scene.play(new FadeIn(a), new FadeOut(b));
  assert.ok(a.strokeOpacity > 0.9);
  // FadeOut restores opacities after removal (manim parity), so the proof
  // the second Animation RAN (wasn't parsed as config) is scene membership.
  assert.ok(!scene.mobjects.includes(b), "b was faded out and removed");
});

test("a trailing .animate builder is never misidentified as config", async () => {
  const scene = silentScene();
  const c = new Circle();
  scene.add(c);
  await scene.play(c.animate.shift([1, 0, 0]));
  assert.ok(Math.abs(c.getCenter()[0] - 1) < 1e-6);
});

test("play() with no animations at all (empty/falsy args) is still a no-op, not mistaken for config", async () => {
  const scene = silentScene();
  const before = scene.frameCount;
  await scene.play();
  assert.equal(scene.frameCount, before);
});
