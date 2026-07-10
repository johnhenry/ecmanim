import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  sankey,
  sankeyLinkHorizontalPoints,
  type SankeyGraph,
  type SankeyNode,
  type SankeyLink,
} from "../src/layout/sankey.ts";

function simpleGraph(): SankeyGraph {
  // a -> b -> d, a -> c -> d
  return {
    nodes: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }],
    links: [
      { source: 0, target: 1, value: 2 },
      { source: 0, target: 2, value: 1 },
      { source: 1, target: 3, value: 2 },
      { source: 2, target: 3, value: 1 },
    ],
  };
}

function loadEnergy(): SankeyGraph {
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "examples", "d3-parity", "data", "energy.json"), "utf8"),
  ) as { nodes: { name: string }[]; links: { source: number; target: number; value: number }[] };
  return {
    nodes: raw.nodes.map((n) => ({ ...n })),
    links: raw.links.map((l) => ({ ...l })),
  };
}

// ---------------------------------------------------------------------------
// Basic layout semantics
// ---------------------------------------------------------------------------

test("assigns depth/height/layer/value and x/y extents on a simple graph", () => {
  const graph = sankey({ extent: [[0, 0], [100, 100]], nodeWidth: 10 })(simpleGraph());
  const [a, b, c, d] = graph.nodes;
  assert.equal(a.depth, 0);
  assert.equal(b.depth, 1);
  assert.equal(c.depth, 1);
  assert.equal(d.depth, 2);
  assert.equal(a.height, 2);
  assert.equal(d.height, 0);
  assert.equal(a.value, 3);
  assert.equal(b.value, 2);
  assert.equal(c.value, 1);
  assert.equal(d.value, 3);
  // layers: justify puts a at 0, b/c at 1, d (no source links) at last.
  assert.equal(a.layer, 0);
  assert.equal(b.layer, 1);
  assert.equal(c.layer, 1);
  assert.equal(d.layer, 2);
  // node x extents
  assert.equal(a.x0, 0);
  assert.equal(a.x1, 10);
  assert.equal(d.x1, 100);
  assert.equal(d.x0, 90);
  // all node boxes inside the extent
  for (const n of graph.nodes) {
    assert.ok(n.x0! >= 0 && n.x1! <= 100 && n.y0! >= -1e-9 && n.y1! <= 100 + 1e-9);
    assert.ok(n.y1! > n.y0!, "positive node height");
  }
});

test("align strategies: left / right / center place endpoint layers differently", () => {
  const make = () => ({
    nodes: [{ n: "a" }, { n: "b" }, { n: "sink" }, { n: "short" }] as SankeyNode[],
    // a -> b -> sink, and short -> sink (short chain starts late)
    links: [
      { source: 0, target: 1, value: 1 },
      { source: 1, target: 2, value: 1 },
      { source: 3, target: 2, value: 1 },
    ] as SankeyLink[],
  });
  const left = sankey({ nodeAlign: "left" })(make());
  assert.equal(left.nodes[3].layer, 0); // depth 0
  const right = sankey({ nodeAlign: "right" })(make());
  assert.equal(right.nodes[3].layer, 1); // n-1-height = 2-1
  const justify = sankey({ nodeAlign: "justify" })(make());
  assert.equal(justify.nodes[3].layer, 0); // has source links -> depth
  const center = sankey({ nodeAlign: "center" })(make());
  assert.equal(center.nodes[3].layer, 1); // min(target.depth) - 1 = 2 - 1
});

test("nodeId accessor resolves string-keyed links", () => {
  const graph: SankeyGraph = {
    nodes: [{ name: "x" }, { name: "y" }],
    links: [{ source: "x", target: "y", value: 5 }],
  };
  sankey({ nodeId: (d) => d.name as string })(graph);
  assert.equal(graph.links[0].source, graph.nodes[0]);
  assert.equal(graph.links[0].target, graph.nodes[1]);
  assert.equal(graph.links[0].width! > 0, true);
});

test("circular graphs throw", () => {
  const graph: SankeyGraph = {
    nodes: [{}, {}],
    links: [
      { source: 0, target: 1, value: 1 },
      { source: 1, target: 0, value: 1 },
    ],
  };
  assert.throws(() => sankey()(graph), /circular/);
});

test("determinism: two runs on identical input are byte-identical", () => {
  const strip = (g: SankeyGraph) =>
    JSON.stringify({
      nodes: g.nodes.map((n) => [n.x0, n.x1, n.y0, n.y1, n.value, n.depth, n.height, n.layer]),
      links: g.links.map((l) => [l.y0, l.y1, l.width]),
    });
  const a = strip(sankey({ extent: [[0, 0], [954, 600]] })(loadEnergy()));
  const b = strip(sankey({ extent: [[0, 0], [954, 600]] })(loadEnergy()));
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// Real fixture: energy.json
// ---------------------------------------------------------------------------

test("energy.json: layout runs with no NaN and sane geometry", () => {
  const graph = sankey({ extent: [[0, 0], [954, 600]] })(loadEnergy());

  const ky = (() => {
    // node height / value should be one consistent scale across all nodes
    const n0 = graph.nodes[0];
    return (n0.y1! - n0.y0!) / n0.value!;
  })();

  for (const node of graph.nodes) {
    for (const v of [node.x0, node.x1, node.y0, node.y1, node.value]) {
      assert.ok(Number.isFinite(v), `non-finite node field on ${String(node.name)}: ${v}`);
    }
    // heights proportional to value (same ky for every node)
    const nodeKy = (node.y1! - node.y0!) / node.value!;
    assert.ok(Math.abs(nodeKy - ky) < 1e-6, `ky mismatch on ${String(node.name)}: ${nodeKy} vs ${ky}`);
  }

  for (const link of graph.links) {
    for (const v of [link.y0, link.y1, link.width]) {
      assert.ok(Number.isFinite(v), `non-finite link field: ${v}`);
    }
    assert.ok(link.width! > 0, "positive link width");

    const source = link.source as SankeyNode;
    const target = link.target as SankeyNode;
    // x-layers monotone along links
    assert.ok(source.layer! < target.layer!, `link goes forward (${source.layer} -> ${target.layer})`);
    assert.ok(source.x1! <= target.x0! + 1e-9, "source box left of target box");
    // link endpoints fit inside their nodes' vertical spans
    const eps = 1e-6;
    assert.ok(
      link.y0! - link.width! / 2 >= source.y0! - eps && link.y0! + link.width! / 2 <= source.y1! + eps,
      `link y0 span inside source node`,
    );
    assert.ok(
      link.y1! - link.width! / 2 >= target.y0! - eps && link.y1! + link.width! / 2 <= target.y1! + eps,
      `link y1 span inside target node`,
    );
  }

  // links stacked within a node exactly fill (no gaps): total sourceLink width
  // equals node height for pure pass-through nodes where out-sum === value.
  for (const node of graph.nodes) {
    const out = node.sourceLinks!.reduce((s, l) => s + l.width!, 0);
    const outValue = node.sourceLinks!.reduce((s, l) => s + l.value, 0);
    if (Math.abs(outValue - node.value!) < 1e-9) {
      assert.ok(Math.abs(out - (node.y1! - node.y0!)) < 1e-6, `outgoing widths fill node ${String(node.name)}`);
    }
  }

  // no vertical overlap within a column (allowing tiny numeric slop)
  const byLayer = new Map<number, SankeyNode[]>();
  for (const node of graph.nodes) {
    const arr = byLayer.get(node.layer!) ?? [];
    arr.push(node);
    byLayer.set(node.layer!, arr);
  }
  for (const [layer, column] of byLayer) {
    const sorted = [...column].sort((a, b) => a.y0! - b.y0!);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        sorted[i].y0! >= sorted[i - 1].y1! - 1e-6,
        `overlap in layer ${layer}: ${String(sorted[i - 1].name)} / ${String(sorted[i].name)}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// sankeyLinkHorizontalPoints
// ---------------------------------------------------------------------------

test("sankeyLinkHorizontalPoints returns d3's bump-x cubic control points", () => {
  const graph = sankey({ extent: [[0, 0], [100, 100]], nodeWidth: 10 })(simpleGraph());
  const link = graph.links[0];
  const pts = sankeyLinkHorizontalPoints(link);
  const source = link.source as SankeyNode;
  const target = link.target as SankeyNode;
  assert.equal(pts.length, 4);
  assert.deepEqual(pts[0], [source.x1, link.y0]);
  assert.deepEqual(pts[3], [target.x0, link.y1]);
  const mx = (source.x1! + target.x0!) / 2;
  assert.deepEqual(pts[1], [mx, link.y0]); // horizontal tangent at start
  assert.deepEqual(pts[2], [mx, link.y1]); // horizontal tangent at end
});

test("sankeyLinkHorizontalPoints with samples returns points on the cubic", () => {
  const graph = sankey({ extent: [[0, 0], [100, 100]], nodeWidth: 10 })(simpleGraph());
  const link = graph.links[0];
  const [p0, , , p3] = sankeyLinkHorizontalPoints(link);
  const sampled = sankeyLinkHorizontalPoints(link, 11);
  assert.equal(sampled.length, 11);
  assert.deepEqual(sampled[0], p0);
  assert.deepEqual(sampled[10], p3);
  // x must be monotone non-decreasing along a bump-x curve
  for (let i = 1; i < sampled.length; i++) {
    assert.ok(sampled[i][0] >= sampled[i - 1][0] - 1e-9);
  }
});
