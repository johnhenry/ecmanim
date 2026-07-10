// Port of D3 gallery: Choropleth (ref/choropleth.js) — unemployment rate by
// U.S. county, August 2016 (BLS). counties-albers-10m.json (pre-projected
// Albers TopoJSON) via feature() → loadGeoJSON(projection: "none"); county
// fills via scaleQuantize([1, 10], schemeBlues[9]); state borders from
// mesh(us, "states", (a, b) => a !== b) drawn as thin white lines.
// Surpass: fade-in, cached hold, then a slow camera drift over the southeast.
// Divergences: loadCsv autotypes FIPS ids to numbers, so ids are re-padded to
// 5-digit strings; counties are addressed by feature.id copied into
// properties (GeoMap regions key on a property, and county NAMES collide).

import {
  MovingCameraScene, Line, Rectangle, Text, VMobject, FadeIn,
  scaleQuantize, schemeBlues, feature, mesh, loadGeoJSON,
} from "../../src/node.ts";
import { demoRender, loadCsv, loadJson } from "./_run.ts";

const us = loadJson("counties-albers-10m.json");
const unemployment = loadCsv("unemployment-x.csv") as Array<{ id: number | string; rate: number }>;

// LIBRARY BUG workaround: loadGeoJSON stores polygon rings as RAW corner
// points (subpathStarts + bare vertices), but CanvasRenderer.tracePath reads
// VMobject.points as cubic bezier chains (anchor, h1, h2, anchor, ...), so
// two of every three vertices become curve HANDLES — counties render as
// rounded petals. Rebuild each ring as a straight-bezier chain.
function cornersToBezierChains(mob: VMobject): void {
  const rings = mob.getSubpaths();
  mob.points = [];
  mob.subpathStarts = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    mob.startNewPath(ring[0]);
    for (let i = 1; i < ring.length; i++) mob.addLineTo(ring[i]);
  }
}

class Choropleth extends MovingCameraScene {
  async construct() {
    const rateById = new Map(unemployment.map((d) => [String(d.id).padStart(5, "0"), d.rate]));
    const color = scaleQuantize([1, 10], schemeBlues[9]!);

    // Counties → GeoMap addressable by FIPS id (see header).
    const counties: any = feature(us, "counties");
    for (const f of counties.features) f.properties.fips = String(f.id);
    const map = loadGeoJSON(counties, {
      projection: "none", nameProperty: "fips",
      width: 11.5, height: 6.7, point: [0, -0.55, 0],
      fillColor: "#ccc", fillOpacity: 1, strokeWidth: 0,
      simplifyTolerance: 0.005,
    });
    for (const [fips, region] of map.regions) {
      const rate = rateById.get(fips);
      const fill = rate != null ? color(rate) : "#ccc";
      for (const mob of region.submobjects) {
        cornersToBezierChains(mob as VMobject);
        (mob as VMobject).setFill(fill, 1);
      }
    }

    // Internal state borders: one white subpath per mesh arc, mapped through
    // the SAME fit transform as the counties (identity proj passes px pairs).
    const borders = new VMobject({ strokeColor: "#ffffff", strokeWidth: 1.4, fillOpacity: 0 });
    for (const line of mesh(us, "states", (a, b) => a !== b).coordinates) {
      borders.startNewPath(map.project(line[0] as [number, number]));
      for (let i = 1; i < line.length; i++) borders.addLineTo(map.project(line[i] as [number, number]));
    }

    // Quantize legend: 9 swatches, boundary labels at 2..9 (%).
    const legend = new VMobject();
    const swatches = color.range();
    const sw = 0.44, sh = 0.22, x0 = 1.0, ly = 3.55;
    const legendMobs: any[] = [];
    swatches.forEach((c, i) => {
      legendMobs.push(new Rectangle({
        width: sw, height: sh, fillColor: c, fillOpacity: 1, strokeWidth: 0,
        point: [x0 + (i + 0.5) * sw, ly, 0],
      }));
    });
    for (let i = 1; i < swatches.length; i++) {
      const [v] = color.invertExtent(swatches[i]);
      legendMobs.push(new Line({
        start: [x0 + i * sw, ly - sh / 2, 0], end: [x0 + i * sw, ly - sh / 2 - 0.08, 0],
        strokeColor: "#000000", strokeWidth: 1,
      }));
      const t = new Text(String(Math.round(v)), { fontSize: 0.16, color: "#000000" });
      t.moveTo([x0 + i * sw, ly - sh / 2 - 0.22, 0]);
      legendMobs.push(t);
    }
    const title = new Text("Unemployment rate (%)", { fontSize: 0.2, color: "#000000" });
    title.moveTo([x0 - 0.3 - title.getWidth() / 2, ly, 0]);
    legend.add(...legendMobs, title);

    this.add(map, borders, legend);
    await this.play(new FadeIn(map), new FadeIn(borders), new FadeIn(legend), { runTime: 1 });

    // Hold with the static-subtree cache on (camera + geometry unchanged).
    for (const m of map.getFamily()) if ((m as any).points?.length) m.cacheStatic();
    await this.wait(2);
    for (const m of map.getFamily()) if ((m as any).points?.length) m.cacheStatic(false);

    // Slow drift toward the southeast (the ref is static; this is the video's
    // "surpass" beat — county texture reads at full resolution).
    this.defineCameraStop("southeast", { center: [1.4, -1.4, 0], zoom: 1.35 });
    await this.goToCameraStop("southeast", { runTime: 3 });
    await this.wait(0.5);
  }
}

await demoRender(Choropleth, import.meta.url);
