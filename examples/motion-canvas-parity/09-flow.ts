// Port of Motion Canvas docs: animation flow (ref/flow-1.tsx + flow-2.tsx +
// flow-3.tsx) — bare `yield` frame-stepping (inline, then via a generator
// helper), then all(...) running five rects' y-tweens in parallel. flow-1/2
// share one circle here (their setups are identical fresh scenes in MC).

import { Scene, Circle, RoundedRectangle, tweenTo } from "../../src/node.ts";
import { demoRender, px, pxLen } from "./_run.ts";

// flow-2's flicker() helper: each bare `yield` (one frame) becomes
// `await scene.nextFrame()`.
async function flicker(scene: Scene, circle: Circle): Promise<void> {
  circle.setFill("red");
  await scene.nextFrame();
  circle.setFill("blue");
  await scene.nextFrame();
  circle.setFill("red");
  await scene.nextFrame();
}

class Flow extends Scene {
  async construct() {
    // --- flow-1: inline frame-by-frame fill changes ---
    const circle = new Circle({
      radius: pxLen(100) / 2,
      fillOpacity: 1,
      strokeWidth: 0,
    });
    this.add(circle);

    circle.setFill("red");
    await this.nextFrame();
    circle.setFill("blue");
    await this.nextFrame();
    circle.setFill("red");
    await this.nextFrame();

    // --- flow-2: the same flicker extracted into a helper "generator" ---
    await flicker(this, circle);
    this.remove(circle);

    // --- flow-3: all(...) animating five rects in parallel ---
    const rects: RoundedRectangle[] = [];

    // Create some rects
    for (let i = 0; i < 5; i++) {
      const rect = new RoundedRectangle({
        width: pxLen(100),
        height: pxLen(100),
        cornerRadius: pxLen(10),
        fillColor: "#88C0D0",
        fillOpacity: 1,
        strokeWidth: 0,
      });
      rect.moveTo(px(-250 + 125 * i, 0));
      rects.push(rect);
    }
    this.add(rects);

    await this.wait(1);

    // Animate them
    await this.play(
      ...rects.map((rect) =>
        tweenTo(rect, { y: px(0, 100)[1] }, 1)
          .to({ y: px(0, -100)[1] }, 2)
          .to({ y: 0 }, 1),
      ),
    );
  }
}

await demoRender(Flow, import.meta.url);
