import { test, before } from "node:test";
import assert from "node:assert/strict";
import { Text, MarkupText, RasterText, CHAR_ASPECT, estimateTextSize } from "../src/mobject/text/Text.ts";
import { VMobject } from "../src/mobject/VMobject.ts";

// Ensure a vector font is loaded so `new Text(...)` builds real glyph outlines.
before(async () => {
  await (await import("../src/renderer/fonts-node.ts")).loadVectorFont();
});

test("estimateTextSize() is exported and matches RasterText's own internal box-building formula", () => {
  assert.equal(CHAR_ASPECT, 0.55);

  // RasterText always uses this estimate as its actual geometry (no vector
  // glyph fallback), so it's a direct, exact ground truth to check against.
  const single = estimateTextSize("Hello, ecmanim!", 0.5);
  const r = new RasterText("Hello, ecmanim!", { fontSize: 0.5 });
  assert.ok(Math.abs(single.width - r.getWidth()) < 1e-9);
  assert.ok(Math.abs(single.height - r.getHeight()) < 1e-9);

  // A multi-line RasterText, and the default lineHeight (matches
  // RasterText's hard-coded 1.2).
  const multi = estimateTextSize("line one\nline two", 0.4);
  const r2 = new RasterText("line one\nline two", { fontSize: 0.4 });
  assert.ok(Math.abs(multi.width - r2.getWidth()) < 1e-9);
  assert.ok(Math.abs(multi.height - r2.getHeight()) < 1e-9);
  assert.equal(multi.height, 2 * 0.4 * 1.2);

  // Custom lineHeight (the parameter Text's own `lineSpacing` config feeds
  // into for its raster-fallback path, used when no vector font is loaded).
  const custom = estimateTextSize("line one\nline two", 0.4, { lineHeight: 1.5 });
  assert.equal(custom.height, 2 * 0.4 * 1.5);
  assert.equal(custom.width, multi.width); // lineHeight only affects height
});

test("Text builds per-glyph submobjects", () => {
  const t = new Text("Ag");
  assert.equal(t.chars.submobjects.length, 2);
  assert.equal(t.submobjects.length, 2);
  // Each glyph is a VMobject with real outline points.
  for (const g of t.chars.submobjects) {
    assert.ok(g instanceof VMobject);
    assert.ok(g.points.length > 0);
  }
});

test("t2c colours a substring's glyphs", () => {
  const t = new Text("red apple", { t2c: { apple: "#FF0000" } });
  const part = t.getPartByText("apple");
  assert.ok(part.submobjects.length === 5);
  for (const g of part.submobjects) {
    const c = (g as VMobject).fillColor;
    assert.ok(c.r > 0.9 && c.g < 0.1 && c.b < 0.1, "apple glyph should be red");
  }
  // A non-coloured glyph stays white.
  const other = t.getPartByText("red").submobjects[0] as VMobject;
  assert.ok(other.fillColor.r > 0.9 && other.fillColor.g > 0.9);
});

test("getPartByText returns a matching glyph group", () => {
  const t = new Text("hello world");
  const part = t.getPartByText("world");
  assert.equal(part.submobjects.length, 5);
  const missing = t.getPartByText("zzz");
  assert.equal(missing.submobjects.length, 0);
});

test("multi-line text stacks vertically via \\n", () => {
  const t = new Text("ab\ncd");
  assert.equal(t.chars.submobjects.length, 4);
  const [a, b, c, d] = t.chars.submobjects.map((g) => g.getCenter());
  // First line ('a','b') sits above the second line ('c','d').
  const firstLineY = (a[1] + b[1]) / 2;
  const secondLineY = (c[1] + d[1]) / 2;
  assert.ok(firstLineY > secondLineY, "line 1 should be above line 2");
});

test("lineSpacing widens vertical gap", () => {
  const tight = new Text("a\nb", { lineSpacing: 1.0 });
  const loose = new Text("a\nb", { lineSpacing: 2.0 });
  const gap = (t: Text) => {
    const [g0, g1] = t.chars.submobjects.map((g) => g.getCenter());
    return Math.abs(g0[1] - g1[1]);
  };
  assert.ok(gap(loose) > gap(tight));
});

test("MarkupText strips <b> tags and bolds the run", () => {
  const t = new MarkupText("<b>Hi</b>");
  assert.equal(t.text, "Hi");
  assert.equal(t.chars.submobjects.length, 2);
  // Bold is emulated with an added stroke on the glyph fill.
  for (const g of t.chars.submobjects) {
    assert.ok((g as VMobject).strokeWidth > 0, "bold glyph should carry stroke");
  }
});

test("MarkupText span foreground colours a run", () => {
  const t = new MarkupText('a <span foreground="#00FF00">go</span> b');
  assert.equal(t.text, "a go b");
  const part = t.getPartByText("go");
  assert.equal(part.submobjects.length, 2);
  for (const g of part.submobjects) {
    const c = (g as VMobject).fillColor;
    assert.ok(c.g > 0.9 && c.r < 0.1, "span run should be green");
  }
});

test("gradient spreads colours across glyphs", () => {
  const t = new Text("ABCDE", { gradient: ["#FF0000", "#0000FF"] });
  const first = t.chars.submobjects[0] as VMobject;
  const lastG = t.chars.submobjects[4] as VMobject;
  assert.ok(first.fillColor.r > first.fillColor.b, "first glyph red-ish");
  assert.ok(lastG.fillColor.b > lastG.fillColor.r, "last glyph blue-ish");
});

test("RasterText still carries _isText and a box", () => {
  const r = new RasterText("hi");
  assert.equal(r._isText, true);
  assert.equal(r.points.length, 4);
  assert.equal(typeof r.currentFontHeight(), "number");
});
