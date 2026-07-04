import { test } from "node:test";
import assert from "node:assert/strict";
import { Dot } from "../src/mobject/geometry.ts";
import { Circumscribe, Flash, FocusOn } from "../src/animation/extra.ts";

// Issue #21: Circumscribe/Flash/FocusOn each build a brand-new, flat
// highlight mobject rather than reusing the target -- so under a 3D camera
// it never inherited the target's own _fixedInFrame/_fixedOrientation flags
// (set by MovingCameraScene/ThreeDScene's addFixedInFrameMobjects()), and
// rendered skewed even when the target itself was correctly fixed-in-frame.
// Fix: propagate the flags from the target (Circumscribe always has one;
// Flash/FocusOn only when called with a Mobject rather than a raw point),
// with an explicit config.fixedInFrame/fixedOrientation override available
// for the raw-point case. This fixes the "fixed-in-frame target" scenario
// (this issue's monty_hall.ts repro); it does NOT fix the separate,
// genuinely-3D-target skew (rsa.ts's repro) -- that needs camera-facing
// billboarding, a larger follow-up out of scope here.

test("Circumscribe inherits _fixedInFrame/_fixedOrientation from its target", () => {
  const plain = new Dot({ point: [1, 0, 0] });
  const plainCirc = new Circumscribe(plain);
  assert.equal((plainCirc.rect as any)._fixedInFrame, false);
  assert.equal((plainCirc.rect as any)._fixedOrientation, false);

  const fixed = new Dot({ point: [-2, -1.5, 0] });
  (fixed as any)._fixedInFrame = true;
  const fixedCirc = new Circumscribe(fixed);
  assert.equal((fixedCirc.rect as any)._fixedInFrame, true, "rect should inherit the target's fixed-in-frame flag");

  const oriented = new Dot({ point: [0, 0, 0] });
  (oriented as any)._fixedOrientation = true;
  const orientedCirc = new Circumscribe(oriented);
  assert.equal((orientedCirc.rect as any)._fixedOrientation, true);
});

test("Circumscribe: an explicit config.fixedInFrame overrides the target's own flag", () => {
  const fixed = new Dot({ point: [0, 0, 0] });
  (fixed as any)._fixedInFrame = true;
  const circ = new Circumscribe(fixed, { fixedInFrame: false });
  assert.equal((circ.rect as any)._fixedInFrame, false, "explicit false should win over an inherited true");
});

test("Flash inherits fixed flags when called with a Mobject (not just a raw point)", () => {
  const fixed = new Dot({ point: [1, 1, 0] });
  (fixed as any)._fixedInFrame = true;
  const flash = new Flash(fixed, { numLines: 4 });
  for (const line of flash.lines.submobjects) {
    assert.equal((line as any)._fixedInFrame, true, "every radiating line should inherit the flag");
  }
});

test("Flash falls back to config.fixedInFrame when given a raw point (no mobject to inherit from)", () => {
  const flashDefault = new Flash([1, 1, 0], { numLines: 4 });
  for (const line of flashDefault.lines.submobjects) {
    assert.equal((line as any)._fixedInFrame, undefined, "a raw point with no override should not force the flag");
  }

  const flashOverride = new Flash([1, 1, 0], { numLines: 4, fixedInFrame: true });
  for (const line of flashOverride.lines.submobjects) {
    assert.equal((line as any)._fixedInFrame, true, "an explicit override should still apply without a source mobject");
  }
});

test("FocusOn inherits fixed flags when called with a Mobject, falls back to config for a raw point", () => {
  const fixed = new Dot({ point: [0, 2, 0] });
  (fixed as any)._fixedOrientation = true;
  const focusOnMobject = new FocusOn(fixed);
  assert.equal((focusOnMobject.circle as any)._fixedOrientation, true);

  const focusOnPoint = new FocusOn([0, 2, 0], { fixedOrientation: true });
  assert.equal((focusOnPoint.circle as any)._fixedOrientation, true);

  const focusOnPlain = new FocusOn([0, 2, 0]);
  assert.equal((focusOnPlain.circle as any)._fixedOrientation, false);
});
