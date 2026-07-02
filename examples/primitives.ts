// Phase-1 primitives: a GSAP-style Timeline, a wiggle expression driver, a
// VectorDecimalNumber counter, a named style preset, and a still export.
// Run: node examples/primitives.ts  ->  examples/out/primitives.mp4 (+ .png)

import {
  render, renderStill, Scene, Circle, Square, Create, FadeIn, Transform,
  Timeline, wiggle, ValueTracker, VectorDecimalNumber, BLUE, GREEN, YELLOW,
} from "../src/node.ts";

class Primitives extends Scene {
  async construct() {
    const c = new Circle({ radius: 1.1, color: BLUE, fillColor: BLUE, fillOpacity: 0.5 });
    c.moveTo([-3, 0, 0]);
    const s = new Square({ sideLength: 2, color: GREEN, fillColor: GREEN, fillOpacity: 0.5 });
    s.moveTo([3, 0, 0]);

    // A live vector counter driven by a ValueTracker + updater.
    const counter = new VectorDecimalNumber(0, { numDecimalPlaces: 0, fontSize: 0.8, color: YELLOW });
    counter.moveTo([0, 2.6, 0]);
    const tracker = new ValueTracker(0);
    counter.addUpdater(() => counter.setValue(tracker.getValue()));

    // A wiggle driver makes the circle bob as scene time advances (deterministic).
    const bob = wiggle(0.3, 2.5, 7);
    c.addUpdater(() => c.moveTo([-3, bob(this.time), 0]));

    this.add(counter);

    // Compose the intro choreography on one timeline instead of manual play/wait.
    const tl = new Timeline({ defaults: { runTime: 0.6 } });
    tl.add(new Create(c));
    tl.add(new Create(s), "<");            // start together with the circle
    tl.add(new FadeIn(counter), "+=0.2");   // small gap after
    await this.play(tl.build(), { _playConfig: true, runTime: tl.duration });

    // Count 0 -> 100 by driving the tracker over a fixed window (updater picks it up).
    const start = this.time, dur = 1.2;
    const drive = () => tracker.setValue(100 * Math.min(1, (this.time - start) / dur));
    tracker.addUpdater(drive);
    await this.play(new Transform(c, s.copy().moveTo([-3, 0, 0])), { _playConfig: true, runTime: dur });
    tracker.removeUpdater(drive);
    tracker.setValue(100);

    await this.wait(0.3);
  }
}

await render(Primitives, {
  output: "examples/out/primitives.mp4",
  style: "3b1b-dark",      // named look (dark navy + accents)
  aspectRatio: "16:9",
  quality: "low",
});

// A poster still at ~1s.
await renderStill(Primitives, {
  output: "examples/out/primitives-poster.png",
  time: 1.0,
  style: "3b1b-dark",
});

console.log("Wrote examples/out/primitives.mp4 and primitives-poster.png");
