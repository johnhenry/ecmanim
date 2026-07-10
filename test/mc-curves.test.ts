// MC6 (Motion Canvas parity campaign): curve nodes (CubicBezier/QuadBezier/
// Spline/Path/PolyLine), tangentAtProportion, FlexGroup padding,
// VideoMobject.seek, Mobject.findAll, and matchTex `{{...}}` group parsing.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  CubicBezier, QuadBezier, Spline, Path, PolyLine,
} from "../src/mobject/curves.ts";
import { Circle, Square, Line } from "../src/mobject/geometry.ts";
import { Text } from "../src/mobject/text/Text.ts";
import { VGroup } from "../src/mobject/VMobject.ts";
import { Group } from "../src/mobject/Mobject.ts";
import { FlexGroup } from "../src/mobject/flex_group.ts";
import { VideoMobject } from "../src/mobject/video_mobject.ts";
import type { VideoFrameProvider } from "../src/mobject/video_mobject.ts";
import { MathTex, initMathTex, matchTex, parseTexGroups } from "../src/mobject/mathtex.ts";
import { TransformMatchingTex } from "../src/animation/transform_matching.ts";

const close = (a: number, b: number, eps = 1e-6, msg?: string) =>
  assert.ok(Math.abs(a - b) < eps, msg ?? `${a} !~ ${b}`);

// --- curve nodes -----------------------------------------------------------

test("CubicBezier passes through endpoints and matches bezier midpoint", () => {
  const cb = new CubicBezier({
    p0: [-4, 0, 0], p1: [-2, 3, 0], p2: [2, -3, 0], p3: [4, 0, 0],
  });
  const start = cb.pointFromProportion(0);
  const end = cb.pointFromProportion(1);
  close(start[0], -4); close(start[1], 0);
  close(end[0], 4); close(end[1], 0);
  // B(0.5) = (p0 + 3p1 + 3p2 + p3)/8 — x: (-4 -6 +6 +4)/8 = 0
  const mid = cb.pointFromProportion(0.5);
  close(mid[0], 0, 1e-6, "cubic midpoint x");
});

test("QuadBezier matches the quadratic midpoint", () => {
  const qb = new QuadBezier({ p0: [-2, 0, 0], p1: [0, 4, 0], p2: [2, 0, 0] });
  // Q(0.5) = (p0 + 2p1 + p2)/4 = (0, 2)
  const mid = qb.pointFromProportion(0.5);
  close(mid[0], 0);
  close(mid[1], 2);
});

test("Spline interpolates all anchors; smoothness=0 degenerates to segments", () => {
  const anchors = [[-4, 0, 0], [0, 3, 0], [4, -1, 0]];
  const spline = new Spline({ points: anchors, smoothness: 1 });
  // Each anchor is on the curve (curve i ends exactly at anchor i+1).
  const p0 = spline.pointFromProportion(0);
  const p1 = spline.pointFromProportion(0.5);
  const p2 = spline.pointFromProportion(1);
  close(p0[0], -4); close(p1[0], 0); close(p1[1], 3); close(p2[0], 4);
  // smoothness 0 → handles collapse onto anchors → straight chords.
  const straight = new Spline({ points: anchors, smoothness: 0 });
  const q = straight.pointFromProportion(0.25); // halfway down the first chord
  close(q[0], -2, 1e-6, "straight chord x");
  close(q[1], 1.5, 1e-6, "straight chord y");
});

test("Spline explicit knot handles (relative, MC-style) override derived ones", () => {
  const spline = new Spline({
    points: [
      { position: [0, 0, 0], endHandle: [0, 2, 0] }, // launch straight up
      [4, 0, 0],
    ],
  });
  const early = spline.pointFromProportion(0.05);
  assert.ok(early[1] > 0.05, `explicit up-handle bends the start upward (y=${early[1]})`);
  assert.ok(Math.abs(early[0]) < 0.5, "barely moved in x yet");
});

test("closed Spline returns to its start", () => {
  const spline = new Spline({
    points: [[2, 0, 0], [0, 2, 0], [-2, 0, 0], [0, -2, 0]],
    closed: true,
  });
  const a = spline.pointFromProportion(0);
  const b = spline.pointFromProportion(1);
  close(a[0], b[0]); close(a[1], b[1]);
});

test("Path builds from SVG d-string and spans the expected extent", () => {
  const path = new Path({ data: "M 0 0 L 100 0 L 100 100 Z", scale: 0.02 });
  assert.ok(path.points.length > 0, "path produced points");
  close(path.getWidth(), 2, 1e-6, "100 units * 0.02 scale");
  close(path.getHeight(), 2, 1e-6);
});

test("PolyLine: sharp corners hit vertices; radius rounds them off", () => {
  const pts = [[-2, 0, 0], [0, 2, 0], [2, 0, 0]];
  const sharp = new PolyLine({ points: pts });
  const apex = sharp.pointFromProportion(0.5);
  close(apex[0], 0); close(apex[1], 2);
  const rounded = new PolyLine({ points: pts, radius: 0.5 });
  // The rounded version never reaches the vertex: max y < 2.
  let maxY = -Infinity;
  for (let a = 0; a <= 1; a += 1 / 64) {
    maxY = Math.max(maxY, rounded.pointFromProportion(a)[1]);
  }
  assert.ok(maxY < 2 - 1e-3, `fillet trims the apex (maxY=${maxY})`);
  assert.ok(maxY > 1.5, "but stays near it");
});

test("closed PolyLine forms a ring (start == end)", () => {
  const ring = new PolyLine({
    points: [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]],
    closed: true,
  });
  const a = ring.pointFromProportion(0);
  const b = ring.pointFromProportion(1);
  close(a[0], b[0]); close(a[1], b[1]);
});

// --- tangentAtProportion -----------------------------------------------------

test("tangentAtProportion returns exact unit tangents", () => {
  const line = new Line({ start: [0, 0, 0], end: [3, 4, 0] });
  const t = line.tangentAtProportion(0.5);
  close(t[0], 3 / 5, 1e-4, "line tangent x");
  close(t[1], 4 / 5, 1e-4, "line tangent y");
  close(Math.hypot(t[0], t[1], t[2]), 1, 1e-9, "unit length");
  // On a circle the tangent is perpendicular to the radius everywhere.
  const c = new Circle({ radius: 2 });
  for (const alpha of [0, 0.21, 0.5, 0.83, 1]) {
    const p = c.pointFromProportion(alpha);
    const r = [p[0] - c.getCenter()[0], p[1] - c.getCenter()[1]];
    const tan = c.tangentAtProportion(alpha);
    const dot = r[0] * tan[0] + r[1] * tan[1];
    close(dot, 0, 1e-2, `tangent ⟂ radius at alpha=${alpha} (dot=${dot})`);
  }
});

// --- FlexGroup padding -------------------------------------------------------

test("FlexGroup padding insets children from the container edge", async () => {
  // layout() anchors the configured container's top-left to the group's
  // PRE-layout center, so measure first-child x relative to that origin.
  const build = async (padding?: number) => {
    const g = new FlexGroup({ direction: "row", width: 8, height: 2, padding });
    g.add(new Square({ sideLength: 1 }), new Square({ sideLength: 1 }));
    const originX = g.getCenter()[0] - 8 / 2;
    await g.layout();
    return g.submobjects[0].getCenter()[0] - originX;
  };
  const a = await build();
  const b = await build(1);
  close(b - a, 1, 1e-6, `padding=1 insets first child by 1 (${a} -> ${b})`);
});

// --- VideoMobject.seek -------------------------------------------------------

function fakeProvider(nFrames: number, fps: number): VideoFrameProvider {
  const frames = Array.from({ length: nFrames }, (_, i) => `f${i}`);
  return {
    duration: nFrames / fps, width: 128, height: 72, fps,
    frameAt(t: number) {
      return frames[Math.max(0, Math.min(nFrames - 1, Math.round(t * fps)))];
    },
    dispose() {},
  };
}

test("VideoMobject.seek jumps to the requested time and shows that frame", () => {
  const v = new VideoMobject(fakeProvider(30, 10), {}); // 3s clip
  v.seek(1.5);
  assert.equal((v as any).image, "f15", "seek(1.5) shows frame 15");
  close(v.sourceTime(), 1.5);
  v.seek(0); // backward seek works too
  assert.equal((v as any).image, "f0");
});

// --- findAll -----------------------------------------------------------------

test("findAll returns every matching descendant including nested groups", () => {
  const c1 = new Circle({ radius: 1 });
  const c2 = new Circle({ radius: 2 });
  const s = new Square({ sideLength: 1 });
  const inner = new VGroup(c2, s);
  const root = new Group(c1, inner);
  const circles = root.findAll((m) => m instanceof Circle);
  assert.equal(circles.length, 2);
  assert.ok(circles.includes(c1) && circles.includes(c2));
  const texts = root.findAll((m) => m instanceof Text);
  assert.equal(texts.length, 0);
});

// --- matchTex ----------------------------------------------------------------

test("parseTexGroups extracts {{...}} groups and strips markers", () => {
  const { tex, isolate } = parseTexGroups("{{a^2}} + {{b^2}} = c^2");
  assert.equal(tex, "a^2 + b^2 = c^2");
  assert.deepEqual(isolate, ["a^2", "b^2"]);
  const none = parseTexGroups("x + y");
  assert.equal(none.tex, "x + y");
  assert.deepEqual(none.isolate, []);
});

test("matchTex builds an isolated target + TransformMatchingTex at the old position", async () => {
  await initMathTex();
  const old = new MathTex("a^2 + b^2 = c^2", { substringsToIsolate: ["a^2", "b^2", "c^2"] });
  old.moveTo([1, 2, 0]);
  const { animation, target } = matchTex(old, "{{a^2}} = {{c^2}} - {{b^2}}");
  assert.ok(animation instanceof TransformMatchingTex);
  assert.ok(target instanceof MathTex);
  assert.ok(target.substringsToIsolate.includes("a^2"));
  assert.ok(target.substringsToIsolate.includes("b^2"));
  close(target.getCenter()[0], 1, 1e-9, "target centered on old x");
  close(target.getCenter()[1], 2, 1e-9, "target centered on old y");
  // Shared groups pair up: a^2, b^2, c^2 all appear in both parts lists.
  const oldTexes = (old as any)._partTex as string[];
  const newTexes = (target as any)._partTex as string[];
  for (const k of ["a^2", "b^2", "c^2"]) {
    assert.ok(oldTexes.some((t) => t.includes(k)), `old has part ${k}`);
    assert.ok(newTexes.some((t) => t.includes(k)), `target has part ${k}`);
  }
});
