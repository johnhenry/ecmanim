// GSAP parity demo 01: ref/01-timeline-labels.md — Timeline labels +
// position parameters (GSAP docs, gsap.com/resources/position-parameter).
// Six squares' tweens are placed on one Timeline using the SAME position
// grammar GSAP uses: default (sequential), "<" (starts with previous),
// ">" (starts at previous's end), "-=0.5" (overlap), "+=1" (gap), and a
// label reference ("scene1+=0.5"). Proves Timeline.add()'s position-
// parameter resolver (src/animation/timeline.ts) is a direct match for
// GSAP's own grammar — no gap-fill needed for this pattern.

import { Scene, Square, VGroup, timeline, RIGHT, DOWN } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const COLORS = ["#ff6b6b", "#feca57", "#48dbfb", "#1dd1a1", "#5f27cd", "#ff9ff3"];

class TimelineLabels extends Scene {
  async construct() {
    const squares = COLORS.map((c, i) => {
      const sq = new Square({ sideLength: 0.8, color: c, fillOpacity: 1 });
      sq.moveTo([-5.5, 2.5 - i * 1.0, 0]);
      return sq;
    });
    this.add(new VGroup(...squares));

    const tl = timeline();
    // 1: sequential (default position) -- moves right.
    tl.add(squares[0].animate.shift([9, 0, 0]));
    // 2: "<" -- starts WITH the previous tween (same start time).
    tl.add(squares[1].animate.shift([9, 0, 0]), "<");
    // 3: ">" -- starts at the previous tween's END (back-to-back).
    tl.add(squares[2].animate.shift([9, 0, 0]), ">");
    // 4: "-=0.5" -- overlaps the running timeline by 0.5s.
    tl.add(squares[3].animate.shift([9, 0, 0]), "-=0.5");
    // 5: "+=1" -- a deliberate 1s gap after the timeline's current end.
    tl.add(squares[4].animate.shift([9, 0, 0]), "+=1");
    // A label, then a 6th tween anchored 0.5s after it.
    tl.addLabel("scene1");
    tl.add(squares[5].animate.shift([9, 0, 0]).rotate(Math.PI), "scene1+=0.5");

    await this.play(tl.build());
    await this.wait(0.5);
  }
}

await demoRender(TimelineLabels, import.meta.url);
