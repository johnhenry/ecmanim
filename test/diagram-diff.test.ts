// diffDiagrams tests: two versions of a flowchart (one node added, one
// removed, two kept) morph into each other. After the play the scene shows
// newDiagram with no stragglers (mirroring mc-portfixes' "code.edit swaps old
// for target" assertions), and a shared node's identity actually morphs — its
// world position travels from the old layout to the new one.
//
// Guarded like mermaid-loader.test.ts: skipped (not failed) when the optional
// mermaid/jsdom devDependencies aren't installed. Renders are serialized
// inside the loader; tests in this file run sequentially.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMermaid } from "../src/loaders/mermaid_loader.ts";
import { diffDiagrams, DiagramDiff } from "../src/animation/diagram_diff.ts";
import { Scene } from "../src/scene/Scene.ts";
import { distance } from "../src/core/math/vector.ts";

let available = true;
try {
  import.meta.resolve("mermaid");
  import.meta.resolve("jsdom");
} catch {
  available = false;
}
const SKIP = !available && "mermaid/jsdom not installed (npm i -D mermaid jsdom)";

const silentScene = () => new Scene({ fps: 20, frameHandler: async () => {} });

// v1 -> v2: keep A, B, C (and edges A->B, B->C); remove D; add E and F.
const FLOW_V1 = `flowchart TD
  A[Start] --> B{Check}
  B --> C[Keep]
  B --> D[Drop me]`;

const FLOW_V2 = `flowchart TD
  A[Start] --> B{Check}
  B --> C[Keep]
  C --> E[New step]
  C --> F[Another new step]`;

test("diff partition: shared ids match, removed fade out, added fade in", { skip: SKIP }, async () => {
  const oldD = await loadMermaid(FLOW_V1);
  const newD = await loadMermaid(FLOW_V2);
  const anim = diffDiagrams(oldD, newD);
  assert.ok(anim instanceof DiagramDiff);
  for (const id of ["A", "B", "C", "L_A_B_0", "L_B_C_0"]) {
    assert.ok(anim.matchedIds.includes(id), `${id} matched: ${anim.matchedIds.join(", ")}`);
  }
  for (const id of ["D", "L_B_D_0"]) {
    assert.ok(anim.removedIds.includes(id), `${id} removed: ${anim.removedIds.join(", ")}`);
  }
  for (const id of ["E", "F", "L_C_E_0", "L_C_F_0"]) {
    assert.ok(anim.addedIds.includes(id), `${id} added: ${anim.addedIds.join(", ")}`);
  }
});

test("diff's animation swaps old diagram for new on the scene", { skip: SKIP }, async () => {
  const oldD = await loadMermaid(FLOW_V1);
  const newD = await loadMermaid(FLOW_V2);
  const scene = silentScene();
  scene.add(oldD);
  await scene.play(diffDiagrams(oldD, newD, { runTime: 0.5 }));
  assert.ok(!scene.mobjects.includes(oldD), "old diagram removed");
  assert.ok(scene.mobjects.includes(newD), "new diagram on scene");
  // No loose wrapper groups left behind (everything visible belongs to newD).
  const loose = scene.mobjects.filter((m) => m !== newD);
  assert.equal(loose.length, 0, `no stragglers: ${loose.map((m: any) => m?.constructor?.name).join(", ")}`);
});

test("shared-node identity morphs: world position travels old -> new layout", { skip: SKIP }, async () => {
  const oldD = await loadMermaid(FLOW_V1);
  const newD = await loadMermaid(FLOW_V2);
  const oldC = oldD.byId("C").getCenter();
  const newC = newD.byId("C").getCenter();
  // The layouts genuinely differ (v2 has an extra rank under C), so the
  // shared node has somewhere to travel.
  assert.ok(
    distance(oldC, newC) > 0.02,
    `C moved between layouts (old ${oldC.join(",")} vs new ${newC.join(",")})`,
  );

  const scene = silentScene();
  scene.add(oldD);
  const anim = diffDiagrams(oldD, newD, { runTime: 0.5 });
  await scene.play(anim);

  // The OLD diagram's C geometry was transformed in place onto the new
  // layout's position — identity morphed, not fade-swapped.
  const movedC = oldD.byId("C").getCenter();
  assert.ok(
    distance(movedC, newC) < 1e-3,
    `old C ended on new C's position (got ${movedC.join(",")}, want ${newC.join(",")})`,
  );
  assert.ok(
    distance(movedC, oldC) > 0.02,
    "old C actually left its original position",
  );
});

test("diff finish leaves newDiagram's parts at their own layout (clean final frame)", { skip: SKIP }, async () => {
  const oldD = await loadMermaid(FLOW_V1);
  const newD = await loadMermaid(FLOW_V2);
  // Snapshot newD's geometry before the play; the diff must not disturb it —
  // the scene's final frame IS newD.
  const before = newD.byId("E").getCenter();
  const scene = silentScene();
  scene.add(oldD);
  await scene.play(diffDiagrams(oldD, newD, { runTime: 0.5 }));
  const after = newD.byId("E").getCenter();
  assert.ok(distance(before, after) < 1e-9, "added node E sits untouched at its layout position");
  // And its faded-in leaves ended fully opaque.
  for (const leaf of newD.byId("E").submobjects as any[]) {
    assert.ok((leaf.strokeOpacity ?? 1) > 0.99 || (leaf.fillOpacity ?? 1) > 0.99,
      "faded-in leaf ended visible");
  }
});
