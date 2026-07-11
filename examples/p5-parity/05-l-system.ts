// p5.js parity demo 05: ref/05-l-system.js — "L-Systems" (p5.js gallery,
// LGPL, example by R. Luke DuBois): a Lindenmayer-system string rewrite
// (axiom "A", 5 iterations of rules A -> "-BF+AFA+FB-", B -> "+AF-BFB-FA+")
// interpreted by a turtle walker into a branching grid pattern. Exact
// axiom/rules/angle(90deg)/iteration-count(5) from the ref's setup().
//
// The ref's `drawIt()` turtle only ever does 3 things: 'F' draws forward,
// '+'/'-' turn by a fixed angle, everything else (the 'A'/'B' symbols
// themselves) is a no-op for drawing purposes -- there is no push()/pop()
// bracket stack anywhere in this particular L-system (no '[' / ']' symbols
// in the axiom or either rule), so it never branches into disconnected
// sub-paths. That means the library's existing `lsystem()` turtle
// (src/layout/hilbert.ts -- forward + turn only, no bracket-stack support)
// is already sufficient here, unmodified: this ref just happens to be a
// single connected turtle path, not a branching tree, despite reading like
// one might expect the L-Systems name to imply. No custom turtle-walk
// needed for this demo.

import {
  Scene, VGroup, Line, Create, lsystem, interpolateRainbow,
} from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const AXIOM = "A";
const RULES = { A: "-BF+AFA+FB-", B: "+AF-BFB-FA+" };
const ITERATIONS = 5; // ref: numloops = 5
const ANGLE = Math.PI / 2; // ref: angle = 90 (degrees)

function buildPath(): VGroup {
  const raw = lsystem(AXIOM, RULES, ITERATIONS, ANGLE, "F");

  // Normalize the unit-step turtle output into frame-sized, origin-centered
  // world coordinates.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of raw) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = 6.8 / span; // fits well within FRAME_HEIGHT=8 / FRAME_WIDTH=14.2
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const pts = raw.map(([x, y]) => [(x - cx) * scale, (y - cy) * scale, 0]);

  const group = new VGroup();
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const color = interpolateRainbow((i / (n - 1)) * 0.92);
    group.add(new Line(pts[i], pts[i + 1], { color, strokeWidth: 2.5 }));
  }
  return group;
}

class LSystem extends Scene {
  async construct() {
    const path = buildPath();
    this.add(path);
    await this.play(new Create(path, { lagRatio: 0.002, runTime: 4 }), { _playConfig: true });
    await this.wait(1);
  }
}

await demoRender(LSystem, import.meta.url);
