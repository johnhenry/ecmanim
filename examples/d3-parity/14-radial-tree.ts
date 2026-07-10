// Port of D3 gallery: Radial tree component (ref/radial-tree.js) — the full
// Flare hierarchy as a radial tidy tree: tree().size([2π, radius]) with the
// ref's depth-scaled separation, radial bump links, node dots.
// Data: flare-2.json (252 nodes).
// Divergence: labels are drawn for depth ≤ 1 nodes only, plain horizontal
// (the ref rotates a tiny label along every node's angle).
// Surpass: the tree grows outward ring by ring (LaggedStart by depth).

import {
  Scene, Dot, Text, Group, VMobject, hierarchy, tree,
  linkRadialPoints, radialPoint, LaggedStart, AnimationGroup, FadeIn,
} from "../../src/node.ts";
import { demoRender, loadJson, svgFrame } from "./_run.ts";

const flare = loadJson("flare-2.json");

class RadialTree extends Scene {
  async construct() {
    const width = 1152, height = 1152, margin = 100;
    const radius = Math.min(width, height) / 2 - margin;
    const f = svgFrame(width, height);

    const root = hierarchy(flare);
    tree()
      .size([2 * Math.PI, radius])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth)(root);

    // Chart center (SVG 576,576) is the world origin; radialPoint maps the
    // layout's (angle x, radius y) straight into world coordinates.
    const byDepth = new Map<number, Group>();
    const ring = (d: number) => {
      if (!byDepth.has(d)) byDepth.set(d, new Group());
      return byDepth.get(d)!;
    };
    for (const l of root.links()) {
      const pts = linkRadialPoints(
        { angle: l.source.x!, radius: f.len(l.source.y!) },
        { angle: l.target.x!, radius: f.len(l.target.y!) },
      );
      const link = new VMobject({
        strokeColor: "#555555", strokeOpacity: 0.4, strokeWidth: f.sw(1.5), fillOpacity: 0,
      });
      link.startNewPath(pts[0]);
      for (let i = 1; i < pts.length; i++) link.addLineTo(pts[i]);
      ring(l.target.depth).add(link);
    }
    const labels = new Group();
    for (const d of root.descendants()) {
      const p = radialPoint(d.x!, f.len(d.y!));
      ring(d.depth).add(new Dot({ point: p, radius: f.len(3), color: d.children ? "#555555" : "#999999" }));
      if (d.depth <= 1) {
        const label = new Text((d.data as any).name, { fontSize: f.len(14), color: "#000000" });
        // Nudge outward along the node's angle, like the ref's x offset.
        label.moveTo(d.depth === 0 ? [0, f.len(12), 0] : radialPoint(d.x!, f.len(d.y! + 16)));
        labels.add(label);
      }
    }

    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    this.add(...depths.map((d) => byDepth.get(d)!));
    await this.play(new LaggedStart(
      depths.map((d) => new FadeIn(byDepth.get(d)!, { scale: 0.85 })),
      { lagRatio: 0.55, runTime: 2.5 },
    ));
    await this.play(new FadeIn(labels, { runTime: 0.6 }));
    await this.wait(1);
  }
}

await demoRender(RadialTree, import.meta.url);
