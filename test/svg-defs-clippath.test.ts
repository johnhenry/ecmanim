import { test } from "node:test";
import assert from "node:assert/strict";
import { SVGMobject } from "../src/mobject/svg_mobject.ts";

// Confirmed bug: SVGMobject's walk() didn't exclude <defs>/<clipPath>/
// <linearGradient> subtrees from rendering, so shapes nested inside them
// (definition-only, referenced by id elsewhere) were incorrectly drawn as
// ordinary visible content. Also adds <linearGradient> fill resolution and
// rect/circle <clipPath> support (radialGradient and non-rect/circle clips
// remain explicitly out of scope).

test("an unreferenced <defs> block produces zero visible submobjects", () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <defs>
        <rect x="0" y="0" width="50" height="50" fill="red"/>
      </defs>
      <circle cx="50" cy="50" r="10" fill="blue"/>
    </svg>
  `;
  const mob = new SVGMobject(svg);
  // Only the circle should have produced a submobject -- the defs-nested
  // rect must not have been rendered as visible content.
  assert.equal(mob.submobjects.length, 1);
});

test("a rect clipped by a <clipPath> containing a circle is contained within that circle", () => {
  // SVGMobject auto-scales its whole result to a fixed default world height,
  // so absolute pixel comparisons aren't meaningful (a 100x100 unclipped
  // rect and a 40x40 clipped one both get normalized to the same height).
  // Use a non-square outer rect (100x50, aspect 2:1) with a centered,
  // circular (aspect 1:1) clip -- the *aspect ratio* of the resulting
  // bounding box is scale-invariant and directly shows whether clipping
  // narrowed the shape down to the circle's own footprint.
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">
      <defs>
        <clipPath id="c"><circle cx="50" cy="25" r="20"/></clipPath>
      </defs>
      <rect x="0" y="0" width="100" height="50" fill="green" clip-path="url(#c)"/>
    </svg>
  `;
  const clipped = new SVGMobject(svg);
  assert.equal(clipped.submobjects.length, 1);
  const box = clipped.submobjects[0].getBoundingBox();
  const aspect = (box.max[0] - box.min[0]) / (box.max[1] - box.min[1]);
  // The clip circle's own bounding box is a 40x40 square (aspect 1:1); the
  // unclipped rect's aspect would have been 2:1. A little slack accounts for
  // the circle's polygon approximation.
  assert.ok(Math.abs(aspect - 1) < 0.15, `clipped shape's aspect ratio (${aspect}) should be ~1:1 (the clip circle's), not 2:1 (the unclipped rect's)`);
});

test("a rect with no clip-path is unaffected (regression guard)", () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <rect x="0" y="0" width="30" height="20" fill="green"/>
    </svg>
  `;
  // SVGMobject auto-scales the whole group to a default world height (see
  // its constructor's setWidth/setHeight sizing step), so raw SVG units
  // aren't preserved 1:1 -- check the aspect ratio instead of absolute size.
  const mob = new SVGMobject(svg);
  assert.equal(mob.submobjects.length, 1);
  const box = mob.submobjects[0].getBoundingBox();
  const w = box.max[0] - box.min[0];
  const h = box.max[1] - box.min[1];
  assert.ok(Math.abs(w / h - 30 / 20) < 1e-6, `aspect ratio should stay 30:20 (got ${w}x${h})`);
});

test("a 2-stop <linearGradient> fill produces gradientColors in stop order", () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#ff0000"/>
          <stop offset="1" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="50" height="50" fill="url(#g)"/>
    </svg>
  `;
  const mob = new SVGMobject(svg);
  assert.equal(mob.submobjects.length, 1);
  const rect = mob.submobjects[0] as any;
  assert.ok(rect.gradientColors, "gradient-filled shape should carry gradientColors");
  assert.equal(rect.gradientColors.length, 2);
  assert.equal(rect.gradientColors[0].toHex().toUpperCase(), "#FF0000");
  assert.equal(rect.gradientColors[1].toHex().toUpperCase(), "#0000FF");
});

test("a plain solid fill (no url(...)) never sets gradientColors (regression guard)", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="10" fill="#00ff00"/></svg>`;
  const mob = new SVGMobject(svg);
  const rect = mob.submobjects[0] as any;
  assert.equal(rect.gradientColors, undefined);
  assert.equal(rect.fillColor.toHex().toUpperCase(), "#00FF00");
});

test("a gradient fill survives being clipped (confirmed bug: boolean ops' copyStyle dropped gradientColors)", () => {
  // Combining the previous two features on the SAME element -- untested
  // until now, and confirmed broken: applyClipPath() wraps the gradient-
  // filled shape in an Intersection (src/mobject/boolean_ops.ts), whose
  // copyStyle() helper only copied fillColor/fillOpacity/strokeColor/
  // strokeWidth/strokeOpacity, silently dropping gradientColors and
  // sheenDirection -- so a clipped, gradient-filled shape rendered as a
  // flat fillColor (the gradient's own first stop, since that's what
  // resolveGradientFill() sets as a solid-fill fallback) instead of an
  // actual gradient. Found via a real end-to-end scene render, not a unit
  // test, since existing gradient/clipPath tests each cover their feature
  // in isolation.
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ff0000"/>
          <stop offset="1" stop-color="#0000ff"/>
        </linearGradient>
        <clipPath id="c"><circle cx="50" cy="50" r="40"/></clipPath>
      </defs>
      <rect x="0" y="0" width="100" height="100" fill="url(#g)" clip-path="url(#c)"/>
    </svg>
  `;
  const mob = new SVGMobject(svg);
  assert.equal(mob.submobjects.length, 1);
  const clipped = mob.submobjects[0] as any;
  assert.ok(clipped.gradientColors, "gradient should survive the clip operation");
  assert.equal(clipped.gradientColors.length, 2);
  assert.equal(clipped.gradientColors[0].toHex().toUpperCase(), "#FF0000");
  assert.equal(clipped.gradientColors[1].toHex().toUpperCase(), "#0000FF");
});

test("a config-level fillColor override still wins over an SVG-authored gradient", () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#ff0000"/>
          <stop offset="1" stop-color="#0000ff"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="50" height="50" fill="url(#g)"/>
    </svg>
  `;
  const mob = new SVGMobject(svg, { fillColor: "#ffff00" });
  const rect = mob.submobjects[0] as any;
  assert.equal(rect.gradientColors, undefined, "an explicit override should suppress the SVG gradient entirely");
  assert.equal(rect.fillColor.toHex().toUpperCase(), "#FFFF00");
});
