// Port of D3 gallery: Hierarchical edge bundling
// (ref/hierarchical-edge-bundling.js) — flare class-import graph. The flat
// {name, imports} list becomes a tree by dot-path grouping (the ref's
// `hierarchy` cell), then cluster().size([2pi, r]) places leaves on a
// radial ring; each import edge follows i.path(o) through the hierarchy as
// a curveBundle (beta 0.85) bezier chain in #ccc. Data: flare.json.
// Divergences: no hover in/out coloring, no mix-blend multiply; leaf labels
// are drawn but tiny (10px at a 954px chart squeezed into frame).
// Surpass: labels appear, then edges fade in in radial batches.

import {
  Scene, Text, Group, hierarchy, cluster, bundleBeziers, bezierChainMobject,
  radialPoint, LaggedStart, AnimationGroup, FadeIn,
} from "../../src/node.ts";
import { demoRender, loadJson, svgFrame } from "./_run.ts";

const flat = loadJson("flare.json") as Array<{ name: string; imports: string[] }>;

// The ref's dot-delimited grouping: flat names -> {name, children} tree.
function buildTree(data: Array<{ name: string; children?: any[] }>): any {
  let root: any;
  const map = new Map<string, any>();
  data.forEach(function find(d: any): any {
    const { name } = d;
    if (map.has(name)) return map.get(name);
    const i = name.lastIndexOf(".");
    map.set(name, d);
    if (i >= 0) {
      find({ name: name.substring(0, i), children: [] }).children.push(d);
      d.name = name.substring(i + 1);
    } else root = d;
    return d;
  });
  return root;
}

const id = (n: any): string => (n.parent ? id(n.parent) + "." : "") + n.data.name;

class EdgeBundling extends Scene {
  async construct() {
    const width = 954, radius = width / 2;
    const f = svgFrame(width, width); // centered viewBox: chart center = origin

    const data = buildTree(flat.map((d) => ({ ...d, imports: d.imports ?? [] })));
    const root = hierarchy<any>(data).sort(
      (a, b) => a.height - b.height || (a.data.name < b.data.name ? -1 : a.data.name > b.data.name ? 1 : 0),
    );
    cluster<any>().size([2 * Math.PI, radius - 100])(root);

    const leaves = root.leaves();
    const byId = new Map(leaves.map((d) => [id(d), d]));

    // Leaf labels along the ring (rotated radially, flipped on the left half).
    const labels = new Group();
    for (const d of leaves) {
      const lab = new Text(d.data.name, { fontSize: f.len(10), color: "#000" });
      const flip = d.x! >= Math.PI;
      const dir = radialPoint(d.x!, 1); // unit radial direction
      const c = radialPoint(d.x!, f.len(d.y! + 6));
      lab.moveTo([c[0] + dir[0] * lab.getWidth() / 2, c[1] + dir[1] * lab.getWidth() / 2, 0]);
      lab.rotate(Math.PI / 2 - d.x! + (flip ? Math.PI : 0));
      labels.add(lab);
    }

    // One bundled bezier chain per import edge, through the hierarchy path.
    const edges = leaves.flatMap((leaf) =>
      (leaf.data.imports as string[]).map((imp) => {
        const pts = leaf.path(byId.get(imp)!).map((n) => radialPoint(n.x!, f.len(n.y!)));
        return bezierChainMobject(bundleBeziers(pts, 0.85), {
          strokeColor: "#ccc", strokeWidth: f.sw(1), strokeOpacity: 0.9,
        });
      }));

    await this.play(new FadeIn(labels, { runTime: 1 }));
    // Edges fade in in batches, sweeping around the ring.
    const BATCH = 64;
    const batches: any[][] = [];
    for (let i = 0; i < edges.length; i += BATCH) batches.push(edges.slice(i, i + BATCH));
    await this.play(new LaggedStart(
      batches.map((b) => new AnimationGroup(b.map((e) => new FadeIn(e)), { runTime: 1 })),
      { lagRatio: 0.35, runTime: 5 },
    ));
    await this.wait(1.5);
  }
}

await demoRender(EdgeBundling, import.meta.url);
