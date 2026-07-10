// Showcase parity: Electricity Maps — animated energy-flow maps.
// Proves: loadGeoJSON (Natural Earth 110m subset, public domain) with
// byName() choropleth coloring by carbon intensity, project()-anchored
// ArcBetweenPoints import/export flows, and a legend. (P4 + P1.)
//
// Data: examples/showcase-parity/assets/europe-subset.geojson — 16 countries
// extracted from Natural Earth ne_110m_admin_0_countries (public domain),
// overseas territories clipped to the European bbox.

import { readFileSync } from "node:fs";
import {
  Scene, Text, VGroup, Rectangle, Circle, ArcBetweenPoints, Create,
  FadeIn, FadeOut, Write, LaggedStart, loadGeoJSON, Color,
} from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const GEOJSON = readFileSync(new URL("./assets/europe-subset.geojson", import.meta.url), "utf8");

// gCO2eq/kWh (illustrative), colored low→high.
const INTENSITY: Record<string, number> = {
  Norway: 30, Sweden: 45, France: 85, Austria: 120, Denmark: 180,
  Switzerland: 90, Spain: 210, Portugal: 190, "United Kingdom": 240,
  Italy: 320, Ireland: 290, Belgium: 170, Netherlands: 330,
  Germany: 380, Czechia: 410, Poland: 620,
};
const LOW = Color.parse("#2ECC71");
const HIGH = Color.parse("#8E3B2F");
const colorFor = (v: number) => Color.lerp(LOW, HIGH, Math.min(1, v / 650));

class ElectricityMaps extends Scene {
  async construct() {
    const title = new Text("Live grid carbon intensity", { fontSize: 0.6, color: "#F5F6F8", point: [0, 3.4, 0] });
    await this.play(new Write(title), { runTime: 0.7 });

    const map = loadGeoJSON(GEOJSON, {
      height: 6.4, point: [-1.4, -0.3, 0],
      strokeColor: "#0E1116", strokeWidth: 1.5, fillOpacity: 1, color: "#3A4653",
    });
    this.add(map);
    await this.play(new FadeIn(map), { runTime: 0.8 });

    // Choropleth: recolor each country by intensity, staggered.
    const recolors = Object.entries(INTENSITY)
      .filter(([name]) => map.hasRegion(name))
      .map(([name, v]) => map.byName(name).animate.setColor(colorFor(v).toHex()).build());
    await this.play(new LaggedStart(recolors, { lagRatio: 0.06 }), { runTime: 2.0 });

    // Cross-border flows through the map's own projection.
    const flows = new VGroup(
      new ArcBetweenPoints(map.project([2.2, 48.8]), map.project([10.4, 51.1]), -0.7, undefined, { color: "#FFD700", strokeWidth: 5 }),   // FR -> DE
      new ArcBetweenPoints(map.project([8.5, 60.5]), map.project([9.5, 56.0]), 0.6, undefined, { color: "#FFD700", strokeWidth: 5 }),     // NO -> DK
      new ArcBetweenPoints(map.project([-3.7, 40.4]), map.project([2.2, 48.8]), 0.6, undefined, { color: "#FFD700", strokeWidth: 5 }),    // ES -> FR
    );
    await this.play(new LaggedStart(flows.submobjects.map((a) => new Create(a)), { lagRatio: 0.3 }), { runTime: 1.4 });
    // Endpoint markers on the exporting grids.
    const dots = new VGroup(
      ...[[8.5, 60.5], [2.2, 48.8], [-3.7, 40.4]].map(([lon, lat]) =>
        new Circle({ radius: 0.09, color: "#FFD700", fillOpacity: 1, strokeWidth: 0, point: map.project([lon, lat]) })),
    );
    await this.play(new FadeIn(dots), { runTime: 0.4 });

    // Legend.
    const legend = new VGroup();
    const steps = [30, 200, 400, 620];
    steps.forEach((v, i) => {
      legend.add(new Rectangle({ width: 0.5, height: 0.32, color: colorFor(v).toHex(), fillOpacity: 1, strokeWidth: 0, point: [4.6, 1.6 - i * 0.5, 0] }));
      legend.add(new Text(`${v}`, { fontSize: 0.26, color: "#9AA3AF", point: [5.5, 1.6 - i * 0.5, 0] }));
    });
    legend.add(new Text("gCO2/kWh", { fontSize: 0.26, color: "#9AA3AF", point: [4.9, 2.3, 0] }));
    await this.play(new FadeIn(legend), { runTime: 0.6 });

    await this.wait(1.4);
    await this.play(new FadeOut(map), new FadeOut(flows), new FadeOut(dots), new FadeOut(legend), new FadeOut(title), { runTime: 0.8 });
  }
}

await demoRender(ElectricityMaps, import.meta.url, { background: "#0E1116" });
