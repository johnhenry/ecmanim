import { test, before } from "node:test";
import assert from "node:assert/strict";

import { initMathTex } from "../src/mobject/mathtex.ts";
import { Matrix, DecimalMatrix } from "../src/mobject/matrix.ts";
import { Table } from "../src/mobject/table.ts";
import { Brace, BraceLabel } from "../src/mobject/brace.ts";
import { Square } from "../src/mobject/geometry.ts";
import { DecimalNumber } from "../src/mobject/value_tracker.ts";

before(async () => {
  await initMathTex();
});

test("Matrix has 4 entries and 2 brackets", () => {
  const m = new Matrix([[1, 2], [3, 4]]);
  assert.equal(m.getEntries().submobjects.length, 4);
  assert.equal(m.getBrackets().submobjects.length, 2);
});

test("Matrix getRows/getColumns lengths", () => {
  const m = new Matrix([[1, 2], [3, 4]]);
  const rows = m.getRows();
  const cols = m.getColumns();
  assert.equal(rows.submobjects.length, 2);
  assert.equal((rows.submobjects[0] as any).submobjects.length, 2);
  assert.equal(cols.submobjects.length, 2);
  assert.equal((cols.submobjects[0] as any).submobjects.length, 2);
});

test("DecimalMatrix entries are DecimalNumbers", () => {
  const m = new DecimalMatrix([[1.5, 2.5], [3.5, 4.5]]);
  const entries = m.getEntries().submobjects;
  assert.equal(entries.length, 4);
  for (const e of entries) assert.ok(e instanceof DecimalNumber);
});

test("Table 2x2 has 4 entries and grid lines", () => {
  const t = new Table([["a", "b"], ["c", "d"]]);
  assert.equal(t.getEntries().submobjects.length, 4);
  assert.ok(t.getHorizontalLines().submobjects.length > 0);
  assert.ok(t.getVerticalLines().submobjects.length > 0);
});

test("Brace spans approximately the square's width", () => {
  const sq = new Square({ sideLength: 2 });
  const brace = new Brace(sq, { direction: [0, -1, 0] });
  // The brace's horizontal extent should be close to the square's width.
  assert.ok(brace.getWidth() > 1.5);
  assert.ok(brace.getWidth() < 2.6);
});

test("Brace.getText returns a labeled mobject near the tip", () => {
  const sq = new Square({ sideLength: 2 });
  const brace = new Brace(sq, { direction: [0, -1, 0] });
  const label = brace.getText("x");
  const tip = brace.getTip();
  const center = label.getCenter();
  const dist = Math.hypot(center[0] - tip[0], center[1] - tip[1]);
  assert.ok(dist < 1.5, `label should be near the tip (dist=${dist})`);
});

test("BraceLabel builds a brace and a label", () => {
  const sq = new Square({ sideLength: 2 });
  const bl = new BraceLabel(sq, "n");
  assert.ok(bl.brace instanceof Brace);
  assert.ok(bl.getLabel() != null);
  assert.equal(bl.submobjects.length, 2);
});
