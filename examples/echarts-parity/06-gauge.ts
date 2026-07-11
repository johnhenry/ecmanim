// ECharts parity demo 06: ref/06-gauge.js — "Gauge Basic chart" (ECharts
// gallery, Apache-2.0). Default 0-100 dial, one series ("Pressure") at
// value 50, `detail: {formatter: '{value}'}` (no unit suffix). Proves the
// GaugeChart mobject: 3-band default color ramp, needle sweep, tick labels,
// center value readout.
//
// The needle sweeps from 0 to 50 over the animation (ECharts' entrance
// animation is a similar needle sweep-in) rather than snapping straight to
// its final pose.

import { Scene, GaugeChart, ValueTracker } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

class GaugeBasic extends Scene {
  async construct() {
    const gauge = new GaugeChart(0, {
      tickFontSize: 0.3,
      tickColor: "#333333",
      valueFontSize: 0.6,
      valueColor: "#333333",
    });
    this.add(gauge);

    const v = new ValueTracker(0);
    gauge.addUpdater(() => gauge.setValue(v.getValue()));
    await this.play(v.animate.setValue(50), { runTime: 1.5 });
    await this.wait(0.5);
  }
}

await demoRender(GaugeBasic, import.meta.url);
