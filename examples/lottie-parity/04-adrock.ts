// Lottie parity demo 04: data/adrock.json — a 690x913 portrait animation
// (392 frames @ 30fps ≈ 13.1s): masks, solids, precomps, nulls and shape
// layers. Played at 2x via the LottieConfig `speed` multiplier so the full
// animation fits in ≈6.5s of video (+0.5s hold) — noted divergence from
// real-time playback, purely a demo-length choice.

import { Scene, loadLottie } from "../../src/node.ts";
import { demoRender, loadAnimationJson } from "./_run.ts";

class Adrock extends Scene {
  async construct() {
    const mob = loadLottie(loadAnimationJson("adrock.json"), {
      height: 7.5,
      speed: 2, // 13.1s of animation → 6.5s of video
      loop: false,
    });
    mob.attachTo(this);
    await this.wait(mob.duration / 2 + 0.5);
    console.log("warnings:", mob.warnings.length ? mob.warnings : "(none)");
  }
}

await demoRender(Adrock, import.meta.url, { background: "#1a1a22" });
