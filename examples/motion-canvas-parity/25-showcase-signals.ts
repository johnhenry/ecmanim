// Port of Motion Canvas examples repo: the "SIGNALS" network showcase
// (ref/showcase-signals.tsx) — the finale. A network of dots pulses with
// traveling line segments picked by a seeded RNG (useRandom(4), like the
// original) while "SIGNALS" types on; everything slides away at the 'next'
// time event into the reactive circle/square/arrow vignette.
//
// Honest divergences (single-scene, world-space model): MC's reactive
// arrow position binding is drawn at its final coordinates (it only
// becomes visible after the circle lands); the dashed arc renders as a
// solid rounded polyline + a triangle tip; join(infinite-loop) becomes
// two more pulse cycles then cancel.

import {
  Scene, Circle, Line, PolyLine, RoundedRectangle, Triangle, Group, Text,
  tweenTo, tween, useRandom, AnimationGroup,
} from "../../src/node.ts";
import { linear, easeOutCubic } from "../../src/animation/rate_functions.ts";
import { demoRender, px, pxLen } from "./_run.ts";

const positions: Array<[number, number]> = [
  [813, -181], [-535, -452], [-511, 9], [-812, 511], [234, 206],
  [514, -142], [746, 305], [55, 462], [-231, -231], [452, -465],
  [720, -31], [-292, 211], [-843, 172], [-700, -170], [85, -509],
  [-28, 43], [509, 124],
];

const BLUE = "#68ABDF";
const DARK = "#242424";

class ShowcaseSignals extends Scene {
  async construct() {
    const random = useRandom(4);
    const lineGroup = new Group();
    const circleGroup = new Group();
    const mainLineGroup = new Group();
    const signals = positions.map(([x, y]) => {
      const c = new Circle({ radius: pxLen(20) / 2, fillColor: DARK, fillOpacity: 1, strokeWidth: 0 });
      c.moveTo(px(x, y));
      c.setOpacity(0);
      circleGroup.add(c);
      return c;
    });
    // MC types the label on with label().text('SIGNALS', 1, linear). Text
    // here is a single raster leaf, so build one Text PER LETTER (fontSize
    // is world units: 120 MC px -> pxLen(120)) and reveal them in order.
    const label = new Group();
    const letters = "SIGNALS".split("").map((ch, i) => {
      const t = new Text(ch, { fontSize: pxLen(120), color: "#FFFFFF" });
      t.moveTo([(i - 3) * pxLen(120) * 0.74, 0, 0]);
      t.setOpacity(0);
      label.add(t);
      return t;
    });
    this.add(lineGroup, circleGroup, mainLineGroup, label);

    // signals[0] lights up, then fades back; SIGNALS types on (per-glyph
    // reveal, our typewriter for MC's label().text('SIGNALS', 1, linear)).
    signals[0].setFill(BLUE);
    this.spawn(function* () {
      yield tweenTo(signals[0], { opacity: 1 }, 0.1);
      yield 1.7 - 0.1;
      yield tweenTo(signals[0], { fill: DARK }, 1, linear);
    });
    this.spawn(() => [tween(1, (t) => {
      const n = Math.floor(t * letters.length);
      letters.forEach((g, i) => g.setOpacity(i < n ? 0.6 : 0));
    }, linear)][Symbol.iterator]());

    // The endless network pulse (MC's loop(Infinity, ...)): from `current`,
    // pick 2-4 targets with the seeded RNG; secondary lines travel out and
    // die (end then start), the main line lands on the next dot and lights
    // it blue, then fades. Composed per iteration as one AnimationGroup of
    // TweenChains (hold segments stand in for MC's delay()).
    let current = 0;
    const task = this.spawn(() => (function* (scene: ShowcaseSignals) {
      for (;;) {
        const start = signals[current];
        const count = random.nextInt(2, 4);
        const ids = random.intArray(count, 2, signals.length - 2);
        ids[0] = 1;
        const targets = ids.map((n) => signals[(current + n) % signals.length]);
        current = (current + ids[0]) % signals.length;

        const anims: any[] = [];
        const mkLine = (to: Circle, color: string) => {
          const l = new Line({
            start: start.getCenter(), end: to.getCenter(),
            strokeWidth: 8, strokeColor: color,
          });
          (l as any).strokeEnd = 0;
          return l;
        };
        // Secondary pulses.
        for (let i = 1; i < count; i++) {
          const line = mkLine(targets[i], DARK);
          lineGroup.add(line);
          const speed = Math.hypot(
            ...start.getCenter().map((v, k) => v - targets[i].getCenter()[k]),
          ) * 135 / 1500;
          anims.push(tweenTo(line, { end: 1 }, speed).to({ start: 1 }, speed));
          anims.push(tweenTo(targets[i], { opacity: targets[i].opacity ?? 0 }, Math.max(0.01, speed - 0.1))
            .to({ opacity: 1 }, 0.1));
        }
        // Main pulse: land, light the dot, afterglow fade.
        const main = mkLine(targets[0], BLUE);
        mainLineGroup.add(main);
        const speed = Math.hypot(
          ...start.getCenter().map((v, k) => v - targets[0].getCenter()[k]),
        ) * 135 / 1500;
        anims.push(tweenTo(main, { end: 1 }, speed, linear).wait(1).to({ opacity: 0 }, 1, linear));
        anims.push(tweenTo(targets[0], { opacity: targets[0].opacity ?? 0 }, Math.max(0.01, speed - 0.1))
          .to({ opacity: 1, fill: BLUE }, 0.1).wait(1).to({ fill: DARK }, 1, linear));
        yield new AnimationGroup(anims);
        for (const l of [...lineGroup.submobjects]) lineGroup.remove(l);
        for (const l of [...mainLineGroup.submobjects]) mainLineGroup.remove(l);
      }
    })(this));

    // waitUntil('next'): let a few pulses play, then sweep everything up.
    await this.waitUntil("next", 6);
    await this.play(
      tweenTo(label, { y: label.getCenter()[1] + pxLen(1400) }, 1),
      tweenTo(lineGroup, { y: lineGroup.getCenter()[1] + pxLen(1080) }, 1),
      tweenTo(mainLineGroup, { y: mainLineGroup.getCenter()[1] + pxLen(1080) }, 1),
      tweenTo(circleGroup, { y: circleGroup.getCenter()[1] + pxLen(1080) }, 1),
    );
    task.cancel();
    this.remove(lineGroup, circleGroup, mainLineGroup, label);

    // --- The reactive circle / square / arrow vignette ---
    const circle = new Circle({ radius: pxLen(240) / 2, fillColor: BLUE, fillOpacity: 1, strokeWidth: 0 });
    // MC scale={0}: shrink AND tell the tween adapter, so `scale: 1.5`
    // later means 1.5x the authored size (absolute, like MC).
    circle.scale(1e-3);
    (circle as any).__tweenScale = 1e-3;
    const square = new RoundedRectangle({
      width: pxLen(240), height: pxLen(240), cornerRadius: pxLen(8),
      fillColor: "#ff6470", fillOpacity: 1, strokeWidth: 0,
    });
    square.moveTo(px(480, 0));
    square.scale(1e-3);
    (square as any).__tweenScale = 1e-3;
    const arrow = new PolyLine({
      points: [px(-480, 0), px(0, 480), px(480, 0)],
      radius: pxLen(480), strokeColor: "#666666", strokeWidth: 8,
    });
    (arrow as any).strokeEnd = 0;
    (arrow as any).strokeStart = 0.12;
    const tip = new Triangle({ fillColor: "#666666", fillOpacity: 1, strokeWidth: 0 });
    tip.setWidth(pxLen(40));
    tip.moveTo(px(400, 100));
    tip.rotate(-Math.PI / 3);
    tip.setOpacity(0);
    this.add(circle, square, arrow, tip);

    await this.waitUntil("circle", 0.5);
    await this.play(tweenTo(circle, { scale: 1.5 }, 0.5, easeOutCubic));
    const task2 = this.loopForever(() => new AnimationGroup([
      tweenTo(circle, { scale: 1 }, 1).to({ scale: 1.5 }, 1),
      tweenTo(square, { rotation: (65 * Math.PI) / 180 }, 1).to({ rotation: (25 * Math.PI) / 180 }, 1),
    ]));

    await this.waitUntil("square", 1.5);
    await this.play(
      tweenTo(circle, { x: px(-480)[0] }, 0.6),
      tweenTo(square, { scale: 1.25 }, 0.6),
      tweenTo(arrow, { end: 0.88 }, 0.6),
      tweenTo(tip, { opacity: tip.opacity ?? 0 }, 0.5).to({ opacity: 1 }, 0.1),
    );

    // waitUntil('end') + join(task2): two more pulse cycles, then stop.
    await this.waitUntil("end", 4);
    task2.cancel();
  }
}

await demoRender(ShowcaseSignals, import.meta.url);
