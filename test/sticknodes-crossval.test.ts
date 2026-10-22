// Cross-validation of parseStickNodes() against the MIT reference
// implementation sticknodes-rs. The .nodes files and the .json dumps in
// test/fixtures/sticknodes/ were produced by test/fixtures/sticknodes/generator
// (sticknodes-rs writes the file, then reads it back and dumps what IT decoded).
// Our parser must decode every field the same way. See that folder's README.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parseStickNodes } from "../src/loaders/sticknodes_loader.ts";
import type { StickNode, StickNodesColor } from "../src/loaders/sticknodes_loader.ts";

const DIR = new URL("./fixtures/sticknodes/", import.meta.url);
const names = readdirSync(DIR).filter((f) => f.endsWith(".nodes")).map((f) => f.slice(0, -6)).sort();

const TYPE: Record<string, StickNode["type"]> = {
  RootNode: "root", RoundedSegment: "roundedSegment", Segment: "segment", Circle: "circle",
  Triangle: "triangle", FilledCircle: "filledCircle", Ellipse: "ellipse", Trapezoid: "trapezoid", Polygon: "polygon",
};
const EPS = 1e-3;
const near = (a: number, b: number, what: string) =>
  assert.ok(Math.abs(a - b) <= EPS * Math.max(1, Math.abs(b)), `${what}: ours ${a} vs sticknodes-rs ${b}`);
const color = (a: StickNodesColor, b: { red: number; green: number; blue: number; alpha: number }, what: string) =>
  assert.deepEqual(a, { r: b.red, g: b.green, b: b.blue, a: b.alpha }, what);

/* eslint-disable @typescript-eslint/no-explicit-any */
function flatten(nodes: any[], out: Map<number, any> = new Map()) {
  for (const n of nodes) { out.set(n.draw_order_index, n); flatten(n.children, out); }
  return out;
}

test("fixture set is present", () => {
  assert.ok(names.length >= 12, `expected >= 12 fixtures, found ${names.length}`);
});

for (const name of names) {
  test(`parseStickNodes matches sticknodes-rs field-by-field: ${name}`, () => {
    const ref = JSON.parse(readFileSync(new URL(`${name}.json`, DIR), "utf8"));
    const ours = parseStickNodes(new Uint8Array(readFileSync(new URL(`${name}.nodes`, DIR))));
    assert.deepEqual(ours.warnings, []);
    assert.equal(ours.compressed, false);
    assert.equal(ours.version, ref.version);
    assert.equal(ours.build, ref.build);
    near(ours.scale, ref.scale, "scale");
    color(ours.color, ref.color, "figure color");

    const refNodes = flatten(ref.nodes);
    assert.equal(ours.nodes.length, refNodes.size, "node count");
    assert.equal(ours.nodes[0].type, "root");
    assert.equal(ours.nodes[0].parent, null);

    for (const n of ours.nodes) {
      const r = refNodes.get(n.drawIndex);
      assert.ok(r, `node ${n.drawIndex} missing from sticknodes-rs`);
      const at = (f: string) => `node ${n.drawIndex} ${f}`;
      // topology, via the geometry table (parent draw index)
      assert.equal(n.parent, ref.geometry[n.drawIndex].parent, at("parent"));
      if (n.parent === null) continue; // sticknodes-rs discards the file's root node data on read
      assert.equal(n.type, TYPE[r.node_type], at("type"));
      for (const [a, b] of [
        ["isStatic", "is_static"], ["isStretchy", "is_stretchy"], ["isFloaty", "is_floaty"],
        ["isSmartStretch", "is_smart_stretch"], ["doNotApplySmartStretch", "do_not_apply_smart_stretch"],
        ["smartStretchResetImpulse", "smart_stretch_reset_impulse"], ["useSegmentColor", "use_segment_color"],
        ["useCircleOutline", "use_circle_outline"], ["circleIsHollow", "circle_is_hollow"],
        ["useGradient", "use_gradient"], ["reverseGradient", "reverse_gradient"],
        ["useSegmentScale", "use_segment_scale"], ["curveCirculization", "curve_circulization"],
        ["halfArc", "half_arc"], ["triangleUpsideDown", "triangle_upside_down"],
        ["trapezoidRoundedStart", "trapezoid_is_rounded_start"], ["trapezoidRoundedEnd", "trapezoid_is_rounded_end"],
        ["dragLocked", "is_drag_locked"],
      ] as const) assert.equal((n as any)[a], r[b], at(a));
      assert.equal(n.gradientMode, r.gradient_mode === "Sideways" ? "sideways" : "normal", at("gradientMode"));
      assert.equal(n.angleLock, r.angle_lock_mode === "Absolute" ? "absolute" : r.angle_lock_mode === "Relative" ? "relative" : "none", at("angleLock"));
      // right-triangle direction: 0 isosceles, 1 right, -1 right + flipped
      const dir = r.triangle_type === "Isosceles" ? 0 : r.triangle_flipped ? -1 : 1;
      assert.equal(Math.sign(n.rightTriangleDirection), dir, at("rightTriangleDirection"));
      for (const [a, b] of [
        ["scale", "scale"], ["defaultLength", "default_length"], ["length", "length"],
        ["defaultThickness", "default_thickness"], ["thickness", "thickness"], ["curveRadius", "segment_curve_radius_and_default_curve_radius"],
        ["curvePolyfillPrecision", "segment_curve_polyfill_precision"],
        ["trapezoidThicknessStart", "trapezoid_thickness_start"], ["trapezoidThicknessEnd", "trapezoid_thickness_end"],
        ["polygonVertices", "num_polygon_vertices"],
        ["defaultLocalAngle", "default_local_angle"], ["localAngle", "local_angle"], ["defaultAngle", "default_angle"],
        ["dragLockAngle", "drag_lock_angle"], ["smartStretchMultiplier", "smart_stretch_multiplier"],
      ] as const) near((n as any)[a], r[b], at(a));
      color(n.color, r.color, at("color"));
      color(n.gradientColor, r.gradient_color, at("gradientColor"));
      color(n.outlineColor, r.circle_outline_color, at("outlineColor"));
      // derived geometry: file localX/localY == length*(cos,sin)(global angle), y-up
      near(n.localX, ref.geometry[n.drawIndex].localX, at("localX"));
      near(n.localY, ref.geometry[n.drawIndex].localY, at("localY"));
      // connector
      const rc = r.connector_data;
      if (!rc) { assert.equal(n.connector, null, at("connector")); continue; }
      assert.ok(n.connector, at("connector present"));
      const c = n.connector!;
      near(c.localX, rc.local_x, at("connector.localX")); near(c.localY, rc.local_y, at("connector.localY"));
      near(c.percent, rc.percent, at("connector.percent")); near(c.percentDefault, rc.percent_default, at("connector.percentDefault"));
      near(c.value, rc.value, at("connector.value"));
      near(c.smartStretchAncestralValue, rc.smart_stretch_ancestral_value, at("connector.smartStretchAncestralValue"));
      assert.equal(c.method, rc.method === "ByValue" ? "byValue" : "byPercent", at("connector.method"));
      assert.equal(c.reversed, rc.reversed, at("connector.reversed"));
      assert.equal(c.endDrawIndex, rc.end_node_draw_index, at("connector.end"));
    }

    // polyfills
    assert.equal(ours.polyfills.length, ref.polyfills.length, "polyfill count");
    ref.polyfills.forEach((p: any, i: number) => {
      const o = ours.polyfills[i];
      assert.equal(o.anchorDrawIndex, p.anchor_node_draw_index, `polyfill ${i} anchor`);
      color(o.color, p.color, `polyfill ${i} color`);
      assert.equal(o.usePolyfillColor, p.use_polyfill_color, `polyfill ${i} usePolyfillColor`);
      assert.deepEqual(o.attachedDrawIndices, p.attached_node_draw_indices, `polyfill ${i} attached`);
    });
  });
}

test("fixtures cover the interesting surface (guards against a vacuous comparison)", () => {
  const all = names.map((n) => JSON.parse(readFileSync(new URL(`${n}.json`, DIR), "utf8")));
  const nodes = all.flatMap((r) => [...flatten(r.nodes).values()]);
  const types = new Set(nodes.map((n) => n.node_type));
  for (const t of ["RoundedSegment", "Segment", "Circle", "Triangle", "FilledCircle", "Ellipse", "Trapezoid", "Polygon"]) assert.ok(types.has(t), t);
  assert.ok(nodes.some((n) => n.connector_data), "connectors");
  assert.ok(all.some((r) => r.polyfills.length), "polyfills");
  assert.ok(nodes.some((n) => n.angle_lock_mode === "Absolute") && nodes.some((n) => n.angle_lock_mode === "Relative"));
  assert.ok(new Set(all.map((r) => `${r.version}/${r.build}`)).size >= 10, "version/build spread");
});
