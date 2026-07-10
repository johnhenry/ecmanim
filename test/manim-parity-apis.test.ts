// Manim-parity API batch (clusters M1-M4 of the manim-parity program):
// every API added to make the 27 gallery examples port 1:1.

import { test } from "node:test";
import assert from "node:assert/strict";
import { VMobject } from "../src/mobject/VMobject.ts";
import { Line, Circle, Square, Dot } from "../src/mobject/geometry.ts";
import { Ellipse } from "../src/mobject/geometry.ts";
import { ValueTracker } from "../src/mobject/value_tracker.ts";
import { Rotating } from "../src/animation/extra.ts";
import { NumberLine, Axes, NumberPlane } from "../src/mobject/coordinate_systems.ts";
import { normalizePixelArray } from "../src/core/pixel_array.ts";
import { fontSizePt } from "../src/mobject/text/Text.ts";
import { Surface } from "../src/mobject/surface.ts";
import { ThreeDScene } from "../src/scene/three_d.ts";
import * as V from "../src/core/math/vector.ts";

// --- M2: mobject APIs -------------------------------------------------------

test("addPointsAsCorners appends straight segments (PointWithTrace core)", () => {
  const path = new VMobject();
  path.setPointsAsCorners([[0, 0, 0], [1, 0, 0]]);
  const before = path.points.length;
  path.addPointsAsCorners([[1, 1, 0]]);
  assert.equal(path.points.length, before + 3, "one appended corner = one bezier segment");
  assert.deepEqual(path.points[path.points.length - 1], [1, 1, 0]);
  // Starts a fresh path when empty.
  const fresh = new VMobject();
  fresh.addPointsAsCorners([[2, 2, 0], [3, 2, 0]]);
  assert.deepEqual(fresh.points[0], [2, 2, 0]);
  assert.deepEqual(fresh.points[fresh.points.length - 1], [3, 2, 0]);
});

test("rotateAboutOrigin rotates about the world origin, not the center", () => {
  const dot = new Dot({ point: [1, 0, 0] });
  dot.rotateAboutOrigin(Math.PI / 2);
  const c = dot.getCenter();
  assert.ok(Math.abs(c[0]) < 1e-9 && Math.abs(c[1] - 1) < 1e-9, `rotated to ${c}`);
});

test("ValueTracker.incrementValue aliases increment", () => {
  const t = new ValueTracker(110);
  t.incrementValue(140);
  assert.equal(t.getValue(), 250);
});

test("Line.getUnitVector returns the normalized start->end direction", () => {
  const line = new Line([0, 0, 0], [3, 4, 0]);
  const u = line.getUnitVector();
  assert.ok(Math.abs(u[0] - 0.6) < 1e-9 && Math.abs(u[1] - 0.8) < 1e-9);
});

test("Rotating accepts manim's `angle` as an alias for radians", () => {
  const dot = new Dot({ point: [1, 0, 0] });
  const anim = new Rotating(dot, { angle: Math.PI, aboutPoint: [0, 0, 0], runTime: 2 });
  assert.equal(anim.radians, Math.PI);
});

test("scale accepts a vector for per-axis scaling", () => {
  const sq = new Square({ sideLength: 2 });
  sq.scale([0.5, 1.5, 1]);
  assert.ok(Math.abs(sq.getWidth() - 1) < 1e-9, `w ${sq.getWidth()}`);
  assert.ok(Math.abs(sq.getHeight() - 3) < 1e-9, `h ${sq.getHeight()}`);
});

test("boolean ops accept a trailing style config", async () => {
  const { Intersection } = await import("../src/mobject/boolean_ops.ts");
  const a = new Ellipse({ width: 4, height: 2, fillOpacity: 1 });
  const b = new Ellipse({ width: 4, height: 2, fillOpacity: 1 }).shift([1, 0, 0]) as Ellipse;
  const i = new Intersection(a, b, { color: "#83C167", fillOpacity: 0.5 });
  assert.equal(i.fillOpacity, 0.5);
  assert.equal((i as any).fillColor.toHex().toUpperCase(), "#83C167");
});

test("prepareForNonlinearTransform lets applyFunction bend straight lines", () => {
  const line = new Line([-3, 0, 0], [3, 0, 0]);
  const bentWithout = line.copy();
  bentWithout.applyFunction((p: number[]) => [p[0], Math.sin(p[0]), p[2]]);
  // Without subdivision: only endpoints move — midpoint of the path stays on
  // the straight chord between the mapped endpoints.
  const bent = line.copy();
  bent.prepareForNonlinearTransform(20);
  assert.ok(bent.getNumCurves() >= 20, `subdivided to ${bent.getNumCurves()} curves`);
  bent.applyFunction((p: number[]) => [p[0], Math.sin(p[0]), p[2]]);
  // With subdivision the path passes near sin(x) at interior points.
  const mid = bent.pointFromProportion(0.25);
  assert.ok(Math.abs(mid[1] - Math.sin(mid[0])) < 0.15, `interior follows sin: ${mid}`);
});

test("NumberPlane backgroundLineStyle accepts manim's strokeColor key", () => {
  const plane = new NumberPlane({ backgroundLineStyle: { strokeColor: "#FC6255", strokeWidth: 2 } });
  assert.equal(String(plane.bgColor), "#FC6255");
});

// --- M1: axes/plotting depth ------------------------------------------------

test("NumberLine numbersToInclude + numbersWithElongatedTicks", () => {
  const nl = new NumberLine({
    xRange: [-10, 10, 2],
    numbersToInclude: [-8, -4, 4, 8],
    numbersWithElongatedTicks: [-8, 8],
  });
  assert.deepEqual(nl.numbers.submobjects.map((t: any) => t.text), ["-8", "-4", "4", "8"]);
  const tall = nl.ticks.submobjects.filter((t: any) => t.getHeight() > nl.tickSize * 3);
  assert.equal(tall.length, 2, "two elongated ticks");
});

test("Axes threads numbersToInclude through x/yAxisConfig; tips flag works", () => {
  const ax = new Axes({
    xRange: [-1, 10], yRange: [-1, 10],
    xAxisConfig: { numbersToInclude: [2, 3] },
    tips: false,
  });
  assert.deepEqual(ax.xAxis.numbers.submobjects.map((t: any) => t.text), ["2", "3"]);
  const tipped = new Axes({ xRange: [0, 4], yRange: [0, 4], tips: true });
  assert.ok(tipped.xAxis.axisLine.constructor.name.includes("Arrow"), "tips=true → Arrow axes");
});

test("plot samples densely by default and records tMin/tMax", () => {
  const ax = new Axes({ xRange: [-10, 10.3, 1], yRange: [-1.5, 1.5, 1] });
  const graph = ax.plot(Math.sin) as any;
  // Old behavior sampled at the AXIS TICK step (1.0) → ~21 corners. Dense
  // default sampling gives hundreds of points.
  assert.ok(graph.points.length > 300, `dense sampling (${graph.points.length} pts)`);
  assert.equal(graph.tMin, -10);
  assert.ok(Math.abs(graph.tMax - 10.3) < 1e-9);
  assert.equal(graph.t_min, -10);
  // Explicit step still wins.
  const coarse = ax.plot(Math.sin, { xRange: [0, 10, 2] }) as any;
  assert.ok(coarse.points.length < 30, `explicit step respected (${coarse.points.length})`);
});

test("getVerticalLine accepts a world point (manim form) and lineFunc", async () => {
  const { DashedLine } = await import("../src/mobject/geometry.ts");
  const ax = new Axes({ xRange: [0, 10], yRange: [0, 10] });
  const curve = ax.plot((x: number) => x / 2);
  const p = ax.inputToGraphPoint(4, curve);
  const vline = ax.getVerticalLine(p, { color: "#FFFF00" });
  const base = ax.coordsToPoint(4, 0);
  assert.ok(V.distance(vline.getStart(), base) < 1e-6, "starts on the x-axis");
  assert.ok(V.distance(vline.getEnd(), p) < 1e-6, "ends at the graph point");
  const dashed = ax.getVerticalLine(p, { lineFunc: DashedLine } as any);
  assert.ok(dashed instanceof DashedLine);
  // The (x, graph) overload still works.
  const v2 = ax.getVerticalLine(4, curve);
  assert.ok(V.distance(v2.getEnd(), p) < 1e-6);
});

test("getArea accepts a gradient color tuple", () => {
  const ax = new Axes({ xRange: [0, 10], yRange: [0, 10] });
  const curve = ax.plot((x: number) => 5);
  const area = ax.getArea(curve, { xRange: [2, 3], color: ["#58C4DD", "#83C167"], opacity: 0.5 }) as any;
  assert.equal(area.gradientColors.length, 2);
  assert.equal(area.fillOpacity, 0.5);
});

test("getGraphLabel accepts manim's xVal", async () => {
  const { initMathTex } = await import("../src/mobject/mathtex.ts");
  await initMathTex();
  const ax = new Axes({ xRange: [-10, 10], yRange: [-2, 2] });
  const curve = ax.plot(Math.sin);
  const atMinus10 = ax.getGraphLabel(curve, "test", { xVal: -10 });
  const atDefault = ax.getGraphLabel(curve, "test");
  assert.ok(atMinus10.getCenter()[0] < atDefault.getCenter()[0], "xVal anchors the label");
});

// --- M3: pixel arrays + font units -------------------------------------------

test("normalizePixelArray: grayscale, RGB, RGBA, and error cases", () => {
  const gray = normalizePixelArray([[0, 128], [255, 64]]);
  assert.equal(gray.width, 2);
  assert.equal(gray.height, 2);
  assert.deepEqual([...gray.data.slice(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...gray.data.slice(4, 8)], [128, 128, 128, 255]);
  const rgb = normalizePixelArray([[[255, 0, 0]], [[0, 0, 255]]]);
  assert.deepEqual([...rgb.data.slice(0, 4)], [255, 0, 0, 255]);
  const rgba = normalizePixelArray([[[1, 2, 3, 4]]]);
  assert.deepEqual([...rgba.data], [1, 2, 3, 4]);
  assert.throws(() => normalizePixelArray([]), /non-empty/);
  assert.throws(() => normalizePixelArray([[0, 1], [2]]), /ragged/);
});

test("fontSizePt maps manim's default 48pt to ecmanim's default 0.7", () => {
  assert.ok(Math.abs(fontSizePt(48) - 0.7) < 1e-12);
  assert.ok(Math.abs(fontSizePt(96) - 1.4) < 1e-12);
});

// --- M4: 3D parity ------------------------------------------------------------

test("Surface.setStyle and setFillByCheckerboard restyle post-construction", () => {
  const s = new Surface((u: number, v: number) => [u, v, 0], { uRange: [0, 1], vRange: [0, 1], resolution: [4, 4] });
  s.setFillByCheckerboard("#FF862F", "#58C4DD", { opacity: 0.5 });
  const faces = s.submobjects as any[];
  assert.equal(faces[0].fillOpacity, 0.5);
  assert.notEqual(faces[0].baseColor.toHex(), faces[1].baseColor.toHex(), "adjacent faces alternate");
  assert.equal(faces[0].baseColor.toHex().toUpperCase(), "#FF862F");
  s.setStyle({ strokeColor: "#83C167", strokeWidth: 2 });
  assert.equal(faces[0].strokeWidth, 2);
});

test("ThreeDScene.lightSource proxies setCameraLight (manim light_source shape)", () => {
  const scene = new ThreeDScene({ frameHandler: async () => {} });
  scene.lightSource.moveTo([0, 0, -3]);
  assert.deepEqual(scene.lightSource.getCenter(), [0, 0, -3]);
  assert.deepEqual(scene.camera.lightSource, [0, 0, -3]);
});
