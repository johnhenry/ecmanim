// Port of D3 gallery: Chord diagram (ref/chord-diagram.js) — phone-brand
// switching survey (inline 8x8 matrix, Nadieh Bremer). chord() layout with
// descending subgroup/chord sort; outer group ring via arcShape; ribbons
// built from ribbonPoints (arc segments + quadratics through the center).
// Divergences: no tick marks / % labels on the ring (group name labels
// instead); no mix-blend-mode multiply; ribbon padAngle omitted (~0.0025 rad).
// Surpass: ring draws in, then ribbons grow/fade in group by group.

import {
  Scene, VMobject, Group, Text, chord, ribbonPoints, arcShape, radialPoint,
  LaggedStart, AnimationGroup, FadeIn,
} from "../../src/node.ts";
import type { RibbonSegment } from "../../src/layout/chord.ts";
import { demoRender, svgFrame } from "./_run.ts";

// The ref's inline data (rows: previous brand -> current brand shares).
const matrix = [
  [.096899, .008859, .000554, .004430, .025471, .024363, .005537, .025471],
  [.001107, .018272, .000000, .004983, .011074, .010520, .002215, .004983],
  [.000554, .002769, .002215, .002215, .003876, .008306, .000554, .003322],
  [.000554, .001107, .000554, .012182, .011628, .006645, .004983, .010520],
  [.002215, .004430, .000000, .002769, .104097, .012182, .004983, .028239],
  [.011628, .026024, .000000, .013843, .087486, .168328, .017165, .055925],
  [.000554, .004983, .000000, .003322, .004430, .008859, .017719, .004430],
  [.002215, .007198, .000000, .003322, .016611, .014950, .001107, .054264],
];
const names = ["Apple", "HTC", "Huawei", "LG", "Nokia", "Samsung", "Sony", "Other"];
const colors = ["#c4c4c4", "#69b40f", "#ec1d25", "#c8125c", "#008fc8", "#10218b", "#134b24", "#737373"];

// Append a circular arc (d3 chord angles, y-up world) as cubic beziers.
function appendChordArc(mob: VMobject, r: number, a0: number, a1: number): void {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 4)));
  for (let i = 1; i <= n; i++) {
    const b0 = a0 + ((i - 1) / n) * (a1 - a0);
    const b1 = a0 + (i / n) * (a1 - a0);
    const k = (4 / 3) * Math.tan(Math.abs(b1 - b0) / 4) * r;
    const s = Math.sign(b1 - b0);
    const p1 = radialPoint(b0, r), p2 = radialPoint(b1, r);
    mob.addCubicBezier(
      [p1[0] + s * k * Math.cos(b0), p1[1] - s * k * Math.sin(b0), 0],
      [p2[0] - s * k * Math.cos(b1), p2[1] + s * k * Math.sin(b1), 0],
      p2,
    );
  }
}

// d3.ribbon(): the segment list from ribbonPoints -> one filled VMobject.
function ribbonMobject(segs: RibbonSegment[], style: any): VMobject {
  const mob = new VMobject({ fillOpacity: 0.8, strokeWidth: 0, ...style });
  mob.startNewPath([segs[0].from[0], segs[0].from[1], 0]);
  for (const seg of segs) {
    if (seg.type === "arc") appendChordArc(mob, seg.radius, seg.startAngle, seg.endAngle);
    else mob.addCubicBezier(
      [seg.from[0] + (2 / 3) * (seg.control[0] - seg.from[0]), seg.from[1] + (2 / 3) * (seg.control[1] - seg.from[1]), 0],
      [seg.to[0] + (2 / 3) * (seg.control[0] - seg.to[0]), seg.to[1] + (2 / 3) * (seg.control[1] - seg.to[1]), 0],
      [seg.to[0], seg.to[1], 0],
    );
  }
  return mob;
}

class ChordDiagram extends Scene {
  async construct() {
    const width = 928, height = 928;
    const f = svgFrame(width, height); // centered viewBox: chart center = origin
    const outerRadius = Math.min(width, height) * 0.5 - 60;
    const innerRadius = outerRadius - 10;

    const { groups, chords } = chord({
      padAngle: 10 / innerRadius,
      sortSubgroups: (a, b) => b - a,
      sortChords: (a, b) => b - a,
    })(matrix);

    const ring = new Group();
    const labels = new Group();
    for (const g of groups) {
      ring.add(arcShape({
        innerRadius: f.len(innerRadius), outerRadius: f.len(outerRadius),
        startAngle: g.startAngle, endAngle: g.endAngle,
        fillColor: colors[g.index], fillOpacity: 1, strokeWidth: 0,
      }));
      const lab = new Text(names[g.index], { fontSize: f.len(18), color: "#000", weight: "bold" });
      lab.moveTo(radialPoint((g.startAngle + g.endAngle) / 2, f.len(outerRadius + 32)));
      labels.add(lab);
    }

    // Ribbons, grouped by source group for the staggered entrance.
    const bySource: VMobject[][] = groups.map(() => []);
    for (const c of chords) {
      bySource[c.source.index].push(ribbonMobject(
        ribbonPoints({ source: c.source, target: c.target, radius: f.len(innerRadius - 1) }),
        { fillColor: colors[c.source.index] },
      ));
    }

    await this.play(new LaggedStart(
      groups.map((g, i) => new AnimationGroup([new FadeIn(ring.submobjects[i]), new FadeIn(labels.submobjects[i])])),
      { lagRatio: 0.15, runTime: 1.5 },
    ));
    await this.play(new LaggedStart(
      bySource.filter((r) => r.length).map((ribbons) =>
        new AnimationGroup(ribbons.map((r) => new FadeIn(r, { scale: 0.85 })), { runTime: 1 })),
      { lagRatio: 0.3, runTime: 4 },
    ));
    await this.wait(1.5);
  }
}

await demoRender(ChordDiagram, import.meta.url);
