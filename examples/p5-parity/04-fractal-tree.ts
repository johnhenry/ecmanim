// p5.js parity demo 04: ref/04-fractal-tree.js — "Recursive Tree" (p5.js
// gallery, LGPL). The ref's branch() is hand-written recursion (push()/
// rotate()/line()/translate()/pop() per call), NOT an L-system string, so
// it's ported literally here as a recursive point-generation function
// building a VGroup of 2-point Lines (matching the ref's actual recursive
// structure: trunk -> two half-length child branches at +-angle, each
// spawning two more, stopping once the branch length shrinks below a
// threshold). Colored by recursion depth (interpolateViridis) in place of
// the ref's per-level HSB hue rotation.
//
// The ref drives `angle` live from mouseX (0..90deg). There's no mouse in a
// rendered demo, so this recreation instead sweeps the angle across a few
// fixed keyframes over scene time -- narrow -> wide -> narrow -- morphing
// between built trees with Transform. Every keyframe uses the same
// recursion (same depth, same branch count and traversal order for any
// angle), so each Transform pairs up 2-point Lines 1:1 and just slides
// endpoints; no point-count mismatch across submobjects.

import {
  Scene, VGroup, Line, Transform, Create, interpolateViridis,
} from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const TRUNK_LEN = 3;   // world units (ref: 120px trunk, same proportions)
const SHRINK = 0.66;   // ref: h *= 0.66 every level
const MIN_LEN = 0.05;  // ref: stop recursing once h <= 2 (proportional)
const MAX_LEVEL = 11;  // safety cap; natural stop (~10 levels) hits first
const DEPTH_FOR_COLOR = 9;

function buildTree(angleDeg: number): VGroup {
  const angle = (angleDeg * Math.PI) / 180;
  const group = new VGroup();

  function branch(pos: [number, number], heading: number, h: number, level: number) {
    const len = h * SHRINK;
    if (len <= MIN_LEN || level >= MAX_LEVEL) return;
    const color = interpolateViridis(Math.min(1, level / DEPTH_FOR_COLOR));
    const width = Math.max(0.75, 4 - level * 0.35);
    for (const dir of [1, -1] as const) {
      const newHeading = heading + dir * angle;
      const end: [number, number] = [
        pos[0] + len * Math.sin(newHeading),
        pos[1] + len * Math.cos(newHeading),
      ];
      group.add(new Line([pos[0], pos[1], 0], [end[0], end[1], 0], {
        color, strokeWidth: width,
      }));
      branch(end, newHeading, len, level + 1);
    }
  }

  const base: [number, number] = [0, -3.6];
  const trunkEnd: [number, number] = [0, -3.6 + TRUNK_LEN];
  group.add(new Line([base[0], base[1], 0], [trunkEnd[0], trunkEnd[1], 0], {
    color: "#22d3ee", strokeWidth: 4.5,
  }));
  branch(trunkEnd, 0, TRUNK_LEN, 0);

  return group;
}

class FractalTree extends Scene {
  async construct() {
    const angles = [15, 35, 58, 35, 15];
    let tree = buildTree(angles[0]);
    this.add(tree);

    await this.play(new Create(tree, { lagRatio: 0.01, runTime: 1.5 }), { _playConfig: true });
    await this.wait(0.3);

    for (let i = 1; i < angles.length; i++) {
      const next = buildTree(angles[i]);
      await this.play(new Transform(tree, next), { _playConfig: true, runTime: 1 });
      await this.wait(0.2);
    }
    await this.wait(0.5);
  }
}

await demoRender(FractalTree, import.meta.url);
