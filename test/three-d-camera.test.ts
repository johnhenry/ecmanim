import { test } from "node:test";
import assert from "node:assert/strict";
import { ThreeDCamera, ThreeDScene, ThreeDAxes } from "../src/scene/three_d.ts";
import * as V from "../src/core/math/vector.ts";
import { Line } from "../src/mobject/geometry.ts";

const CFG = { pixelWidth: 640, pixelHeight: 360, frameWidth: 640 / 360 * 8, frameHeight: 8 };

// Reference upright view: theta=-90, phi=0, gamma=0.
test("gamma=0 keeps [1,0,0] to the right and [0,1,0] up", () => {
  const cam = new ThreeDCamera({ ...CFG, phi: 0, theta: -90 * V.DEGREES, gamma: 0 });
  const cx = (CFG.pixelWidth) / 2, cy = CFG.pixelHeight / 2;
  const [rx, ry] = cam.toPixel([1, 0, 0]);
  const [ux, uy] = cam.toPixel([0, 1, 0]);
  // x-axis point projects to the right of center, roughly on the horizontal line.
  assert.ok(rx > cx, "x point is to the right");
  assert.ok(Math.abs(ry - cy) < 1, "x point stays on the center horizontal");
  // y-axis point projects above center, roughly on the vertical line.
  assert.ok(uy < cy, "y point is above (smaller pixel-y)");
  assert.ok(Math.abs(ux - cx) < 1, "y point stays on the center vertical");
});

test("gamma=PI/2 rolls the x-axis point toward vertical", () => {
  const cam = new ThreeDCamera({ ...CFG, phi: 0, theta: -90 * V.DEGREES, gamma: Math.PI / 2 });
  const cx = CFG.pixelWidth / 2, cy = CFG.pixelHeight / 2;
  const [rx, ry] = cam.toPixel([1, 0, 0]);
  // After a 90deg roll, the horizontal x-axis point maps onto the vertical axis.
  assert.ok(Math.abs(rx - cx) < 1, "x point now sits on the vertical (roll)");
  assert.ok(Math.abs(ry - cy) > 1, "x point moved off the horizontal");
});

test("getLightDirection normalizes the light source", () => {
  const cam = new ThreeDCamera({ ...CFG });
  const d = cam.getLightDirection();
  assert.ok(Math.abs(V.length(d) - 1) < 1e-9);
});

test("ThreeDAxes.c2p maps origin, right, and z distinctly", () => {
  const ax = new ThreeDAxes({ xRange: [-4, 4, 1], yRange: [-4, 4, 1], zRange: [-4, 4, 1] });
  const o = ax.c2p(0, 0, 0);
  assert.ok(V.length(o) < 1e-6, "c2p(0,0,0) is the origin");
  const rx = ax.c2p(1, 0, 0);
  assert.ok(rx[0] > 0 && Math.abs(rx[1]) < 1e-9 && Math.abs(rx[2]) < 1e-9, "c2p(1,0,0) goes +x");
  const pz = ax.c2p(0, 0, 1);
  const py = ax.c2p(0, 1, 0);
  assert.ok(Math.abs(pz[2]) > 1e-6, "c2p(0,0,1) has a real z-component");
  assert.ok(Math.abs(py[2]) < 1e-9 && Math.abs(py[1]) > 1e-6, "c2p(0,1,0) is in-plane");
  // The z point projects differently than the y point under the 3D camera.
  const cam = new ThreeDCamera({ ...CFG, phi: 70 * V.DEGREES, theta: -45 * V.DEGREES });
  const [, zpy] = cam.toPixel(pz);
  const [, ypy] = cam.toPixel(py);
  assert.ok(Math.abs(zpy - ypy) > 1, "z and y project to different screen positions");
});

test("ThreeDAxes exposes getAxis / getZAxis", () => {
  const ax = new ThreeDAxes({});
  assert.equal(ax.getAxis(0), ax.xAxis);
  assert.equal(ax.getAxis(2), ax.zAxis);
  assert.equal(ax.getZAxis(), ax.zAxis);
});

// ecmanim#38: yAxis/zAxis built their number-label Text submobjects BEFORE
// being rotated into place, so the rotate() calls in the constructor
// rotated the labels right along with the axis line -- sideways/edge-on
// relative to the camera, effectively illegible. Fixed by discarding those
// mispositioned labels and rebuilding them in world space via
// coordsToPoint (same fix 2D Axes already had for its own yAxis --
// see coordinate_systems.ts's `_buildYNumbers()`).
test("yAxisConfig.includeNumbers positions y-axis labels beside the y-axis line, not scattered by the rotation", () => {
  const ax = new ThreeDAxes({
    xRange: [-4, 4, 1],
    yRange: [-4, 4, 1],
    zRange: [-4, 4, 1],
    yAxisConfig: { includeNumbers: true },
  });
  const labels = ax.getYAxis().numbers.submobjects;
  assert.ok(labels.length > 0, "y-axis numbers were built");
  for (const label of labels) {
    const [lx] = label.getCenter();
    // Correct placement hugs the y-axis (a small fixed buffer to its side,
    // in world x); the pre-fix bug rotated the label's local
    // horizontal-line offset along with the axis, scattering it away from
    // the y-axis line by multiple world units instead.
    assert.ok(Math.abs(lx) < 1, `y-axis label at x=${lx} should hug the y-axis (x~0), not be scattered by the rotation bug`);
  }
});

test("zAxisConfig.includeNumbers positions z-axis labels beside the z-axis line, not scattered by the rotation", () => {
  const ax = new ThreeDAxes({
    xRange: [-4, 4, 1],
    yRange: [-4, 4, 1],
    zRange: [-4, 4, 1],
    zAxisConfig: { includeNumbers: true },
  });
  const labels = ax.getZAxis().numbers.submobjects;
  assert.ok(labels.length > 0, "z-axis numbers were built");
  for (const label of labels) {
    const [lx] = label.getCenter();
    assert.ok(Math.abs(lx) < 1, `z-axis label at x=${lx} should hug the z-axis (x~0), not be scattered by the rotation bug`);
  }
});

test("y-axis and z-axis number labels stay upright, matching the x-axis's own (never-rotated) label shape", () => {
  // Uses the shared `axisConfig` path (not the new per-axis config) since
  // that path already worked pre-fix -- an apples-to-apples check that
  // isolates the rotation bug itself from the separate per-axis-config
  // addition. Same xRange/yRange/zRange means the same tick values (and
  // thus the same label text/shape) on every axis, so a correctly upright
  // y/z label's world-space aspect ratio (getWidth()/getHeight()) should
  // match the x-axis's own -- pre-fix, the y-axis's rotated label measured
  // a visibly different (inflated) aspect, and the z-axis's collapsed to
  // ~0 width (a 90-degree rotation about Y turns the label's in-plane
  // width into near-zero depth).
  const ax = new ThreeDAxes({
    xRange: [-4, 4, 1],
    yRange: [-4, 4, 1],
    zRange: [-4, 4, 1],
    axisConfig: { includeNumbers: true },
  });
  const aspect = (m: any) => m.getWidth() / Math.max(m.getHeight(), 1e-9);
  // The x-axis's own labels include a "0" (the never-rotated NumberLine's
  // stock _addNumbers() doesn't skip it); _buildAxisNumbers skips 0 on y/z
  // to avoid stacking three axes' zero labels at the shared origin -- so
  // compare against the SET of x's distinct aspect values rather than a
  // 1:1 indexed pairing, which would otherwise assume equal label counts.
  const xAspects = [...new Set(ax.getXAxis().numbers.submobjects.map(aspect).map((v: number) => v.toFixed(2)))].map(Number);
  const yAspects = ax.getYAxis().numbers.submobjects.map(aspect);
  const zAspects = ax.getZAxis().numbers.submobjects.map(aspect);
  assert.ok(yAspects.length > 0 && zAspects.length > 0, "y and z labels were built");
  for (const a of yAspects) {
    assert.ok(
      xAspects.some((x) => Math.abs(x - a) < 0.05),
      `y-axis label aspect ${a} should match one of the x-axis's own upright aspects [${xAspects}], not a rotated shape`,
    );
  }
  for (const a of zAspects) {
    assert.ok(
      xAspects.some((x) => Math.abs(x - a) < 0.05),
      `z-axis label aspect ${a} should match one of the x-axis's own upright aspects [${xAspects}], not a rotated shape`,
    );
  }
});

test("y-axis and z-axis number labels vary along their own axis' world coordinate, confirming they track real tick values", () => {
  const ax = new ThreeDAxes({
    xRange: [-4, 4, 1],
    yRange: [-4, 4, 1],
    zRange: [-4, 4, 1],
    axisConfig: { includeNumbers: true },
  });
  const yPositions = ax.getYAxis().numbers.submobjects.map((m: any) => m.getCenter()[1]);
  const zPositions = ax.getZAxis().numbers.submobjects.map((m: any) => m.getCenter()[2]);
  assert.ok(yPositions.length > 1, "multiple y-axis labels built");
  assert.ok(zPositions.length > 1, "multiple z-axis labels built");
  assert.ok(new Set(yPositions.map((v: number) => v.toFixed(3))).size > 1, "y-axis labels vary along world Y");
  assert.ok(new Set(zPositions.map((v: number) => v.toFixed(3))).size > 1, "z-axis labels vary along world Z");
});

// Issue #31: an axis whose range doesn't include 0 (e.g. a log10 axis over
// values that never reach 0) used to shift so data-value 0's position --
// off that axis's own rendered segment -- sat at the world origin, leaving
// the three axes rendered as disconnected segments instead of meeting at a
// shared corner. Fixed by falling back to the axis's own minimum as the
// crossing reference when 0 isn't in [xMin, xMax].
test("an axis whose range doesn't include 0 anchors its OWN minimum to the shared corner (issue #31)", () => {
  const ax = new ThreeDAxes({
    xRange: [1.1, 3.4, 0.5], // entirely positive -- 0 is not in range
    yRange: [-1.2, 6.5, 1],  // straddles 0 -- unaffected
    zRange: [-2.1, 0.5, 1],  // straddles 0 -- unaffected
    xLength: 8.5, yLength: 4.2, zLength: 2.5,
  });
  const xStart = ax.xAxis.axisLine.getStart();
  const yLine = [ax.yAxis.axisLine.getStart(), ax.yAxis.axisLine.getEnd()];
  const zLine = [ax.zAxis.axisLine.getStart(), ax.zAxis.axisLine.getEnd()];

  // The x-axis's own minimum (1.1, since 0 isn't in [1.1, 3.4]) must land
  // exactly at the world origin -- the same corner the y/z axes cross at.
  assert.ok(V.length(xStart) < 1e-9, `xAxis start should be at the origin, got ${xStart}`);

  // y and z DO straddle 0, so they're unaffected -- their lines must still
  // cross world x=0/z=0 (i.e. the origin lies between each pair of endpoints).
  assert.ok(yLine[0][1] < 0 && yLine[1][1] > 0, "yAxis straddles the origin");
  assert.ok(zLine[0][2] < 0 && zLine[1][2] > 0, "zAxis straddles the origin");
  assert.ok(Math.abs(yLine[0][0]) < 1e-9 && Math.abs(yLine[1][0]) < 1e-9, "yAxis line sits at world x=0");
  assert.ok(Math.abs(zLine[0][0]) < 1e-9 && Math.abs(zLine[1][0]) < 1e-9, "zAxis line sits at world x=0");
});

test("c2p/p2c round-trip correctly for an axis whose range doesn't include 0 (issue #31)", () => {
  const ax = new ThreeDAxes({
    xRange: [1.1, 3.4, 0.5], yRange: [-1.2, 6.5, 1], zRange: [-2.1, 0.5, 1],
    xLength: 8.5, yLength: 4.2, zLength: 2.5,
  });
  for (const coords of [[1.1, 0, 0], [3.4, 6.5, 0.5], [2.25, 2.65, -0.8]]) {
    const p = ax.c2p(coords[0], coords[1], coords[2]);
    const back = ax.p2c(p);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(back[i] - coords[i]) < 1e-9, `axis ${i}: expected ${coords[i]}, got ${back[i]}`);
  }
  // The x-axis minimum must map to the x-axis's own rendered start point.
  const minPoint = ax.c2p(1.1, 0, 0);
  const xStart = ax.xAxis.axisLine.getStart();
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(minPoint[i] - xStart[i]) < 1e-9);
});

test("a normal 0-including range is unaffected by the issue #31 fix", () => {
  const ax = new ThreeDAxes({ xRange: [-4, 4, 1], yRange: [-4, 4, 1], zRange: [-4, 4, 1] });
  assert.deepEqual(ax.c2p(0, 0, 0), [0, 0, 0]);
  assert.deepEqual(ax.c2p(2, 3, -1), [2, 3, -1]);
});

test("addFixedInFrameMobjects marks _fixedInFrame and adds it", () => {
  const scene = new ThreeDScene(CFG);
  const line = new Line([0, 0, 0], [1, 0, 0]);
  scene.addFixedInFrameMobjects(line);
  assert.equal((line as any)._fixedInFrame, true);
  assert.ok(scene.mobjects.includes(line));
});

test("moveCamera tweens gamma to its target", async () => {
  const scene = new ThreeDScene({ ...CFG, fps: 5 });
  scene.frameHandler = async () => {};
  await scene.moveCamera({ gamma: Math.PI / 2 }, { runTime: 0.4 });
  assert.ok(Math.abs(scene.camera.gamma - Math.PI / 2) < 1e-6);
});

test("setToDefaultAngledCameraOrientation sets phi/theta", () => {
  const scene = new ThreeDScene(CFG);
  scene.setToDefaultAngledCameraOrientation();
  assert.ok(scene.camera.phi > 0, "phi tilted");
  assert.ok(scene.camera.theta < 0, "theta rotated negative");
  assert.ok(Math.abs(scene.camera.phi - 75 * V.DEGREES) < 1e-9);
});
