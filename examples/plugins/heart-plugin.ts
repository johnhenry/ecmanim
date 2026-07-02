// A sample ecmanim plugin. Import it and `use()` it (Node or browser) to add a
// Heart mobject, a custom animation, a rate function, and a brand color.
//   import { use } from "ecmanim";
//   import heartPlugin from "./heart-plugin.ts";
//   use(heartPlugin);
import type { Plugin, Registry } from "../../src/plugins/registry.ts";

const heartPlugin: Plugin = {
  name: "ecmanim-heart",
  version: "1.0.0",
  install(api: Registry) {
    const { VMobject } = api.bases;
    const { Animation } = api.bases;

    // A heart curve as a filled VMobject.
    class Heart extends VMobject {
      constructor(config: any = {}) {
        super({ fillColor: "#D147BD", fillOpacity: 1, ...config });
        const pts: number[][] = [];
        for (let i = 0; i <= 64; i++) {
          const t = (i / 64) * Math.PI * 2;
          const x = 16 * Math.sin(t) ** 3;
          const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
          pts.push([x / 16, y / 16, 0]);
        }
        this.setPointsAsCorners(pts);
      }
    }

    // A little "heartbeat" pulse animation (scale up-and-back twice).
    class Heartbeat extends Animation {
      interpolateMobject(alpha: number) {
        const s = 1 + 0.15 * Math.abs(Math.sin(alpha * Math.PI * 2));
        const c = (this as any).startState.getCenter();
        const start = (this as any).startState;
        for (let i = 0; i < this.mobject.points.length; i++) {
          const p = start.points[i];
          this.mobject.points[i] = [
            c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s, p[2],
          ];
        }
      }
    }

    api.registerMobject("Heart", Heart);
    api.registerAnimation("Heartbeat", Heartbeat);
    api.registerRateFunction("thump", (t) => 0.5 - 0.5 * Math.cos(t * Math.PI * 2));
    api.registerColor("brandPink", "#D147BD");
  },
};

export default heartPlugin;
