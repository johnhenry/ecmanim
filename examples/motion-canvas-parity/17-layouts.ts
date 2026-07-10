// Port of Motion Canvas docs: layouts, cardinal-directions example
// (ref/layouts.tsx) — a grey rect rocking between ±10°, a yellow square
// reactively glued right-edge-to-left-edge (sharing the rect's rotation) and
// a red square glued bottomLeft-to-bottomRight. MC's reactive anchor
// bindings become an applyTheta() driver re-placing the followers each frame.

import { Scene, Rectangle, tween, map, rate_functions } from "../../src/node.ts";
import { demoRender, pxLen } from "./_run.ts";

const { easeInOutCubic } = rate_functions;
// MC rotation is degrees clockwise (y-down) -> ecmanim radians CCW, negated.
const rad = (deg: number) => (-deg * Math.PI) / 180;
const rot2 = (x: number, y: number, a: number): number[] =>
  [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), 0];

class Layouts extends Scene {
  async construct() {
    const W = pxLen(200), H = pxLen(100);
    const rect = new Rectangle({ width: W, height: H, fillColor: "#333333", fillOpacity: 1, strokeWidth: 0 });
    const rect2 = new Rectangle({ width: pxLen(50), height: pxLen(50), fillColor: "#e6a700", fillOpacity: 1, strokeWidth: 0 });
    const rect3 = new Rectangle({ width: pxLen(100), height: pxLen(100), fillColor: "#e13238", fillOpacity: 1, strokeWidth: 0 });
    rect3.rotate(rad(10)); // rotation={10}

    // rect's rotated cardinal anchor: center + local offset rotated by theta.
    let theta = 0;
    let rect2Theta = 0;
    const anchor = (dx: number, dy: number): number[] => {
      const c = rect.getCenter();
      const o = rot2(dx, dy, theta);
      return [c[0] + o[0], c[1] + o[1], 0];
    };
    const applyTheta = (a: number) => {
      rect.rotate(a - theta);
      theta = a;
      // rotation={rect().rotation}
      rect2.rotate(theta - rect2Theta);
      rect2Theta = theta;
      // right={rect().left} — rect2's rotated right-edge midpoint on rect's left.
      const left = anchor(-W / 2, 0);
      const r2 = rot2(pxLen(50) / 2, 0, rect2Theta);
      rect2.moveTo([left[0] - r2[0], left[1] - r2[1], 0]);
      // bottomLeft={rect().bottomRight}
      const br = anchor(W / 2, -H / 2);
      const r3 = rot2(-pxLen(100) / 2, -pxLen(100) / 2, rad(10));
      rect3.moveTo([br[0] - r3[0], br[1] - r3[1], 0]);
    };
    applyTheta(rad(-10)); // rotation={-10} initial state

    this.add(rect, rect2, rect3);

    // yield* rect().rotation(10, 1).to(-10, 1);
    await this.play(tween(1, (t) => applyTheta(map(rad(-10), rad(10), t)), easeInOutCubic));
    await this.play(tween(1, (t) => applyTheta(map(rad(10), rad(-10), t)), easeInOutCubic));
  }
}

await demoRender(Layouts, import.meta.url);
