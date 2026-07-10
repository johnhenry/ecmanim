// Port of Motion Canvas docs: positioning (ref/composite-positioning.tsx) —
// parent-relative transforms and the absolute-transform helpers. MC's nested
// <Node position/rotation> parents become Groups; ecmanim is world-space, so
// the parent transform is applied to the family up front (rotate about the
// parent origin, then shift), and absolutePosition() is just getCenter().

import { Scene, Circle, Group, tweenTo } from "../../src/node.ts";
import { demoRender, px, pxLen } from "./_run.ts";

class Positioning extends Scene {
  async construct() {
    // <Node position={[200, 100]}><Circle position={[0, 100]} .../></Node>
    const circleA = new Circle({
      radius: pxLen(20) / 2,
      fillColor: "white",
      fillOpacity: 1,
      strokeWidth: 0,
    });
    circleA.moveTo(px(0, 100));
    const parentA = new Group(circleA);
    parentA.shift(px(200, 100));

    // <Node position={[-200, -100]} rotation={45}><Circle position={[100, 0]} .../></Node>
    const circleB = new Circle({
      radius: pxLen(40) / 2,
      fillColor: "#e13238",
      fillOpacity: 1,
      strokeWidth: 0,
    });
    circleB.moveTo(px(100, 0));
    const parentB = new Group(circleB);
    // MC rotation is degrees clockwise (y-down) -> radians CCW, negated;
    // a Node rotates its children about its own origin.
    parentB.rotate((-45 * Math.PI) / 180, { aboutPoint: [0, 0, 0] });
    parentB.shift(px(-200, -100));

    this.add(parentA, parentB);

    await this.wait(0.5);
    // World-space helper: match B's absolute position to A's.
    circleB.moveTo(circleA.getCenter());
    await this.wait(0.5);
    // Parent transform moves children with it: parent origin -> [0, -100]
    // puts child A (local [0, 100]) at world [0, 0].
    await this.play(tweenTo(parentA, { position: px(0, 0) }, 1));
    await this.wait(0.5);
  }
}

await demoRender(Positioning, import.meta.url);
