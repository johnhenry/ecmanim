// Port of Motion Canvas docs: signals (ref/composite-signals.tsx) — a
// circle whose diameter and a text readout are both driven by one signal:
// createSignal + computed area, reactive() as the property-function binding,
// and tweenSignal as the `yield* radius(v, dur)` signal tween.

import { Scene, Circle, Text, createSignal, computed, reactive, tweenSignal } from "../../src/node.ts";
import { demoRender, px, pxLen } from "./_run.ts";

class Signals extends Scene {
  async construct() {
    const radius = createSignal(1);
    const area = computed(() => Math.PI * radius() * radius());

    this.add(
      reactive(() =>
        new Circle({
          radius: (radius() * pxLen(200)) / 2,
          fillColor: "#e13238",
          fillOpacity: 1,
          strokeWidth: 0,
        }).moveTo(px(-200, 0)),
      ),
    );
    this.add(
      reactive(
        () =>
          new Text(`area: ${area().toFixed(2)}`, {
            fontSize: pxLen(48),
            color: "#f8f8f8",
            point: px(250, 0),
          }),
      ),
    );

    await this.wait(0.5);
    // tween the signal: every dependent property follows.
    await this.play(tweenSignal(radius, 2, 1.5));
    await this.play(tweenSignal(radius, 0.5, 1));
    await this.play(tweenSignal(radius, 1, 1));
  }
}

await demoRender(Signals, import.meta.url);
