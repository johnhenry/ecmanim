// Showcase parity: FluidMotion — ambient generative flow-field visuals.
// Proves: simplex-fbm flow fields (P2) advecting a family of flowing curves
// via alwaysRedraw-style updaters, a drifting ParticleSystem (P6), and a
// palette cycle — all deterministic, loopable by sampling noise on a time
// torus (t -> (cos, sin) circle through the 3D field).

import {
  Scene, VMobject, VGroup, Text, FadeIn, FadeOut,
  simplex3D, fbm3, ParticleSystem, Color,
} from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const LOOP_SECONDS = 8;
const field = fbm3(simplex3D(11), { octaves: 3 });
// Time torus: noise sampled along a circle in the 3rd dimension loops
// EXACTLY every LOOP_SECONDS — frame 0 and the last frame are identical.
const torus = (x: number, y: number, t: number) => {
  const a = (t / LOOP_SECONDS) * Math.PI * 2;
  return field(x * 0.55 + Math.cos(a) * 0.8, y * 0.55 + Math.sin(a) * 0.8, 0);
};

const PALETTE = ["#58C4DD", "#9A72AC", "#FC6255", "#F0AC5F"].map((c) => Color.parse(c));

class FluidMotion extends Scene {
  async construct() {
    const curves: VMobject[] = [];
    const N_CURVES = 14;
    for (let c = 0; c < N_CURVES; c++) {
      const mob = new VMobject({ strokeWidth: 4, fillOpacity: 0 });
      mob.strokeOpacity = 0.85;
      curves.push(mob);
      this.add(mob);
    }

    // Each frame, rebuild every curve from the flow field at the scene clock.
    const rebuild = () => {
      const t = this.time % LOOP_SECONDS;
      curves.forEach((mob, c) => {
        const y0 = -3.2 + (6.4 * c) / (N_CURVES - 1);
        const pts: number[][] = [];
        for (let i = 0; i <= 110; i++) {
          const x = -7 + (14 * i) / 110;
          const y = y0 + 1.15 * torus(x, y0, t);
          pts.push([x, y, 0]);
        }
        mob.setPointsAsCorners(pts);
        // Palette cycle: hue drifts with the loop clock + row.
        const phase = (t / LOOP_SECONDS + c / N_CURVES) % 1;
        const seg = phase * PALETTE.length;
        const lo = Math.floor(seg) % PALETTE.length;
        const hi = (lo + 1) % PALETTE.length;
        const col = Color.lerp(PALETTE[lo], PALETTE[hi], seg - lo);
        mob.strokeColor = col;
        (mob as any)._color = col;
      });
    };
    rebuild();
    curves[0].addUpdater(() => rebuild());

    // Drifting motes riding the same visual field.
    const motes = new ParticleSystem({
      rate: 14, lifetime: [3, 6], speed: [0.25, 0.7], direction: 0, spread: Math.PI * 2,
      emitterPoint: [0, 0, 0], emitterRadius: 5.5,
      size: [0.09, 0.02], particleOpacity: [0.9, 0], colorRamp: ["#FFFFFF", "#58C4DD"],
      seed: 3, drag: 0.2,
    });
    this.add(motes);

    const wordmark = new Text("fluidmotion", { fontSize: 0.5, color: "#F5F6F8", point: [0, -3.5, 0] });
    wordmark.setOpacity(0.7);
    await this.play(new FadeIn(wordmark), { runTime: 0.8 });
    await this.wait(LOOP_SECONDS);
    await this.play(new FadeOut(wordmark), { runTime: 0.6 });
  }
}

await demoRender(FluidMotion, import.meta.url, { background: "#0C0E14" });
