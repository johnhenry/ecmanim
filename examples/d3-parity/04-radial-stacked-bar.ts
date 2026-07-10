// Port of D3 gallery: Radial Stacked Bar Chart (ref/radial-stacked-bar-chart.js)
// — US state population by age group, stacked radially: scaleBand over [0, 2π]
// for states, scaleRadial (area-true) for population, arc per stack segment.
// Data: data-2.csv. Surpass: segments fade in sweeping around the circle.
// Divergence: arcShape's padAngle is a constant-angle approximation of d3's
// padRadius scaling.

import {
  Scene, Circle, Line, Rectangle, Text, VGroup, scaleBand, scaleRadial,
  scaleOrdinal, stack, max, format, arcShape, radialPoint, FadeIn, LaggedStart,
} from "../../src/node.ts";
import { demoRender, loadCsv, svgFrame } from "./_run.ts";

const data = loadCsv("data-2.csv") as Array<Record<string, any>>;
const columns = Object.keys(data[0]);
const ageKeys = columns.slice(1);
for (const d of data) d.total = ageKeys.reduce((s, k) => s + d[k], 0);

class RadialStackedBar extends Scene {
  async construct() {
    const width = 975, height = 975;
    const innerRadius = 180, outerRadius = Math.min(width, height) / 2;
    const f = svgFrame(width, height);
    // The ref's viewBox is centered on the origin; SVG-center coords -> world.
    const c = (sx: number, sy: number) => [f.len(sx), -f.len(sy), 0];

    const x = scaleBand(data.map((d) => d.State), [0, 2 * Math.PI]).align(0);
    const y = scaleRadial([0, max(data, (d) => d.total)], [innerRadius, outerRadius]);
    const z = scaleOrdinal(ageKeys, ["#98abc5", "#8a89a6", "#7b6888", "#6b486b", "#a05d56", "#d0743c", "#ff8c00"]);

    // Stacked arcs, grouped per state so the intro sweeps around the circle.
    const series = stack({ keys: ageKeys })(data);
    const stateGroups = data.map((d) => {
      const g = new VGroup();
      const a0 = x(d.State);
      for (const s of series) {
        const [d0, d1] = s[data.indexOf(d)];
        g.add(arcShape({
          innerRadius: f.len(y(d0)), outerRadius: f.len(y(d1)),
          startAngle: a0, endAngle: a0 + x.bandwidth(), padAngle: 0.01,
          fillColor: z(s.key), fillOpacity: 1, strokeWidth: 0,
        }));
      }
      return g;
    });

    // xAxis: per-state tick line at the inner radius + tangential label.
    const xAxis = new VGroup();
    for (const d of data) {
      const a = x(d.State) + x.bandwidth() / 2;
      xAxis.add(new Line({
        start: radialPoint(a, f.len(innerRadius)), end: radialPoint(a, f.len(innerRadius - 5)),
        strokeColor: "#000", strokeWidth: f.sw(1),
      }));
      const firstHalf = (a + Math.PI / 2) % (2 * Math.PI) < Math.PI;
      const label = new Text(d.State, { fontSize: f.len(10), color: "#000" });
      label.moveTo(radialPoint(a, f.len(innerRadius - (firstHalf ? 16 : 9))));
      label.rotate(firstHalf ? -a : Math.PI - a);
      xAxis.add(label);
    }

    // yAxis: tick circles + halo'd labels at 12 o'clock + title.
    const yAxis = new VGroup();
    const yTicks = y.ticks(5).slice(1);
    // NOTE: format(".0s") throws in the library (toPrecision(0) — d3 clamps
    // SI precision to >= 1); format("s") trims to the same "10M" strings.
    const fmt = format("s");
    for (const t of yTicks) {
      yAxis.add(new Circle({ radius: f.len(y(t)), strokeColor: "#000", strokeOpacity: 0.5, strokeWidth: f.sw(1), fillOpacity: 0 }));
      const halo = new Text(fmt(t), { fontSize: f.len(10), color: "#fff", strokeColor: "#fff", strokeWidth: f.sw(5) });
      const label = new Text(fmt(t), { fontSize: f.len(10), color: "#000" });
      halo.moveTo(c(0, -y(t)));
      label.moveTo(c(0, -y(t)));
      yAxis.add(halo, label);
    }
    const title = new Text("Population", { fontSize: f.len(10), color: "#000" });
    title.moveTo(c(0, -y(yTicks[yTicks.length - 1]) - 14));
    yAxis.add(title);

    // Legend: age keys reversed, centered column.
    const legend = new VGroup();
    ageKeys.slice().reverse().forEach((key, i) => {
      const rowY = (i - (columns.length - 1) / 2) * 20;
      const sw = new Rectangle({ width: f.len(18), height: f.len(18), fillColor: z(key), fillOpacity: 1, strokeWidth: 0 });
      sw.moveTo(c(-40 + 9, rowY + 9));
      const label = new Text(key, { fontSize: f.len(10), color: "#000" });
      label.moveTo(c(-40 + 24, rowY + 9));
      label.shift([label.getWidth() / 2, 0, 0]);
      legend.add(sw, label);
    });

    await this.play(new LaggedStart(stateGroups.map((g) => new FadeIn(g)), { lagRatio: 0.04, runTime: 2.5 }));
    await this.play(new FadeIn(new VGroup(xAxis, yAxis, legend), { runTime: 1 }));
    await this.wait(1.5);
  }
}

await demoRender(RadialStackedBar, import.meta.url);
