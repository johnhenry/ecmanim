import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "../src/mobject/text/Text.ts";
import { getDefaultFont } from "../src/mobject/vectorized_text.ts";
import { loadVectorFont, resolveFontPath } from "../src/node.ts";

// Issue #14: before a vector font has loaded in the process, Text/getWidth()
// silently used the raster/CHAR_ASPECT estimate; after loading (which
// render() does internally before running a scene's construct()), it
// switches to real glyph-metric measurement -- a different value for the
// same string/fontSize. Issue #16 closes that gap in Node: getDefaultFont()
// now lazily auto-resolves a system font on first use, so a fresh process
// measures with the same glyph metrics render() will use. The raster
// fallback remains only for environments with no system font at all.
// This file (like every other test file here) runs in its own process.
//
// NOTE: never `assert.equal(<font>, null)` here -- a parsed opentype.js Font
// has thousands of glyphs, and node:assert's failure-diff generation on an
// object that size allocates unboundedly (it OOM'd the machine repeatedly
// before this test was updated for the issue-#16 behaviour). Compare with a
// boolean (`assert.ok(x == null)`) so a failure never serializes the font.

test("fresh process: getDefaultFont() lazily auto-loads a system font (issue #16)", () => {
  const path = resolveFontPath();
  if (!path) {
    // No system font in this environment: auto-load can't resolve one, and
    // Text must keep the raster/estimate fallback of the pre-#16 behaviour.
    assert.ok(getDefaultFont() == null, "no system font, so nothing should auto-load");
    const t = new Text("Hello, ecmanim!", { fontSize: 0.5 });
    assert.equal((t as any)._isText, true, "should build via the raster fallback, not real glyphs");
    return;
  }
  assert.ok(getDefaultFont() != null, "first getDefaultFont() call should auto-load a system font");
  const t = new Text("Hello, ecmanim!", { fontSize: 0.5 });
  assert.notEqual((t as any)._isText, true, "auto-loaded font should give Text the same glyph path render() uses");
  assert.ok(t.chars.submobjects.length > 0);
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
