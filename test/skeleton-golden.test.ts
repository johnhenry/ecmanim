// Golden-frame test for a posed Skeleton (epic #61, #64). Vector geometry only
// (no text), so the golden is stable across machines. Regenerate (only for an
// intended visual change): UPDATE_SNAPSHOTS=1 node --test test/skeleton-golden.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { Scene } from "../src/scene/Scene.ts";
import { Skeleton } from "../src/mobject/skeleton.ts";
import { PoseTween } from "../src/animation/pose.ts";
import { captureFrames, matchSnapshot, loadNapiCanvas } from "./_snapshot_util.ts";

const canvasAvailable = await loadNapiCanvas().then((m) => !!m);

function figure(): Skeleton {
  const D = Math.PI / 180;
  return new Skeleton(
    [
      { id: "torso", parent: null, length: 1.4, angle: 90 * D, width: 8 },
      { id: "neck", parent: "torso", length: 0.35, angle: 0, width: 6 },
      { id: "armL", parent: "torso", length: 0.9, angle: 140 * D, bend: 0.5 },
      { id: "handL", parent: "armL", length: 0.8, angle: 20 * D },
      { id: "armR", parent: "torso", length: 0.9, angle: -140 * D },
      { id: "handR", parent: "armR", length: 0.8, angle: -20 * D, zIndex: -1 },
      { id: "legL", parent: null, length: 1.2, angle: -110 * D },
      { id: "footL", parent: "legL", length: 1, angle: 40 * D },
      { id: "legR", parent: null, length: 1.2, angle: -70 * D },
      { id: "footR", parent: "legR", length: 1, angle: -40 * D },
    ],
    {
      color: "#58C4DD",
      root: [0, -0.2],
      joints: true,
      heads: [{ joint: "neck", radius: 0.3, fillColor: "#FFFF00", fillOpacity: 0.5, color: "#FFFF00" }],
      fills: [{ joints: ["root", "armL", "armR"], color: "#FC6255", opacity: 0.4 }],
    },
  );
}

class PosedScene extends Scene {
  async construct() {
    const s = figure();
    this.add(s);
    await this.play(new PoseTween(s, { bones: { armL: { angle: 60 * Math.PI / 180 }, armR: { angle: -60 * Math.PI / 180 }, legL: { angle: -95 * Math.PI / 180 } } }, { runTime: 1, rateFunc: (t: number) => t }), { _playConfig: true, runTime: 1 });
  }
}

for (const [label, frame] of [["start", 0], ["mid", 7], ["end", 14]] as const) {
  test(`skeleton golden: ${label}`, { skip: !canvasAvailable && "@napi-rs/canvas not available" }, async () => {
    const caps = await captureFrames(PosedScene, [frame]);
    const failure = await matchSnapshot(`skeleton.${label}`, caps.get(frame)!);
    assert.equal(failure, null, failure ?? undefined);
  });
}
