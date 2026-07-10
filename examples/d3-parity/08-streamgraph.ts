// Port of D3 gallery: Streamgraph (ref/streamgraph.js) — unemployed persons
// by industry, 2000-2010 (BLS). Data: unemployment.csv. stack with
// order=insideOut + offset=wiggle, bands filled with schemeTableau10 (cycled
// across 14 industries, as d3 does), scaleUtc x axis with domain removed.
// Surpass: designed intro — bands rise from below and fade in with a lagged
// stagger, drawn inside-out order (the ref is static).

import {
  Scene, Polygon, Text, scaleUtc, scaleLinear, scaleOrdinal, extent,
  stack, areaGen, schemeTableau10, LaggedStart, FadeIn,
} from "../../src/node.ts";
import { demoRender, loadCsv, svgFrame } from "./_run.ts";
import { axisBottom } from "./_axes.ts";

const unemployment = loadCsv("unemployment.csv") as Array<{ date: Date; industry: string; unemployed: number }>;

class Streamgraph extends Scene {
  async construct() {
    const width = 928, height = 600;
    const marginTop = 20, marginRight = 30, marginBottom = 30, marginLeft = 20;
    const f = svgFrame(width, height);

    // Pivot long rows -> one wide row per date (keys = industries in first-
    // appearance order, the ref's InternSet z-domain).
    const keys: string[] = [];
    const byDate = new Map<number, Record<string, any>>();
    for (const d of unemployment) {
      if (!keys.includes(d.industry)) keys.push(d.industry);
      let row = byDate.get(+d.date);
      if (!row) byDate.set(+d.date, (row = { date: d.date }));
      row[d.industry] = d.unemployed;
    }
    const rows = [...byDate.values()].sort((a, b) => +a.date - +b.date);

    const series = stack({ keys, order: "insideOut", offset: "wiggle" })(rows);

    const x = scaleUtc(extent(rows, (d) => +d.date), [marginLeft, width - marginRight]);
    const y = scaleLinear(
      extent(series.flat(2) as unknown as number[]),
      [height - marginBottom, marginTop],
    );
    const color = scaleOrdinal(keys, schemeTableau10);

    const area = areaGen<[number, number]>({
      x: (_d, i) => x(+rows[i].date),
      y0: ([y0]) => y(y0),
      y1: ([, y1]) => y(y1),
    });

    const bands = series.map((s) => {
      const ring = area(s as unknown as Array<[number, number]>)[0];
      return new Polygon(
        ring.map(([px, py]) => f.pt(px, py)),
        // Hairline same-color stroke seals antialiasing seams between bands.
        { fillColor: color(s.key), fillOpacity: 1, strokeColor: color(s.key), strokeWidth: f.sw(1) },
      );
    });

    this.add(axisBottom(x, height - marginBottom, f, {
      tickCount: Math.round(width / 80), format: x.tickFormat(), noDomain: true,
    }));
    const yLabel = new Text("↑ Unemployed persons", { fontSize: f.len(10), color: "#000000" });
    yLabel.moveTo(f.pt(0, 10));
    yLabel.shift([yLabel.getWidth() / 2, 0, 0]);
    this.add(yLabel);

    await this.play(new LaggedStart(
      bands.map((b) => new FadeIn(b, { shift: [0, f.len(40), 0] })),
      { lagRatio: 0.12, runTime: 3 },
    ));
    await this.wait(1);
  }
}

await demoRender(Streamgraph, import.meta.url);
