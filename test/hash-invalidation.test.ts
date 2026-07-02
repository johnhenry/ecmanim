// Segment-hash invalidation: the content-hash partial-movie cache is only
// sound if any visible change to an animation's target changes its hash.
// Regression coverage for the container-mobject blind spot found while
// dogfooding the explainer format: VGroup / vector-Text keep geometry in
// submobjects (own `points` empty), and the old fingerprint read only the
// top-level points — so moving a Text between renders reused stale partials.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene } from "../src/scene/Scene.ts";
import { Circle, Square } from "../src/mobject/geometry.ts";
import { VGroup } from "../src/mobject/VMobject.ts";
import { FadeIn, Transform } from "../src/animation/Animation.ts";

const scene = () => new Scene({ fps: 30 });

test("hash changes when a plain mobject moves", () => {
  const s = scene();
  const a = new Circle({ radius: 1 });
  const b = new Circle({ radius: 1 });
  b.shift([2, 0, 0]);
  assert.notEqual(
    s.hashAnimations([new FadeIn(a)], "play"),
    s.hashAnimations([new FadeIn(b)], "play"),
  );
});

test("hash changes when a CONTAINER (VGroup) moves — the dogfooding bug", () => {
  const s = scene();
  const make = () => new VGroup(new Circle({ radius: 0.5 }), new Square({ sideLength: 1 }));
  const a = make();
  const b = make();
  b.shift([2, 0, 0]);
  assert.equal(a.points.length, 0, "VGroup keeps no own points (the blind spot)");
  assert.notEqual(
    s.hashAnimations([new FadeIn(a)], "play"),
    s.hashAnimations([new FadeIn(b)], "play"),
  );
});

test("hash changes when a container's CHILD changes shape", () => {
  const s = scene();
  const a = new VGroup(new Circle({ radius: 0.5 }));
  const b = new VGroup(new Circle({ radius: 0.9 }));
  assert.notEqual(
    s.hashAnimations([new FadeIn(a)], "play"),
    s.hashAnimations([new FadeIn(b)], "play"),
  );
});

test("hash is stable across identical re-construction (cache still works)", () => {
  const make = () => {
    const g = new VGroup(new Circle({ radius: 0.5 }), new Square({ sideLength: 1 }));
    g.shift([1, -0.5, 0]);
    return g;
  };
  const s1 = scene();
  const s2 = scene();
  assert.equal(
    s1.hashAnimations([new FadeIn(make())], "play"),
    s2.hashAnimations([new FadeIn(make())], "play"),
  );
});

test("hash distinguishes animation class and runTime", () => {
  const s = scene();
  const c = () => new Circle({ radius: 1 });
  const h1 = s.hashAnimations([new FadeIn(c())], "play");
  const h2 = s.hashAnimations([new Transform(c(), new Square())], "play");
  assert.notEqual(h1, h2);
  const slow = new FadeIn(c());
  slow.runTime = 3;
  assert.notEqual(h1, s.hashAnimations([slow], "play"));
});
