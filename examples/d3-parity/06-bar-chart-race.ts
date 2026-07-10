// Port of D3 gallery: Bar Chart Race (ref/bar-chart-race.js) — top-12 global
// brand values 2000-2019, rank-interpolated keyframes (interpolateFrames k=5,
// vs the ref's 10, for render speed), keyed dataJoin per keyframe with bars
// entering/exiting at their prev/next ranks, tabular value labels, white
// axis gridlines and a bold year ticker. Data: category-brands.csv, color by
// category (schemeTableau10). Divergences: value labels step per keyframe
// (not per frame); off-chart ranks are hidden by a white mask (no SVG clip);
// the zero tick keeps no label (as the ref removes it).

import {
  Scene, Rectangle, Group, Line, Text, DecimalNumber, scaleLinear, scaleBand,
  scaleOrdinal, schemeTableau10, group as groupBy, ascending, rangeOf, pairs,
  utcFormat, dataJoin, interpolateFrames, rankFrame, tweenTo, AnimationGroup,
  rate_functions, format,
} from "../../src/node.ts";
import type { Animation } from "../../src/node.ts";
import { demoRender, loadCsv, svgFrame } from "./_run.ts";

const data = loadCsv("category-brands.csv") as Array<{ date: Date; name: string; category: string; value: number }>;
const linear = rate_functions.linear;

class BarChartRace extends Scene {
  async construct() {
    const width = 928, n = 12, barSize = 48, k = 5, dur = 0.2;
    const marginTop = 16, marginRight = 6, marginLeft = 0;
    const height = marginTop + barSize * n + 6;
    const f = svgFrame(width, height);

    // rollup by date -> Map(name -> value), then rank-interpolated keyframes.
    const datevalues = [...groupBy(data, (d) => +d.date)]
      .map(([date, rows]) => [date, new Map(rows.map((r) => [r.name, r.value]))] as [number, Map<string, number>])
      .sort(([a], [b]) => ascending(a, b));
    const rawFrames = pairs(datevalues).flatMap(([a, b]) => interpolateFrames(a, b, k));
    rawFrames.push(datevalues[datevalues.length - 1]);
    const frames = rawFrames.map(([t, m]) => ({ date: t, data: rankFrame(m, n).slice(0, n) }));

    const x = scaleLinear([0, 1], [marginLeft, width - marginRight]);
    const y = scaleBand(rangeOf(n + 1), [marginTop, marginTop + barSize * (n + 1 + 0.1)]).padding(0.1);
    const categoryByName = new Map(data.map((d) => [d.name, d.category]));
    const color = scaleOrdinal([...new Set(categoryByName.values())], schemeTableau10);
    const bw = y.bandwidth();
    const fmt = format(",d");

    type Datum = { key: string; value: number; rank: number };
    const geometry = (d: Datum) => ({
      cx: f.pt((x(0) + x(d.value)) / 2, 0)[0], w: f.len(Math.max(0.5, x(d.value) - x(0))),
      cy: f.pt(0, y(d.rank) + bw / 2)[1],
      nameAt: (nw: number) => [f.pt(x(d.value) - 6, y(d.rank) + bw / 2 - 7)[0] - nw / 2, f.pt(0, y(d.rank) + bw / 2 - 7)[1], 0],
      valueEdge: f.pt(x(d.value) - 6, y(d.rank) + bw / 2 + 7),
    });
    const makeBar = (d: Datum): Group => {
      const g = geometry(d);
      const rect = new Rectangle({ width: g.w, height: f.len(bw), fillColor: color(categoryByName.get(d.key)), fillOpacity: 0.6, strokeWidth: 0 });
      rect.moveTo([g.cx, g.cy, 0]);
      const name = new Text(d.key, { fontSize: f.len(12), weight: "bold", color: "#000" });
      name.moveTo(g.nameAt(name.getWidth()));
      const value = new DecimalNumber(d.value, { numDecimalPlaces: 0, fontSize: f.len(12), color: "#000", fillOpacity: 0.7, edgeToFix: [1, 0, 0] });
      value.moveTo(g.valueEdge, [1, 0, 0]);
      const bar = new Group(rect, name, value) as any;
      bar.__parts = { rect, name, value };
      return bar;
    };
    const placeBar = (mob: any, d: Datum) => {
      const g = geometry(d);
      const { rect, name, value } = mob.__parts;
      rect.moveTo([g.cx, g.cy, 0]); rect.stretch(g.w / rect.getWidth(), 0);
      name.moveTo(g.nameAt(name.getWidth()));
      value.moveTo(g.valueEdge, [1, 0, 0]);
    };
    const barTween = (mob: any, d: Datum): Animation => {
      const g = geometry(d);
      const { rect, name, value } = mob.__parts;
      value.setValue(d.value); // stepwise counter (per keyframe, not per frame)
      const vw = value.getWidth();
      return new AnimationGroup([
        tweenTo(rect, { x: g.cx, y: g.cy, width: g.w }, dur, linear),
        tweenTo(name, { position: g.nameAt(name.getWidth()) }, dur, linear),
        tweenTo(value, { position: [g.valueEdge[0] - vw / 2, g.valueEdge[1], 0] }, dur, linear),
      ]);
    };

    // Axis: white gridlines over the bars + labels above (kept as foreground).
    const axisLayer = new Group();
    // NOTE: y.padding() (getter form) is a library trap — ScaleBand.padding
    // has no getter overload and calling it with no args SETS padding=NaN,
    // corrupting the scale. Use the literal instead.
    const yTickBottom = marginTop + barSize * (n + 0.1);
    const tickMobs = new Map<number, Group>();
    const axisTweens = (): Animation[] => {
      const anims: Animation[] = [];
      const want = x.ticks(width / 160);
      for (const t of want) {
        const wx = f.pt(x(t), 0)[0];
        let g = tickMobs.get(t);
        if (!g) {
          g = new Group(new Line({ start: f.pt(x(t), marginTop), end: f.pt(x(t), yTickBottom), strokeColor: "#fff", strokeWidth: f.sw(1) }));
          if (t !== 0) {
            const label = new Text(fmt(t), { fontSize: f.len(10), color: "#000" });
            label.moveTo(f.pt(x(t), marginTop - 9));
            g.add(label);
          }
          (g as any).setOpacity?.(0) ?? g.submobjects.forEach((m: any) => m.setOpacity?.(0));
          tickMobs.set(t, g);
          axisLayer.add(g);
          anims.push(tweenTo(g, { opacity: 1 }, dur, linear));
        } else {
          anims.push(tweenTo(g, { x: wx, opacity: 1 }, dur, linear));
        }
      }
      for (const [t, g] of tickMobs) if (!want.includes(t)) anims.push(tweenTo(g, { opacity: 0 }, dur, linear));
      return anims;
    };

    // White mask standing in for the SVG viewport clip below the chart.
    const mask = new Rectangle({ width: f.len(width + 40), height: f.len(80), fillColor: "#fff", fillOpacity: 1, strokeWidth: 0 });
    mask.moveTo(f.pt(width / 2, height + 40));
    const ticker = new DecimalNumber(2000, { numDecimalPlaces: 0, groupWithCommas: false, fontSize: f.len(barSize), weight: "bold", color: "#000" });
    const tickerAt = f.pt(width - 6, marginTop + barSize * (n - 0.45));
    ticker.moveTo(tickerAt, [1, 0, 0]);
    this.addForegroundMobject(axisLayer, mask, ticker);

    // First keyframe: static join; then one 250ms-style transition per frame.
    x.domain([0, frames[0].data[0].value]);
    let join = dataJoin<Datum>([], frames[0].data, (d) => d.key, { make: makeBar });
    this.add(...join.mobs);
    for (const a of axisTweens()) { a.begin(); a.finish(); }
    await this.wait(0.5);

    const formatYear = utcFormat("%Y");
    for (let i = 1; i < frames.length; i++) {
      const frame = frames[i];
      x.domain([0, frame.data[0].value]);
      const prev = new Map((frames[i - 1]?.data ?? []).map((d) => [d.key, d]));
      const next = new Map((frames[i + 1]?.data ?? []).map((d) => [d.key, d]));
      ticker.setValue(+formatYear(new Date(frame.date)));
      ticker.moveTo(tickerAt, [1, 0, 0]);
      join = dataJoin<Datum>(join.mobs, frame.data, (d) => d.key, {
        make: makeBar,
        update: (mob, d) => barTween(mob, d),
        enterFrom: (mob, d) => placeBar(mob, prev.get(d.key) ?? d),
        exitTo: (mob) => {
          const key = (mob as any).__joinKey;
          const to = next.get(key);
          return to ? tweenTo(mob, { y: f.pt(0, y(to.rank) + bw / 2)[1] }, dur, linear) : undefined;
        },
        runTime: dur,
      });
      const byKey = new Map(frame.data.map((d) => [d.key, d]));
      const enterTweens = join.enter.map((mob) => barTween(mob, byKey.get((mob as any).__joinKey)!));
      await this.play(join.animation, ...enterTweens, ...axisTweens());
    }
    await this.wait(1.5);
  }
}

await demoRender(BarChartRace, import.meta.url, { fps: 20, disableCaching: true });
