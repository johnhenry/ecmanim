// Port of D3 gallery: Brushable scatterplot (ref/brushable-scatterplot.js) —
// 406 cars (1970-82), fuel efficiency (x, mpg) vs engine power (y, hp),
// steelblue stroke-only dots; N/A values pinned to the margins as the ref.
// REFRAME: the interactive d3.brush becomes camera direction — a brush
// rectangle is drawn over mpg 15-30 / hp 75-150, outside dots dim to gray
// (the ref's non-selection styling), the camera zooms into the selection,
// then pulls back out and the selection clears.

import {
  MovingCameraScene, AnimationGroup, Circle, Create, FadeIn, FadeOut,
  Rectangle, VGroup, scaleLinear, max,
} from "../../src/node.ts";
import { demoRender, loadCsv, svgFrame } from "./_run.ts";
import { axisLeft, axisBottom } from "./_axes.ts";

const data = loadCsv("cars-2.csv") as Array<{ Miles_per_Gallon: number | null; Horsepower: number | null }>;

class BrushableScatterplot extends MovingCameraScene {
  async construct() {
    const width = 928, height = 600;
    const marginTop = 20, marginRight = 30, marginBottom = 30, marginLeft = 40;
    const f = svgFrame(width, height);

    const x = scaleLinear([0, max(data, (d) => d.Miles_per_Gallon ?? 0)], [marginLeft, width - marginRight]).nice();
    const y = scaleLinear([0, max(data, (d) => d.Horsepower ?? 0)], [height - marginBottom, marginTop]).nice();
    const px = (d: (typeof data)[0]) => (d.Miles_per_Gallon == null ? marginLeft : x(d.Miles_per_Gallon));
    const py = (d: (typeof data)[0]) => (d.Horsepower == null ? height - marginBottom : y(d.Horsepower));

    const dots = new VGroup(...data.map((d) => new Circle({
      radius: f.len(3), strokeColor: "steelblue", strokeWidth: f.sw(1.5),
      fillOpacity: 0, point: f.pt(px(d), py(d)),
    })));

    this.add(
      axisBottom(x, height - marginBottom, f, { label: "Miles per Gallon", noDomain: true }),
      axisLeft(y, marginLeft, f, { label: "Horsepower" }),
    );
    await this.play(new FadeIn(dots), { runTime: 0.8 });
    await this.wait(0.5);

    // The "brush": selection rect over mpg 15-30, hp 75-150 (px space).
    const [sx0, sx1] = [x(15), x(30)];
    const [sy0, sy1] = [y(150), y(75)]; // y-down: y(150) above y(75)
    const brush = new Rectangle({
      width: f.len(sx1 - sx0), height: f.len(sy1 - sy0),
      strokeColor: "#555555", strokeWidth: f.sw(1),
      fillColor: "#777777", fillOpacity: 0.15,
      point: f.pt((sx0 + sx1) / 2, (sy0 + sy1) / 2),
    });
    const selected = (d: (typeof data)[0]) =>
      d.Miles_per_Gallon != null && d.Horsepower != null &&
      sx0 <= x(d.Miles_per_Gallon) && x(d.Miles_per_Gallon) < sx1 &&
      sy0 <= y(d.Horsepower) && y(d.Horsepower) < sy1;
    const outside = dots.submobjects.filter((_, i) => !selected(data[i]));

    await this.play(new Create(brush), { runTime: 0.7 });
    await this.play(new AnimationGroup(
      outside.map((m) => (m as any).animate.setStroke("gray").build()),
    ), { runTime: 0.6 });

    // Camera as brush: dive into the selection, hold, pull back out.
    this.defineCameraStop("selection", { center: brush.getCenter(), zoom: 2.1 });
    await this.goToCameraStop("selection", { runTime: 1.6 });
    await this.wait(1.2);
    await this.resetCamera({ runTime: 1.4 });

    // Clear the selection (ref: empty brush restores steelblue).
    await this.play(new AnimationGroup([
      ...outside.map((m) => (m as any).animate.setStroke("steelblue").build()),
      new FadeOut(brush),
    ]), { runTime: 0.6 });
    await this.wait(0.6);
  }
}

await demoRender(BrushableScatterplot, import.meta.url);
