// Port of D3 gallery: Pie Chart Update (ref/pie-chart-update.js) — a donut
// whose slices re-apportion with an animated ANGLE tween (d3's arcTween)
// when the value field switches apples → oranges (oranges are all equal, so
// the donut relaxes to five equal slices). Data: the ref's inline TSV.
// Surpass: sweep-in intro; the radio input becomes apples → oranges → apples.

import {
  Scene, Text, VMobject, pieGen, arcShape, schemeObservable10, tween, rate_functions,
} from "../../src/node.ts";
import type { PieSlice } from "../../src/node.ts";
import { demoRender, svgFrame } from "./_run.ts";

const data = [
  { apples: 53245, oranges: 200 },
  { apples: 28479, oranges: 200 },
  { apples: 19697, oranges: 200 },
  { apples: 24037, oranges: 200 },
  { apples: 40245, oranges: 200 },
];

class PieChartUpdate extends Scene {
  async construct() {
    const width = 928;
    const height = Math.min(500, width / 2);
    const outerRadius = height / 2 - 10;
    const innerRadius = outerRadius * 0.75;
    const f = svgFrame(width, height);

    // d3.pie().sort(null): input order (sort() implicitly nulls sortValues).
    const slicesFor = (key: "apples" | "oranges") =>
      pieGen<typeof data[0]>({ value: (d) => d[key], sortValues: null })(data);
    const apples = slicesFor("apples");
    const oranges = slicesFor("oranges");

    // One VMobject per slice; geometry is regenerated per frame from
    // interpolated ANGLES (the d3 arcTween, not a pointwise shape morph).
    const mobs = data.map((_, i) => {
      const mob = new VMobject({ fillColor: schemeObservable10[i], fillOpacity: 1, strokeWidth: 0 });
      this.add(mob);
      return mob;
    });
    const setAngles = (angles: Array<{ startAngle: number; endAngle: number }>) => {
      angles.forEach((a, i) => {
        const fresh = arcShape({
          innerRadius: f.len(innerRadius), outerRadius: f.len(outerRadius),
          startAngle: a.startAngle, endAngle: a.endAngle,
        });
        mobs[i].points = fresh.points;
        mobs[i].subpathStarts = fresh.subpathStarts;
      });
    };
    const lerpAngles = (a: PieSlice[], b: PieSlice[], t: number) =>
      a.map((s, i) => ({
        startAngle: s.startAngle + (b[i].startAngle - s.startAngle) * t,
        endAngle: s.endAngle + (b[i].endAngle - s.endAngle) * t,
      }));

    const title = (label: string) => {
      const t = new Text(`dataset: ${label}`, { fontSize: f.len(14), color: "#000" });
      t.moveTo([0, -f.len(height / 2 - 14), 0]);
      return t;
    };
    let caption = title("apples");
    this.add(caption);

    // Sweep-in intro: all angles grow from 0 to the apples layout.
    const zero = apples.map(() => ({ startAngle: 0, endAngle: 0 }));
    await this.play(tween(1, (u) => setAngles(lerpAngles(zero as any, apples, u)), rate_functions.smooth));
    await this.wait(1);

    const change = (from: PieSlice[], to: PieSlice[], label: string) => {
      this.remove(caption);
      this.add(caption = title(label));
      const anim = tween(0.75, (v) => setAngles(lerpAngles(from, to, v)), rate_functions.smooth);
      // Disambiguate the two change() tweens for the partial-movie cache
      // (tween()'s default hash is its callback SOURCE, identical here).
      (anim as any)._hashExtra = () => `change:${label}`;
      return anim;
    };
    await this.play(change(apples, oranges, "oranges"));
    await this.wait(1);
    await this.play(change(oranges, apples, "apples"));
    await this.wait(1);
  }
}

await demoRender(PieChartUpdate, import.meta.url);
