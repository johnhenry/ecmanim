// Port of Motion Canvas docs: spawners (ref/spawners.tsx) — a `count`
// signal reactively spawns white circles in a row; tweening the signal
// 10 → 3 (wait) → 10 removes/re-adds nodes live. MC's `<Layout layout>`
// becomes a reactive() VGroup re-arranged as a touching row on each
// rebuild (arrange + recenter ≙ default flexbox row, gap 0).

import {
  Scene, Circle, VGroup, RIGHT, createSignal, reactive, tweenSignal,
} from "../../src/node.ts";
import { linear } from "../../src/animation/rate_functions.ts";
import { demoRender, pxLen } from "./_run.ts";

class Spawners extends Scene {
  async construct() {
    const count = createSignal(10);

    // range(count()) — MC's range truncates a fractional count (floor).
    this.add(
      reactive(() => {
        const circles = Array.from(
          { length: Math.max(0, Math.floor(count())) },
          () =>
            new Circle({
              radius: pxLen(32) / 2,
              fillColor: "white",
              fillOpacity: 1,
              strokeWidth: 0,
            }),
        );
        const row = new VGroup(circles);
        row.arrange(RIGHT, 0);
        if (circles.length) row.moveTo([0, 0, 0]);
        return row;
      }),
    );

    await this.play(tweenSignal(count, 3, 2, linear).wait(1).back(2));
  }
}

await demoRender(Spawners, import.meta.url);
