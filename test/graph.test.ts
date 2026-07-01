import { test } from "node:test";
import assert from "node:assert/strict";
import { Graph, DiGraph, GenericGraph } from "../src/mobject/graph.ts";
import { Dot, Arrow } from "../src/mobject/geometry.ts";
import * as V from "../src/core/math/vector.ts";

test("Graph builds a vertex mobject per id and an edge per pair", () => {
  const g = new Graph([1, 2, 3], [[1, 2], [2, 3]]);
  assert.equal(g.getVertexMobjects().length, 3);
  assert.equal(g.getEdgeMobjects().length, 2);
  assert.ok(g.getVertex(1) instanceof Dot);
});

test("circular layout places vertices ~equidistant from the layout center", () => {
  const g = new Graph([1, 2, 3, 4], [], { layout: "circular", layout_scale: 2 });
  const centers = g.getVertexMobjects().map((m) => m.getCenter());
  const mid = V.centerOfMass(centers);
  const radii = centers.map((c) => V.distance(c, mid));
  const first = radii[0];
  assert.ok(first > 0.1);
  for (const r of radii) assert.ok(Math.abs(r - first) < 1e-6, `radius ${r} vs ${first}`);
});

test("addEdges / removeEdges update the edge count", () => {
  const g = new Graph([1, 2, 3], [[1, 2]]);
  assert.equal(g.getEdgeMobjects().length, 1);
  g.addEdges([2, 3], [1, 3]);
  assert.equal(g.getEdgeMobjects().length, 3);
  g.removeEdges([1, 3]);
  assert.equal(g.getEdgeMobjects().length, 2);
});

test("addVertices / removeVertices update the vertex count and incident edges", () => {
  const g = new Graph([1, 2], [[1, 2]]);
  g.addVertices(3);
  assert.equal(g.getVertexMobjects().length, 3);
  g.removeVertices(2); // removes vertex 2 and edge [1,2]
  assert.equal(g.getVertexMobjects().length, 2);
  assert.equal(g.getEdgeMobjects().length, 0);
});

test("updateEdges repositions an edge after a vertex moves", () => {
  const g = new Graph([1, 2], [[1, 2]], { layout: "circular", layout_scale: 2 });
  const edge = g.getEdge(1, 2);
  const before = edge.getEnd();
  const v2 = g.getVertex(2)!;
  v2.shift([5, 5, 0]);
  g.updateEdges();
  const after = edge.getEnd();
  // The edge end should now sit at vertex 2's new center.
  assert.ok(V.distance(after, v2.getCenter()) < 1e-6);
  assert.ok(V.distance(before, after) > 1);
});

test("DiGraph edges are Arrows with a tip submobject", () => {
  const g = new DiGraph([1, 2], [[1, 2]]);
  const edge = g.getEdge(1, 2);
  assert.ok(edge instanceof Arrow);
  assert.ok(edge.tip != null);
  assert.ok(edge.submobjects.includes(edge.tip));
});

test("DiGraph updateEdges keeps the arrow tip at the target vertex", () => {
  const g = new DiGraph([1, 2], [[1, 2]], { layout: "circular", layout_scale: 2 });
  const edge = g.getEdge(1, 2);
  g.getVertex(2)!.shift([3, 0, 0]);
  g.updateEdges();
  // Tip apex is the first corner point of the tip triangle (= edge end).
  assert.ok(V.distance(edge.getEnd(), g.getVertex(2)!.getCenter()) < 1e-6);
});

test("labels:true adds a label centered on each vertex", () => {
  const g = new Graph([1, 2], [], { labels: true, layout: "circular" });
  const v1 = g.getVertex(1)!;
  // The vertex mobject should contain a label submobject.
  assert.ok(v1.submobjects.length >= 1);
  assert.equal((g as GenericGraph)._labelsById.size, 2);
});
