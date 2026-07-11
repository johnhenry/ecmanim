// Lottie parity demo 01: data/bodymovin.json — the lottie-web wordmark
// (1820x275, 103 frames @ 30fps ≈ 3.4s). Exercises trim paths (the letters
// draw on as animated strokes), precomps, masks and nulls. attachTo drives
// playback for the full duration plus a 0.5s hold on the final pose.
//
// Expected warnings (documented): merge paths (mm) unsupported.

import { Scene, loadLottie } from "../../src/node.ts";
import { demoRender, loadAnimationJson } from "./_run.ts";

class BodymovinWordmark extends Scene {
  async construct() {
    const mob = loadLottie(loadAnimationJson("bodymovin.json"), {
      width: 12,
      loop: false,
    });
    mob.attachTo(this);
    await this.wait(mob.duration + 0.5);
    console.log("warnings:", mob.warnings.length ? mob.warnings : "(none)");
  }
}

// The artwork is yellow letters on a green banner (self-contained) — a light
// neutral background frames it without fighting the palette.
await demoRender(BodymovinWordmark, import.meta.url, { background: "#f4f1ea" });
