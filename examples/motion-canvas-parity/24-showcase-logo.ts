// Port of Motion Canvas examples repo: the animated MC logo
// (ref/showcase-logo.tsx). Three masked capsule "trails" scroll forever
// behind a spinning star that is CUT OUT of them — the whole thing built on
// CompositeGroup layers: each trail is masked by a fixed capsule via
// "destination-in", and the star's oversized petals erase the trails via
// "destination-out" before the white petals draw on top. The outer node's
// rotation(-45)/position(44)/scale(0.8) is applied to the finished
// assembly; trail slides move along the rotated axis (world-space model).

import {
  Scene, CompositeGroup, Group, RoundedRectangle, tweenTo,
} from "../../src/node.ts";
import { linear } from "../../src/animation/rate_functions.ts";
import * as V from "../../src/core/math/vector.ts";
import { demoRender, px, pxLen } from "./_run.ts";

const YELLOW = "#FFC66D";
const RED = "#FF6470";
const GREEN = "#99C47A";
const BLUE = "#68ABDF";

// MC <Rect width radius height fill/> — a capsule when radius = width/2.
function capsule(w: number, h: number, radius: number, fill: string): RoundedRectangle {
  return new RoundedRectangle({
    width: pxLen(w), height: pxLen(h), cornerRadius: pxLen(radius),
    fillColor: fill, fillOpacity: 1, strokeWidth: 0,
  });
}

// MC <Layout direction="column" gap={30} offsetY={-1}/> at local (x, topY):
// capsules stack downward from the column's TOP edge.
function trail(x: number, topY: number, heights: number[], fills: string[]): Group {
  const g = new Group();
  let y = topY;
  heights.forEach((h, i) => {
    const c = capsule(40, h, Math.min(20, h / 2), fills[i]);
    c.moveTo(px(x, y + h / 2));
    g.add(c);
    y += h + 30; // gap 30
  });
  return g;
}

// The fixed "destination-in" window: only where the mask is does the trail show.
function mask(x: number, topY: number, h: number): RoundedRectangle {
  const m = capsule(40, h, 20, "white");
  m.moveTo(px(x, topY + h / 2));
  m.compositeOperation = "destination-in";
  return m;
}

class ShowcaseLogo extends Scene {
  async construct() {
    // Local layout in MC pixel space (node y-offsets folded into topY).
    const trail1 = trail(0, -270, [120, 120, 120], [YELLOW, YELLOW, YELLOW]);
    const node1 = new CompositeGroup(trail1, mask(0, -270, 270));

    const trail2 = trail(-70, -200, [120, 120, 120], [RED, RED, RED]);
    const node2 = new CompositeGroup(trail2, mask(-70, -200, 180));

    const trail3 = trail(70, -300, [100, 100, 100, 100], [GREEN, BLUE, BLUE, BLUE]);
    const dot = trail3.submobjects[1] as RoundedRectangle;
    const node3 = new CompositeGroup(trail3, mask(70, -300 + 60, 220));

    // Star: 5 oversized "destination-out" petals erase the trails beneath,
    // then 5 white petals draw the star. offsetY=1 -> petal extends outward
    // from the origin; MC's clockwise degrees become negative world radians.
    const star = new Group();
    const petal = (w: number, h: number, r: number, i: number, cut: boolean) => {
      const p = capsule(w, h, r, "white");
      p.moveTo([0, pxLen(h) / 2, 0]);
      p.rotate((-(360 / 5) * i * Math.PI) / 180, { aboutPoint: [0, 0, 0] });
      if (cut) p.compositeOperation = "destination-out";
      return p;
    };
    for (let i = 0; i < 5; i++) star.add(petal(100, 150, 50, i, true));
    for (let i = 0; i < 5; i++) star.add(petal(40, 120, 20, i, false));

    const assembly = new CompositeGroup(node1, node2, node3, star);
    // Outer <Node rotation={-45} position={44} scale={0.8}>.
    const parentAngle = (45 * Math.PI) / 180; // -(-45deg) in world CCW
    assembly.rotate(parentAngle);
    assembly.scale(0.8);
    assembly.shift(px(44, 44));
    this.add(assembly);

    // A local upward slide of `n` px, in post-rotation/scale world terms.
    const slide = (n: number) => {
      const len = pxLen(n) * 0.8;
      return [-len * Math.sin(parentAngle), len * Math.cos(parentAngle), 0];
    };

    // loop(4): trail1 up 150px over 1s, snap back — an endless dash scroll.
    const loopTrail = (t: Group, dist: number, dur: number, times: number) => {
      const home = t.getCenter();
      const target = V.add(home, slide(dist));
      return function* () {
        for (let i = 0; i < times; i++) {
          yield tweenTo(t, { position: target }, dur, linear);
          t.moveTo(home);
        }
      };
    };
    this.spawn(loopTrail(trail1, 150, 1, 4));
    this.spawn(loopTrail(trail2, 150, 2, 2));
    const dotHome = dot.getCenter();
    this.spawn(function* () {
      for (let i = 0; i < 2; i++) {
        yield tweenTo(dot, { fill: GREEN }, 2, linear);
        dot.setFill(BLUE);
      }
    });
    this.spawn(loopTrail(trail3, 130, 2, 2));

    // all(star.rotation(360, 4, linear), ...loops) — the star spin is the
    // foreground play; the loops ride the same 4s clock in the background.
    await this.play(tweenTo(star, { rotation: -2 * Math.PI }, 4, linear));
  }
}

await demoRender(ShowcaseLogo, import.meta.url);
