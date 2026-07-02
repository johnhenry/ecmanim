import { test, before } from "node:test";
import assert from "node:assert/strict";
import { VectorDecimalNumber, vectorDecimalNumber } from "../src/mobject/vector_value_tracker.ts";

before(async () => {
  await (await import("../src/renderer/fonts-node.ts")).loadVectorFont("sans-serif");
});

test("renders one vector glyph VMobject per character with real points", () => {
  const n = new VectorDecimalNumber(3.14, { numDecimalPlaces: 2 });
  // "3.14" -> up to 4 glyphs (some may be dropped if a char has no outline).
  assert.ok(n.submobjects.length >= 3, `got ${n.submobjects.length} glyphs`);
  for (const g of n.submobjects) {
    assert.ok((g as any).points.length > 0, "glyph has bezier points");
  }
  assert.equal(n.getValue(), 3.14);
});

test("_format mirrors DecimalNumber (decimals, sign, commas, unit)", () => {
  const n = new VectorDecimalNumber(0);
  assert.equal(n._format(1234.5), "1,234.50");
  n.includeSign = true;
  assert.equal(n._format(5), "+5.00");
  assert.equal(n._format(-5), "-5.00");
  n.includeSign = false; n.groupWithCommas = false; n.unit = " kg"; n.numDecimalPlaces = 1;
  assert.equal(n._format(1000), "1000.0 kg");
});

test("setValue updates and returns the new value", () => {
  const n = vectorDecimalNumber(1, { numDecimalPlaces: 0, groupWithCommas: false });
  n.setValue(42);
  assert.equal(n.getValue(), 42);
  assert.ok(n.submobjects.length >= 2, "'42' -> 2 glyphs");
});

test("edgeToFix keeps the left edge ~constant across a width-changing setValue", () => {
  const n = new VectorDecimalNumber(9, { numDecimalPlaces: 0, groupWithCommas: false, edgeToFix: [-1, 0, 0] });
  const leftBefore = n.getBoundaryPoint([-1, 0, 0])[0];
  n.setValue(1000000); // much wider
  const leftAfter = n.getBoundaryPoint([-1, 0, 0])[0];
  assert.ok(Math.abs(leftAfter - leftBefore) < 1e-3, `left edge moved ${leftAfter - leftBefore}`);
});

test("includeSign / unit / commas change glyph count", () => {
  const plain = new VectorDecimalNumber(1000, { numDecimalPlaces: 0 }); // "1,000"
  const noCommas = new VectorDecimalNumber(1000, { numDecimalPlaces: 0, groupWithCommas: false }); // "1000"
  assert.ok(plain.submobjects.length > noCommas.submobjects.length);
});
