// Port of Motion Canvas docs: time events (ref/composite-time-events.tsx) —
// waitFor's hard-coded delay vs waitUntil's named, editor-adjustable event.
// The 'event' hold comes from SceneConfig.timeEvents (ecmanim's stand-in for
// the editor's draggable event track) — retimed to 2s here without touching
// construct(), exactly how MC's editor drag overrides the inline value.

import { Scene, Circle, tweenTo } from "../../src/node.ts";
import type { SceneConfig } from "../../src/scene/Scene.ts";
import { demoRender, px, pxLen } from "./_run.ts";

class TimeEvents extends Scene {
  constructor(config: SceneConfig = {}) {
    super({ ...config, timeEvents: { event: 2, ...config.timeEvents } });
  }

  async construct() {
    const circle = new Circle({
      radius: pxLen(120) / 2,
      fillColor: "#68abdf",
      fillOpacity: 1,
      strokeWidth: 0,
    });
    circle.moveTo(px(-300, 0));
    this.add(circle);

    await this.play(tweenTo(circle, { x: 0 }, 1)); // animationOne
    await this.wait(3.1415); // hard-coded delay
    await this.play(tweenTo(circle, { fill: "#e13238" }, 0.5)); // animationTwo

    await this.waitUntil("event", 1); // editor-adjustable event
    await this.play(tweenTo(circle, { x: px(300)[0] }, 1));
  }
}

await demoRender(TimeEvents, import.meta.url);
