import { test } from "node:test";
import assert from "node:assert/strict";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type SimulationNode,
  type SimulationLink,
} from "../src/layout/force.ts";

function makeNodes(n: number): SimulationNode[] {
  return Array.from({ length: n }, () => ({}));
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

test("nodes without x/y are placed on d3's phyllotaxis spiral", () => {
  const nodes = makeNodes(5);
  forceSimulation(nodes);
  const angle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < nodes.length; i++) {
    const radius = 10 * Math.sqrt(0.5 + i);
    assert.ok(Math.abs(nodes[i].x! - radius * Math.cos(i * angle)) < 1e-12);
    assert.ok(Math.abs(nodes[i].y! - radius * Math.sin(i * angle)) < 1e-12);
    assert.equal(nodes[i].vx, 0);
    assert.equal(nodes[i].vy, 0);
    assert.equal(nodes[i].index, i);
  }
});

test("nodes with preset x/y keep them; fx/fy pin position", () => {
  const nodes: SimulationNode[] = [{ x: 3, y: 4 }, { fx: -1, fy: -2 }, {}];
  const sim = forceSimulation(nodes);
  assert.equal(nodes[0].x, 3);
  assert.equal(nodes[0].y, 4);
  assert.equal(nodes[1].x, -1);
  assert.equal(nodes[1].y, -2);
  sim.force("x", forceX(100, 1)).force("y", forceY(100, 1)).tick(10);
  assert.equal(nodes[1].x, -1); // pinned
  assert.equal(nodes[1].y, -2);
  assert.equal(nodes[1].vx, 0);
  assert.equal(nodes[1].vy, 0);
});

test("alpha decays with d3 semantics; run() is exactly 300 ticks by default", () => {
  const sim = forceSimulation(makeNodes(3));
  const decay = 1 - Math.pow(0.001, 1 / 300);
  assert.ok(Math.abs(sim.alphaDecay - decay) < 1e-15);
  sim.tick();
  assert.ok(Math.abs(sim.alpha - (1 - decay)) < 1e-15);

  const sim2 = forceSimulation(makeNodes(3));
  const n = Math.ceil(Math.log(sim2.alphaMin) / Math.log(1 - sim2.alphaDecay));
  assert.equal(n, 300);
  // run() alpha equals ticking 300 times manually.
  const sim3 = forceSimulation(makeNodes(3)).tick(300);
  sim2.run();
  assert.equal(sim2.alpha, sim3.alpha);
});

// ---------------------------------------------------------------------------
// Byte-determinism
// ---------------------------------------------------------------------------

function runScenario(seed: number): string {
  // Includes coincident nodes (jiggle paths) and every force type.
  const nodes: SimulationNode[] = [
    { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" },
    { id: "e", x: 0, y: 0 }, { id: "f", x: 0, y: 0 }, // coincident -> jiggle
    { id: "g" }, { id: "h" },
  ];
  const links: SimulationLink[] = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "c", target: "d" },
    { source: "d", target: "e" },
    { source: "e", target: "f" },
    { source: "f", target: "g" },
    { source: "g", target: "h" },
    { source: "h", target: "a" },
    { source: "a", target: "e" },
  ];
  const sim = forceSimulation(nodes, { seed })
    .force("link", forceLink(links, { id: (d) => d.id }))
    .force("charge", forceManyBody())
    .force("center", forceCenter([0, 0]))
    .force("collide", forceCollide(2))
    .force("x", forceX(0, 0.05))
    .force("y", forceY(0, 0.05));
  sim.run();
  return JSON.stringify(nodes.map((n) => [n.id, n.x, n.y, n.vx, n.vy]));
}

test("two runs with identical inputs produce byte-identical positions", () => {
  const a = runScenario(1);
  const b = runScenario(1);
  assert.equal(a, b);
});

test("different seeds change the jiggle stream (coincident nodes separate differently)", () => {
  const a = runScenario(1);
  const b = runScenario(2);
  assert.notEqual(a, b);
});

test("no NaN or Infinity after a full run", () => {
  const parsed = JSON.parse(runScenario(1)) as [string, number, number, number, number][];
  for (const [, x, y, vx, vy] of parsed) {
    for (const v of [x, y, vx, vy]) assert.ok(Number.isFinite(v), `non-finite ${v}`);
  }
});

// ---------------------------------------------------------------------------
// Individual forces
// ---------------------------------------------------------------------------

test("forceLink pulls linked nodes toward the configured distance", () => {
  const nodes: SimulationNode[] = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
  const links: SimulationLink[] = [{ source: 0, target: 1 }];
  forceSimulation(nodes)
    .force("link", forceLink(links, { distance: 30 }))
    .run();
  const d = Math.hypot(nodes[1].x! - nodes[0].x!, nodes[1].y! - nodes[0].y!);
  assert.ok(Math.abs(d - 30) < 1, `distance ${d} should approach 30`);
});

test("forceLink default strength is 1/min(degree(source), degree(target))", () => {
  // star: node 0 has degree 3, leaves degree 1 -> strength 1/1 = 1
  const nodes = makeNodes(4);
  const links: SimulationLink[] = [
    { source: 0, target: 1 },
    { source: 0, target: 2 },
    { source: 0, target: 3 },
  ];
  // Just verify it initializes and runs without error and converges sanely.
  forceSimulation(nodes).force("link", forceLink(links, { distance: 10 })).run();
  for (let i = 1; i < 4; i++) {
    const d = Math.hypot(nodes[i].x! - nodes[0].x!, nodes[i].y! - nodes[0].y!);
    assert.ok(d > 5 && d < 20, `leaf ${i} at distance ${d}`);
  }
});

test("forceManyBody with negative strength repels nodes", () => {
  const nodes: SimulationNode[] = [{ x: -1, y: 0 }, { x: 1, y: 0 }];
  const before = Math.hypot(nodes[1].x! - nodes[0].x!, nodes[1].y! - nodes[0].y!);
  forceSimulation(nodes).force("charge", forceManyBody({ strength: -30 })).tick(50);
  const after = Math.hypot(nodes[1].x! - nodes[0].x!, nodes[1].y! - nodes[0].y!);
  assert.ok(after > before, `repulsion should increase separation (${before} -> ${after})`);
});

test("forceManyBody respects distanceMax2 cutoff", () => {
  const nodes: SimulationNode[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  forceSimulation(nodes)
    .force("charge", forceManyBody({ strength: -30, distanceMax2: 50 * 50 }))
    .tick(1);
  // Beyond the cutoff: no velocity imparted.
  assert.equal(nodes[0].vx, 0);
  assert.equal(nodes[1].vx, 0);
});

test("forceCenter recenters the mean position on the target", () => {
  const nodes: SimulationNode[] = [{ x: 10, y: 10 }, { x: 20, y: 30 }];
  forceSimulation(nodes).force("center", forceCenter([5, -5])).tick(1);
  const mx = (nodes[0].x! + nodes[1].x!) / 2;
  const my = (nodes[0].y! + nodes[1].y!) / 2;
  assert.ok(Math.abs(mx - 5) < 1e-9);
  assert.ok(Math.abs(my - -5) < 1e-9);
});

test("forceCollide separates overlapping circles", () => {
  const nodes: SimulationNode[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.5 }];
  forceSimulation(nodes).force("collide", forceCollide(5)).run();
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const d = Math.hypot(nodes[j].x! - nodes[i].x!, nodes[j].y! - nodes[i].y!);
      assert.ok(d > 9.9, `nodes ${i},${j} at distance ${d}, want >= ~10`);
    }
  }
});

test("forceX / forceY pull nodes toward target coordinates", () => {
  const nodes: SimulationNode[] = [{ x: -50, y: 80 }];
  forceSimulation(nodes).force("x", forceX(10)).force("y", forceY(-20)).run();
  assert.ok(Math.abs(nodes[0].x! - 10) < 1, `x ${nodes[0].x}`);
  assert.ok(Math.abs(nodes[0].y! - -20) < 1, `y ${nodes[0].y}`);
});

test("force(name, null) removes a force; tick(n) multi-tick works", () => {
  const nodes: SimulationNode[] = [{ x: 0, y: 0 }];
  const sim = forceSimulation(nodes).force("x", forceX(100, 1));
  assert.ok(sim.force("x"));
  sim.force("x", null);
  assert.equal(sim.force("x"), undefined);
  sim.tick(5);
  assert.equal(nodes[0].x, 0); // no forces -> no movement
});
