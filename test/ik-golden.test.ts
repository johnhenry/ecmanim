// Golden-frame test for an IK-driven limb (epic #61, #66). Vector geometry
// only. Regenerate (only for an intended visual change):
//   UPDATE_SNAPSHOTS=1 node --test test/ik-golden.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { Scene } from "../src/scene/Scene.ts";
import { Skeleton } from "../src/mobject/skeleton.ts";
import { IKChain } from "../src/mobject/ik.ts";
import { Dot } from "../src/mobject/geometry.ts";
import { captureFrames, matchSnapshot, loadNapiCanvas } from "./_snapshot_util.ts";

const canvasAvailable = await loadNapiCanvas().then((m) => !!m);

class IKScene extends Scene {
  async construct() {
    const D = Math.PI / 180;
    const fig = new Skeleton(
      [
        { id: "torso", parent: null, length: 1.4, angle: 90 * D, width: 8 },
        { id: "armL", parent: "torso", length: 1, angle: 140 * D },
        { id: "handL", parent: "armL", length: 1, angle: 20 * D },
        { id: "armR", parent: "torso", length: 1, angle: -140 * D },
        { id: "handR", parent: "armR", length: 1, angle: -20 * D },
      ],
      { color: "#58C4DD", root: [0, -1.2], joints: true },
    );
    const reachL: [number, number] = [-1.1, 1.0], reachR: [number, number] = [2.4, 1.6];
    new IKChain(fig, { bones: ["armL", "handL"], target: reachL, bendSide: "left" }).solve();
    // out of reach on the right: straight, stretched arm
    new IKChain(fig, { bones: ["armR", "handR"], target: reachR, bendSide: "right", allowStretch: true }).solve();
    this.add(fig, new Dot({ point: [reachL[0], reachL[1], 0], color: "#FC6255" }), new Dot({ point: [reachR[0], reachR[1], 0], color: "#FC6255" }));
    await this.wait(0.1);
  }
}

test("ik golden: two-bone reach + stretched reach", { skip: !canvasAvailable && "@napi-rs/canvas not available" }, async () => {
  const caps = await captureFrames(IKScene, [0]);
  const failure = await matchSnapshot("ik.reach", caps.get(0)!);
  assert.equal(failure, null, failure ?? undefined);
});
