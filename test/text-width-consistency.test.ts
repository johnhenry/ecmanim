import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "../src/mobject/text/Text.ts";
import { getDefaultFont } from "../src/mobject/vectorized_text.ts";
import { loadVectorFont, resolveFontPath } from "../src/node.ts";

// Issue #14: before a vector font has loaded in the process, Text/getWidth()
// silently uses the raster/CHAR_ASPECT estimate; after loading (which
// render() does internally before running a scene's construct()), it
// switches to real glyph-metric measurement -- a different value for the
// same string/fontSize. There was no public way to force the same path
// render() uses ahead of a render() call, so "measure your own width before
// rendering" layout code could pass its own check yet still render clipped.
// This file (like every other test file here) runs in its own process, so
// it starts with no font loaded -- see the isolation check this relies on.

test("no font loaded yet: Text falls back to the raster/estimate path", () => {
  assert.equal(getDefaultFont(), null, "expected a fresh process with no font pre-loaded");
  const t = new Text("Hello, ecmanim!", { fontSize: 0.5 });
  assert.equal((t as any)._isText, true, "should build via the raster fallback, not real glyphs");
});

test("loadVectorFont/resolveFontPath are exported from ecmanim/node, not just the internal renderer module", () => {
  assert.equal(typeof loadVectorFont, "function");
  assert.equal(typeof resolveFontPath, "function");
});

test("loadVectorFont() flips subsequently-constructed Text into the same glyph path render() uses", async () => {
  const path = resolveFontPath();
  if (!path) return; // no system font in this environment; nothing to force-load

  await loadVectorFont();
  assert.ok(getDefaultFont(), "loadVectorFont() should register the process-wide default font");

  const t = new Text("Hello, ecmanim!", { fontSize: 0.5 });
  assert.notEqual((t as any)._isText, true, "should now build real glyph outlines, matching render()'s path");
  assert.ok(t.chars.submobjects.length > 0);
});
