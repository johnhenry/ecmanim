// Port of D3 gallery: Hexbin (ref/hexbin.js) — 53,940 diamonds binned into a
// hexagonal lattice of carat (x, log) vs price (y, log), radius 8px; bins
// filled by scaleSequential(interpolateBuPu) over [0, maxCount / 2] (as the
// ref). Log axes label only 1/2/5-mantissa ticks (d3's sparse log labeling);
// no domain lines (the ref removes them).
// Surpass: hexes pop in sparse-to-dense (count order) with a lagged grow.

import {
  Scene, Polygon, GrowFromCenter, LaggedStart,
  scaleLog, scaleSequential, interpolateBuPu, extent, max,
  hexbin, hexagonPoints,
} from "../../src/node.ts";
import { demoRender, loadCsv, svgFrame } from "./_run.ts";
import { axisLeft, axisBottom } from "./_axes.ts";

const data = loadCsv("diamonds.csv") as Array<{ carat: number; price: number }>;

// Label only 1/2/5-mantissa log ticks; "" draws the tick mark unlabeled.
function logLabel(fmt: (v: number) => string): (v: number) => string {
  return (v) => {
    const mant = Math.round((v / Math.pow(10, Math.floor(Math.log10(v) + 1e-9))) * 1e6) / 1e6;
    return mant === 1 || mant === 2 || mant === 5 ? fmt(v) : "";
  };
}

class Hexbin extends Scene {
  async construct() {
    const width = 928, height = 928;
    const marginTop = 20, marginRight = 20, marginBottom = 30, marginLeft = 40;
    const f = svgFrame(width, height);

    const x = scaleLog(extent(data, (d) => d.carat), [marginLeft, width - marginRight]);
    const y = scaleLog(extent(data, (d) => d.price), [height - marginBottom, marginTop]);

    const bins = hexbin<{ carat: number; price: number }>({
      x: (d) => x(d.carat), y: (d) => y(d.price), radius: 8,
    }).bin(data);
    const color = scaleSequential([0, max(bins, (b) => b.length) / 2], interpolateBuPu);
    const corners = hexagonPoints(8);

    const hexes = bins.map((bin) => new Polygon(
      corners.map(([hx, hy]) => f.pt(bin.x + hx, bin.y + hy)),
      { fillColor: color(bin.length), fillOpacity: 1, strokeColor: "#000000", strokeWidth: f.sw(0.5) },
    ));

    this.add(
      axisBottom(x, height - marginBottom, f, { label: "Carats", noDomain: true, format: logLabel(String) }),
      axisLeft(y, marginLeft, f, {
        label: "$ Price",
        format: logLabel((v) => (v >= 1000 ? `${v / 1000}k` : String(v))),
      }),
    );

    // Pop in sparse → dense: the diagonal density ridge assembles last.
    const order = bins.map((b, i) => i).sort((a, b) => bins[a].length - bins[b].length);
    await this.play(new LaggedStart(
      order.map((i) => new GrowFromCenter(hexes[i])),
      { lagRatio: 0.0015, runTime: 4 },
    ));
    await this.wait(1.5);
  }
}

await demoRender(Hexbin, import.meta.url);
