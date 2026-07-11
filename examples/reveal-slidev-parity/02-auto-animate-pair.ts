// Reveal.js/Slidev parity demo 02: Reveal.js Auto-Animate-style demo — a
// shared visual element (a rounded-rectangle "card") smoothly moves/resizes/
// recolors across 3 consecutive slides instead of cutting, driven DIRECTLY
// by `Scene.autoAnimateToNextSection()` (src/scene/Scene.ts, a primitive
// that predates this campaign — no `deckFromMarkdown()` needed here, per
// the campaign brief's guidance that direct Scene authoring is the clearer
// choice for this demo). Mirrors ref/reveal-demo.html's `data-auto-animate`
// box sections (three consecutive sections, each repositioning/recoloring
// `data-id="box1..3"` divs — the classic reveal.js Auto-Animate example).
//
// Identity: the card carries a stable `matchId` ("hero-card"), which
// src/animation/auto_matching.ts's `autoKey()` prefers over shape/position
// keying — so `TransformMatchingAuto` (invoked internally by
// autoAnimateToNextSection) pairs the SAME element across slides and
// Transforms its geometry+color, rather than fading one out and a new one
// in. Per-slide caption text intentionally has NO matchId and DIFFERENT
// content each time, so it naturally mismatches and fades (the honest
// reveal.js behavior too: only elements sharing a `data-id` auto-animate,
// everything else cuts/fades) — this keeps the one thing that's supposed to
// visibly persist (the card) unambiguous against the thing that isn't
// (the caption).

import { Scene } from "../../src/scene/Scene.ts";
import { RoundedRectangle } from "../../src/mobject/polygram.ts";
import { Text } from "../../src/mobject/text/Text.ts";
import { demoRender } from "./_run.ts";

const HOLD = 0.6;

// Build a fresh card for a given state. autoAnimateToNextSection() snapshots
// `this.mobjects` BEFORE buildNext() runs, then diffs against whatever's in
// `this.mobjects` AFTER it returns — so swapping in a brand-new mobject that
// carries the SAME matchId is the natural way to change actual geometry
// (RoundedRectangle's points are fixed at construction; there's no in-place
// resize), and it's exactly what a fresh reveal.js `<section data-id="...">`
// with different CSS would produce too.
function makeCard(point: number[], width: number, height: number, color: string): any {
  const card: any = new RoundedRectangle({
    width,
    height,
    cornerRadius: 0.15,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: color,
    strokeWidth: 2,
  });
  card.matchId = "hero-card";
  card.moveTo(point);
  return card;
}

class AutoAnimatePair extends Scene {
  async construct() {
    const heading = new Text("Auto-Animate", { fontSize: 0.6, color: "#FFFFFF" });
    heading.moveTo([0, 3, 0]);
    this.add(heading);

    // The shared element: same matchId across all three states below, only
    // its position/size/color change slide to slide.
    let card = makeCard([-4.5, 0, 0], 1.4, 1.4, "#4FC3F7");
    this.add(card);

    let caption = new Text("Step 1 — small card, docked left", { fontSize: 0.32, color: "#DDDDDD" });
    caption.moveTo([0, -2.5, 0]);
    this.add(caption);

    await this.wait(HOLD);

    // Step 2: the card grows and slides to center, recoloring cyan -> magenta.
    await this.autoAnimateToNextSection("grow-and-center", () => {
      this.remove(card, caption);
      card = makeCard([0, 0, 0], 3, 2, "#E040FB");
      this.add(card);
      caption = new Text("Step 2 — grows + moves to center, recolors", { fontSize: 0.32, color: "#DDDDDD" });
      caption.moveTo([0, -2.5, 0]);
      this.add(caption);
    });
    await this.wait(HOLD);

    // Step 3: the same card shrinks again and docks right, recoloring to amber.
    await this.autoAnimateToNextSection("shrink-and-dock-right", () => {
      this.remove(card, caption);
      card = makeCard([4.3, -0.3, 0], 1.8, 3.2, "#FFAB40");
      this.add(card);
      caption = new Text("Step 3 — reshapes + docks right, recolors again", { fontSize: 0.32, color: "#DDDDDD" });
      caption.moveTo([0, -2.5, 0]);
      this.add(caption);
    });
    await this.wait(HOLD);
  }
}

await demoRender(AutoAnimatePair, import.meta.url);
