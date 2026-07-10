// Port of D3 gallery: Parallel coordinates (ref/parallel-coordinates.js) —
// 7 numeric dimensions of ~400 cars, one horizontal axis per dimension
// (scalePoint rows), polylines per car colored by weight (lb) through
// interpolateBrBG reversed, stroke-opacity 0.4, drawn in ascending weight
// order. Data: cars.csv. Surpass: lines draw on with a heavy lagged stagger
// (the ref is static). Divergence: no white halo behind axis titles.

import {
  Scene, PolyLine, Text, scaleLinear, scalePoint, scaleSequential,
  extent, ascending, lineGen, interpolateBrBG, LaggedStart, tweenTo,
} from "../../src/node.ts";
import { demoRender, loadCsv, svgFrame } from "./_run.ts";
import { axisBottom } from "./_axes.ts";

const data = loadCsv("cars.csv") as Array<Record<string, any>>;
// data.columns.slice(1) in the ref (loadCsv has no .columns).
const keys = ["economy (mpg)", "cylinders", "displacement (cc)", "power (hp)", "weight (lb)", "0-60 mph (s)", "year"];
const keyz = "weight (lb)";

class ParallelCoordinates extends Scene {
  async construct() {
    const width = 928, height = keys.length * 120;
    const marginTop = 20, marginRight = 10, marginBottom = 20, marginLeft = 10;
    const f = svgFrame(width, height);

    const x = new Map(keys.map((key) => [
      key,
      scaleLinear(extent(data, (d) => d[key]), [marginLeft, width - marginRight]),
    ]));
    const y = scalePoint(keys, [marginTop, height - marginBottom]);
    const color = scaleSequential(
      x.get(keyz)!.domain() as [number, number],
      (t) => interpolateBrBG(1 - t),
    );

    // One polyline per car (split where a value is missing), ascending keyz.
    const line = lineGen<[string, any]>({
      defined: ([, value]) => value != null,
      x: ([key, value]) => x.get(key)!(value),
      y: ([key]) => y(key),
    });
    const lines: PolyLine[] = [];
    for (const d of [...data].sort((a, b) => ascending(a[keyz], b[keyz]))) {
      for (const seg of line(keys.map((key) => [key, d[key]]))) {
        const l = new PolyLine({
          points: seg.map(([px, py]) => f.pt(px, py)),
          strokeColor: color(d[keyz]), strokeWidth: f.sw(1.5), strokeOpacity: 0.4,
        });
        (l as any).strokeEnd = 0; // draw-on target
        lines.push(l);
      }
    }
    // Lines first, axes after: the ref appends axes above the polylines.
    this.add(...lines);

    for (const key of keys) {
      this.add(axisBottom(x.get(key)!, y(key), f));
      const title = new Text(key, { fontSize: f.len(11), color: "#000000" });
      title.moveTo(f.pt(marginLeft, y(key) - 9));
      title.shift([title.getWidth() / 2, 0, 0]);
      this.add(title);
    }

    await this.play(new LaggedStart(
      lines.map((l) => tweenTo(l, { end: 1 }, 1)),
      { lagRatio: 0.01, runTime: 6 },
    ));
    await this.wait(1);
  }
}

await demoRender(ParallelCoordinates, import.meta.url);
