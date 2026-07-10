// Port of D3 gallery: Sunburst component (ref/sunburst.js) — Flare package
// hierarchy as nested rings (partition layout in polar coordinates), each
// arc colored by its top-level ancestor via a rainbow sequential scale.
// Data: flare-2.json (the ref reads the equivalent flare.json).
// Divergences: labels are unrotated (plain horizontal) and only drawn on
// the largest arcs; arc padding is a constant-angle approximation.
// Surpass: rings sweep in with a per-depth stagger (the ref is static).

import {
  Scene, Text, Group, hierarchy, partition, arcShape, radialPoint,
  scaleSequential, interpolateRainbow, LaggedStart, FadeIn,
} from "../../src/node.ts";
import { demoRender, loadJson, svgFrame } from "./_run.ts";

const flare = loadJson("flare-2.json");

class Sunburst extends Scene {
  async construct() {
    const width = 1152, height = 1152, margin = 1;
    const radius = Math.min(width, height) / 2 - margin;
    const f = svgFrame(width, height);

    const root = hierarchy(flare)
      .sum((d: any) => Math.max(0, d.value ?? 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    partition().size([2 * Math.PI, radius])(root);

    // Color by top-level ancestor index over a rainbow (the ref's scale).
    const color = scaleSequential([0, root.children!.length], interpolateRainbow);
    root.children!.forEach((c, i) => ((c as any).index = i));
    const fillOf = (d: any) => {
      const top = d.ancestors().reverse()[1];
      return top == null ? "#cccccc" : color((top as any).index);
    };

    // One annular sector per node (angles are x0/x1, radii y0/y1); the
    // chart center (SVG 576,576) maps to the world origin, where arcShape
    // already lives.
    const rings = new Map<number, Group>();
    const labels = new Group();
    for (const d of root.descendants()) {
      const arc = arcShape({
        innerRadius: f.len(d.y0!),
        outerRadius: f.len(Math.max(d.y0!, d.y1! - 1)),
        startAngle: d.x0!,
        endAngle: d.x1!,
        padAngle: Math.min((d.x1! - d.x0!) / 2, (2 * 1) / radius),
        fillColor: fillOf(d), fillOpacity: 0.6, strokeWidth: 0,
      });
      if (!rings.has(d.depth)) rings.set(d.depth, new Group());
      rings.get(d.depth)!.add(arc);

      // Label the biggest arcs only (ref threshold is 10; we raise it and
      // keep labels horizontal for video legibility).
      if (d.depth > 0 && ((d.y0! + d.y1!) / 2) * (d.x1! - d.x0!) > 130) {
        const label = new Text((d.data as any).name, { fontSize: f.len(11), color: "#000000" });
        label.moveTo(radialPoint((d.x0! + d.x1!) / 2, f.len((d.y0! + d.y1!) / 2)));
        labels.add(label);
      }
    }

    const depths = [...rings.keys()].sort((a, b) => a - b);
    this.add(...depths.map((d) => rings.get(d)!));
    await this.play(new LaggedStart(
      depths.map((d) => new FadeIn(rings.get(d)!, { scale: 0.6 })),
      { lagRatio: 0.5, runTime: 2.5 },
    ));
    await this.play(new FadeIn(labels, { runTime: 0.6 }));
    await this.wait(1);
  }
}

await demoRender(Sunburst, import.meta.url);
