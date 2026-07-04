import { test } from "node:test";
import assert from "node:assert/strict";
import { Dot } from "../src/mobject/geometry.ts";
import { Circumscribe, Flash, FocusOn } from "../src/animation/extra.ts";
import { ThreeDCamera } from "../src/scene/three_d.ts";
import * as V from "../src/core/math/vector.ts";

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

// Issue #29: the remaining half of issue #21 -- a genuinely-3D (non-fixed)
// target has no "fixed" orientation to inherit, so it still rendered skewed
// (a parallelogram/lopsided starburst/ellipse) even after the #21 fix.
// Fixed via camera-facing billboarding: pass a 3D camera as config.camera to
// build the highlight in the target's camera-tangent plane instead of a
// fixed world-XY plane, recomputed every interpolateMobject() frame so an
// orbiting camera is tracked correctly.

// Rectangle builds a 13-point closed cubic-bezier path for its 4 corners
// (anchor, ctrl1, ctrl2 per edge, sharing endpoints) -- the true corners are
// every 3rd point (0, 3, 6, 9; index 12 repeats index 0). Two adjacent edge
// vectors from the first corner are undistorted (camera-facing) iff they're
// orthogonal and have exactly the configured width/height, regardless of
// camera angle.
function rectEdgeLengths(points: number[][]) {
  const a = points[0], b = points[3], d = points[9];
  const ab = V.sub(b, a);
  const ad = V.sub(d, a);
  return { ab, ad, abLen: V.length(ab), adLen: V.length(ad), dot: ab.reduce((s, v, i) => s + v * ad[i], 0) };
}

test("Circumscribe billboards an undistorted rectangle around a genuinely-3D target under an oblique camera", () => {
  const camera = new ThreeDCamera({ phi: 65 * V.DEGREES, theta: -70 * V.DEGREES });
  const worldDot = new Dot({ point: [1, 0.5, 0.8] });
  const circ = new Circumscribe(worldDot, { buff: 0.35, camera });
  circ.begin();
  circ.interpolateMobject(1); // fully drawn

  const { abLen, adLen, dot } = rectEdgeLengths(circ.rect.points);
  const expectedSide = worldDot.getWidth() + 2 * 0.35;
  assert.ok(Math.abs(abLen - expectedSide) < 1e-6, `edge length ${abLen} should equal ${expectedSide}`);
  assert.ok(Math.abs(adLen - expectedSide) < 1e-6, `edge length ${adLen} should equal ${expectedSide}`);
  assert.ok(Math.abs(dot) < 1e-6, `adjacent edges should be orthogonal (dot=${dot}), i.e. an undistorted rectangle`);
});

test("Circumscribe billboard re-tracks an orbiting camera every frame (not cached at construction)", () => {
  const camera = new ThreeDCamera({ phi: 65 * V.DEGREES, theta: -70 * V.DEGREES });
  const worldDot = new Dot({ point: [1, 0.5, 0.8] });
  const circ = new Circumscribe(worldDot, { buff: 0.35, camera });
  circ.begin();
  circ.interpolateMobject(1);
  const pointsBefore = circ.rect.points.map((p: number[]) => [...p]);

  // Simulate camera orbit (beginAmbientCameraRotation/moveCamera) between frames.
  camera.theta += 40 * V.DEGREES;
  circ.interpolateMobject(1);
  const pointsAfter = circ.rect.points;

  assert.notDeepEqual(pointsAfter, pointsBefore, "the rectangle must be rebuilt (not stale) when the camera moves");
  const { abLen, adLen, dot } = rectEdgeLengths(pointsAfter);
  const expectedSide = worldDot.getWidth() + 2 * 0.35;
  assert.ok(Math.abs(abLen - expectedSide) < 1e-6, "still undistorted after the camera moved");
  assert.ok(Math.abs(adLen - expectedSide) < 1e-6);
  assert.ok(Math.abs(dot) < 1e-6, "still orthogonal (undistorted) after the camera moved");
});

test("Circumscribe does NOT billboard when the target is fixed-in-frame, even if a camera is given", () => {
  const camera = new ThreeDCamera({ phi: 65 * V.DEGREES, theta: -70 * V.DEGREES });
  const fixed = new Dot({ point: [1, 0.5, 0.8] });
  (fixed as any)._fixedInFrame = true;
  const circ = new Circumscribe(fixed, { buff: 0.35, camera });
  assert.equal(circ._billboard, false, "the fixed-in-frame flag-propagation path (issue #21) should be used instead");
});

test("Circumscribe does NOT billboard when no camera is given (flat XY, unchanged pre-#29 behavior)", () => {
  const worldDot = new Dot({ point: [1, 0.5, 0.8] });
  const circ = new Circumscribe(worldDot, { buff: 0.35 });
  assert.equal(circ._billboard, false);
  circ.begin();
  circ.interpolateMobject(1);
  // Flat in world XY: every corner shares the same z as the target.
  for (const p of circ.rect.points) assert.ok(Math.abs(p[2] - 0.8) < 1e-9);
});

test("Flash billboards a symmetric burst around a genuinely-3D target under an oblique camera", () => {
  const camera = new ThreeDCamera({ phi: 65 * V.DEGREES, theta: -70 * V.DEGREES });
  const worldDot = new Dot({ point: [1, 0.5, 0.8] });
  const flash = new Flash(worldDot, { numLines: 8, flashRadius: 0.3, lineLength: 0.2, camera });
  flash.begin();
  flash.interpolateMobject(0); // alpha=0: full-length rays, before any fade

  // Symmetric iff every ray's length from the target's center is identical.
  const center = worldDot.getCenter();
  const lengths = flash.lines.submobjects.map((line: any) => V.distance(line.getStart(), center));
  for (const len of lengths) assert.ok(Math.abs(len - 0.3) < 1e-6, `every ray should start at radius 0.3, got ${len}`);
});

test("FocusOn billboards a camera-facing ring around a genuinely-3D target, still shrinking correctly", () => {
  const camera = new ThreeDCamera({ phi: 65 * V.DEGREES, theta: -70 * V.DEGREES });
  const worldDot = new Dot({ point: [1, 0.5, 0.8] });
  const focus = new FocusOn(worldDot, { startRadius: 1, camera });
  focus.begin();

  focus.interpolateMobject(0); // full size
  const center = worldDot.getCenter();
  const fullRadius = V.distance(focus.circle.points[0], center);
  assert.ok(Math.abs(fullRadius - 1) < 1e-6, `full-size ring should have radius 1, got ${fullRadius}`);

  focus.interpolateMobject(0.5); // half-shrunk
  const halfRadius = V.distance(focus.circle.points[0], center);
  assert.ok(Math.abs(halfRadius - 0.5) < 1e-6, `half-shrunk ring should have radius 0.5, got ${halfRadius}`);
});
