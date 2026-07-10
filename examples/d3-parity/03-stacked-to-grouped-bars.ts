// Port of D3 gallery: Stacked-to-Grouped Bars (ref/stacked-to-grouped-bars.js)
// — n=5 series of m=58 synthetic "bumps" values, stacked with d3.stack, then
// transitioning stacked → grouped → stacked (500ms two-phase moves + i*20ms
// per-column delays, like the ref). Data: seeded bumps() (useRandom), so the
// render is deterministic where the notebook uses Math.random().

import {
  Scene, Rectangle, Line, scaleBand, scaleLinear, scaleSequential,
  interpolateBlues, stack, rangeOf, max, AnimationGroup, tweenTo, useRandom,
} from "../../src/node.ts";
import { demoRender, svgFrame } from "./_run.ts";

// The notebook's bumps(m): uniform noise + five gaussian bumps, clamped >= 0.
const rng = useRandom(7);
function bumps(m: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < m; ++i) values[i] = 0.1 + 0.1 * rng.nextFloat();
  for (let j = 0; j < 5; ++j) {
    const x = 1 / (0.1 + rng.nextFloat());
    const y = 2 * rng.nextFloat() - 0.5;
    const z = 10 / (0.1 + rng.nextFloat());
    for (let i = 0; i < m; i++) {
      const w = (i / m - y) * z;
      values[i] += x * Math.exp(-w * w);
    }
  }
  return values.map((v) => Math.max(0, v));
}

class StackedToGroupedBars extends Scene {
  async construct() {
    const width = 928, height = 500;
    const marginBottom = 10;
    const n = 5, m = 58;
    const f = svgFrame(width, height);

    const yz = rangeOf(n).map(() => bumps(m)); // yz[series][column]
    const keys = rangeOf(n).map(String);
    // d3.stack().keys(range(n))(transpose(yz)): rows = columns of yz.
    const rows = rangeOf(m).map((j) => Object.fromEntries(keys.map((k, i) => [k, yz[i][j]])));
    const y01z = stack({ keys })(rows); // y01z[series][column] = [y0, y1]

    const yMax = max(yz.flat());
    const y1Max = max(y01z.flat(), (d) => d[1]);

    const x = scaleBand(rangeOf(m), [0, width]).padding(0.08).round(true);
    const y = scaleLinear([0, y1Max], [height - marginBottom, 0]);
    const color = scaleSequential([-0.5 * n, 1.5 * n], interpolateBlues);

    // Rects start with ~zero height at the baseline (the ref appends them
    // with y = baseline, height = 0, then transitions to stacked).
    const rects: Array<{ mob: Rectangle; i: number; j: number; d: [number, number] }> = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const mob = new Rectangle({
          width: f.len(x.bandwidth()), height: f.len(0.01),
          fillColor: color(i), fillOpacity: 1, strokeWidth: 0,
        });
        mob.moveTo(f.pt(x(j) + x.bandwidth() / 2, height - marginBottom));
        rects.push({ mob, i, j, d: y01z[i][j] as unknown as [number, number] });
        this.add(mob);
      }
    }
    // Bottom axis: domain line + unlabeled band ticks (tickFormat "").
    const y0px = height - marginBottom;
    this.add(new Line({ start: f.pt(0, y0px), end: f.pt(width, y0px), strokeColor: "#000", strokeWidth: f.sw(1) }));
    for (let j = 0; j < m; j++) {
      const cx = x(j) + x.bandwidth() / 2;
      this.add(new Line({ start: f.pt(cx, y0px), end: f.pt(cx, y0px + 6), strokeColor: "#000", strokeWidth: f.sw(1) }));
    }

    // Target geometries (SVG px, center-anchored for tweenTo).
    const stackedGeom = ({ d, j }: { d: [number, number]; j: number }) => {
      y.domain([0, y1Max]);
      return { x: x(j) + x.bandwidth() / 2, w: x.bandwidth(), top: y(d[1]), bot: y(d[0]) };
    };
    const groupedGeom = ({ d, i, j }: { d: [number, number]; i: number; j: number }) => {
      y.domain([0, yMax]);
      const w = x.bandwidth() / n;
      return { x: x(j) + w * i + w / 2, w, top: y(d[1] - d[0]), bot: y(0) };
    };

    // Two-phase transitions with per-column delay, like the ref: grouped
    // moves x/width first then y/height; stacked moves y/height first.
    // The _hashExtra tag works around a library bug: AnimationGroup doesn't
    // fold its children into the segment hash, so same-shaped transitions
    // collide in the partial-movie cache and replay the wrong clip.
    const transition = (label: string, geom: typeof stackedGeom, xFirst: boolean) => {
      const group = new AnimationGroup(rects.map((r) => {
        const g = geom(r);
        const xw = { x: f.pt(g.x, 0)[0], width: f.len(g.w) };
        const yh = { y: f.pt(0, (g.top + g.bot) / 2)[1], height: f.len(Math.max(0.01, g.bot - g.top)) };
        const chain = tweenTo(r.mob, {}, r.j * 0.02);
        return xFirst ? chain.to(xw, 0.5).to(yh, 0.5) : chain.to(yh, 0.5).to(xw, 0.5);
      }));
      (group as any)._hashExtra = () => `layout:${label}`;
      return group;
    };

    await this.play(transition("stacked-in", stackedGeom, false)); // grow in, stacked
    await this.wait(1);
    await this.play(transition("grouped", groupedGeom, true));
    await this.wait(1);
    await this.play(transition("stacked", stackedGeom, false));
    await this.wait(1);
  }
}

await demoRender(StackedToGroupedBars, import.meta.url);
