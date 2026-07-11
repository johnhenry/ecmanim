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

// Regression: a play() whose animation targets mobject A said nothing about
// a DIFFERENT, unanimated top-level mobject B sitting alongside it on the
// scene -- mutating B (moveTo/scale/color/...) before this play() call
// produced the IDENTICAL hash as leaving B alone, so the partial-movie cache
// could replay a stale segment whose rendered frame was visibly wrong (B in
// the old position). Verified with a direct repro before fixing. Found
// during the parity-campaigns roadmap retrospective (Campaign 9), not by
// any single campaign's port — a "what else might be broken" follow-up.
test("hash changes when an UNANIMATED sibling mobject moves (the untouched-mobject blind spot)", () => {
  const makeScene = (bPos: number[]) => {
    const s = scene();
    const a = new Circle({ radius: 1 });
    const b = new Circle({ radius: 1 });
    s.add(a, b);
    b.moveTo(bPos);
    return { s, a };
  };
  const one = makeScene([5, 0, 0]);
  const two = makeScene([-5, 0, 0]);
  assert.notEqual(
    one.s.hashAnimations([new FadeIn(one.a)], "play"),
    two.s.hashAnimations([new FadeIn(two.a)], "play"),
  );
});

test("hash stays the SAME when every top-level mobject is untouched-identical (no false-positive cache miss)", () => {
  const makeScene = () => {
    const s = scene();
    const a = new Circle({ radius: 1 });
    const b = new Circle({ radius: 1 });
    s.add(a, b);
    b.moveTo([5, 0, 0]);
    return { s, a };
  };
  const one = makeScene();
  const two = makeScene();
  assert.equal(
    one.s.hashAnimations([new FadeIn(one.a)], "play"),
    two.s.hashAnimations([new FadeIn(two.a)], "play"),
  );
});

test("the play()'s own animated mobject is excluded from the untouched set (moving it isn't double-counted as a false miss trigger)", () => {
  // Two scenes with the SAME two top-level mobjects (a, b); only `a` (the
  // one actually animated) differs in position between them. Since `a`'s
  // own position is already covered by hashAnimations()'s per-animation
  // geometry fingerprint (the pre-existing mechanism, not this fix), and
  // `a` must be EXCLUDED from the untouched-set fingerprint (it's touched),
  // the hashes should still differ here -- confirming `a` isn't silently
  // dropped from consideration entirely, just correctly attributed to the
  // existing geometry fingerprint rather than double-counted via untouched.
  const makeScene = (aPos: number[]) => {
    const s = scene();
    const a = new Circle({ radius: 1 });
    const b = new Circle({ radius: 1 });
    s.add(a, b);
    a.moveTo(aPos);
    return { s, a };
  };
  const one = makeScene([1, 0, 0]);
  const two = makeScene([2, 0, 0]);
  assert.notEqual(
    one.s.hashAnimations([new FadeIn(one.a)], "play"),
    two.s.hashAnimations([new FadeIn(two.a)], "play"),
  );
});
