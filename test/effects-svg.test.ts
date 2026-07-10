// SVGRenderer effects tests: native <filter> defs mirroring the canvas
// pipeline's semantics (string assertions in the established svg-renderer
// test style).

import { test } from "node:test";
import assert from "node:assert/strict";

import { SVGRenderer } from "../src/renderer/SVGRenderer.ts";
import { Camera } from "../src/renderer/CanvasRenderer.ts";
import { Circle, Square } from "../src/mobject/geometry.ts";

function makeRenderer(frameEffects?: any[]) {
  return new SVGRenderer(new Camera({ pixelWidth: 216, pixelHeight: 216, frameHeight: 8, frameEffects }));
}

test("a blurred mobject emits a <filter> def with feGaussianBlur and a filtered <g>", () => {
  const svg = makeRenderer().renderToString([new Circle({ radius: 1 }).blur(10)]);
  assert.match(svg, /<filter id="fx0"[^>]*color-interpolation-filters="sRGB"/);
  // radius 10 at strokeScale 216/1080 = 0.2 -> stdDeviation 2.
  assert.match(svg, /<feGaussianBlur stdDeviation="2"\/>/);
  assert.match(svg, /<g filter="url\(#fx0\)">/);
});

test("dropShadow emits feDropShadow with scaled offsets", () => {
  const svg = makeRenderer().renderToString([
    new Circle({ radius: 1 }).dropShadow({ blur: 10, offsetX: 5, offsetY: -5, color: "#112233" }),
  ]);
  assert.match(svg, /<feDropShadow dx="1" dy="-1" stdDeviation="2" flood-color="#112233"/);
});

test("glow(strength 3) chains three feDropShadow primitives in one filter", () => {
  const svg = makeRenderer().renderToString([new Circle({ radius: 1 }).glow(10, "#00ff00", 3)]);
  const matches = svg.match(/<feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#00ff00"/g);
  assert.equal(matches?.length, 3);
});

test("colorAdjust maps to feColorMatrix + feComponentTransfer", () => {
  const svg = makeRenderer().renderToString([
    new Circle({ radius: 1 }).colorAdjust({ saturate: 0.5, hueRotate: 90, brightness: 1.2, contrast: 0.8 }),
  ]);
  assert.match(svg, /<feColorMatrix type="saturate" values="0.5"\/>/);
  assert.match(svg, /<feColorMatrix type="hueRotate" values="90"\/>/);
  assert.match(svg, /<feComponentTransfer><feFuncR type="linear" slope="0.96" intercept="0.1"\/>/);
});

test("two effected mobjects get distinct filter ids", () => {
  const svg = makeRenderer().renderToString([
    new Circle({ radius: 1 }).blur(4),
    new Square({ sideLength: 1 }).blur(8),
  ]);
  assert.match(svg, /<filter id="fx0"/);
  assert.match(svg, /<filter id="fx1"/);
  assert.match(svg, /url\(#fx0\)/);
  assert.match(svg, /url\(#fx1\)/);
});

test("filter defs reset across renderToString calls", () => {
  const r = makeRenderer();
  r.renderToString([new Circle({ radius: 1 }).blur(4)]);
  const second = r.renderToString([new Circle({ radius: 1 }).blur(4)]);
  // Second render starts back at fx0 and contains exactly one filter def.
  assert.equal((second.match(/<filter /g) ?? []).length, 1);
  assert.match(second, /<filter id="fx0"/);
});

test("a no-effects render contains no <filter (regression guard)", () => {
  const svg = makeRenderer().renderToString([new Circle({ radius: 1 })]);
  assert.equal(svg.includes("<filter"), false);
});

test("camera frameEffects wrap the whole body and vignette adds a radial-gradient rect", () => {
  const svg = makeRenderer([
    { type: "colorAdjust", saturate: 0 },
    { type: "vignette", strength: 0.8, color: "#000000" },
  ]).renderToString([new Circle({ radius: 1 })]);
  assert.match(svg, /<g filter="url\(#fx0\)"><path/); // grading <g> wraps the body content
  assert.match(svg, /<radialGradient id="fxvig1"/);
  assert.match(svg, /stop-opacity="0.8"/);
  assert.match(svg, /fill="url\(#fxvig1\)"/);
});
