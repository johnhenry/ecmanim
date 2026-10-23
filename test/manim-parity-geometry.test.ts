// Manim CE parity for #119 (A5): Line path_arc/buff and Arrow tip-length defaults.
// Expected numbers derive from Manim CE source:
//   mobject/geometry/line.py  Line.__init__(buff=0, path_arc=0), _account_for_buff
//   mobject/geometry/line.py  Arrow(max_tip_length_to_length_ratio=0.25), get_default_tip_length
//   constants.py              DEFAULT_ARROW_TIP_LENGTH = 0.35

import { test } from "node:test";
import assert from "node:assert/strict";
import { Line, Arrow } from "../src/mobject/geometry.ts";
import { Vector, DoubleArrow } from "../src/mobject/vectors.ts";
import { LabeledArrow } from "../src/mobject/labeled.ts";
import { CurvedArrow, CurvedDoubleArrow } from "../src/mobject/arcs.ts";

const near = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("Line pathArc bends the line into an ArcBetweenPoints (CE path_arc)", () => {
  const l = new Line([-1, 0, 0], [1, 0, 0], { pathArc: 1 });
  // sagitta = R(1 - cos(a/2)), R = chord / (2 sin(a/2)); CE arc runs CCW => bulges to -y.
  const R = 2 / (2 * Math.sin(0.5));
  const sag = R * (1 - Math.cos(0.5));
  const mid = l.pointFromProportion(0.5);
  near(mid[0], 0, 1e-3);
  near(mid[1], -sag, 1e-3);
  near(l.getStart()[0], -1);
  near(l.getEnd()[0], 1);
});

test("Line pathArc = 0 stays straight", () => {
  const l = new Line([-1, 0, 0], [1, 0, 0], { pathArc: 0 });
  near(l.pointFromProportion(0.5)[1], 0);
});

test("Line buff shortens both ends (CE _account_for_buff)", () => {
  const l = new Line([-2, 0, 0], [2, 0, 0], { buff: 0.5 });
  near(l.getStart()[0], -1.5);
  near(l.getEnd()[0], 1.5);
  near(l.getLength(), 3);
});

test("Line buff is ignored when length < 2*buff (CE)", () => {
  const l = new Line([0, 0, 0], [0.5, 0, 0], { buff: 0.5 });
  near(l.getLength(), 0.5);
});

test("Line buff with pathArc trims by arc length", () => {
  const plain = new Line([-2, 0, 0], [2, 0, 0], { pathArc: Math.PI / 2 });
  const trimmed = new Line([-2, 0, 0], [2, 0, 0], { pathArc: Math.PI / 2, buff: 0.5 });
  near(trimmed.getArcLength(20), plain.getArcLength(20) - 1, 5e-2);
});

test("Arrow default tip length is DEFAULT_ARROW_TIP_LENGTH = 0.35", () => {
  const a = new Arrow([0, 0, 0], [4, 0, 0]);
  near((a.tip as any).length, 0.35);
  near(a.tipLength, 0.35);
});

test("Arrow tip length is clamped to 0.25 * shaft length (CE get_default_tip_length)", () => {
  // buff 0.25 each side => shaft 0.5 => max tip 0.125
  const a = new Arrow([0, 0, 0], [1, 0, 0]);
  near((a.tip as any).length, 0.125);
  // buff 0: shaft 1 => max 0.25
  const b = new Arrow([0, 0, 0], [1, 0, 0], { buff: 0 });
  near((b.tip as any).length, 0.25);
  // custom ratio
  const c = new Arrow([0, 0, 0], [1, 0, 0], { buff: 0, maxTipLengthToLengthRatio: 0.5 });
  near((c.tip as any).length, 0.35);
});

test("Arrow explicit tipLength is honoured up to the ratio clamp", () => {
  near(((new Arrow([0, 0, 0], [4, 0, 0], { tipLength: 0.2 })).tip as any).length, 0.2);
});

test("Vector default tip length is 0.35 (buff 0)", () => {
  near((new Vector([3, 0, 0]).tip as any).length, 0.35);
  near((new Vector([1, 0, 0]).tip as any).length, 0.25); // clamp: 0.25 * 1
});

test("LabeledArrow inherits the Arrow tip default", () => {
  near((new LabeledArrow([0, 0, 0], [4, 0, 0], { label: "x" }).tip as any).length, 0.35);
});

test("DoubleArrow tips default to 0.35, clamped to 0.25 * length", () => {
  const d = new DoubleArrow([-2, 0, 0], [2, 0, 0]);
  near(d.tipLength, 0.35);
  const tipSpan = Math.abs(d.tipEnd.points[3][1] - d.tipEnd.points[6][1]);
  near(tipSpan, 0.35);
  const s = new DoubleArrow([0, 0, 0], [1, 0, 0]);
  near(s.tipLength, 0.25);
});

test("CurvedArrow / CurvedDoubleArrow tips default to 0.35", () => {
  near((new CurvedArrow([-2, 0, 0], [2, 0, 0]).tip as any).length, 0.35);
  const cd: any = new CurvedDoubleArrow([-2, 0, 0], [2, 0, 0]);
  near(cd.tip.length, 0.35);
  near(cd.startTip.length, 0.35);
});
