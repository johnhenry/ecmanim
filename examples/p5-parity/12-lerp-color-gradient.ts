// p5.js parity demo 12: ref/12-lerp-color-gradient.js — "Color
// Interpolation": `lerpColor()` swept across 12 horizontal stripes fading
// from a top color to a bottom color, with "Color A"/"Color B" end-cap
// labels (p5.js gallery, LGPL).
//
// Proves Color.lerp (src/core/color.ts) driving a discrete stripe sweep --
// the same stop count (12) and top/bottom colors as the ref (translated
// from p5's HSB(360,100,100) space to sRGB hex: hue 100/sat 90/bri 100 ->
// a light yellow-green, hue 250/sat 80/bri 20 -> a dark blue-violet) -- plus
// a slow continuous animation of the interpolation fraction so the sweep is
// visibly a *gradient in motion*, not just a static frame.

import { Scene, Rectangle, Text, VGroup, Color } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const COLOR_A = new Color(0.75, 0.95, 0.35); // light yellow-green (~HSB 100,90,100)
const COLOR_B = new Color(0.16, 0.06, 0.28); // dark blue-violet (~HSB 250,80,20)

class LerpColorGradient extends Scene {
  async construct() {
    const stripeCount = 12;
    const totalWidth = 11;
    const totalHeight = 6.5;
    const stripeHeight = totalHeight / stripeCount;

    const stripes = new VGroup();
    const rects: Rectangle[] = [];
    for (let i = 0; i < stripeCount; i++) {
      const rect = new Rectangle({
        width: totalWidth,
        height: stripeHeight,
        strokeWidth: 0,
        fillOpacity: 1,
      });
      rect.moveTo([0, totalHeight / 2 - stripeHeight * (i + 0.5), 0]);
      rects.push(rect);
      stripes.add(rect);
    }
    this.add(stripes);

    const labelA = new Text("Color A", { fontSize: 0.32, color: "#000000" });
    labelA.moveTo([-totalWidth / 2 + 1.1, totalHeight / 2 - stripeHeight / 2, 0]);
    const labelB = new Text("Color B", { fontSize: 0.32, color: "#ffffff" });
    labelB.moveTo([-totalWidth / 2 + 1.1, -totalHeight / 2 + stripeHeight / 2, 0]);
    this.add(labelA, labelB);

    // Sweep the interpolation fraction back and forth over time so every
    // stripe's color continuously slides between A and B (a moving gradient,
    // not a static one), driven purely by scene time.
    const period = 5;
    let time = 0;
    stripes.addUpdater((_m: any, dt: number) => {
      time += dt;
      const phase = (Math.sin((time / period) * Math.PI * 2) + 1) / 2; // 0..1..0
      for (let i = 0; i < stripeCount; i++) {
        const base = stripeCount <= 1 ? 0 : i / (stripeCount - 1);
        const t = Math.min(1, Math.max(0, base + (phase - 0.5) * 0.6));
        rects[i].fillColor = Color.lerp(COLOR_A, COLOR_B, t);
      }
    });

    await this.wait(6);
  }
}

await demoRender(LerpColorGradient, import.meta.url);
