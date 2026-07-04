import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  Axes,
  NumberPlane,
  PolarPlane,
  ComplexPlane,
} from "../src/mobject/coordinate_systems.ts";
import { LinearBase, LogBase } from "../src/mobject/graphing_scale.ts";
import { VGroup } from "../src/mobject/VMobject.ts";
import { Rectangle, Polygon, Circle } from "../src/mobject/geometry.ts";
import { initMathTex } from "../src/mobject/mathtex.ts";

// A vector font is needed for Text labels; MathJax for MathTex graph labels.
before(async () => {
  await (await import("../src/renderer/fonts-node.ts")).loadVectorFont();
  await initMathTex();
});

test("getRiemannRectangles returns a VGroup of Rectangles", () => {
  const ax = new Axes({ xRange: [0, 4, 1], yRange: [0, 16, 4] });
  const graph = ax.plot((x) => x * x, { xRange: [0, 4] });
  const rects = ax.getRiemannRectangles(graph, { dx: 0.5, inputSampleType: "center" });
  assert.ok(rects instanceof VGroup);
  assert.equal(rects.submobjects.length, 8); // (4-0)/0.5, center sampling => all nonzero
  for (const r of rects.submobjects) assert.ok(r instanceof Rectangle);
});

test("getArea builds a filled Polygon region", () => {
  const ax = new Axes({ xRange: [0, 3, 1], yRange: [0, 9, 3] });
  const graph = ax.plot((x) => x * x);
  const area = ax.getArea(graph, { xRange: [0, 2], opacity: 0.5 });
  assert.ok(area instanceof Polygon);
  assert.ok(area.points.length > 0);
  assert.ok(area.fillOpacity > 0);
});

test("slopeOfTangent of y=x^2 at x=1 is about 2", () => {
  const ax = new Axes();
  const graph = ax.plot((x) => x * x);
  assert.ok(Math.abs(ax.slopeOfTangent(1, graph) - 2) < 1e-3);
});

test("getGraphLabel places a label near the curve", () => {
  const ax = new Axes({ xRange: [0, 4, 1], yRange: [0, 16, 4] });
  const graph = ax.plot((x) => x * x, { xRange: [0, 4] });
  const label = ax.getGraphLabel(graph, "x^2", { x: 2 });
  assert.ok(label.submobjects.length > 0);
  const anchor = ax.inputToGraphPoint(2, graph);
  const c = label.getCenter();
  assert.ok(Math.hypot(c[0] - anchor[0], c[1] - anchor[1]) < 2.5);
});

test("getAxisLabels adds two labels", () => {
  const ax = new Axes();
  const labels = ax.getAxisLabels("x", "y");
  assert.ok(labels instanceof VGroup);
  assert.equal(labels.submobjects.length, 2);
});

test("addCoordinates adds number mobjects to both axes", () => {
  const ax = new Axes({ xRange: [-2, 2, 1], yRange: [-2, 2, 1] });
  ax.addCoordinates();
  assert.ok(ax.getXAxis().numbers.submobjects.length > 0);
  assert.ok(ax.getYAxis().numbers.submobjects.length > 0);
});

test("plotParametricCurve of a circle has finite points", () => {
  const ax = new Axes({ xRange: [-2, 2, 1], yRange: [-2, 2, 1] });
  const curve = ax.plotParametricCurve(
    (t) => [Math.cos(t), Math.sin(t)],
    { tRange: [0, 2 * Math.PI, 0.1] }
  );
  assert.ok(curve.points.length > 0);
  for (const p of curve.points) {
    assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]));
  }
});

test("PolarPlane builds concentric circles", () => {
  const pp = new PolarPlane({ size: 6, radiusMax: 3, radiusStep: 1 });
  assert.equal(pp.circles.submobjects.length, 3);
  for (const c of pp.circles.submobjects) assert.ok(c instanceof Circle);
  // c2p places r along the +x axis at azimuth 0.
  const p = pp.c2p(3, 0);
  assert.ok(p[0] > 0 && Math.abs(p[1]) < 1e-9);
});

test("LogBase functionOf(100) is 2 with base 10", () => {
  const lb = new LogBase(10);
  assert.ok(Math.abs(lb.functionOf(100) - 2) < 1e-9);
  assert.ok(Math.abs(lb.inverseFunctionOf(2) - 100) < 1e-6);
  const linear = new LinearBase();
  assert.equal(linear.functionOf(5), 5);
});

test("ComplexPlane n2p maps 1+1i up-right", () => {
  const cp = new ComplexPlane({ xRange: [-2, 2, 1], yRange: [-2, 2, 1] });
  const origin = cp.getOrigin();
  const p = cp.n2p({ re: 1, im: 1 });
  assert.ok(p[0] > origin[0], "real part moves right");
  assert.ok(p[1] > origin[1], "imaginary part moves up");
  const back = cp.p2n(p);
  assert.ok(Math.abs(back.re - 1) < 1e-6 && Math.abs(back.im - 1) < 1e-6);
});

test("c2p places coordinates on the rendered axis line for an asymmetric xRange (issue #1)", () => {
  // xRange not centered on zero: [0,70] instead of e.g. [-4,4]. Before the
  // fix, coordsToPoint()'s x used xAxis.numberToPoint() directly, which
  // ignored the shift() applied post-construction to re-center the axis on
  // its zero-reference — producing a constant horizontal offset for any
  // range whose reference isn't the midpoint.
  const ax = new Axes({ xRange: [0, 70, 10], yRange: [0, 1, 0.5] });
  const linePoints = ax.xAxis.axisLine.points;
  const lineStartX = linePoints[0][0];
  const lineEndX = linePoints[linePoints.length - 1][0];
  assert.ok(Math.abs(ax.c2p(0, 0)[0] - lineStartX) < 1e-9);
  assert.ok(Math.abs(ax.c2p(70, 0)[0] - lineEndX) < 1e-9);

  // A dot at c2p(x, 0) for any x in range must land on the drawn axis line.
  for (const x of [0, 17.5, 35, 52.5, 70]) {
    const px = ax.c2p(x, 0)[0];
    assert.ok(px >= lineStartX - 1e-9 && px <= lineEndX + 1e-9, `c2p(${x},0)[0]=${px} outside [${lineStartX},${lineEndX}]`);
  }

  // p2c must invert c2p (round-trip), including for a non-symmetric range.
  const [rx, ry] = ax.p2c(ax.c2p(25.9, 0.25));
  assert.ok(Math.abs(rx - 25.9) < 1e-9);
  assert.ok(Math.abs(ry - 0.25) < 1e-9);
});

// Issue #31 (filed against ThreeDAxes) turned out to affect this 2D class
// identically: _xRef()/_yRef() used to check `Number.isFinite(functionOf(0))`,
// which only catches a true log-scale axis -- not a plain LINEAR range that
// simply doesn't straddle 0, like [1.1, 3.4]. Confirmed via direct repro
// before this fix: the x-axis rendered spanning world x∈[4.07, 12.57],
// nowhere near the y-axis's crossing at world x=0 -- the exact "disconnected
// axes" symptom issue #31 reports for the 3D case. Fixed by checking range
// membership (xMin <= 0 <= xMax) instead of function finiteness.
test("x-axis anchors its own minimum (not an off-segment zero) when xRange doesn't include 0 (issue #31)", () => {
  const ax = new Axes({ xRange: [1.1, 3.4, 0.5], yRange: [-1.2, 6.5, 1], xLength: 8.5, yLength: 4.2 });
  const xStart = ax.xAxis.axisLine.getStart();
  const yLine = [ax.yAxis.axisLine.getStart(), ax.yAxis.axisLine.getEnd()];

  // The x-axis's own minimum (1.1) must land at the world origin, the same
  // point the y-axis (whose range DOES straddle 0) crosses at.
  assert.ok(Math.abs(xStart[0]) < 1e-9 && Math.abs(xStart[1]) < 1e-9, `xAxis start should be at the origin, got ${xStart}`);
  assert.ok(yLine[0][1] < 0 && yLine[1][1] > 0, "yAxis straddles the origin");
  assert.ok(Math.abs(yLine[0][0]) < 1e-9 && Math.abs(yLine[1][0]) < 1e-9, "yAxis line sits at world x=0, meeting the xAxis's start");

  // c2p/p2c must still round-trip correctly for values across the range.
  for (const x of [1.1, 2.25, 3.4]) {
    const [rx] = ax.p2c(ax.c2p(x, 0));
    assert.ok(Math.abs(rx - x) < 1e-9);
  }
});

test("c2p reflects a shift() applied after construction (issue #2)", () => {
  // Before the fix, coordsToPoint()/numberToPoint() computed from frozen
  // construction-time scalars (_leftX/unit), so a shift() applied to the
  // whole Axes after construction moved the rendered axis line but left
  // c2p()'s output unchanged. numberToPoint() must read the axis line's
  // live/current points instead.
  const ax = new Axes({ xRange: [-4, 4, 1], yRange: [-4, 4, 1] });
  const before = ax.c2p(0, 0.5);
  ax.shift([-1.5, 0, 0]);
  const after = ax.c2p(0, 0.5);
  assert.ok(Math.abs(after[0] - (before[0] - 1.5)) < 1e-9, `expected x to shift by -1.5, got ${before[0]} -> ${after[0]}`);
  assert.ok(Math.abs(after[1] - before[1]) < 1e-9, "y should be unaffected by a pure x shift");

  // The shifted c2p() output must still land exactly on the shifted,
  // rendered axis line.
  const lineStartX = ax.xAxis.axisLine.points[0][0];
  const lineEndX = ax.xAxis.axisLine.points[ax.xAxis.axisLine.points.length - 1][0];
  assert.ok(Math.abs(ax.c2p(-4, 0)[0] - lineStartX) < 1e-9);
  assert.ok(Math.abs(ax.c2p(4, 0)[0] - lineEndX) < 1e-9);

  // p2c must still invert c2p after the shift.
  const [rx, ry] = ax.p2c(ax.c2p(1.5, -2.5));
  assert.ok(Math.abs(rx - 1.5) < 1e-9);
  assert.ok(Math.abs(ry - -2.5) < 1e-9);

  // Combining both bugs: an asymmetric xRange (issue #1) plus a post-
  // construction shift (issue #2) must compose correctly.
  const ax2 = new Axes({ xRange: [0, 70, 10], yRange: [0, 1, 0.5] });
  ax2.shift([3, -2, 0]);
  const l2 = ax2.xAxis.axisLine.points;
  assert.ok(Math.abs(ax2.c2p(0, 0)[0] - l2[0][0]) < 1e-9);
  assert.ok(Math.abs(ax2.c2p(70, 0)[0] - l2[l2.length - 1][0]) < 1e-9);
});

test("NumberPlane with LogBase scaling maps 100 correctly", () => {
  const ax = new NumberPlane({
    xRange: [0, 4, 1],
    yAxisConfig: { scaling: new LogBase(10) },
    yRange: [1, 1000, 1],
  });
  // y=1000 => log10=3 is at the top; y=1 => log10=0 at the bottom.
  const pTop = ax.c2p(0, 1000);
  const pBot = ax.c2p(0, 1);
  assert.ok(pTop[1] > pBot[1]);
});
