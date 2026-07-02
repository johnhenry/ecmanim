// Frame-snapshot (visual regression) tests. Each test renders a canonical
// scene through the real CPU pipeline and compares captured frames against
// golden PNGs in test/golden/. These are the only tests that protect against
// "it still runs but looks wrong" regressions (stroke rendering, fills,
// transforms, easing, coordinate systems).
//
//   Regenerate after an intended visual change:  UPDATE_SNAPSHOTS=1 npm test
//   A failing test writes <name>.actual.png next to the golden for inspection.
//
// Scenes deliberately use only vector geometry (no system-font text), so the
// goldens are stable across machines.

import { test } from "node:test";
import assert from "node:assert";
import { Scene } from "../src/scene/Scene.ts";
import { Circle, Square, Triangle, Line } from "../src/mobject/geometry.ts";
import { Axes } from "../src/mobject/coordinate_systems.ts";
import { VGroup } from "../src/mobject/VMobject.ts";
import { Create, Transform, FadeIn } from "../src/animation/Animation.ts";
import { BLUE, GREEN, RED, YELLOW, WHITE } from "../src/core/color.ts";
import { captureFrames, matchSnapshot, loadNapiCanvas } from "./_snapshot_util.ts";

const canvasAvailable = await loadNapiCanvas().then((m) => !!m);

// -- scenes -------------------------------------------------------------------

class ShapesScene extends Scene {
  async construct() {
    const circle = new Circle({ radius: 1, color: BLUE, fillColor: BLUE, fillOpacity: 0.6 });
    circle.shift([-2.5, 0.8, 0]);
    const square = new Square({ sideLength: 1.6, color: GREEN, strokeWidth: 6 });
    square.shift([0, -0.8, 0]);
    const tri = new Triangle({ color: RED, fillColor: YELLOW, fillOpacity: 0.4 });
    tri.shift([2.5, 0.8, 0]).scale(1.2).rotate(Math.PI / 5);
    this.add(circle, square, tri);
    await this.wait(0.2);
  }
}

class TransformScene extends Scene {
  async construct() {
    const c = new Circle({ radius: 1.3, color: BLUE, fillColor: BLUE, fillOpacity: 0.5 });
    this.add(c);
    await this.play(
      new Transform(c, new Square({ sideLength: 2.4, color: GREEN, fillColor: GREEN, fillOpacity: 0.5 })),
      { _playConfig: true, runTime: 1 },
    );
  }
}

class CreateScene extends Scene {
  async construct() {
    const c = new Circle({ radius: 1.6, color: YELLOW, fillColor: RED, fillOpacity: 0.7, strokeWidth: 5 });
    await this.play(new Create(c), { _playConfig: true, runTime: 1 });
  }
}

class GraphScene extends Scene {
  async construct() {
    const axes = new Axes({
      xRange: [-4, 4, 1],
      yRange: [-1.5, 1.5, 0.5],
      xLength: 7,
      yLength: 3.5,
      includeNumbers: false,
      includeTips: false,
    });
    const curve = axes.plot((x) => Math.sin(x), { color: YELLOW });
    const chord = new Line([-3, -1, 0], [3, 1, 0], { color: RED });
    this.add(axes, curve, chord);
    await this.wait(0.2);
  }
}

class LayoutScene extends Scene {
  async construct() {
    const row = new VGroup(
      new Square({ sideLength: 0.9, color: BLUE, fillColor: BLUE, fillOpacity: 0.8 }),
      new Circle({ radius: 0.45, color: GREEN, fillColor: GREEN, fillOpacity: 0.8 }),
      new Triangle({ color: WHITE, fillColor: RED, fillOpacity: 0.8 }),
    );
    row.arrange([1, 0, 0], 0.6);
    const fadedCopy = row.copy();
    fadedCopy.shift([0, -2, 0]).scale(0.6);
    this.add(row);
    await this.play(new FadeIn(fadedCopy, { shift: [0, 0.5, 0] }), { _playConfig: true, runTime: 0.6 });
  }
}

// -- tests ---------------------------------------------------------------------

// fps 15, so a 1s play = frames 0..14; frame 7 is mid-animation.
const CASES: Array<{ name: string; scene: any; frames: Record<string, number> }> = [
  { name: "shapes", scene: ShapesScene, frames: { static: 1 } },
  { name: "create", scene: CreateScene, frames: { mid: 7, end: 14 } },
  { name: "transform", scene: TransformScene, frames: { mid: 7, end: 14 } },
  { name: "graph", scene: GraphScene, frames: { static: 1 } },
  { name: "layout", scene: LayoutScene, frames: { end: 10 } },
];

for (const c of CASES) {
  test(`snapshot: ${c.name}`, { skip: !canvasAvailable && "@napi-rs/canvas not available" }, async () => {
    const frameIdx = Object.values(c.frames);
    const caps = await captureFrames(c.scene, frameIdx);
    for (const [label, idx] of Object.entries(c.frames)) {
      const cap = caps.get(idx);
      assert.ok(cap, `frame ${idx} was captured`);
      const failure = await matchSnapshot(`${c.name}.${label}`, cap!);
      assert.equal(failure, null, failure ?? undefined);
    }
  });
}

// Determinism guard: two renders of the same scene must be byte-identical.
// If this ever fails, the content-hash partial-movie cache is unsound too.
test("snapshot: CPU renders are byte-identical across runs", { skip: !canvasAvailable && "@napi-rs/canvas not available" }, async () => {
  const a = await captureFrames(TransformScene, [7]);
  const b = await captureFrames(TransformScene, [7]);
  assert.deepEqual(Buffer.from(a.get(7)!.data), Buffer.from(b.get(7)!.data));
});
