// Lottie parity demo 02: data/gatin.json — an 800x800 shape animation
// (80 frames @ 25fps = 3.2s): groups, nulls, solids and heavily keyframed
// shape layers. attachTo plays it once through plus a 0.5s hold.
//
// Expected warnings: none (census: group, null, shape, solid — all FULL).

import { Scene, loadLottie } from "../../src/node.ts";
import { demoRender, loadAnimationJson } from "./_run.ts";

class Gatin extends Scene {
  async construct() {
    const mob = loadLottie(loadAnimationJson("gatin.json"), {
      height: 7.5,
      loop: false,
    });
    mob.attachTo(this);
    await this.wait(mob.duration + 0.5);
    console.log("warnings:", mob.warnings.length ? mob.warnings : "(none)");
  }
}

await demoRender(Gatin, import.meta.url);
