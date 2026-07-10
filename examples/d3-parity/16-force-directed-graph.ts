// Port of D3 gallery: Force-directed graph (ref/force-directed-graph.js) —
// character co-occurrence in Les Misérables, d3-force layout, nodes colored
// by group (schemeTableau10), link width = sqrt(value).
// Data: miserables.json (Stanford Graph Base).
// Surpass: THE SETTLING IS THE ANIMATION — the simulation ticks live on
// screen from the phyllotaxis spiral to the settled organic network.
// Divergence: deterministic seeded sim (seed 1), exact O(n^2) many-body
// (see src/layout/force.ts), so the settled shape differs slightly from d3.

import {
  Scene, Circle, Line, VGroup, scaleOrdinal, schemeTableau10, tween,
  forceSimulation, forceLink, forceManyBody, forceCenter,
} from "../../src/node.ts";
import { demoRender, loadJson, svgFrame } from "./_run.ts";

const miserables = loadJson("miserables.json");

class ForceDirectedGraph extends Scene {
  async construct() {
    const width = 928, height = 600;
    const f = svgFrame(width, height);

    // Mutable copies for the simulation (the ref rebuilds {id}/{source,target}).
    const nodes = miserables.nodes.map((d: any) => ({ ...d }));
    const links = miserables.links.map((d: any) => ({ ...d }));

    const groups = [...new Set(nodes.map((d: any) => d.group))].sort((a: any, b: any) => a - b);
    const color = scaleOrdinal(groups, schemeTableau10);

    const sim = forceSimulation(nodes, { seed: 1 })
      .force("link", forceLink(links, { id: (d: any) => d.id }))
      .force("charge", forceManyBody())
      .force("center", forceCenter());

    // The ref's viewBox is centered: sim (x, y) -> svg px (x + w/2, y + h/2).
    const P = (x: number, y: number) => f.pt(x + width / 2, y + height / 2);

    const edges = links.map((l: any) => new Line(
      P(l.source.x, l.source.y), P(l.target.x, l.target.y),
      { strokeColor: "#999", strokeOpacity: 0.6, strokeWidth: f.sw(Math.sqrt(l.value)) },
    ));
    const dots = nodes.map((d: any) => {
      const c = new Circle({
        radius: f.len(5), fillColor: color(d.group), fillOpacity: 1,
        strokeColor: "#fff", strokeWidth: f.sw(1.5),
      });
      c.moveTo(P(d.x, d.y));
      return c;
    });
    this.add(new VGroup(...edges), new VGroup(...dots)); // links under nodes

    const reposition = () => {
      links.forEach((l: any, i: number) =>
        edges[i].putStartAndEndOn(P(l.source.x, l.source.y), P(l.target.x, l.target.y)));
      nodes.forEach((d: any, i: number) => dots[i].moveTo(P(d.x, d.y)));
    };

    // Settle: 300 ticks (d3's static-layout count) spread over the tween.
    const TICKS = 300;
    let done = 0;
    await this.play(tween(6, (t) => {
      const target = Math.round(t * TICKS);
      if (target > done) { sim.tick(target - done); done = target; }
      reposition();
    }));
    await this.wait(1.5); // hold the settled network
  }
}

await demoRender(ForceDirectedGraph, import.meta.url);
