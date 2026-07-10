// Recreation of the "Hilbert's curve" visual (3b1b, 2017): the space-filling
// curve refined order 1 -> 6, each refinement a smooth point-interpolation,
// with a rainbow gradient along arc length showing locality (nearby colors
// stay nearby through every refinement). Recreation of the visual, not a
// code port.

import {
  Scene, VMobject, VGroup, Text, Transform, Create, FadeIn,
  hilbertCurve, interpolateRainbow, GRAY,
} from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SIZE = 6;    // world extent of the unit square
const SEG = 256;   // fixed segment count per order -> segment i morphs to segment i
// Every segment at every order carries exactly this many bezier curves.
// WORKAROUND for an ecmanim bug: Transform.setup() aligns points only on the
// top-level mobject, not on family members, and VMobject.interpolate()
// truncates to min(points.length) — so VGroup submobjects with mismatched
// point counts morph to just a leading fraction of their target (the curve
// dissolved into dashes). Pre-padding all segments to a fixed curve count
// via insertNCurves makes every submobject pair 1:1.
const CURVES = 20; // >= max corners/segment at order 6 (4095/256 ≈ 16 edges)

// Build one order of the curve as a VGroup of SEG short polylines, each
// covering the same arc-length window [j/SEG, (j+1)/SEG] at every order and
// colored by that window's position along the curve. Because Hilbert edges
// are all equal length, index-proportion === arc-length proportion, and
// because window j of order k maps to window j of order k+1, Transform
// morphs locally (no scrambling) with colors pinned per segment.
function buildOrder(order: number): VGroup {
  // hilbertCurve centers points in grid cells, so order k spans only
  // (n-1)/n of the unit square (n = 2^k); stretch so every order fills
  // the same SIZE x SIZE region.
  const n = 1 << order;
  const stretch = n / (n - 1);
  const pts = hilbertCurve(order).map(([x, y]) =>
    [(x - 0.5) * SIZE * stretch, (y - 0.5) * SIZE * stretch, 0]);
  const nEdges = pts.length - 1;
  // Point at fractional edge-index f in [0, nEdges].
  const at = (f: number): number[] => {
    const i = Math.max(0, Math.min(nEdges - 1, Math.floor(f)));
    const t = f - i;
    const a = pts[i], b = pts[i + 1];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0];
  };
  const group = new VGroup();
  const strokeWidth = order <= 2 ? 6 : order <= 4 ? 4 : 2.5;
  for (let j = 0; j < SEG; j++) {
    const f0 = (j / SEG) * nEdges;
    const f1 = ((j + 1) / SEG) * nEdges;
    const corners: number[][] = [at(f0)];
    for (let i = Math.floor(f0) + 1; i <= Math.floor(f1); i++) {
      if (i > f0 && i < f1) corners.push(pts[i]);
    }
    corners.push(at(f1));
    // interpolateRainbow is cyclic (ends meet); stop at 0.92 so the tail
    // doesn't wrap back to the head color.
    const color = interpolateRainbow((j / (SEG - 1)) * 0.92);
    const seg = new VMobject({ strokeColor: color, strokeWidth, fillOpacity: 0 });
    seg.setPointsAsCorners(corners);
    const cur = seg.getNumCurves();
    if (cur < CURVES) seg.insertNCurves(CURVES - cur);
    group.add(seg);
  }
  return group;
}

class HilbertCurve extends Scene {
  async construct() {
    const title = new Text("Hilbert curve", { fontSize: 0.5, color: "#FFFFFF" });
    title.moveTo([-4.7, 3.4, 0]);
    this.add(title);

    const curve = buildOrder(1);
    let label = new Text("order 1", { fontSize: 0.38, color: GRAY });
    label.moveTo([-4.9, 2.7, 0]);

    await this.play(
      new Create(curve, { lagRatio: 0.004, runTime: 2 }),
      new FadeIn(label),
      { _playConfig: true },
    );
    await this.wait(0.7);

    for (let order = 2; order <= 6; order++) {
      const next = buildOrder(order);
      const nextLabel = new Text(`order ${order}`, { fontSize: 0.38, color: GRAY });
      nextLabel.moveTo(label.getCenter());
      this.remove(label); // instant swap at morph start (no lingering ghost)
      this.add(nextLabel);
      label = nextLabel;
      await this.play(new Transform(curve, next), { _playConfig: true, runTime: 1.5 });
      await this.wait(order === 6 ? 0 : 0.55);
    }
    await this.wait(1.8);
  }
}

await demoRender(HilbertCurve, import.meta.url);
