// Tests for the arc-derived geometry (arcs.ts) and the arrow tip system (tips.ts).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ArcBetweenPoints,
  CurvedArrow,
  Sector,
  AnnularSector,
  Angle,
  RightAngle,
  TangentLine,
  Elbow,
  LabeledDot,
  AnnotationDot,
} from "../src/mobject/arcs.ts";
import {
  ArrowTriangleFilledTip,
  StealthTip,
  ArrowCircleFilledTip,
  ArrowSquareTip,
} from "../src/mobject/tips.ts";
import { Line, Circle } from "../src/mobject/geometry.ts";
import * as V from "../src/core/math/vector.ts";

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test("ArcBetweenPoints passes through its endpoints", () => {
  const arc = new ArcBetweenPoints([-1, 0, 0], [1, 0, 0], Math.PI / 2);
  const s = arc.getStart();
  const e = arc.getEnd();
  assert.ok(V.equals(s, [-1, 0, 0], 1e-6), "start on requested start");
  assert.ok(V.equals(e, [1, 0, 0], 1e-6), "end on requested end");
});

test("ArcBetweenPoints with radius derives a curved arc", () => {
  const arc = new ArcBetweenPoints([-1, 0, 0], [1, 0, 0], Math.PI / 2, 2);
  assert.ok(arc.getNumCurves() >= 1, "produces at least one bezier curve");
  // The interior of the arc bulges away from the chord.
  const mid = arc.pointFromProportion(0.5);
  assert.ok(Math.abs(mid[1]) > 1e-3, "arc is not a straight line");
});

test("Sector is closed and filled", () => {
  const sec = new Sector({ outerRadius: 2, angle: Math.PI / 2 });
  assert.equal(sec.fillOpacity, 1, "sector is filled");
  const first = sec.points[0];
  const last = sec.points[sec.points.length - 1];
  assert.ok(V.equals(first, last, 1e-6), "sector path is closed");
});

test("AnnularSector leaves an inner radius (ring slice)", () => {
  const ann = new AnnularSector({ innerRadius: 1, outerRadius: 2, angle: Math.PI / 2 });
  assert.equal(ann.fillOpacity, 1);
  // Both an inner-radius and outer-radius point should appear among anchors.
  const radii = ann.getAnchors().map((p) => V.length(p));
  assert.ok(radii.some((r) => close(r, 1, 1e-3)), "has inner-radius anchor");
  assert.ok(radii.some((r) => close(r, 2, 1e-3)), "has outer-radius anchor");
});

test("Angle produces an arc VMobject between two lines", () => {
  const l1 = new Line([0, 0, 0], [1, 0, 0]);
  const l2 = new Line([0, 0, 0], [0, 1, 0]);
  const ang = new Angle(l1, l2, { radius: 0.5 });
  assert.ok(ang.getNumCurves() >= 1, "angle has bezier curves (an arc)");
  // Arc points sit at ~radius from the intersection (the origin).
  const r = V.length(ang.pointFromProportion(0.5));
  assert.ok(close(r, 0.5, 1e-2), "arc radius ~ requested radius");
});

test("RightAngle builds a square-corner elbow", () => {
  const l1 = new Line([0, 0, 0], [1, 0, 0]);
  const l2 = new Line([0, 0, 0], [0, 1, 0]);
  const ra = new RightAngle(l1, l2, { length: 0.4 });
  // An elbow is an L of two straight segments (2 curves), not a smooth arc.
  assert.equal(ra.getNumCurves(), 2, "elbow has two straight segments");
  assert.equal(ra._straightPath, true, "elbow path is straight");
});

test("Elbow is an L shape scaled to width", () => {
  const el = new Elbow({ width: 0.5 });
  assert.equal(el.getNumCurves(), 2);
  assert.ok(close(el.getWidth(), 0.5, 1e-6), "elbow width matches config");
});

test("TangentLine has the requested length", () => {
  const c = new Circle({ radius: 2 });
  const tl = new TangentLine(c, 0.25, { length: 3 });
  const len = V.distance(tl.getStart(), tl.getEnd());
  assert.ok(close(len, 3, 1e-6), "tangent line length matches config");
});

test("An ArrowTip points in +X (getTipAngle ~ 0)", () => {
  const tip = new ArrowTriangleFilledTip();
  assert.ok(close(tip.getTipAngle(), 0, 1e-6), "triangle tip points +X");
  assert.equal(tip.fillOpacity, 1, "filled variant has fillOpacity 1");
  const stealth = new StealthTip();
  assert.ok(close(stealth.getTipAngle(), 0, 1e-6), "stealth tip points +X");
  const circ = new ArrowCircleFilledTip();
  assert.ok(close(circ.getTipAngle(), 0, 1e-6), "circle tip points +X");
  const sq = new ArrowSquareTip();
  assert.ok(close(sq.getTipAngle(), 0, 1e-6), "square tip points +X");
});

test("ArrowTip length and vector are consistent", () => {
  const tip = new ArrowTriangleFilledTip({ tipLength: 0.5 });
  assert.ok(tip.length > 0, "tip has positive length");
  const vec = tip.getVector();
  assert.ok(close(V.length(vec), tip.length, 1e-9), "length equals |vector|");
});

test("CurvedArrow has a tip submobject at the end", () => {
  const ca = new CurvedArrow([-2, 0, 0], [2, 0, 0]);
  assert.ok(ca.tip, "curved arrow has a tip");
  assert.ok(ca.submobjects.includes(ca.tip), "tip is a submobject");
  // Tip point sits near the arrow's end point.
  const end = ca.pointFromProportion(1);
  const tipPoint = (ca.tip as any).getTipPoint();
  assert.ok(V.distance(tipPoint, end) < 0.5, "tip near arrow end");
});

test("LabeledDot contains its label centered on the dot", () => {
  const ld = new LabeledDot("X");
  assert.ok(ld.label, "labeled dot exposes its label");
  assert.ok(ld.submobjects.includes(ld.label as any), "label is a submobject");
  assert.equal((ld.label as any).text, "X", "label carries the text");
  assert.ok(V.distance(ld.label.getCenter(), ld.getCenter()) < 1e-6, "label centered on dot");
});

test("AnnotationDot is a bold blue dot with white stroke", () => {
  const dot = new AnnotationDot();
  assert.equal(dot.strokeWidth, 5, "thick stroke");
  assert.equal(dot.fillOpacity, 1, "filled");
});
