// SVGMobject id preservation: drawable elements (and children of a <g id>)
// are addressable via byId()/ids, while defs-internal ids stay excluded.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SVGMobject } from "../src/mobject/svg_mobject.ts";

const FIXTURE = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <clipPath id="clipper"><circle cx="20" cy="60" r="12"/></clipPath>
    <linearGradient id="grad"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>
  </defs>
  <path id="lone-path" d="M10 10 L30 10 L30 30 Z" fill="#00ff00"/>
  <g id="pair">
    <rect x="40" y="10" width="15" height="15" fill="#ffaa00"/>
    <rect x="60" y="10" width="15" height="15" fill="#ffaa00"/>
  </g>
  <circle id="clipped" cx="20" cy="60" r="15" fill="#8800ff" clip-path="url(#clipper)"/>
  <rect x="50" y="50" width="20" height="20" fill="#123456"/>
</svg>`;

test("element ids and <g id> children are recorded; anonymous elements are not", () => {
  const svg = new SVGMobject(FIXTURE);
  assert.ok(svg.hasId("lone-path"));
  assert.equal(svg.ids.get("lone-path")!.length, 1);
  assert.ok(svg.hasId("pair"));
  assert.equal(svg.ids.get("pair")!.length, 2, "a <g id> groups BOTH child rects");
  // 5 drawables total; the anonymous rect is index-addressable only.
  assert.equal(svg.submobjects.length, 5);
});

test("an element's own id wins over an inherited <g id>", () => {
  const nested = new SVGMobject(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g id="outer">
        <rect id="inner" x="0" y="0" width="10" height="10"/>
        <rect x="20" y="0" width="10" height="10"/>
      </g>
    </svg>`);
  assert.equal(nested.ids.get("inner")!.length, 1);
  assert.equal(nested.ids.get("outer")!.length, 1, "only the un-id'd sibling inherits the group id");
});

test("defs-internal ids never appear (consumed for url(#) resolution only)", () => {
  const svg = new SVGMobject(FIXTURE);
  assert.equal(svg.hasId("clipper"), false);
  assert.equal(svg.hasId("grad"), false);
});

test("a clip-path'd element's id maps to the FINAL (clipped) mobject", () => {
  const svg = new SVGMobject(FIXTURE);
  assert.ok(svg.hasId("clipped"));
  const clipped = svg.ids.get("clipped")![0];
  // The clipped mob is one of the actual rendered submobjects, not a
  // discarded pre-clip instance.
  assert.ok(svg.submobjects.includes(clipped));
});

test("byId returns a live VGroup: style mutations apply to the rendered mobjects", () => {
  const svg = new SVGMobject(FIXTURE);
  svg.byId("pair").setColor("#ff00ff");
  for (const mob of svg.ids.get("pair")!) {
    assert.equal((mob.fillColor as any).toHex().toLowerCase(), "#ff00ff");
  }
  // And transforms move the real geometry.
  const before = svg.byId("lone-path").getCenter();
  svg.byId("lone-path").shift([1, 2, 0]);
  const after = svg.byId("lone-path").getCenter();
  assert.ok(Math.abs(after[0] - before[0] - 1) < 1e-9);
  assert.ok(Math.abs(after[1] - before[1] - 2) < 1e-9);
});

test("byId throws with the available-id list for an unknown id", () => {
  const svg = new SVGMobject(FIXTURE);
  assert.throws(() => svg.byId("nope"), /Available ids: .*lone-path/);
});
