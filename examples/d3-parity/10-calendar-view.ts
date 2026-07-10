// Port of D3 gallery: Calendar View (ref/calendar-view.js) — daily relative
// change of the Dow Jones Industrial Average (DJI-2.csv, Yahoo Finance),
// weekday×week cells colored by a diverging PiYG scale symmetric around 0
// (bounds = d3.quantile(|change|, 0.9975), computed over ALL years).
// Monday-based 7-day weeks (the ref Calendar default), month boundaries in
// white, month/weekday/year labels. Divergences: only the 4 most recent
// years (2017-2020) are rendered for legibility (the ref draws 2000-2020);
// no bold year label. Surpass: cells fade in week-by-week, sweeping
// left-to-right across all year rows (the ref is static).

import {
  Scene, Rectangle, PolyLine, Text, VGroup,
  scaleSequential, interpolatePiYG, quantile, groups,
  utcMonday, utcMonth, utcYear, utcFormat, LaggedStart, FadeIn,
} from "../../src/node.ts";
import { demoRender, loadCsv, svgFrame } from "./_run.ts";

const dji = loadCsv("DJI-2.csv") as Array<{ Date: Date; Close: number }>;

class CalendarView extends Scene {
  async construct() {
    const width = 928, cellSize = 17;
    const weekDays = 7, countDay = (i: number) => (i + 6) % 7; // monday weeks
    const timeWeek = utcMonday;
    const bandHeight = cellSize * (weekDays + 2);

    const X = dji.map((d) => d.Date);
    // Relative daily change, like the ref's y accessor (pairs of Closes).
    const Y = dji.map((d, i) => (i > 0 ? (d.Close - dji[i - 1].Close) / dji[i - 1].Close : NaN));
    const I = X.map((_, i) => i);

    const max = quantile(Y, 0.9975, (v: number) => Math.abs(v));
    const color = scaleSequential([-max, +max], interpolatePiYG);
    const formatMonth = utcFormat("%b");

    // Years, most recent first (the ref reverses); keep the last 4 only.
    const years = groups(I.filter((i) => !Number.isNaN(Y[i])), (i) => X[i].getUTCFullYear())
      .reverse().slice(0, 4);

    const height = bandHeight * years.length;
    const f = svgFrame(width, height);
    const fontSize = f.len(10);
    const cellAt = (tx: number, ty: number, w: number, d: number) =>
      f.pt(tx + w * cellSize + 0.5 + (cellSize - 1) / 2, ty + d * cellSize + 0.5 + (cellSize - 1) / 2);

    const weekBuckets = new Map<number, VGroup>(); // sweep stagger groups
    const decor = new VGroup(); // everything drawn ABOVE the cells

    years.forEach(([yearKey, Iy], yi) => {
      const tx = 40.5, ty = bandHeight * yi + cellSize * 1.5;

      const yearLabel = new Text(String(yearKey), { fontSize, color: "#000000" });
      yearLabel.moveTo(f.pt(tx - 5, ty - 9));
      yearLabel.shift([-yearLabel.getWidth() / 2, 0, 0]);
      decor.add(yearLabel);

      for (let i = 0; i < 7; i++) {
        const day = new Text("SMTWTFS"[i], { fontSize, color: "#000000" });
        day.moveTo(f.pt(tx - 5, ty + (countDay(i) + 0.5) * cellSize));
        day.shift([-day.getWidth() / 2, 0, 0]);
        decor.add(day);
      }

      for (const i of Iy) {
        const w = timeWeek.count(utcYear.floor(X[i]), X[i]);
        const cell = new Rectangle({
          width: f.len(cellSize - 1), height: f.len(cellSize - 1),
          fillColor: color(Y[i]), fillOpacity: 1, strokeWidth: 0,
        });
        cell.moveTo(cellAt(tx, ty, w, countDay(X[i].getUTCDay())));
        let bucket = weekBuckets.get(w);
        if (!bucket) weekBuckets.set(w, (bucket = new VGroup()));
        bucket.add(cell);
      }

      // Month boundaries (white staircase paths) + month labels.
      const months = utcMonth.range(utcMonth.floor(X[Iy[0]]), X[Iy[Iy.length - 1]]);
      months.forEach((m, mi) => {
        if (mi) {
          const d = countDay(m.getUTCDay());
          const w = timeWeek.count(utcYear.floor(m), m);
          const px = (wx: number, dy: number) => f.pt(tx + wx * cellSize, ty + dy * cellSize);
          const points = d === 0
            ? [px(w, 0), px(w, weekDays)]
            : [px(w + 1, 0), px(w + 1, d), px(w, d), px(w, weekDays)];
          decor.add(new PolyLine({ points, strokeColor: "#ffffff", strokeWidth: f.sw(3) }));
        }
        const lab = new Text(formatMonth(m), { fontSize, color: "#000000" });
        lab.moveTo(f.pt(tx + timeWeek.count(utcYear.floor(m), timeWeek.ceil(m)) * cellSize + 2, ty - 9));
        lab.shift([lab.getWidth() / 2, 0, 0]);
        decor.add(lab);
      });
    });

    // Cells below, decorations above (ref DOM order); pre-adding keeps the
    // FadeIn introducers from restacking cells over the white month paths.
    const weeks = [...weekBuckets.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
    this.add(...weeks, decor);

    await this.play(new LaggedStart(
      weeks.map((g) => new FadeIn(g)),
      { lagRatio: 0.05, runTime: 4 },
    ));
    await this.wait(1);
  }
}

await demoRender(CalendarView, import.meta.url);
