import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STYLE_PRESETS, ASPECT_RATIO_PRESETS, resolveStyle, resolveAspectRatio,
} from "../src/core/presets.ts";

test("STYLE_PRESETS includes 3b1b-dark with a palette + dark background", () => {
  const s = STYLE_PRESETS["3b1b-dark"];
  assert.ok(s);
  assert.equal(s.name, "3b1b-dark");
  assert.ok(Array.isArray(s.palette) && s.palette.length >= 3);
  assert.match(s.background, /^#[0-9a-fA-F]{6}$/);
  assert.ok(Object.keys(STYLE_PRESETS).length >= 7);
});

test("resolveStyle is case-insensitive and undefined for unknown", () => {
  assert.equal(resolveStyle("3b1b-dark")?.name, "3b1b-dark");
  assert.equal(resolveStyle("BOLD-NEON")?.name, "bold-neon");
  assert.equal(resolveStyle("nope"), undefined);
  assert.equal(resolveStyle(undefined), undefined);
});

test("aspect-ratio presets give default dims", () => {
  assert.deepEqual(resolveAspectRatio("16:9"), { pixelWidth: 1920, pixelHeight: 1080 });
  assert.deepEqual(resolveAspectRatio("9:16"), { pixelWidth: 1080, pixelHeight: 1920 });
  assert.deepEqual(resolveAspectRatio("1:1"), { pixelWidth: 1080, pixelHeight: 1080 });
  assert.ok(ASPECT_RATIO_PRESETS["21:9"]);
});

test("aspect-ratio derives width from a target height (even)", () => {
  const d = resolveAspectRatio("16:9", 720);
  assert.deepEqual(d, { pixelWidth: 1280, pixelHeight: 720 });
  const v = resolveAspectRatio("9:16", 1280);
  assert.equal(v!.pixelHeight, 1280);
  assert.equal(v!.pixelWidth % 2, 0);
});

test("arbitrary W:H ratio is accepted; junk returns undefined", () => {
  const d = resolveAspectRatio("2:1", 1080);
  assert.deepEqual(d, { pixelWidth: 2160, pixelHeight: 1080 });
  assert.equal(resolveAspectRatio("banana"), undefined);
  assert.equal(resolveAspectRatio(undefined), undefined);
});
