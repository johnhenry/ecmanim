// Port of Motion Canvas docs: Bézier node snippets (ref/bezier-2.tsx +
// ref/bezier-3.tsx) — the two static curves, the draw-in/draw-out `end`
// tween, and the Rect that rides a cubic curve (getPointAtPercentage ->
// pointFromProportion / tangentAtProportion), as sequential sections.

import {
  Scene, CubicBezier, QuadBezier, Square,
  tweenTo, tweenSignal, createSignal, computed,
} from "../../src/node.ts";
import { demoRender, px, pxLen } from "./_run.ts";

class BezierAdvanced extends Scene {
  async construct() {
    // --- ref/bezier-2.tsx snippet: Cubic Bézier (static) ---
    const bezier = new CubicBezier({
      strokeWidth: 6,
      strokeColor: "lightseagreen",
      p0: px(-200, -70),
      p1: px(120, -120),
      p2: px(-120, 120),
      p3: px(200, 70),
    });
    this.add(bezier);
    await this.wait(1);
    this.remove(bezier);

    // --- ref/bezier-2.tsx snippet: Quadratic Bézier (static) ---
    const quad = new QuadBezier({
      strokeWidth: 6,
      strokeColor: "lightseagreen",
      p0: px(-150, 50),
      p1: px(0, -120),
      p2: px(150, 50),
    });
    this.add(quad);
    await this.wait(1);
    this.remove(quad);

    // --- ref/bezier-3.tsx snippet: Drawing Bézier curves ---
    const drawn = new CubicBezier({
      strokeWidth: 6,
      strokeColor: "lightseagreen",
      p0: px(-200, -70),
      p1: px(120, -120),
      p2: px(-120, 120),
      p3: px(200, 70),
    });
    (drawn as any).strokeEnd = 0; // end={0}
    this.add(drawn);

    await this.play(tweenTo(drawn, { end: 1 }, 2).to({ end: 0 }, 2));
    this.remove(drawn);

    // --- ref/bezier-3.tsx snippet: Moving nodes along a curve ---
    const track = new CubicBezier({
      strokeWidth: 6,
      strokeColor: "lightgray",
      p0: px(-300, -70),
      p1: px(120, -120),
      p2: px(-120, 120),
      p3: px(300, 70),
    });

    const progress = createSignal(0);
    const curvePoint = computed(() => ({
      position: track.pointFromProportion(progress()),
      tangent: track.tangentAtProportion(progress()),
    }));

    const rect = new Square({
      sideLength: pxLen(25),
      fillColor: "lightseagreen",
      fillOpacity: 1,
      strokeWidth: 0,
    });
    // position={() => curvePoint().position}
    // rotation={() => curvePoint().tangent.degrees}
    let applied = 0; // rotate() is incremental; track the applied angle.
    rect.addUpdater(() => {
      const { position, tangent } = curvePoint();
      rect.moveTo(position);
      const angle = Math.atan2(tangent[1], tangent[0]);
      rect.rotate(angle - applied);
      applied = angle;
    });
    rect.update(0);
    this.add(track, rect);

    // progress(1, 2); waitFor(0.5); progress(0, 2); waitFor(0.5) — one
    // chain, not four plays: signal TweenChains hash identically (empty
    // placeholder mobject), so separate plays would replay the 1st segment.
    // Chained .to on a signal needs the {value} State shape (raw values
    // spread to {} and hold — suspected tweenSignal chain bug).
    await this.play(
      tweenSignal(progress, 1, 2).wait(0.5).to({ value: 0 } as any, 2).wait(0.5),
    );
  }
}

await demoRender(BezierAdvanced, import.meta.url);
