// Port of D3 gallery: Disjoint force-directed graph
// (ref/disjoint-force-directed-graph.js) — a citation graph with many
// disconnected components; forceX/forceY positioning forces (instead of
// forceCenter) keep detached subgraphs in frame. Nodes colored by group
// (schemeTableau10, groups sorted); links #999 at default 1.5 width.
// Data: graph.json. Surpass: the settling is the animation (live ticks).
// Divergence: deterministic seeded sim + exact O(n^2) many-body.

import {
  Scene, Circle, Line, VGroup, scaleOrdinal, schemeTableau10, tween,
  forceSimulation, forceLink, forceManyBody, forceX, forceY,
} from "../../src/node.ts";
import { demoRender, loadJson, svgFrame } from "./_run.ts";

const graph = loadJson("graph.json");

class DisjointForceGraph extends Scene {
  async construct() {
    const width = 928, height = 680;
    const f = svgFrame(width, height);

    const nodes = graph.nodes.map((d: any) => ({ ...d }));
    const links = graph.links.map((d: any) => ({ ...d }));

    const groups = [...new Set(nodes.map((d: any) => d.group))].sort();
    const color = scaleOrdinal(groups, schemeTableau10);

    const sim = forceSimulation(nodes, { seed: 1 })
      .force("link", forceLink(links, { id: (d: any) => d.id }))
      .force("charge", forceManyBody())
      .force("x", forceX())
      .force("y", forceY());

    // Centered viewBox: sim (x, y) -> svg px (x + w/2, y + h/2).
    const P = (x: number, y: number) => f.pt(x + width / 2, y + height / 2);

    const edges = links.map((l: any) => new Line(
      P(l.source.x, l.source.y), P(l.target.x, l.target.y),
      { strokeColor: "#999", strokeOpacity: 0.6, strokeWidth: f.sw(1.5) },
    ));
    const dots = nodes.map((d: any) => {
      const c = new Circle({
        radius: f.len(5), fillColor: color(d.group), fillOpacity: 1,
        strokeColor: "#fff", strokeWidth: f.sw(1.5),
      });
      c.moveTo(P(d.x, d.y));
      return c;
    });
    this.add(new VGroup(...edges), new VGroup(...dots));

    const reposition = () => {
      links.forEach((l: any, i: number) =>
        edges[i].putStartAndEndOn(P(l.source.x, l.source.y), P(l.target.x, l.target.y)));
      nodes.forEach((d: any, i: number) => dots[i].moveTo(P(d.x, d.y)));
    };

    const TICKS = 300;
    let done = 0;
    await this.play(tween(6, (t) => {
      void "17-disjoint"; // distinct source: tween() hashes the callback SOURCE
      const target = Math.round(t * TICKS);
      if (target > done) { sim.tick(target - done); done = target; }
      reposition();
    }));
    await this.wait(1.5);
  }
}

await demoRender(DisjointForceGraph, import.meta.url);
