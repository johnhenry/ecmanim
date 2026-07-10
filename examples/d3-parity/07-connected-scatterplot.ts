// Port of D3 gallery: Connected Scatterplot (ref/connected-scatterplot.js) —
// "Driving Shifts Into Reverse": miles driven vs gas price, one point per year.
// Data: driving.csv. Catmull-Rom spline through the points, white dots, year
// labels oriented per datum (d.side). Signature animation kept: the path draws
// on linearly over 5s while year labels fade in staggered by their distance
// along the path. Divergences: uniform Catmull-Rom (d3 uses alpha=0.5
// centripetal), no white text halo behind labels.

import {
  Scene, Spline, Circle, Text, VGroup, scaleLinear, extent, niceExtent,
  format, tweenTo, FadeIn, timeline, rate_functions,
} from "../../src/node.ts";
import { demoRender, loadCsv, svgFrame } from "./_run.ts";
import { axisLeft, axisBottom } from "./_axes.ts";

const driving = loadCsv("driving.csv") as Array<{ side: string; year: number; miles: number; gas: number }>;

class ConnectedScatterplot extends Scene {
  async construct() {
    const width = 928, height = 720;
    const marginTop = 20, marginRight = 20, marginBottom = 30, marginLeft = 30;
    const r = 3, inset = r * 2;
    const f = svgFrame(width, height);

    const x = scaleLinear(
      niceExtent(...extent(driving, (d) => d.miles), width / 80),
      [marginLeft + inset, width - marginRight - inset],
    );
    const y = scaleLinear(
      niceExtent(...extent(driving, (d) => d.gas), height / 50),
      [height - marginBottom - inset, marginTop + inset],
    );

    const P = driving.map((d) => [x(d.miles), y(d.gas)]);
    // Cumulative chord length: label stagger ~ distance along the path.
    const cum = [0];
    for (let i = 1; i < P.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    }
    const total = cum[cum.length - 1];

    const path = new Spline({
      points: P.map(([px, py]) => f.pt(px, py)),
      smoothness: 0.5, // uniform Catmull-Rom handles (≈ d3.curveCatmullRom)
      strokeColor: "#000000", strokeWidth: f.sw(2),
    });
    (path as any).strokeEnd = 0;

    const dots = new VGroup();
    for (const [px, py] of P) {
      const c = new Circle({
        radius: f.len(r), fillColor: "#ffffff", fillOpacity: 1,
        strokeColor: "#000000", strokeWidth: f.sw(2),
      });
      c.moveTo(f.pt(px, py));
      dots.add(c);
    }

    const fontSize = f.len(10);
    const labels = driving.map((d, i) => {
      const t = new Text(String(d.year), { fontSize, color: "#000000" });
      const [px, py] = P[i];
      switch (d.side) {
        case "top": t.moveTo(f.pt(px, py - 10)); break;
        case "bottom": t.moveTo(f.pt(px, py + 11)); break;
        case "left": t.moveTo(f.pt(px - 8, py)); t.shift([-t.getWidth() / 2, 0, 0]); break;
        default: t.moveTo(f.pt(px + 8, py)); t.shift([t.getWidth() / 2, 0, 0]); break;
      }
      return t;
    });

    this.add(
      axisBottom(x, height - marginBottom, f, {
        tickCount: Math.round(width / 80), gridY: [marginTop, height - marginBottom],
        noDomain: true, label: "Miles driven (per capita per year) →",
      }),
      axisLeft(y, marginLeft, f, {
        tickCount: Math.round(height / 50), format: format(".2f"),
        gridX: [marginLeft, width - marginRight],
        label: "↑ Price of gas (per gallon, adjusted average $)",
      }),
      dots, path,
    );

    const duration = 5;
    const tl = timeline();
    tl.add(tweenTo(path, { end: 1 }, duration, rate_functions.linear), 0);
    labels.forEach((t, i) => {
      tl.add(new FadeIn(t, { runTime: 0.25 }), (cum[i] / total) * (duration - 0.125));
    });
    await this.play(tl.build());
    await this.wait(1);
  }
}

await demoRender(ConnectedScatterplot, import.meta.url);
