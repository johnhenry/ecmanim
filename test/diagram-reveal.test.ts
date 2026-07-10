// revealDiagram tests: staged reveals play through a silent Scene
// deterministically, the topological ordering property holds (a parseable
// edge never starts before either of its endpoint nodes), sequence reveals
// stage actors before messages, and gantt reveals stage scaffolding before
// bars. Cleanup contract: after the play the scene holds exactly the diagram.
//
// Guarded like mermaid-loader.test.ts: skipped (not failed) when the optional
// mermaid/jsdom devDependencies aren't installed. Renders are serialized
// inside the loader; tests in this file run sequentially.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMermaid } from "../src/loaders/mermaid_loader.ts";
import { revealDiagram, parseEdgeEndpoints, DiagramReveal } from "../src/animation/diagram_reveal.ts";
import { Scene } from "../src/scene/Scene.ts";

let available = true;
try {
  import.meta.resolve("mermaid");
  import.meta.resolve("jsdom");
} catch {
  available = false;
}
const SKIP = !available && "mermaid/jsdom not installed (npm i -D mermaid jsdom)";

const silentScene = () => new Scene({ fps: 20, frameHandler: async () => {} });

const FLOW_4 = `flowchart TD
  A[Start] --> B{Is it working?}
  B -- Yes --> C[Ship it]
  B -- No --> D[Debug]
  D --> B`;

const SEQUENCE = "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi";

const GANTT = `gantt
  title Plan
  section Core
  Task A :a1, 2024-01-01, 5d
  Task B :a2, after a1, 3d`;

// -- flowchart -------------------------------------------------------------------

test("flowchart reveal plays through a silent scene and leaves the diagram", { skip: SKIP }, async () => {
  const diagram = await loadMermaid(FLOW_4);
  const scene = silentScene();
  const anim = revealDiagram(diagram, { runTime: 1 });
  assert.ok(anim instanceof DiagramReveal);
  // Every node and edge is staged.
  for (const id of [...diagram.nodeIds(), ...diagram.edgeIds()]) {
    assert.ok(anim.revealOrder.includes(id), `revealOrder includes ${id}: ${anim.revealOrder.join(", ")}`);
  }
  await scene.play(anim);
  assert.ok(scene.mobjects.includes(diagram), "diagram is on the scene after the reveal");
  const loose = scene.mobjects.filter((m) => m !== diagram);
  assert.equal(loose.length, 0, `no stragglers: ${loose.map((m: any) => m?.constructor?.name).join(", ")}`);
});

test("topological ordering: no parseable edge starts before its endpoints", { skip: SKIP }, async () => {
  const diagram = await loadMermaid(FLOW_4);
  const anim = revealDiagram(diagram); // default order: "topological"
  const nodeIds = diagram.nodeIds();
  let checked = 0;
  for (const edgeId of diagram.edgeIds()) {
    const ends = parseEdgeEndpoints(edgeId, nodeIds);
    if (!ends) continue;
    checked++;
    const edgeStart = anim.startOf(edgeId);
    assert.ok(
      anim.startOf(ends.source) <= edgeStart,
      `source ${ends.source} (${anim.startOf(ends.source)}) starts <= edge ${edgeId} (${edgeStart})`,
    );
    assert.ok(
      anim.startOf(ends.target) <= edgeStart,
      `target ${ends.target} (${anim.startOf(ends.target)}) starts <= edge ${edgeId} (${edgeStart})`,
    );
  }
  // FLOW_4's four edges (A->B, B->C, B->D, D->B) all carry endpoints.
  assert.ok(checked >= 4, `parsed endpoints for ${checked} edges (>= 4)`);
});

test("edge-id endpoint parsing handles the friendly-id conventions", { skip: SKIP }, () => {
  assert.deepEqual(parseEdgeEndpoints("L_A_B_0", ["A", "B", "C"]), { source: "A", target: "B" });
  assert.deepEqual(parseEdgeEndpoints("id_Animal_Dog_1", ["Animal", "Dog"]), { source: "Animal", target: "Dog" });
  assert.deepEqual(
    parseEdgeEndpoints("id_entity-USER-0_entity-ORDER-1_0", ["USER", "ORDER"]),
    { source: "USER", target: "ORDER" },
  );
  // state's edgeN ids carry no endpoints.
  assert.equal(parseEdgeEndpoints("edge0", ["Idle", "Running"]), null);
});

test("source and spatial orders also play clean", { skip: SKIP }, async () => {
  const diagram = await loadMermaid(FLOW_4);
  for (const order of ["source", "spatial"] as const) {
    const scene = silentScene();
    await scene.play(revealDiagram(diagram, { order, runTime: 0.5 }));
    assert.ok(scene.mobjects.includes(diagram), `${order}: diagram on scene`);
    assert.equal(scene.mobjects.length, 1, `${order}: nothing but the diagram`);
  }
});

// -- sequence --------------------------------------------------------------------

test("sequence reveal: actors + lifelines before messages, plays clean", { skip: SKIP }, async () => {
  const diagram = await loadMermaid(SEQUENCE);
  assert.equal(diagram.diagramType, "sequence");
  const anim = revealDiagram(diagram, { runTime: 1 });
  const actorStarts = diagram.nodeIds().map((id) => anim.startOf(id));
  assert.ok(actorStarts.length >= 2, `has actor parts: ${diagram.nodeIds().join(", ")}`);
  const messageIds = anim.revealOrder.filter((id) => /^msg\d+$/.test(id));
  assert.ok(messageIds.length > 0, "sequence has un-id'd message geometry to stage");
  const lastActor = Math.max(...actorStarts);
  for (const id of messageIds) {
    assert.ok(anim.startOf(id) >= lastActor, `message ${id} starts after every actor`);
  }
  // Messages play top-to-bottom by world y (nonincreasing y in msg order).
  const scene = silentScene();
  await scene.play(anim);
  assert.ok(scene.mobjects.includes(diagram), "diagram on scene");
  assert.equal(scene.mobjects.length, 1, "no stragglers");
});

// -- gantt -----------------------------------------------------------------------

test("gantt reveal: scaffolding first, bars grow in id order, plays clean", { skip: SKIP }, async () => {
  const diagram = await loadMermaid(GANTT);
  assert.equal(diagram.diagramType, "gantt");
  const anim = revealDiagram(diagram, { runTime: 1 });
  assert.ok(anim.revealOrder.includes("a1") && anim.revealOrder.includes("a2"),
    `bars staged: ${anim.revealOrder.join(", ")}`);
  // Axis/scaffolding (the un-id'd remainder) starts before every bar.
  if (anim.revealOrder.includes("__rest__")) {
    assert.ok(anim.startOf("__rest__") <= anim.startOf("a1"), "scaffolding before the first bar");
  }
  assert.ok(anim.startOf("a1") <= anim.startOf("a2"), "bars in id order (a1 before a2)");
  const scene = silentScene();
  await scene.play(anim);
  assert.ok(scene.mobjects.includes(diagram), "diagram on scene");
  assert.equal(scene.mobjects.length, 1, "no stragglers");
});

// -- pie / un-id'd parts (campaign 4, M1.5) ----------------------------------------

test("pie reveal: un-id'd parts get the documented GrowFromCenter default, plays clean", { skip: SKIP }, async () => {
  const { GrowFromCenter } = await import("../src/animation/extra.ts");
  const diagram = await loadMermaid('pie title Pets\n  "Dogs": 40\n  "Cats": 60');
  assert.equal(diagram.diagramType, "pie");
  const anim = revealDiagram(diagram, { runTime: 1 });
  // Pie emits no per-element ids, so every part is synthetic — the per-type
  // default (GrowFromCenter) must reach them (used to hardwire FadeIn).
  const grows = (anim as any).animations.filter((a: unknown) => a instanceof GrowFromCenter);
  assert.ok(grows.length > 0, `composed children include GrowFromCenter (${grows.length})`);
  const scene = silentScene();
  await scene.play(anim);
  assert.ok(scene.mobjects.includes(diagram), "diagram on scene");
  assert.equal(scene.mobjects.length, 1, "no stragglers");
});

test("pie reveal: a user nodeAnimation factory reaches synthetic parts too", { skip: SKIP }, async () => {
  const { FadeIn } = await import("../src/animation/Animation.ts");
  const diagram = await loadMermaid('pie title Pets\n  "Dogs": 40\n  "Cats": 60');
  const seen: string[] = [];
  const anim = revealDiagram(diagram, {
    runTime: 1,
    nodeAnimation: (part, id) => { seen.push(id); return new FadeIn(part); },
  });
  assert.ok(seen.length > 0 && seen.every((id) => /^part\d+$/.test(id)), `factory called for synthetic ids: ${seen.join(", ")}`);
  assert.equal((anim as any).animations.length, seen.length, "every part went through the factory");
});
