// Authoring layer: run a pluggable Format (title-card) through its lifecycle with
// the manim-js render provider to produce a real video, and dry-run a plan IR.
// Run: node examples/authoring.ts  ->  examples/out/authoring.mp4 (+ plan JSON)

import { writeFileSync, mkdirSync } from "node:fs";
import { runFormat, manimRenderProvider, toPlanIR } from "../src/authoring.ts";
import { Scene, Circle, Create } from "../src/node.ts";

mkdirSync("examples/out", { recursive: true });

// 1) Run the built-in "title-card" format: plan → compose (render) via a provider.
const res = await runFormat("title-card", {
  topic: "manim-js",
  params: {
    bullets: ["code → animation", "Node + browser", "now with an authoring layer"],
    style: "3b1b-dark",
    renderOptions: { output: "examples/out/authoring.mp4", quality: "low", fps: 15 },
  },
  providers: { render: manimRenderProvider },
});
console.log("Format output:", res.output?.output ?? res.output, "| title:", res.plan.title);

// 2) Dry-run a plan IR for a scene (no rendering) + quality gates.
class Demo extends Scene {
  async construct() {
    this.nextSection("intro");
    await this.play(new Create(new Circle()), { _playConfig: true, runTime: 1 });
    this.nextSection("hold");
    await this.wait(1.5);
  }
}
const plan = await toPlanIR(Demo, { fps: 30, width: 1920, height: 1080, promise: "motion-led" });
writeFileSync("examples/out/authoring.plan.json", JSON.stringify(plan, null, 2));
console.log(`Plan: ${plan.segments.length} segments, ${plan.durationSeconds}s, slideshow-risk ${plan.quality.slideshowRisk.toFixed(2)}, gates ok=${plan.quality.ok}`);
