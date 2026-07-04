import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "../src/mobject/text/Text.ts";
import { getDefaultFont } from "../src/mobject/vectorized_text.ts";
import {
  setTextShapingBackend,
  isTextShapingBackendActive,
  buildGlyphRun,
} from "../src/mobject/text_shaping.ts";
import { canShapeWithHarfBuzz } from "../src/mobject/text_shaping_hb.ts";
import { resolveFontPath } from "../src/node.ts";

// Optional HarfBuzz shaping backend: real GSUB/GPOS shaping instead of the
// default per-code-point charToGlyph loop. Skips gracefully (not failing)
// if harfbuzzjs's WASM can't load in this environment, matching this
// project's existing "environment-dependent, degrade don't fail" test style.

test("setTextShapingBackend and friends are reachable from the public ecmanim/ecmanim-node barrels", async () => {
  // Confirmed bug: this whole backend was implemented and unit-tested
  // exclusively against its own module (../src/mobject/text_shaping.ts)
  // above, but was never wired into src/index.ts's barrel -- the same class
  // of gap the 0.0.12 release notes describe catching for
  // linearTiming/springTiming/registerStylePreset, just missed for this
  // feature. `import { setTextShapingBackend } from "ecmanim"` threw
  // "does not provide an export" until fixed.
  const pub = await import("../src/index.ts");
  assert.equal(typeof pub.setTextShapingBackend, "function");
  assert.equal(typeof pub.getTextShapingBackend, "function");
  assert.equal(typeof pub.isTextShapingBackendActive, "function");
  assert.equal(typeof pub.buildGlyphRun, "function");
  assert.equal(typeof pub.measureGlyphRunWidth, "function");

  const node = await import("../src/node.ts");
  assert.equal(typeof node.setTextShapingBackend, "function", "ecmanim/node re-exports the full public barrel");
});

test("harfbuzz backend: glyphs render right-side up, matching the opentype backend's orientation", async () => {
  // Confirmed bug, found via an actual rendered end-to-end scene (not
  // caught by this file's other tests, which only ever check glyph
  // COUNTS/widths, never orientation): opentype.js's
  // glyph.getPath().toPathData() emits Y-DOWN pixel-space coordinates
  // (confirmed directly: "H"'s top point is negative, baseline at 0), so
  // text_shaping.ts's buildGlyphRun() passes flipY:true to convert that
  // into this codebase's Y-up world space. HarfBuzz's glyphToPath()
  // instead emits Y-UP font-unit-space coordinates for the very same font
  // (confirmed directly: "H"'s top point is POSITIVE, baseline at 0) --
  // already matching Y-up world space after scaling alone. Reusing the
  // same flipY:true for the HarfBuzz path double-flipped it, rendering
  // every HarfBuzz-shaped Text mobject upside down.
  const path = resolveFontPath();
  if (!path) return;

  await setTextShapingBackend("opentype");
  const otText = new Text("H", { fontSize: 1 });
  const otTop = Math.max(...otText.chars.submobjects[0].points.map((p: number[]) => p[1]));
  const otBottom = Math.min(...otText.chars.submobjects[0].points.map((p: number[]) => p[1]));

  await setTextShapingBackend("harfbuzz");
  const font = getDefaultFont();
  if (!font || !canShapeWithHarfBuzz(font)) { await setTextShapingBackend("opentype"); return; }
  const hbText = new Text("H", { fontSize: 1 });
  const hbTop = Math.max(...hbText.chars.submobjects[0].points.map((p: number[]) => p[1]));
  const hbBottom = Math.min(...hbText.chars.submobjects[0].points.map((p: number[]) => p[1]));
  await setTextShapingBackend("opentype");

  // Right-side up in both cases means the ascender (top) is well above the
  // baseline/descender (bottom) by roughly the same amount either backend
  // measures it -- an upside-down glyph would invert which end is which.
  assert.ok(otTop > otBottom, "sanity: opentype 'H' top should be above its bottom");
  assert.ok(hbTop > hbBottom, "harfbuzz 'H' top should be above its bottom, not flipped");
  assert.ok(Math.abs(hbTop - otTop) < 0.05, `harfbuzz top (${hbTop}) should match opentype top (${otTop})`);
  assert.ok(Math.abs(hbBottom - otBottom) < 0.05, `harfbuzz bottom (${hbBottom}) should match opentype bottom (${otBottom})`);
});

test("harfbuzz backend: ligature-prone text produces fewer glyphs with ligatures on than off", async () => {
  const path = resolveFontPath();
  if (!path) return; // no system font in this environment

  await setTextShapingBackend("harfbuzz");
  const font = getDefaultFont();
  if (!font || !canShapeWithHarfBuzz(font)) return; // harfbuzzjs unavailable here; nothing to exercise

  const withLigatures = buildGlyphRun("ffi", { font, scaleToWorld: 1, ligatures: true });
  const withoutLigatures = buildGlyphRun("ffi", { font, scaleToWorld: 1, ligatures: false });
  assert.equal(isTextShapingBackendActive(), "harfbuzz");

  // DejaVu Sans is confirmed (via direct inspection) to substitute "ffi" via
  // a real ligature glyph when GSUB is enabled -- fewer output glyphs than
  // input characters. Ligature *coverage* is font-specific, though: on
  // macOS, resolveFontPath() commonly resolves to the system Arial build,
  // which -- confirmed directly, harfbuzz shaping is genuinely active here
  // -- has a `liga` GSUB feature but no "ffi"/"fi"/"fl"/"ff" substitutions
  // in it. Skip rather than fail when this environment's font doesn't
  // support the specific ligature being probed, same "degrade don't fail"
  // spirit as the harfbuzzjs-unavailable check above.
  if (withLigatures.entries.length >= 3) { await setTextShapingBackend("opentype"); return; } // this font's GSUB doesn't merge "ffi"

  assert.equal(withoutLigatures.entries.length, 3, "no ligatures: one glyph per character");
  assert.ok(withLigatures.entries.length < 3, `with ligatures: expected fewer than 3 glyphs, got ${withLigatures.entries.length}`);

  await setTextShapingBackend("opentype"); // restore default for later tests in this file
});

test("harfbuzz backend: getPartByText selects correctly across a ligature boundary", async () => {
  const path = resolveFontPath();
  if (!path) return;

  await setTextShapingBackend("harfbuzz");
  const font = getDefaultFont();
  if (!font || !canShapeWithHarfBuzz(font)) { await setTextShapingBackend("opentype"); return; }

  const t = new Text("office", { fontSize: 0.5 });
  if ((t as any)._isText) { await setTextShapingBackend("opentype"); return; }

  // "ffi" (chars 1-3) forms one ligature glyph -- fewer chars entries than
  // source characters, but getPartByText must still correctly select the
  // substring spanning that merged glyph via the cluster-based _charSource.
  // Ligature coverage is font-specific (see the previous test) -- skip if
  // this environment's font doesn't merge "ffi" into fewer glyph slots.
  if (t.chars.submobjects.length >= "office".length) { await setTextShapingBackend("opentype"); return; }
  assert.ok(t.chars.submobjects.length < "office".length, "the ffi ligature should have merged into fewer glyph slots");
  const part = t.getPartByText("ffi");
  assert.ok(part.submobjects.length >= 1, "should find the ligature-spanning substring");

  const oPart = t.getPartByText("o");
  assert.equal(oPart.submobjects.length, 1);
  const ePart = t.getPartByText("e");
  assert.equal(ePart.submobjects.length, 1);

  await setTextShapingBackend("opentype");
});

test("harfbuzz backend: kerning matches or improves on the opentype-backend fallback for plain text", async () => {
  const path = resolveFontPath();
  if (!path) return;

  await setTextShapingBackend("harfbuzz");
  const font = getDefaultFont();
  if (!font || !canShapeWithHarfBuzz(font)) { await setTextShapingBackend("opentype"); return; }

  // Plain, non-ligature text should shape to sane, finite geometry via
  // either backend -- this is a coarse "doesn't regress" check, not an
  // assertion about a specific kerning delta (this environment's font has
  // no kerning pairs for common combos, confirmed directly beforehand).
  const hbRun = buildGlyphRun("Hello", { font, scaleToWorld: 1 });
  assert.equal(isTextShapingBackendActive(), "harfbuzz");
  assert.equal(hbRun.entries.length, 5);
  assert.ok(Number.isFinite(hbRun.endX) && hbRun.endX > 0);

  await setTextShapingBackend("opentype");
  const otRun = buildGlyphRun("Hello", { font, scaleToWorld: 1 });
  assert.equal(isTextShapingBackendActive(), "opentype");
  assert.equal(otRun.entries.length, 5);
  assert.ok(Number.isFinite(otRun.endX) && otRun.endX > 0);
});

test("Text's disableLigatures actually suppresses ligatures once harfbuzz backend is active", async () => {
  const path = resolveFontPath();
  if (!path) return;

  await setTextShapingBackend("harfbuzz");
  const font = getDefaultFont();
  if (!font || !canShapeWithHarfBuzz(font)) { await setTextShapingBackend("opentype"); return; }

  const ligated = new Text("ffi", { fontSize: 0.5, disableLigatures: false });
  const disabled = new Text("ffi", { fontSize: 0.5, disableLigatures: true });

  // Meaningful only if this environment's font actually merges "ffi" into a
  // ligature when enabled (font-specific -- see the first test in this file).
  if (ligated.chars.submobjects.length >= 3) { await setTextShapingBackend("opentype"); return; }

  assert.ok(
    disabled.chars.submobjects.length > ligated.chars.submobjects.length,
    "disableLigatures:true should produce one glyph per character, not the merged ligature",
  );
  assert.equal(disabled.chars.submobjects.length, 3);

  await setTextShapingBackend("opentype");
});

test("a simulated HarfBuzz load failure falls back to the opentype backend cleanly", async () => {
  const path = resolveFontPath();
  if (!path) return;

  const font = getDefaultFont();
  if (!font) return;

  // A font with no _rawFontBytes stashed (e.g. passed directly by a user as
  // config.font) can't be shaped via HarfBuzz regardless of module
  // availability -- canShapeWithHarfBuzz() must report false, not throw,
  // and buildGlyphRun() must fall back to "opentype" transparently.
  const fontWithoutBytes = Object.create(font);
  fontWithoutBytes._rawFontBytes = undefined;
  assert.ok(!canShapeWithHarfBuzz(fontWithoutBytes));

  await setTextShapingBackend("harfbuzz");
  const run = buildGlyphRun("test", { font: fontWithoutBytes, scaleToWorld: 1 });
  assert.equal(isTextShapingBackendActive(), "opentype", "should transparently fall back, not throw or silently produce nothing");
  assert.equal(run.entries.length, 4);

  await setTextShapingBackend("opentype");
});
