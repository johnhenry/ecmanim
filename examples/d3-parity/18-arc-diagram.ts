// Port of D3 gallery: Arc diagram (ref/arc-diagram.js) — Les Misérables
// characters on a vertical line (labels + dots at x=130), semicircular arcs
// for co-occurrence links bulging right; links colored by group when both
// endpoints share a group, #aaa otherwise. Data: miserables.json.
// Order: "by group" (the ref's demo order after its synthetic input event).
// Divergences: no hover interaction / order transition; label color is the
// group color darkened (approximating d3.lab(color).darker(2)).
// Surpass: arcs draw on node-by-node (LaggedStart, top to bottom).

import {
  Scene, ArcBetweenPoints, Circle, Text, VGroup, Group, scalePoint, scaleOrdinal,
  schemeCategory10, Color, LaggedStart, AnimationGroup, Create, FadeIn,
} from "../../src/node.ts";
import { demoRender, loadJson, svgFrame } from "./_run.ts";

const miserables = loadJson("miserables.json");

class ArcDiagram extends Scene {
  async construct() {
    const nodes = miserables.nodes as Array<{ id: string; group: number }>;
    const links = miserables.links as Array<{ source: string; target: string; value: number }>;

    const width = 640, step = 14;
    const marginTop = 20, marginBottom = 20, marginLeft = 130;
    const height = (nodes.length - 1) * step + marginTop + marginBottom;
    const f = svgFrame(width, height);

    // "by group" order: sort by group, then id (the ref's orders map).
    const order = nodes.slice()
      .sort((a, b) => a.group - b.group || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((d) => d.id);
    const y = scalePoint(order, [marginTop, height - marginBottom]);

    const color = scaleOrdinal(
      [...new Set(nodes.map((d) => d.group))].sort((a, b) => a - b),
      schemeCategory10,
    );
    const groupOf = new Map(nodes.map((d) => [d.id, d.group]));
    const samegroup = (l: { source: string; target: string }) =>
      groupOf.get(l.source) === groupOf.get(l.target) ? groupOf.get(l.source) : null;

    // Labels + dots per node.
    const labels = new Group();
    const dots = new VGroup();
    for (const d of nodes) {
      const dot = new Circle({
        radius: f.len(3), fillColor: color(d.group), fillOpacity: 1, strokeWidth: 0,
      });
      dot.moveTo(f.pt(marginLeft, y(d.id)));
      dots.add(dot);
      const lab = new Text(d.id, {
        fontSize: f.len(10), color: Color.parse(color(d.group)).darker(0.45),
      });
      lab.moveTo(f.pt(marginLeft - 6, y(d.id)));
      lab.shift([-lab.getWidth() / 2, 0, 0]); // text-anchor: end
      labels.add(lab);
    }

    // Semicircular arcs, all bulging right of the node line (the ref's
    // sweep flags produce exactly this for either link direction).
    const arcsByTopNode = new Map<string, any[]>();
    for (const l of links) {
      const g = samegroup(l);
      const [ya, yb] = [y(l.source), y(l.target)].sort((a, b) => a - b);
      if (yb - ya < 1e-6) continue;
      const arc = new ArcBetweenPoints(f.pt(marginLeft, ya), f.pt(marginLeft, yb), -Math.PI, undefined, {
        strokeColor: g == null ? "#aaa" : color(g), strokeOpacity: 0.6,
        strokeWidth: f.sw(1.5), fillOpacity: 0,
      });
      const top = y(l.source) <= y(l.target) ? l.source : l.target;
      (arcsByTopNode.get(top) ?? arcsByTopNode.set(top, []).get(top)!).push(arc);
    }

    this.add(labels, dots);
    // Draw arcs on, grouped by their topmost node, top to bottom.
    const perNode = order
      .filter((id) => arcsByTopNode.has(id))
      .map((id) => new AnimationGroup(arcsByTopNode.get(id)!.map((a) => new Create(a)), { runTime: 0.9 }));
    await this.play(new LaggedStart(perNode, { lagRatio: 0.06, runTime: 6 }));
    await this.wait(1.5);
  }
}

await demoRender(ArcDiagram, import.meta.url);
