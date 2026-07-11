// Lottie parity demo 05: data/navidad.json — a 1920x1080 christmas scene
// (125 frames @ 25fps = 5s): the corpus's track-matte sample (tt alpha
// mattes) plus masks, solids, precomps and shape layers. attachTo plays it
// once through plus a 0.5s hold.

import { Scene, loadLottie } from "../../src/node.ts";
import { demoRender, loadAnimationJson } from "./_run.ts";

class Navidad extends Scene {
  async construct() {
    const mob = loadLottie(loadAnimationJson("navidad.json"), {
      width: 14,
      loop: false,
    });
    mob.attachTo(this);
    await this.wait(mob.duration + 0.5);
    console.log("warnings:", mob.warnings.length ? mob.warnings : "(none)");
  }
}

await demoRender(Navidad, import.meta.url);
