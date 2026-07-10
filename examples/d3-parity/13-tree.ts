// Port of D3 gallery: Tidy tree + Cluster (ref/tree.js + ref/cluster.js) —
// one Tree component drives both layouts, so this port shows the tidy tree
// first, then MORPHS it into the cluster dendrogram (leaves aligned right).
// Data: flare-2.json, flare.animate subtree ONLY (22 nodes, mixed leaf
// depths so the two layouts differ visibly) — the refs draw all of flare.
// Divergences: cluster.js's height sort is omitted (keeps the morph
// correspondence obvious); bump links via linkHorizontalPoints.

import {
  Scene, Dot, Text, Group, hierarchy, tree, cluster,
  linkHorizontalPoints, bezierChainMobject, Transform, AnimationGroup, FadeIn, tweenTo,
} from "../../src/node.ts";
import { demoRender, loadJson, svgFrame } from "./_run.ts";

const flare = loadJson("flare-2.json");
const animate = flare.children.find((c: any) => c.name === "animate");

class TreeToCluster extends Scene {
  async construct() {
    const width = 928, padding = 1, dx = 10;
    const root = hierarchy(animate);
    const dy = width / (root.height + padding);

    // Tidy tree first, then cluster on the SAME nodes (positions overwritten).
    tree().nodeSize([dx, dy])(root);
    const tidy = new Map(root.descendants().map((d) => [d, { x: d.x!, y: d.y! }]));
    cluster().nodeSize([dx, dy])(root);
    const dendro = new Map(root.descendants().map((d) => [d, { x: d.x!, y: d.y! }]));

    // Frame from the union of both layouts (ref: height = x1 - x0 + 2dx).
    const all = [...tidy.values(), ...dendro.values()];
    const x0 = Math.min(...all.map((p) => p.x)), x1 = Math.max(...all.map((p) => p.x));
    const height = x1 - x0 + dx * 2;
    const f = svgFrame(width, height);
    // SVG px from layout coords (viewBox [-dy*padding/2, x0-dx, ...]).
    const px = (p: { x: number; y: number }) => [p.y + (dy * padding) / 2, p.x - x0 + dx];

    const linkStyle = { strokeColor: "#555555", strokeOpacity: 0.4, strokeWidth: f.sw(1.5) };
    const mkLink = (pos: Map<any, any>, s: any, t: any) => {
      const [p0, c1, c2, p1] = linkHorizontalPoints(
        f.pt(...(px(pos.get(s)!) as [number, number])),
        f.pt(...(px(pos.get(t)!) as [number, number])),
      );
      return bezierChainMobject({ start: p0, beziers: [[c1, c2, p1]] }, linkStyle);
    };

    const links = root.links().map((l) => mkLink(tidy, l.source, l.target));
    const dots: Dot[] = [], labels: Text[] = [];
    for (const d of root.descendants()) {
      const [sx, sy] = px(tidy.get(d)!);
      dots.push(new Dot({ point: f.pt(sx, sy), radius: f.len(3), color: d.children ? "#555555" : "#999999" }));
      const label = new Text((d.data as any).name, { fontSize: f.len(10), color: "#000000" });
      label.moveTo(f.pt(sx + (d.children ? -6 : 6), sy));
      label.shift([(d.children ? -1 : 1) * label.getWidth() / 2, 0, 0]); // d3 text-anchor end/start
      labels.push(label);
    }

    const chart = new Group(new Group(...links), new Group(...dots), new Group(...labels));
    this.add(chart);
    await this.play(new FadeIn(chart, { runTime: 1 }));
    await this.wait(1);

    // Morph tidy tree -> cluster dendrogram: nodes/labels tween to the new
    // positions; links transform into the recomputed bump curves.
    const nodes = root.descendants();
    const moves: any[] = root.links().map((l, i) => new Transform(links[i], mkLink(dendro, l.source, l.target)));
    nodes.forEach((d, i) => {
      const [sx, sy] = px(dendro.get(d)!);
      moves.push(tweenTo(dots[i], { position: f.pt(sx, sy) }, 1));
      const lp = f.pt(sx + (d.children ? -6 : 6), sy);
      lp[0] += (d.children ? -1 : 1) * labels[i].getWidth() / 2;
      moves.push(tweenTo(labels[i], { position: lp }, 1));
    });
    await this.play(new AnimationGroup(moves, { runTime: 1.5 }));
    await this.wait(1.5);
  }
}

await demoRender(TreeToCluster, import.meta.url);
