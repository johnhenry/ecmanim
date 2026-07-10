// only sees top-level counts, so holds would otherwise reuse stale frames.

import { Scene, Circle, Group, RIGHT, effect, createSignal, tweenTo, tweenSignal } from "../../src/node.ts";
import { demoRender, pxLen } from "./_run.ts";

class Effects extends Scene {
  async construct() {
    const scene = this;
    const count = createSignal(0);
    const container = new Group();
    container.addUpdater(() => container.arrange(RIGHT, 0));
    this.add(container);

    const circles: Circle[] = [];
    effect(() => {
      const targetCount = Math.round(count());
      let i = circles.length;
      // add any missing circles
      for (; i < targetCount; i++) {
        const circle = new Circle({
          radius: 1e-4,
          fillColor: "white",
          fillOpacity: 1,
          strokeWidth: 0,
        });
        circles.push(circle);
        container.add(circle);
        scene.spawn(function* () {
          yield tweenTo(circle, { width: pxLen(80), height: pxLen(80) }, 0.3);
        });
      }
      // remove any extra circles
      for (; i > targetCount; i--) {
        const circle = circles.pop()!;
        scene.spawn(function* () {
          yield tweenTo(circle, { width: 1e-4, height: 1e-4 }, 0.3);
          container.remove(circle);
        });
      }
    });

    count(1);
    await this.wait(1);
    count(6);
    await this.wait(1);
    count(4);
    await this.play(tweenSignal(count, 0, 2));
    await this.wait(1);
  }
}

await demoRender(Effects, import.meta.url);
