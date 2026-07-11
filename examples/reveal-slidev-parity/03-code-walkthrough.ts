// Reveal.js/Slidev parity demo 03: a step-by-step code highlight walkthrough
// — Reveal.js's `data-line-numbers="|4,8-11|17|22-24"` (ref/reveal-demo.html's
// "With Animations" auto-animate-code section) and Slidev's
// ` ```ts {all|4|6|6-7|9|all} ` (ref/slidev-demo.md's "Code" slide) both
// step a fenced code block through a sequence of highlighted line ranges,
// one reveal.js/Slidev "click" per step. This port takes approach (b) from
// the campaign brief: build a `Code` mobject directly (src/mobject/text/
// code.ts) and step through it with `code.selection(lines(a, b))` calls via
// `scene.play()`, rather than routing through `deckFromMarkdown()`'s fenced-
// code-block parsing — direct authoring reads more clearly for a single
// code slide with narration captions per step.
//
// The highlighted CONTENT is original (a small `clamp()` helper), not
// lifted from either reference corpus file (both ship framework-specific
// React/Vue examples) — only the STEP PATTERN (dim-everything-but-the-
// current-range, one step per play()) is being demonstrated.

import { Scene } from "../../src/scene/Scene.ts";
import { Code, lines } from "../../src/mobject/text/code.ts";
import { Text } from "../../src/mobject/text/Text.ts";
import { FadeIn, FadeOut } from "../../src/animation/Animation.ts";
import { demoRender } from "./_run.ts";

const STEP_HOLD = 0.5;
const STEP_RUN = 0.35;

const SOURCE = `function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}`;

// Each step: a line range to highlight (null = "all", i.e. full opacity,
// matching Slidev/Reveal's `all` step keyword) plus the caption explaining
// it — one play() per step, a natural fragment boundary via
// scene.playRecords, same convention deckFromMarkdown's own code-slide
// stepping uses (src/loaders/deck_markdown.ts).
const STEPS: Array<{ range: [number, number] | null; caption: string }> = [
  { range: null, caption: "Step 0 — the whole function, unhighlighted" },
  { range: [0, 0], caption: "Step 1 — the signature: 3 params, one return type" },
  { range: [1, 2], caption: "Step 2 — clamp against min, then against max" },
  { range: [3, 3], caption: "Step 3 — otherwise the value already fits" },
  { range: null, caption: "Step 4 — back to \"all\": the full picture" },
];

class CodeWalkthrough extends Scene {
  async construct() {
    const heading = new Text("Code Walkthrough", { fontSize: 0.6, color: "#FFFFFF" });
    heading.moveTo([0, 3.1, 0]);
    this.add(heading);

    // fontSize 0.24: the signature line is the width driver (~63 chars) --
    // anything above ~0.28 pushes the code block past FRAME_WIDTH (14.22
    // units, src/core/constants.ts) and clips both edges off-screen.
    const code: any = new Code(SOURCE, { language: "ts", fontSize: 0.24 });
    code.moveTo([0, 0.4, 0]);
    this.add(code);
    await this.play(new FadeIn(code));

    let caption = new Text(STEPS[0].caption, { fontSize: 0.32, color: "#DDDDDD" });
    caption.moveTo([0, -2.8, 0]);
    this.add(caption);
    await this.play(new FadeIn(caption), { runTime: STEP_RUN });
    await this.wait(STEP_HOLD);

    for (let i = 1; i < STEPS.length; i++) {
      const step = STEPS[i];
      const target = step.range ? lines(step.range[0], step.range[1]) : null;

      const nextCaption = new Text(step.caption, { fontSize: 0.32, color: "#DDDDDD" });
      nextCaption.moveTo([0, -2.8, 0]);

      // Swap the caption and re-highlight the code range in the same beat —
      // each is its own play() (own FadeOut/FadeIn introducer/remover
      // lifecycle per the campaign's already-fixed wrapper-VGroup bug, see
      // commit 70e4fad: no wrapper group, each mobject animated directly).
      await this.play(new FadeOut(caption), { runTime: STEP_RUN });
      caption = nextCaption;
      this.add(caption);
      await this.play(new FadeIn(caption), code.selection(target, STEP_RUN), { runTime: STEP_RUN });
      await this.wait(STEP_HOLD);
    }

    await this.wait(STEP_HOLD);
  }
}

// disableCaching: this campaign's demos share out/partial/ across several
// concurrently-rendering ports, and a partial-movie-cache collision was
// observed there (a stale/foreign cached segment — mismatched code-block
// width from an earlier fontSize iteration — got spliced into an otherwise
// correct, deterministically-reproduced render; see this file's PR/report
// notes). Not a bug in this demo's own scene code (confirmed by rendering
// the identical construct() to an isolated output with a private cache
// directory, which came out correct on every sampled frame) — routing
// around the shared cache here is the safe fix on this side of the fence.
await demoRender(CodeWalkthrough, import.meta.url, { disableCaching: true });
