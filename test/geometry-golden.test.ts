// Golden frames for GeometryFigure (new fixtures only; no existing golden is touched).
// Regenerate (only for an intended visual change): UPDATE_SNAPSHOTS=1 node --test test/geometry-golden.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { Scene } from "../src/scene/Scene.ts";
import { GeometryFigure } from "../src/mobject/geometry_figure.ts";
import { initMathTex } from "../src/mobject/mathtex.ts";
import { captureFrames, matchSnapshot, loadNapiCanvas } from "./_snapshot_util.ts";

const canvasAvailable = await loadNapiCanvas().then((m) => !!m);

const CASES: Array<[string, any]> = [
  ["right-triangle-squares", { type: "right-triangle", a: 3, b: 4, squares: true }],
  ["rhombus", { type: "rhombus" }],
  ["kite", { type: "kite" }],
  ["isosceles-trapezoid", { type: "isosceles-trapezoid" }],
  ["hexagon", { type: "hexagon", circle: "both" }],
  ["cube", { type: "cube" }],
  ["icosahedron", { type: "icosahedron" }],
];

for (const [name, spec] of CASES) {
  test(`geometry golden: ${name}`, { skip: !canvasAvailable && "@napi-rs/canvas not available" }, async () => {
    await initMathTex();
    class GeoScene extends Scene {
      async construct() {
        const fig = new GeometryFigure(spec, { size: spec.squares ? 2 : 4 });
        this.add(fig);
        await this.wait(0.2);
      }
    }
    const caps = await captureFrames(GeoScene, [2]);
    const failure = await matchSnapshot(`geometry.${name}`, caps.get(2)!);
    assert.equal(failure, null, failure ?? undefined);
  });
}
