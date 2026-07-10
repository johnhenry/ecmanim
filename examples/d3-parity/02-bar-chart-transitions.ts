// Port of D3 gallery: Bar Chart Transitions (ref/bar-chart-transitions.js) —
// alphabet bars keyed by letter re-sort alphabetical ↔ frequency-descending,
// matching the ref's 750ms transition + i*20ms per-bar staggered delay (i =
// index in the NEW order). Data: alphabet.csv. Divergence: the interactive
// order dropdown becomes a timed sequence (alpha → desc → alpha).

import {
  Scene, Rectangle, Group, Line, Text, scaleBand, scaleLinear, max, format,
  ascending, descending, LaggedStart, GrowFromEdge, AnimationGroup, tweenTo,
  DOWN,
} from "../../src/node.ts";
import { demoRender, loadCsv, svgFrame } from "./_run.ts";
import { axisLeft } from "./_axes.ts";

const alphabet = loadCsv("alphabet.csv") as Array<{ letter: string; frequency: number }>;

class BarChartTransitions extends Scene {
  async construct() {
    const width = 928, height = 500;
    const marginTop = 20, marginRight = 0, marginBottom = 30, marginLeft = 40;
    const f = svgFrame(width, height);
    const y0 = height - marginBottom;

    const x = scaleBand(alphabet.map((d) => d.letter), [marginLeft, width - marginRight]).padding(0.1);
    const y = scaleLinear([0, max(alphabet, (d) => d.frequency)], [y0, marginTop]);

    // One group per letter: bar + x tick + letter label move together
    // (d3 transitions the bars AND the axis ticks with the same delays).
    const groups = new Map<string, Group>();
    const bars: Rectangle[] = [];
    for (const d of alphabet) {
      const cx = x(d.letter) + x.bandwidth() / 2;
      const yTop = y(d.frequency);
      const bar = new Rectangle({
        width: f.len(x.bandwidth()), height: f.len(y0 - yTop),
        fillColor: "#9642f6", fillOpacity: 1, strokeWidth: 0,
      });
      bar.moveTo(f.pt(cx, (yTop + y0) / 2));
      const tick = new Line({ start: f.pt(cx, y0), end: f.pt(cx, y0 + 6), strokeColor: "#000", strokeWidth: f.sw(1) });
      const label = new Text(d.letter, { fontSize: f.len(11), color: "#000" });
      label.moveTo(f.pt(cx, y0 + 16));
      bars.push(bar);
      groups.set(d.letter, new Group(bar, tick, label));
    }

    this.add(
      axisLeft(y, marginLeft, f, { format: format(".0%"), label: "↑ Frequency", gridX: [marginLeft, width - marginRight] }),
      new Line({ start: f.pt(marginLeft, y0), end: f.pt(width - marginRight, y0), strokeColor: "#000", strokeWidth: f.sw(1) }),
      ...[...groups.values()].flatMap((g) => g.submobjects.slice(1)), // ticks + labels
    );
    await this.play(new LaggedStart(bars.map((b) => new GrowFromEdge(b, DOWN)), { lagRatio: 0.05, runTime: 1.5 }));
    await this.wait(0.8);

    // d3's chart.update(d3.sort(alphabet, order)): re-domain x, then move
    // each letter's group to its new band with delay = 20ms * new index.
    // The _hashExtra tag works around a library bug: AnimationGroup doesn't
    // fold its children into the segment hash, so the two reorders collide
    // in the partial-movie cache and the second replays the first's clip.
    const reorder = (label: string, order: (a: any, b: any) => number) => {
      const sorted = [...alphabet].sort(order);
      x.domain(sorted.map((d) => d.letter));
      const chains = sorted.map((d, i) => {
        const cx = x(d.letter) + x.bandwidth() / 2;
        return tweenTo(groups.get(d.letter)!, {}, i * 0.02).to({ x: f.pt(cx, 0)[0] }, 0.75);
      });
      const group = new AnimationGroup(chains);
      (group as any)._hashExtra = () => `order:${label}`;
      return group;
    };

    await this.play(reorder("descending", (a, b) => descending(a.frequency, b.frequency)));
    await this.wait(0.8);
    await this.play(reorder("alphabetical", (a, b) => ascending(a.letter, b.letter)));
    await this.wait(1);
  }
}

await demoRender(BarChartTransitions, import.meta.url);
