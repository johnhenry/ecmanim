// p5.js parity demo 09: ref/09-recursive-circles.js — "Recursion" (p5.js
// gallery, LGPL; see ref/README.md's substitution note: the site's own
// "Recursion" example is the closest official match to "recursive circles"
// in the corpus, and it literally is one). Read carefully, the ref's
// `drawCircle(x, radius, level)` does NOT draw concentric circle-in-circle
// rings -- it has no `y` parameter at all, so every circle at every
// recursion depth is centered on the SAME horizontal line
// (`ellipse(x, height / 2, ...)`). Each call draws itself, then (while
// `level > 1`) recurses twice at half the radius, offset left/right by
// half the CURRENT radius (`x - radius/2`, `x + radius/2`) -- a binary
// subdivision along one axis, matching the aria-label exactly: "a grey
// circle with two grey circles across its middle; each of those has more
// grey circles across its middle," six levels deep (root call passes
// `level: 6`; recursion stops once a level-1 circle is drawn). Root radius
// in the ref is 280 (= height/2 for its 720x560 canvas, i.e. the root
// circle's diameter spans the full canvas height) -- reproduced here at the
// same relative proportion.
//
// COLOR: ref shades by `tt = 126 * level / 4` (grayscale fill, bigger/less-
// recursed circles brighter) against its default light canvas background --
// direct porting of that range (~31 to ~189) would put the deepest, smallest
// circles at a near-invisible dark gray against this harness's BLACK
// background. Kept the same "bigger = brighter" relationship (level driving
// lightness) but remapped the floor up so even the deepest leaf circles stay
// clearly visible on black.
//
// ANIMATION: a single static frame is the literal ref (`noLoop()`), but per
// the campaign brief this reveals depth-by-depth (all 1 root, then both
// level-5 circles, then all four level-4 circles, ...) via LaggedStartMap +
// FadeIn, one introducer animation per recursion level -- growing the
// fractal structure inward across the clip instead of popping in as one
// static composition.

import { Scene, Circle, VGroup, LaggedStartMap, FadeIn, FRAME_HEIGHT } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const MAX_LEVEL = 6; // matches ref's drawCircle(width/2, 280, 6) -> 2^6 - 1 = 63 circles total
const ROOT_RADIUS = FRAME_HEIGHT / 2 - 0.4; // ref: root radius == canvas height / 2

// Grayscale-by-level, remapped from the ref's [31.5, 189] range up to
// [90, 240] so the deepest (smallest) circles stay visible against black.
function colorForLevel(level: number): string {
  const gray = Math.round(90 + (level / MAX_LEVEL) * 150);
  const hex = gray.toString(16).padStart(2, "0");
  return `#${hex}${hex}${hex}`;
}

class RecursiveCircles extends Scene {
  async construct() {
    // levelGroups[0] = the single root circle (level MAX_LEVEL); levelGroups[k]
    // = all circles produced by the k-th round of recursion (2^k circles).
    const levelGroups: Circle[][] = [];

    const build = (x: number, radius: number, level: number, depth: number) => {
      const circle = new Circle({
        point: [x, 0, 0],
        radius,
        fillColor: colorForLevel(level),
        fillOpacity: 1,
        strokeWidth: 0,
      });
      (levelGroups[depth] ??= []).push(circle);
      if (level > 1) {
        build(x - radius / 2, radius / 2, level - 1, depth + 1);
        build(x + radius / 2, radius / 2, level - 1, depth + 1);
      }
    };
    build(0, ROOT_RADIUS, MAX_LEVEL, 0);

    const groups = levelGroups.map((circles) => new VGroup(...circles));

    // Depth-by-depth reveal: root fades in first, then each successive
    // recursion round's circles fade in together (introducer FadeIn --
    // mobjects are added to the scene the moment their own step begins, same
    // pattern as gsap-parity/03-text-split-reveal.ts's word-level reveal).
    await this.play(
      new LaggedStartMap((m: any) => new FadeIn(m, { runTime: 0.5 }), groups, { lagRatio: 0.75 }),
    );

    await this.wait(2);
  }
}

await demoRender(RecursiveCircles, import.meta.url);
