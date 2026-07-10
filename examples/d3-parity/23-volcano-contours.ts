// Port of D3 gallery: Volcano Contours (ref/volcano-contours.js) — the
// topography of Maungawhau (R's classic `volcano` 87x61 elevation grid),
// filled isobands from contours().contour at ~20 nice thresholds, colored by
// scaleSequential(interpolateTerrain) over the niced elevation extent.
// Holes (the crater) are extra subpaths, filled evenodd by the renderer.
// Surpass: bands rise in threshold order (lagged fade, slight upward drift)
// like a growing relief map (the ref draws them in a static loop).

import {
  Scene, VGroup, VMobject, FadeIn, LaggedStart,
  scaleSequential, interpolateTerrain, contours, contourThresholds,
  extent, niceExtent,
} from "../../src/node.ts";
import { demoRender, loadJson, svgFrame } from "./_run.ts";

const data = loadJson("volcano.json") as { width: number; height: number; values: number[] };

class VolcanoContours extends Scene {
  async construct() {
    const { width, height, values } = data;
    const f = svgFrame(width, height);

    // color = scaleSequential(interpolateTerrain).domain(extent(values)).nice()
    const [min, max] = extent(values) as [number, number];
    const color = scaleSequential(niceExtent(min, max, 10), interpolateTerrain);
    const gen = contours({ size: [width, height] });
    const thresholds = contourThresholds(values, 20); // = color.ticks(20) clipped to data

    // One band per threshold: everything >= t, painted in ascending order so
    // higher terrain stacks on top. Rings are closed (first === last), so
    // addLineTo through the duplicate point also closes the white stroke.
    const bands = thresholds.map((t) => {
      const band = new VGroup();
      for (const polygon of gen.contour(values, t).coordinates) {
        const mob = new VMobject({
          fillColor: color(t), fillOpacity: 1,
          strokeColor: "#ffffff", strokeWidth: f.sw(0.03),
        });
        for (const ring of polygon) {
          mob.startNewPath(f.pt(ring[0][0], ring[0][1]));
          for (let i = 1; i < ring.length; i++) mob.addLineTo(f.pt(ring[i][0], ring[i][1]));
        }
        band.add(mob);
      }
      return band;
    });

    await this.play(new LaggedStart(
      bands.map((b) => new FadeIn(b, { shift: [0, 0.08, 0] })),
      { lagRatio: 0.1, runTime: 5 },
    ));
    await this.wait(1.5);
  }
}

await demoRender(VolcanoContours, import.meta.url);
