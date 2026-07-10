// Port of Motion Canvas docs: Camera (ref/camera-1.tsx + camera-2.tsx +
// camera-3.tsx) — a rect + circle pair; the camera centers on the rect while
// rotating 180° and zooming 1.8x, pans to the circle, resets; then (camera-3
// layout) the camera position steps between three points. Divergence note:
// the parallel centerOn+rotation+zoom (and the reset out of a 180° roll) use
// one combined `tween` on the camera frame instead of stacked ApplyMethods —
// point-lerped 180° rotations degenerate (the frame collapses mid-way).

import { MovingCameraScene, Rectangle, Circle, tween, map, rate_functions } from "../../src/node.ts";
import { demoRender, px, pxLen } from "./_run.ts";

class CameraScene extends MovingCameraScene {
  async construct() {
    // --- ref/camera-1.tsx ---
    const rect = new Rectangle({
      width: pxLen(100),
      height: pxLen(100),
      fillColor: "lightseagreen",
      fillOpacity: 1,
      strokeWidth: 0,
    });
    rect.moveTo(px(100, -50));
    const circle = new Circle({
      radius: pxLen(120) / 2,
      fillColor: "hotpink",
      fillOpacity: 1,
      strokeWidth: 0,
    });
    circle.moveTo(px(-100, 50));
    this.add(rect, circle);

    // Camera state applier: rebuild the frame from its rest geometry each
    // tick so center/zoom/roll compose exactly (see header divergence note).
    const frame = this.getFrame();
    const rest = frame.copy();
    const setFrame = (center: number[], zoom: number, roll: number) => {
      frame.become(rest);
      frame.scale(1 / zoom);
      if (roll !== 0) frame.rotate(roll);
      frame.moveTo(center);
    };

    // yield* all(
    //   camera().centerOn(rect(), 3),
    //   camera().rotation(180, 3),
    //   camera().zoom(1.8, 3),
    // );
    const rc = rect.getCenter();
    await this.play(tween(3, (t) => setFrame(
      [map(0, rc[0], t), map(0, rc[1], t), 0],
      map(1, 1.8, t),
      map(0, -Math.PI, t), // MC 180° (y-down, CW) -> radians CCW: negate
    ), rate_functions.easeInOutCubic));

    // yield* camera().centerOn(circle(), 2);
    await this.centerOn(circle, { runTime: 2 });

    // yield* camera().reset(1);
    const cc = circle.getCenter();
    await this.play(tween(1, (t) => setFrame(
      [map(cc[0], 0, t), map(cc[1], 0, t), 0],
      map(1.8, 1, t),
      map(-Math.PI, 0, t),
    ), rate_functions.easeInOutCubic));

    // --- ref/camera-2.tsx + camera-3.tsx (same nodes; 3 does the moves) ---
    this.remove(rect, circle);
    const rect2 = new Rectangle({
      width: pxLen(100),
      height: pxLen(100),
      fillColor: "lightseagreen",
      fillOpacity: 1,
      strokeWidth: 0,
    });
    rect2.moveTo(px(-100, -30));
    const circle2 = new Circle({
      radius: pxLen(80) / 2,
      fillColor: "hotpink",
      fillOpacity: 1,
      strokeWidth: 0,
    });
    circle2.moveTo(px(100, 30));
    this.add(rect2, circle2);

    // yield* camera().position([-100, -30], 1);
    await this.centerOn(px(-100, -30), { runTime: 1 });
    // yield* camera().position([100, -30], 1);
    await this.centerOn(px(100, -30), { runTime: 1 });
    // yield* camera().position(0, 1);
    await this.centerOn(px(0, 0), { runTime: 1 });
  }
}

await demoRender(CameraScene, import.meta.url);
