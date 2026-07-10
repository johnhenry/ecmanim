// Port of Motion Canvas docs: tweening (ref/composite-tweening.tsx) —
// explicit tween() with map + easeInOutCubic, a chained property tween
// (.to().to()), and spring physics via springTween + PlopSpring.

import {
  Scene, Circle, tweenTo, tween, map, springTween, PlopSpring, rate_functions,
} from "../../src/node.ts";
import { demoRender, px, pxLen } from "./_run.ts";

const { easeInOutCubic } = rate_functions;

class Tweening extends Scene {
  async construct() {
    const circle = new Circle({
      radius: pxLen(140) / 2,
      fillColor: "#e13238",
      fillOpacity: 1,
      strokeWidth: 0,
    });
    circle.moveTo(px(-300, 0));
    this.add(circle);

    // Explicit tween + interpolation + easing.
    await this.play(
      tween(2, (value) => {
        circle.setX(map(px(-300)[0], px(300)[0], easeInOutCubic(value)));
      }),
    );

    // Property tween with chained .to().
    await this.play(
      tweenTo(circle, { y: px(0, -150)[1] }, 0.6)
        .to({ y: px(0, 150)[1] }, 0.6)
        .to({ y: 0 }, 0.6),
    );

    // Spring physics.
    await this.play(
      springTween(PlopSpring, 300, -300, 1, (value) => {
        circle.setX(px(value)[0]);
      }),
    );
    await this.wait(0.3);
  }
}

await demoRender(Tweening, import.meta.url);
