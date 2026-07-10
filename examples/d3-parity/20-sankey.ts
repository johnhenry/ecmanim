// Port of D3 gallery: Sankey diagram (ref/sankey.js) — UK energy flows
// (supplies left, demands right), justify-aligned sankey() layout, node
// rectangles colored by the first word of the name (schemeTableau10),
// links as stroked cubic beziers (width = flow) colored by SOURCE node
// at 0.5 opacity (the ref's "source" linkColor option; its default
// source-target gradient isn't supported — divergence). Data: energy.json
// (nodes + index links; loads cleaner than re-deriving nodes from the csv).
// Surpass: nodes+labels appear, then links draw on left-to-right by layer.

import {
  Scene, Rectangle, VMobject, Text, Group, VGroup, scaleOrdinal, schemeTableau10,
  sankey, sankeyLinkHorizontalPoints, LaggedStart, AnimationGroup, FadeIn, tweenTo,
} from "../../src/node.ts";
import { demoRender, loadJson, svgFrame } from "./_run.ts";

const energy = loadJson("energy.json");

class Sankey extends Scene {
  async construct() {
    const width = 928, height = 600;
    const f = svgFrame(width, height);

    const nodes = energy.nodes.map((d: any) => ({ ...d }));
    const links = energy.links.map((d: any) => ({ ...d }));
    sankey({
      nodeWidth: 15, nodePadding: 10,
      extent: [[1, 5], [width - 1, height - 5]],
    })({ nodes, links });

    const group = (d: any) => d.name.split(/\W/)[0];
    const color = scaleOrdinal(nodes.map(group), schemeTableau10);

    const rects = new VGroup();
    const labels = new Group();
    for (const d of nodes) {
      const r = new Rectangle({
        width: f.len(d.x1 - d.x0), height: f.len(d.y1 - d.y0),
        fillColor: color(group(d)), fillOpacity: 1, strokeColor: "#000", strokeWidth: f.sw(0.75),
      });
      r.moveTo(f.pt((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2));
      rects.add(r);
      const lab = new Text(d.name, { fontSize: f.len(10), color: "#000" });
      const onLeft = d.x0 < width / 2;
      lab.moveTo(f.pt(onLeft ? d.x1 + 6 : d.x0 - 6, (d.y0 + d.y1) / 2));
      lab.shift([(onLeft ? 1 : -1) * lab.getWidth() / 2, 0, 0]);
      labels.add(lab);
    }

    const ribbons = links.map((l: any) => {
      const [p0, c1, c2, p1] = sankeyLinkHorizontalPoints(l);
      const mob = new VMobject({
        strokeColor: color(group(l.source)), strokeOpacity: 0.5,
        strokeWidth: f.sw(Math.max(1, l.width)), fillOpacity: 0,
        lineCap: "butt", // round caps would balloon past the node rects
      });
      mob.startNewPath(f.pt(p0[0], p0[1]));
      mob.addCubicBezier(f.pt(c1[0], c1[1]), f.pt(c2[0], c2[1]), f.pt(p1[0], p1[1]));
      mob.strokeEnd = 0; // drawn on during the intro
      return mob;
    });

    this.add(new Group(...ribbons), rects, labels); // links under nodes
    await this.play(new LaggedStart(
      nodes.map((d: any, i: number) =>
        new AnimationGroup([new FadeIn(rects.submobjects[i]), new FadeIn(labels.submobjects[i])])),
      { lagRatio: 0.02, runTime: 1.5 },
    ));
    // Links draw source->target, staggered by source layer (left to right).
    const order = links.map((l: any, i: number) => i)
      .sort((a: number, b: number) => links[a].source.layer - links[b].source.layer || links[a].y0 - links[b].y0);
    await this.play(new LaggedStart(
      order.map((i: number) => tweenTo(ribbons[i], { end: 1 }, 1.2)),
      { lagRatio: 0.05, runTime: 5 },
    ));
    await this.wait(1.5);
  }
}

await demoRender(Sankey, import.meta.url);
