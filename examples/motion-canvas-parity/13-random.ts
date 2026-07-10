// Port of Motion Canvas docs: random values (ref/composite-random.tsx) —
// useRandom(123) reproducible RNG scattering ten blue circles with random
// position and size. Deterministic: same seed → same layout, every run
// (RNG call order preserved: nextInt for size, then nextFloat x, y).

import { Scene, Circle, useRandom } from "../../src/node.ts";
import { demoRender, px, pxLen } from "./_run.ts";

class RandomScene extends Scene {
  async construct() {
    const random = useRandom(123);

    for (let i = 0; i < 10; i++) {
      const integer = random.nextInt(0, 10);
      const circle = new Circle({
        radius: pxLen(20 + integer * 8) / 2,
        fillColor: "#68abdf",
        fillOpacity: 1,
        strokeWidth: 0,
      });
      circle.moveTo(px(random.nextFloat(-500, 500), random.nextFloat(-250, 250)));
      circle.setOpacity(0.8);
      this.add(circle);
    }
    await this.wait(1);
  }
}

await demoRender(RandomScene, import.meta.url);
