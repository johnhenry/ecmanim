// Lottie parity demo 03: data/happy2016.json — a 1920x1080 new-year card
// (99 frames @ 30fps = 3.3s). Precomp-heavy: 2 root layers referencing
// nested comps with masks, nulls and shape layers. attachTo plays it once
// through plus a 0.5s hold.

import { Scene, loadLottie } from "../../src/node.ts";
import { demoRender, loadAnimationJson } from "./_run.ts";

class Happy2016 extends Scene {
  async construct() {
    const mob = loadLottie(loadAnimationJson("happy2016.json"), {
      width: 14,
      loop: false,
    });
    mob.attachTo(this);
    await this.wait(mob.duration + 0.5);
    console.log("warnings:", mob.warnings.length ? mob.warnings : "(none)");
  }
}

await demoRender(Happy2016, import.meta.url);
