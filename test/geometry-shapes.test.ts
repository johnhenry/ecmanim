// Parity tests for the added geometry classes: polygram family, shape matchers,
// vectors, and labeled lines/arrows.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RegularPolygram,
  Star,
  RoundedRectangle,
  Cutout,
  ConvexHull,
} from "../src/mobject/polygram.ts";
import {
  SurroundingRectangle,
  BackgroundRectangle,
  Cross,
  Underline,
} from "../src/mobject/shape_matchers.ts";
import { Vector, DoubleArrow } from "../src/mobject/vectors.ts";
import { Square, Circle } from "../src/mobject/geometry.ts";
import * as V from "../src/core/math/vector.ts";

// Segments (p1,p2) and (p3,p4) properly intersect (strictly inside both).
function segmentsIntersect(p1: number[], p2: number[], p3: number[], p4: number[]): boolean {
  const d = (a: number[], b: number[], c: number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function outlineSelfIntersects(verts: number[][]): boolean {
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent (shared-endpoint) edges.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const c = verts[j], dd = verts[(j + 1) % n];
      if (segmentsIntersect(a, b, c, dd)) return true;
    }
  }
  return false;
}

test("RegularPolygram(5, {density:2}) has 5 vertices and a self-intersecting outline", () => {
  const rp = new RegularPolygram(5, { density: 2 });
  const verts = rp.getVertices();
  assert.equal(verts.length, 5);
  assert.ok(outlineSelfIntersects(verts), "pentagram outline should self-intersect (be star-shaped)");
});

test("Star builds a 5-pointed star with 10 vertices", () => {
  const s = new Star(5);
  const verts = s.getVertices();
  assert.equal(verts.length, 10);
  // Outer radius should exceed inner radius (alternating).
  const rs = verts.map((p) => V.length(p));
  const maxR = Math.max(...rs);
  const minR = Math.min(...rs);
  assert.ok(maxR > minR + 1e-6, "star should alternate outer/inner radii");
});

test("RoundedRectangle bounds are approximately width x height", () => {
  const rr = new RoundedRectangle({ width: 4, height: 2, cornerRadius: 0.3 });
  assert.ok(Math.abs(rr.getWidth() - 4) < 1e-6, `width ${rr.getWidth()}`);
  assert.ok(Math.abs(rr.getHeight() - 2) < 1e-6, `height ${rr.getHeight()}`);
});

test("SurroundingRectangle encloses the target's bounding box", () => {
  const sq = new Square({ side: 2 });
  const buff = 0.1;
  const sr = new SurroundingRectangle(sq, { buff });
  const sqBB = sq.getBoundingBox();
  const srBB = sr.getBoundingBox();
  // sr bbox must contain the target bbox on every axis.
  assert.ok(srBB.min[0] <= sqBB.min[0] + 1e-9 && srBB.min[1] <= sqBB.min[1] + 1e-9);
  assert.ok(srBB.max[0] >= sqBB.max[0] - 1e-9 && srBB.max[1] >= sqBB.max[1] - 1e-9);
  // And be larger by ~2*buff.
  assert.ok(Math.abs(sr.getWidth() - (sq.getWidth() + 2 * buff)) < 1e-6);
});

test("BackgroundRectangle has fillOpacity 0.75 by default", () => {
  const c = new Circle();
  const bg = new BackgroundRectangle(c);
  assert.ok(Math.abs(bg.fillOpacity - 0.75) < 1e-9);
});

test("Cross has 2 line submobjects", () => {
  const sq = new Square({ side: 2 });
  const cross = new Cross(sq);
  assert.equal(cross.submobjects.length, 2);
});

test("Vector points in the given direction (getEnd ~= direction)", () => {
  const dir = [2, 1, 0];
  const v = new Vector(dir);
  assert.ok(V.equals(v.getEnd(), dir, 1e-9), `getEnd ${v.getEnd()}`);
  // coordinateLabel returns a Text-like mobject.
  const label = v.coordinateLabel();
  assert.ok(label && typeof (label as any).text === "string");
});

test("DoubleArrow has tips near both ends", () => {
  const start = [-2, 0, 0];
  const end = [2, 0, 0];
  const da = new DoubleArrow(start, end);
  assert.equal(da.submobjects.length, 2);
  // Each tip's bounding-box center should lie near one of the endpoints.
  const centers = da.submobjects.map((m) => m.getCenter());
  const nearStart = centers.some((c) => V.distance(c, start) < 0.4);
  const nearEnd = centers.some((c) => V.distance(c, end) < 0.4);
  assert.ok(nearStart, "a tip should sit near the start");
  assert.ok(nearEnd, "a tip should sit near the end");
});

test("ConvexHull of a square's corners + interior point equals the square", () => {
  const pts = [
    [-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0],
    [0, 0, 0], [0.5, 0.5, 0], [-0.3, 0.2, 0], // interior points
  ];
  const hull = new ConvexHull(pts);
  const verts = hull.getVertices();
  assert.equal(verts.length, 4, `hull should have 4 corners, got ${verts.length}`);
  // Every hull vertex must be one of the square's corners.
  const corners = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]];
  for (const hv of verts) {
    assert.ok(corners.some((c) => V.equals(hv, c, 1e-6)), `unexpected hull vertex ${hv}`);
  }
});

test("Cutout produces a filled multi-subpath VMobject (main minus holes)", () => {
  const outer = new Square({ side: 4 });
  const hole = new Square({ side: 1 });
  const cut = new Cutout(outer, hole);
  assert.ok(cut.fillOpacity > 0, "cutout should be filled");
  assert.ok(cut.getSubpaths().length >= 2, "cutout should have main + hole subpaths");
});

test("Underline sits below the target", () => {
  const sq = new Square({ side: 2 });
  const u = new Underline(sq, { buff: 0.1 });
  assert.ok(u.getCenter()[1] < sq.getBottom()[1] + 1e-9, "underline should be at/below the bottom");
  assert.ok(Math.abs(u.getWidth() - sq.getWidth()) < 1e-6, "underline spans the target width");
});
