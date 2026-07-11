// p5.js parity demo 10: ref/10-softbody-spring.js — a 5-node "soft body"
// polygon that springs (damped Hooke's-law acceleration) toward a chase
// target, its vertices also wobbling with independent per-node phases for an
// organic, jelly-like silhouette (Processing/p5's classic "Soft Body"
// example, p5.js gallery, LGPL). The ref drives the chase target with live
// mouse input, which isn't reproducible here; this port substitutes a
// SCRIPTED deterministic target path -- a point orbiting a circle -- so the
// same springy chase/overshoot/settle character is visible without relying
// on non-deterministic input.
//
// Proves SoftBody / SoftBodySimulation (src/mobject/soft_body.ts, this
// campaign's gap-fill): every node independently Hooke's-law springs toward
// a caller-supplied target via `.step(dt, target)`, called here once per
// frame from an updater with a target computed purely from scene time (no
// Math.random(), no wall-clock reads -- see soft_body.ts's determinism
// contract).

import { Scene, SoftBody } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

class SoftbodySpring extends Scene {
  async construct() {
    // TUNING NOTE (see soft_body.ts's own tuning comment for the library
    // default's context): the library default (springing=0.12, damping=0.98)
    // is tuned for a roughly-stationary/slow target; against a continuously
    // ORBITING target near this system's resonant frequency it produces a
    // large, bounded-but-off-frame resonant swing (not a numerical bug --
    // the underlying per-node recurrence's eigenvalue magnitude is exactly
    // sqrt(damping) < 1 regardless of springing, so it's provably BIBO
    // stable, just a big oscillation that can swing past the visible frame).
    // springing=0.03 / damping=0.97 keeps the chase visibly springy while
    // staying well within frame at this orbit's radius/period.
    //
    // SEPARATE FINDING worth flagging upstream (not a bug in THIS demo, a
    // structural property of SoftBodySimulation.step()): because every node
    // is driven by the exact SAME `target` each call, the DIFFERENCE between
    // any two nodes' (pos, vel) evolves by a target-INDEPENDENT homogeneous
    // recurrence (the shared target term cancels out pairwise in the Hooke's-
    // law subtraction), whose decay rate is exactly sqrt(damping) per step
    // -- independent of springing and of how the target moves. So the
    // polygon's spread (its visible "blob" shape) provably decays toward a
    // single point given long enough elapsed time, for ANY parameters. A
    // high damping close to 1 (like 0.97 here) merely slows that decay to
    // something visible across a several-second clip; it can't stop it.
    // Consumers wanting a persistent (non-collapsing) blob shape over long
    // runtimes would need per-node distinct targets/forcing or true
    // inter-node coupling springs, neither of which this API exposes.
    const body = new SoftBody({
      nodeCount: 5,
      radius: 1.2,
      seed: 3,
      initialJitter: 0.6,
      springing: 0.03,
      damping: 0.97,
      fillColor: "#FFC857",
      fillOpacity: 0.6,
      strokeColor: "#FFC857",
      strokeWidth: 4,
    });
    this.add(body);

    // Deterministic chase target: a point orbiting a circle around the
    // origin, one full loop every `period` seconds of scene time.
    const R = 3.0;
    const period = 6;
    let time = 0;
    body.addUpdater((_m: any, dt: number) => {
      time += dt;
      const theta = (time / period) * Math.PI * 2;
      const target: [number, number] = [Math.cos(theta) * R, Math.sin(theta) * R];
      body.step(dt, target);
    });

    await this.wait(6); // one full orbit: captures the springy chase/overshoot transient clearly
  }
}

await demoRender(SoftbodySpring, import.meta.url);
