import { test } from "node:test";
import assert from "node:assert/strict";
import { registry } from "../src/plugins/registry.ts";
import {
  Color,
  WHITE,
  BLACK,
  RED,
  BLUE,
  colorGradient,
  invertColor,
  averageColor,
  hexToRgb,
  rgbToHex,
} from "../src/core/color.ts";

// Importing color.ts pulls in colors_data.ts, which registers all palettes.

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

test("core palette name resolves via registry (PURPLE_A)", () => {
  const c = Color.parse("PURPLE_A");
  assert.equal(registry.colors.has("PURPLE_A"), true);
  assert.match(c.toHex(), /^#[0-9a-f]{6}$/);
  // PURPLE_A in manim is #CAA3E8
  assert.equal(c.toHex().toLowerCase(), "#caa3e8");
});

test("namespaced XKCD color resolves via prefixed key", () => {
  assert.equal(registry.colors.has("XKCD_AVOCADO"), true);
  const c = Color.parse("XKCD_AVOCADO");
  assert.match(c.toHex(), /^#[0-9a-f]{6}$/);
});

test("namespaced X11 color resolves via prefixed key", () => {
  assert.equal(registry.colors.has("X11_ALICEBLUE"), true);
  const c = Color.parse("X11_ALICEBLUE");
  assert.equal(c.toHex().toLowerCase(), "#f0f8ff");
});

test("colorGradient produces N colors with correct endpoints", () => {
  const grad = colorGradient([RED, BLUE], 5);
  assert.equal(grad.length, 5);
  assert.equal(grad[0].toHex().toLowerCase(), Color.parse(RED).toHex().toLowerCase());
  assert.equal(grad[4].toHex().toLowerCase(), Color.parse(BLUE).toHex().toLowerCase());
});

test("invertColor(WHITE) ~ BLACK", () => {
  const inv = invertColor(WHITE);
  const black = Color.parse(BLACK);
  assert.ok(near(inv.r, black.r) && near(inv.g, black.g) && near(inv.b, black.b));
});

test("averageColor(RED, BLUE) lies between them", () => {
  const red = Color.parse(RED);
  const blue = Color.parse(BLUE);
  const avg = averageColor(RED, BLUE);
  const between = (x: number, a: number, b: number) => x >= Math.min(a, b) - 1e-9 && x <= Math.max(a, b) + 1e-9;
  assert.ok(between(avg.r, red.r, blue.r));
  assert.ok(between(avg.g, red.g, blue.g));
  assert.ok(between(avg.b, red.b, blue.b));
});

test("lighter/darker change brightness", () => {
  const base = Color.parse(RED);
  const baseLum = base.r + base.g + base.b;
  const lighter = base.lighter(0.3);
  const darker = base.darker(0.3);
  assert.ok(lighter.r + lighter.g + lighter.b > baseLum);
  assert.ok(darker.r + darker.g + darker.b < baseLum);
});

test("toHsv/fromHsv round-trip", () => {
  const c = Color.parse(RED);
  const [h, s, v] = c.toHsv();
  const back = Color.fromHsv(h, s, v);
  assert.ok(near(back.r, c.r, 1e-6) && near(back.g, c.g, 1e-6) && near(back.b, c.b, 1e-6));
});

test("hexToRgb/rgbToHex round-trip", () => {
  const hex = "#58c4dd";
  const rgb = hexToRgb(hex);
  assert.equal(rgbToHex(rgb).toLowerCase(), hex);
});

test("registry has hundreds of registered colors", () => {
  const n = registry.list("color").length;
  assert.ok(n > 500, `expected >500 colors, got ${n}`);
});
