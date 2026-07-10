// Showcase parity: the watercolor journey map (À la Fabrique carto style).
// Proves: GeoMap + the Cluster-A effects pass (per-region noise + blur +
// frame vignette/grain) for a stylized painterly look, and an fbm-wobbled
// hand-drawn route trace (P2 noise) between cities. Acceptance bar:
// "stylized painterly", not photoreal watercolor.

import { readFileSync } from "node:fs";
import {
  Scene, Camera, Text, VMobject, VGroup, Circle, Create, FadeIn, FadeOut, Write,
  loadGeoJSON, simplex2D, fbm,
} from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const GEOJSON = readFileSync(new URL("./assets/europe-subset.geojson", import.meta.url), "utf8");

// Wash palette per country (uneven, like pigment pooling).
const WASH: Record<string, string> = {
  France: "#7FA8C9", Spain: "#D9A066", Portugal: "#C97F5E", Italy: "#9DBF7E",
  Germany: "#B9A0C9", Switzerland: "#8FBFB0", Austria: "#C9B27F", Belgium: "#C98FA0",
  Netherlands: "#E0B75E", "United Kingdom": "#A0AEC9", Ireland: "#7EBF8E",
  Denmark: "#C9877F", Norway: "#8EA8BF", Sweden: "#A8BF8E", Poland: "#BF8E7E", Czechia: "#BFA88E",
};

class WatercolorMap extends Scene {
  async construct() {
    const title = new Text("Un été en Europe", { fontSize: 0.72, color: "#4A3B2F", point: [0, 3.35, 0] });

    const map = loadGeoJSON(GEOJSON, {
      height: 6.6, point: [-0.8, -0.35, 0],
      strokeColor: "#5A4A3A", strokeWidth: 2, fillOpacity: 0.85, color: "#C9B79C",
      simplifyTolerance: 0.02,
    });
    // The painterly pass: per-region pigment wash + soft blur + grain.
    for (const [name, wash] of Object.entries(WASH)) {
      if (!map.hasRegion(name)) continue;
      const region = map.byName(name);
      region.setColor(wash);
      region.blur(3).noise(0.35, { monochrome: true, seed: name.length }); // seeded per country
    }

    await this.play(new Write(title), { runTime: 0.9 });
    await this.play(new FadeIn(map), { runTime: 1.2 });

    // The journey: Paris -> Zurich -> Rome, wobbled by fbm like a pen line.
    const stops: Array<[number, number]> = [[2.35, 48.85], [8.54, 47.37], [12.5, 41.9]];
    const anchors = stops.map((lonLat) => map.project(lonLat));
    const noise = fbm(simplex2D(7), { octaves: 3 });
    const route = new VMobject({ color: "#8E3B2F", strokeWidth: 5, fillOpacity: 0 });
    const pts: number[][] = [];
    for (let leg = 0; leg < anchors.length - 1; leg++) {
      const [ax, ay] = anchors[leg];
      const [bx, by] = anchors[leg + 1];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        // Perpendicular wobble, fading at the endpoints.
        const w = 0.16 * Math.sin(Math.PI * t) * noise(x * 1.7, y * 1.7 + leg * 10);
        const nx = -(by - ay), ny = bx - ax;
        const len = Math.hypot(nx, ny) || 1;
        pts.push([x + (nx / len) * w, y + (ny / len) * w, 0]);
      }
    }
    route.setPointsAsCorners(pts);
    const cities = new VGroup(...anchors.map(([x, y]) =>
      new Circle({ radius: 0.1, color: "#8E3B2F", fillOpacity: 1, strokeWidth: 0, point: [x, y, 0] })));
    await this.play(new FadeIn(cities), { runTime: 0.4 });
    await this.play(new Create(route), { runTime: 2.2 });

    const legend = new Text("Paris — Zurich — Rome", { fontSize: 0.4, color: "#5A4A3A", point: [3.4, -3.3, 0] });
    await this.play(new FadeIn(legend), { runTime: 0.5 });
    await this.wait(1.4);
    await this.play(new FadeOut(map), new FadeOut(route), new FadeOut(cities), new FadeOut(title), new FadeOut(legend), { runTime: 0.9 });
  }
}

// Paper-toned frame grading: vignette + grain sell the print look.
await demoRender(WatercolorMap, import.meta.url, {
  background: "#EFE6D5",
  // A Camera instance keeps its own background; set it explicitly.
  camera: new Camera({
    background: "#EFE6D5",
    frameEffects: [
      { type: "vignette", strength: 0.3, color: "#6B5B45" },
      { type: "noise", amount: 0.05, monochrome: true, seed: 4 },
    ],
  }) as any,
});
