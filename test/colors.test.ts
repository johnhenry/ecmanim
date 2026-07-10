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

// -- CSS functional notation (campaign 4, M1.5: hsl()/rgb() used to fall
// -- through fromHex and come out black — mermaid themes use hsl heavily) ----

test("Color.parse: hsl() resolves to the CSS-correct rgb", () => {
  assert.equal(Color.parse("hsl(120, 100%, 25%)").toHex(), "#008000");
  assert.equal(Color.parse("hsl(0, 100%, 50%)").toHex(), "#ff0000");
  assert.equal(Color.parse("hsl(240, 100%, 50%)").toHex(), "#0000ff");
  // Space-separated + negative/wrapped hue forms.
  assert.equal(Color.parse("hsl(480 100% 25%)").toHex(), "#008000");
  assert.equal(Color.parse("hsl(-240, 100%, 25%)").toHex(), "#008000");
});

test("Color.parse: rgb()/rgba() with 0-255 and % channels", () => {
  assert.equal(Color.parse("rgb(255, 0, 0)").toHex(), "#ff0000");
  assert.equal(Color.parse("rgb(100%, 0%, 50%)").toHex(), "#ff0080");
  const c = Color.parse("rgba(0, 128, 255, 0.25)");
  assert.equal(c.toHex(), "#0080ff");
  assert.ok(near(c.a, 0.25), `alpha carried (${c.a})`);
});

test("Color.parse: hsla alpha carried (number and percent)", () => {
  const c = Color.parse("hsla(120, 100%, 25%, 0.5)");
  assert.equal(c.toHex(), "#008000");
  assert.ok(near(c.a, 0.5), `alpha ${c.a} = 0.5`);
  assert.ok(near(Color.parse("hsl(120 100% 25% / 40%)").a, 0.4), "slash-percent alpha");
  assert.equal(Color.parse("hsl(120, 100%, 25%)").a, 1, "no alpha -> opaque");
});
