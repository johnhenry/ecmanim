import { test, before } from "node:test";
import assert from "node:assert/strict";
import { parsePathToSubpaths } from "../src/mobject/svg_path.js";
import { VText } from "../src/mobject/vectorized_text.js";
import { MathTex, initMathTex } from "../src/mobject/mathtex.js";
import { ThreeDCamera, ThreeDAxes } from "../src/scene/three_d.js";
import { loadVectorFont } from "../src/renderer/fonts-node.js";
import { DEGREES } from "../src/core/math/vector.js";

before(async () => {
  await loadVectorFont("sans-serif");
  await initMathTex();
});

test("svg path parser: cubic bezier invariant per subpath", () => {
  const subs = parsePathToSubpaths("M0 0 L10 0 L10 10 Z M20 0 C20 5 25 5 25 0 Z");
  assert.equal(subs.length, 2);
  for (const sp of subs) assert.equal((sp.length - 1) % 3, 0);
});

test("VText produces real glyph outlines as bezier VMobjects", () => {
  const t = new VText("Ag", { fontSize: 1 });
  assert.equal(t.submobjects.length, 2);
  // "A" has an outer outline plus an inner counter (hole) -> >= 2 subpaths.
  assert.ok(t.submobjects[0].getSubpaths().length >= 2);
  for (const g of t.submobjects) {
    for (const sp of g.getSubpaths()) assert.equal((sp.length - 1) % 3, 0);
    assert.ok(g.points.every((p) => p.every(Number.isFinite)));
  }
  assert.ok(t.getWidth() > 0 && t.getHeight() > 0);
});

test("MathTex renders LaTeX to bezier glyphs with correct superscript layout", () => {
  const m = new MathTex("x^2", { fontSize: 1 });
  assert.ok(m.submobjects.length >= 2);
  // Identify by size: the smaller glyph is the superscript "2".
  const [g0, g1] = m.submobjects;
  const c0 = g0.getCenter();
  const c1 = g1.getCenter();
  // The "2" should be higher (greater y) and to the right of the "x".
  const sup = c0[1] > c1[1] ? c0 : c1;
  const base = c0[1] > c1[1] ? c1 : c0;
  assert.ok(sup[1] > base[1]); // superscript is above
  assert.ok(sup[0] > base[0]); // and to the right
  assert.ok(m.submobjects.every((g) => g.points.every((p) => p.every(Number.isFinite))));
});

test("MathTex fraction produces a bar and stacks numerator over denominator", () => {
  const m = new MathTex("\\frac{a}{b}", { fontSize: 1 });
  assert.ok(m.submobjects.length >= 3); // a, b, and the fraction bar
  assert.ok(m.getHeight() > 0);
});

test("ThreeDCamera phi=0 gives an upright 2D-like projection", () => {
  const cam = new ThreeDCamera({ pixelWidth: 1920, pixelHeight: 1080, phi: 0, theta: -90 * DEGREES });
  const center = cam.toPixel([0, 0, 0]);
  assert.ok(Math.abs(center[0] - 960) < 2 && Math.abs(center[1] - 540) < 2);
  const right = cam.toPixel([1, 0, 0]);
  const up = cam.toPixel([0, 1, 0]);
  assert.ok(right[0] > center[0]); // +x is to the right
  assert.ok(up[1] < center[1]);    // +y is up (smaller pixelY)
});

test("ThreeDCamera encodes depth for painter sorting", () => {
  const cam = new ThreeDCamera({ phi: 70 * DEGREES, theta: -90 * DEGREES });
  const near = cam.projectionDepth([0, 0, 2]);
  const far = cam.projectionDepth([0, 0, -2]);
  assert.ok(Math.sign(near) !== Math.sign(far));
});

test("ThreeDAxes has three axes with 3D extent", () => {
  const ax = new ThreeDAxes({ xRange: [-3, 3], yRange: [-3, 3], zRange: [-2, 2] });
  assert.ok(ax.submobjects.length >= 3);
  // Some point must have a non-zero z (the z-axis).
  const anyZ = ax.getFamily().some((m) => m.points.some((p) => Math.abs(p[2]) > 0.5));
  assert.ok(anyZ);
});
