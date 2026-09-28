import { test, before } from "node:test";
import assert from "node:assert/strict";

import { TextList } from "../src/mobject/text/text_list.ts";
import { LEFT } from "../src/core/math/vector.ts";

before(async () => {
  const { loadVectorFont } = await import("../src/renderer/fonts-node.ts");
  await loadVectorFont();
});

test("TextList has one row per flat item", () => {
  const list = new TextList(["First item", "Second item", "Third item"]);
  assert.equal(list.rows.length, 3);
  assert.equal(list.getContent(0).text, "First item");
  assert.equal(list.getContent(2).text, "Third item");
});

test("default markers are bullets, one per depth level", () => {
  const list = new TextList(["top", ["nested", ["deep"]]]);
  assert.equal(list.rows.map((r) => r.depth).join(","), "0,1,2");
  assert.equal(list.getMarker(0).text, "•");
  assert.equal(list.getMarker(1).text, "◦");
  assert.equal(list.getMarker(2).text, "▪");
});

test("a marker function receives (index, depth) and can number items", () => {
  const list = new TextList(["a", "b", "c"], { marker: (i) => `${i + 1}.` });
  assert.equal(list.getMarker(0).text, "1.");
  assert.equal(list.getMarker(1).text, "2.");
  assert.equal(list.getMarker(2).text, "3.");
});

test("rows at the same depth share a left edge regardless of text length", () => {
  const list = new TextList([
    "Short",
    "A medium length bullet point",
    "An even longer bullet point that runs quite far across the frame",
  ]);
  const xs = list.rows.map((r) => r.group.getBoundaryPoint(LEFT)[0]);
  assert.ok(xs.every((x) => Math.abs(x - xs[0]) < 1e-9), `expected all left edges equal, got ${xs}`);
});

test("nested items are indented right of their parent's left edge", () => {
  const list = new TextList(["Parent", ["Child one", "Child two"]], { indent: 0.6 });
  const parentX = list.rows[0].group.getBoundaryPoint(LEFT)[0];
  const child1X = list.rows[1].group.getBoundaryPoint(LEFT)[0];
  const child2X = list.rows[2].group.getBoundaryPoint(LEFT)[0];
  assert.ok(Math.abs(child1X - (parentX + 0.6)) < 1e-9);
  assert.ok(Math.abs(child2X - child1X) < 1e-9);
});

test("rows stack top to bottom without overlapping", () => {
  const list = new TextList(["one", "two", "three"]);
  const ys = list.rows.map((r) => r.group.getCenter()[1]);
  assert.ok(ys[0] > ys[1] && ys[1] > ys[2], `expected descending y, got ${ys}`);
});

test("markerColor tints only the marker, not the content", () => {
  const list = new TextList(["item"], { markerColor: "#FF0000", color: "#00FF00" });
  const markerColor = list.getMarker(0).fillColor.toHex();
  const contentColor = list.getContent(0).fillColor.toHex();
  assert.notEqual(markerColor, contentColor);
});
