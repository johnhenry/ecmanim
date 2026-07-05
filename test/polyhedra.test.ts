import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Polyhedron,
  Tetrahedron,
  Octahedron,
  Icosahedron,
  Dodecahedron,
  ConvexHull3D,
} from "../src/mobject/polyhedra.ts";
import * as V from "../src/core/math/vector.ts";

test("Tetrahedron has 4 faces, 4 vertices, 6 edges", () => {
  const t = new Tetrahedron();
  assert.equal(t.faces.submobjects.length, 4);
  assert.equal(t.vertices.submobjects.length, 4);
  assert.equal(t.edges.size, 6);
});

test("Octahedron has 8 faces, 6 vertices, 12 edges", () => {
  const o = new Octahedron();
  assert.equal(o.faces.submobjects.length, 8);
  assert.equal(o.vertices.submobjects.length, 6);
  assert.equal(o.edges.size, 12);
});

test("Icosahedron has 20 faces, 12 vertices, 30 edges", () => {
  const ico = new Icosahedron();
  assert.equal(ico.faces.submobjects.length, 20);
  assert.equal(ico.vertices.submobjects.length, 12);
  assert.equal(ico.edges.size, 30);
});

test("Dodecahedron has 12 faces, 20 vertices, 30 edges", () => {
  const d = new Dodecahedron();
  assert.equal(d.faces.submobjects.length, 12);
  assert.equal(d.vertices.submobjects.length, 20);
  assert.equal(d.edges.size, 30);
});

test("all solids are regular: vertices equidistant from center", () => {
  for (const solid of [new Tetrahedron(), new Octahedron(), new Icosahedron(), new Dodecahedron()]) {
    const center = V.centerOfMass(solid.vertexCoords);
    const dists = solid.vertexCoords.map((p) => V.distance(p, center));
    const min = Math.min(...dists), max = Math.max(...dists);
    assert.ok(max - min < 1e-6, `vertex radii vary: ${min}..${max}`);
  }
});

test("Tetrahedron edge lengths equal edgeLength within tolerance", () => {
  const edgeLength = 1.5;
  const t = new Tetrahedron({ edgeLength });
  for (const [i, j] of t.getEdges(t.facesList)) {
    const len = V.distance(t.vertexCoords[i], t.vertexCoords[j]);
    assert.ok(Math.abs(len - edgeLength) < 1e-6, `edge length ${len} != ${edgeLength}`);
  }
});

test("updateFaces repositions a face after a vertex moves", () => {
  const t = new Tetrahedron();
  // Face 0 uses vertices [0,1,2]; move vertex 0 and re-sync.
  const before = t.faces.submobjects[0].getCenter();
  t.vertices.submobjects[0].shift([2, 0, 0]);
  t.updateFaces();
  const after = t.faces.submobjects[0].getCenter();
  assert.ok(V.distance(before, after) > 0.1, "face 0 should move with its vertex");
  // The moved vertex coord should be reflected.
  assert.ok(Math.abs(t.vertexCoords[0][0] - (t.faces.submobjects[0] as any).points[0][0]) < 1e-9);
});

test("ConvexHull3D of a cube (+ interior points) has 12 triangular faces, 8 vertices", () => {
  const corners = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const interior = [[0, 0, 0], [0.5, 0.2, -0.3], [-0.4, 0.1, 0.2]];
  const hull = new ConvexHull3D(...corners, ...interior, { tolerance: 1e-6 });
  assert.equal(hull.vertices.submobjects.length, 8);
  // A cube's hull triangulates 6 quads -> 12 triangles.
  assert.equal(hull.faces.submobjects.length, 12);
});

test("Polyhedron base class builds faces/vertices/edges from tables", () => {
  const p = new Polyhedron(
    [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
    [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]],
  );
  assert.equal(p.faces.submobjects.length, 4);
  assert.equal(p.getFaceCoords().length, 4);
  assert.equal(p.getVertexMobjects().length, 4);
  assert.equal(p.getFaceMobjects().length, 4);
});

test("showVertices/showEdges default to true, preserving existing Platonic-solid behavior", () => {
  const t = new Tetrahedron();
  // faces group + vertices group + each of the 6 edge Lines individually.
  assert.equal(t.submobjects.length, 2 + t.edges.size);
  assert.ok(t.submobjects.includes(t.faces));
  assert.ok(t.submobjects.includes(t.vertices));
  for (const line of t.edges.values()) assert.ok(t.submobjects.includes(line));
});

test("showVertices: false, showEdges: false hides the vertex/edge overlay but still builds them", () => {
  const p = new Polyhedron(
    [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
    [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]],
    { showVertices: false, showEdges: false },
  );
  // Only the faces group is a submobject -- no vertex Dots, no edge Lines.
  assert.equal(p.submobjects.length, 1);
  assert.equal(p.submobjects[0], p.faces);
  // Still built (populated), just not displayed.
  assert.equal(p.vertices.submobjects.length, 4);
  assert.equal(p.edges.size, 6);
});
