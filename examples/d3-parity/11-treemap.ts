// Port of D3 gallery: Treemap component (ref/treemap.js) — Flare package
// sizes tiled as nested rectangles, colored by top-level package.
// Data: flare-2.json (ref reads the equivalent flare-2.csv via stratify).
// Divergences: squarify tiling (the notebook's interactive default is
// binary); labels are the leaf name only (no camelCase splitting / value
// line), shown in the larger cells only.
// Surpass: cells grow in staggered by depth (the ref is static).

import {
  Scene, Rectangle, Text, Group, scaleOrdinal, schemeTableau10,
  hierarchy, treemap, treemapSquarify,
  LaggedStart, AnimationGroup, GrowFromCenter, FadeIn,
} from "../../src/node.ts";
import { demoRender, loadJson, svgFrame } from "./_run.ts";

const flare = loadJson("flare-2.json");

class Treemap extends Scene {
  async construct() {
    const width = 1152, height = 1152;
    const f = svgFrame(width, height);

    const root = hierarchy(flare)
      .sum((d: any) => Math.max(0, d.value ?? 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    treemap()
      .tile(treemapSquarify)
      .size([width, height])
      .padding(1)
      .round(true)(root);

    // Color leaves by their top-level ancestor (ref: d.name.split(".")[1]).
    const color = scaleOrdinal(root.children!.map((c) => (c.data as any).name), schemeTableau10);
    const topName = (d: any) => d.ancestors().reverse()[1]?.data.name;

    const byDepth = new Map<number, GrowFromCenter[]>();
    const labels = new Group();
    for (const leaf of root.leaves()) {
      const [x0, y0, x1, y1] = [leaf.x0!, leaf.y0!, leaf.x1!, leaf.y1!];
      const cell = new Rectangle({
        width: f.len(x1 - x0), height: f.len(y1 - y0),
        fillColor: color(topName(leaf)), fillOpacity: 0.6, strokeWidth: 0,
      });
      cell.moveTo(f.pt((x0 + x1) / 2, (y0 + y1) / 2));
      if (!byDepth.has(leaf.depth)) byDepth.set(leaf.depth, []);
      byDepth.get(leaf.depth)!.push(new GrowFromCenter(cell));
      this.add(cell);

      // Name label in the larger cells only (ref clips text to the cell).
      if (x1 - x0 > 58 && y1 - y0 > 22) {
        const label = new Text((leaf.data as any).name, { fontSize: f.len(10), color: "#000000" });
        if (label.getWidth() <= f.len(x1 - x0 - 6)) {
          label.moveTo(f.pt(x0 + 3, y0 + 11));
          label.shift([label.getWidth() / 2, 0, 0]); // left-align at the cell's top-left
          labels.add(label);
        }
      }
    }

    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    await this.play(new LaggedStart(
      depths.map((d) => new AnimationGroup(byDepth.get(d)!)),
      { lagRatio: 0.45, runTime: 2.5 },
    ));
    await this.play(new FadeIn(labels, { runTime: 0.6 }));
    await this.wait(1);
  }
}

await demoRender(Treemap, import.meta.url);
