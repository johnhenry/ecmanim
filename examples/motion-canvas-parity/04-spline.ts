// Port of Motion Canvas docs: Spline node (ref/spline-1.tsx + spline-2.tsx
// + spline-3.tsx) — the default smooth spline through points, the animated
// `smoothness` tween, and the closed Knot-handle blob that pulses its
// scale, as sequential sections. Knot handles map to {position,
// startHandle, endHandle} entries; MC mirrors a missing handle, so the
// mirrored one is written out explicitly here.

import { Scene, Spline, tweenTo, tween, map, rate_functions } from "../../src/node.ts";
const { smooth } = rate_functions;
import { demoRender, px } from "./_run.ts";

class SplineNodes extends Scene {
  async construct() {
    // --- ref/spline-2.tsx: smooth spline through points (static) ---
    const SPLINE_POINTS = [
      px(-300, 0),
      px(-150, -100),
      px(150, 100),
      px(300, 0),
    ];
    const spline = new Spline({
      strokeWidth: 6,
      strokeColor: "lightseagreen",
      points: SPLINE_POINTS,
    });
    this.add(spline);
    await this.wait(1);
    this.remove(spline);

    // --- ref/spline-3.tsx: animated smoothness ---
    const spline3 = new Spline({
      strokeWidth: 6,
      strokeColor: "lightseagreen",
      smoothness: 0.4,
      points: SPLINE_POINTS,
    });
    this.add(spline3);

    // smoothness bakes the geometry at construction, so the tween rebuilds
    // the points each frame (spline().smoothness(0, 1).to(1, 1).to(0.4, 1)).
    // One 3s tween with piecewise smooth-eased legs instead of three 1s
    // tween() plays: identical-duration tween() calls hash to the same
    // partial-movie segment, so the cache would replay leg 1 three times.
    const setSmoothness = (s: number) => {
      spline3.points = new Spline({ points: SPLINE_POINTS, smoothness: s }).points;
    };
    await this.play(
      tween(3, (t) => {
        const u = t * 3;
        if (u < 1) setSmoothness(map(0.4, 0, smooth(u)));
        else if (u < 2) setSmoothness(map(0, 1, smooth(u - 1)));
        else setSmoothness(map(1, 0.4, smooth(u - 2)));
      }),
    );
    this.remove(spline3);

    // --- ref/spline-1.tsx: closed spline from Knots, filled ---
    const blob = new Spline({
      strokeWidth: 0, // MC: lineWidth={4} but no stroke color
      fillColor: "#e13238",
      fillOpacity: 1,
      closed: true,
      points: [
        { position: px(-120, -30), startHandle: px(0, 70), endHandle: px(0, -70) },
        { position: px(0, -50), startHandle: px(-40, -60), endHandle: px(40, -60) },
        { position: px(120, -30), startHandle: px(0, -70), endHandle: px(0, 70) },
        { position: px(0, 100), startHandle: px(5, 0), endHandle: px(-5, 0) },
      ],
    });
    this.add(blob);

    await this.play(tweenTo(blob, { scale: 0.9 }, 0.6).to({ scale: 1 }, 0.4));
  }
}

await demoRender(SplineNodes, import.meta.url);
