// Advanced example: coordinate systems, plotting, .animate syntax, a
// ValueTracker-driven live readout, LaggedStart, and Indicate.
// Run: node examples/graph.js  ->  examples/out/graph.mp4

import {
  render, Scene, Axes, Dot, Text, DecimalNumber, ValueTracker, alwaysRedraw,
  Create, Write, FadeIn, LaggedStart, Indicate, MoveAlongPath,
  BLUE, YELLOW, GREEN, RED, WHITE, PI,
} from "../src/node.js";

class GraphScene extends Scene {
  async construct() {
    const axes = new Axes({
      xRange: [-4, 4, 1],
      yRange: [-1, 5, 1],
      xLength: 9,
      yLength: 6,
      color: WHITE,
    });
    axes.shift([0, -0.5, 0]);
    await this.play(new Create(axes), { _playConfig: true, runTime: 1.5 });

    const label = new Text("f(x) = 0.4 x²", { fontSize: 0.55, color: BLUE, point: [3.5, 3, 0] });
    await this.play(new Write(label));

    const f = (x) => 0.4 * x * x;
    const graph = axes.plot(f, { color: BLUE });
    await this.play(new Create(graph), { _playConfig: true, runTime: 1.5 });

    // Sample dots appear with a stagger (LaggedStart).
    const dots = [-3, -2, -1, 0, 1, 2, 3].map((x) =>
      new Dot({ point: axes.c2p(x, f(x)), color: YELLOW, radius: 0.09 }));
    await this.play(new LaggedStart(dots.map((d) => new FadeIn(d)), { lagRatio: 0.15, runTime: 1.5 }));

    // A tracker dot that rides along the curve, with a live y-readout.
    const t = new ValueTracker(-3);
    const rider = alwaysRedraw(() =>
      new Dot({ point: axes.c2p(t.getValue(), f(t.getValue())), color: RED, radius: 0.12 }));
    const readout = new DecimalNumber(f(-3), { numDecimalPlaces: 2, color: RED, fontSize: 0.5, point: [-4.5, 3, 0] });
    readout.addUpdater((m) => m.setValue(f(t.getValue())));
    this.add(rider, readout);

    await this.play(t.animate.setValue(3), { _playConfig: true, runTime: 3 });
    await this.play(new Indicate(graph));
    await this.wait(0.5);
  }
}

await render(GraphScene, {
  output: "examples/out/graph.mp4",
  quality: "medium",
  background: "#0d1117",
});
