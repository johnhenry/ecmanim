// Regression tests for the library bugs surfaced by the D3 port wave:
// GeoJSON polygon bezier-chain corruption, format SI edge cases, scaleBand
// getter corruption, AnimationGroup/empty-family cache hashes, FadeOut →
// FadeIn round-trips, and the CameraFrameTween barrel export.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGeoJSON } from "../src/loaders/geojson_loader.ts";
import { format } from "../src/core/format.ts";
import { scaleBand, scalePoint } from "../src/core/scales.ts";
import { Scene } from "../src/scene/Scene.ts";
import { Circle } from "../src/mobject/geometry.ts";
import { FadeIn, FadeOut } from "../src/animation/Animation.ts";
import { AnimationGroup } from "../src/animation/composition.ts";
import { tweenTo, tween } from "../src/animation/tween_chain.ts";
import { CameraFrameTween } from "../src/index.ts";

const close = (a: number, b: number, eps = 1e-6, msg?: string) =>
  assert.ok(Math.abs(a - b) < eps, msg ?? `${a} !~ ${b}`);

const silentScene = () => new Scene({ fps: 20, frameHandler: async () => {} });

test("GeoJSON polygons build straight-edged bezier chains (no petal handles)", () => {
  const fc = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { name: "sq" },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
    }],
  };
  const map = loadGeoJSON(fc as any, { projection: "none", nameProperty: "name" });
  const mob: any = map.getFamily().find((m: any) => m.points?.length > 1);
  assert.ok(mob, "polygon mobject exists");
  const sp = mob.getSubpaths()[0];
  assert.equal((sp.length - 1) % 3, 0, "valid cubic chain");
  assert.equal(Math.floor((sp.length - 1) / 3), 4, "4 edges = 4 curves");
  // Midpoint of the outline must sit ON the square's perimeter, not bulge.
  const mid = mob.pointFromProportion(0.125); // halfway along edge 1
  const [minX, maxX] = [Math.min(...sp.map((p: number[]) => p[0])), Math.max(...sp.map((p: number[]) => p[0]))];
  const w = maxX - minX;
  // Edge midpoint should be at 50% of edge 1 — exactly on the boundary line.
  const onEdge = sp.some(() => true) && Math.abs(mid[1] - sp[0][1]) < w * 0.01;
  assert.ok(onEdge, `outline midpoint hugs the straight edge (${mid})`);
});

test("format SI edge cases: .0s clamps, plain notation, k prefix", () => {
  assert.equal(format(".0s")(400), "400", "precision 0 clamps to 1, no throw");
  assert.equal(format(".1s")(400), "400", "no exponent notation");
  assert.equal(format(".1s")(1500), "2k");
  assert.equal(format("s")(0), "0");
});

test("scaleBand getter forms return values without corrupting state", () => {
  const b = scaleBand(["a", "b"], [0, 100]).padding(0.2);
  assert.equal(b.padding(), 0.2, "padding() getter");
  assert.equal(b.round(), false, "round() getter");
  const before = b("a");
  b.padding(); b.paddingInner(); b.paddingOuter(); b.align(); b.round();
  close(b("a"), before, 1e-12, "getters left the scale intact (no NaN)");
  const p = scalePoint(["x", "y"], [0, 10]);
  assert.equal(typeof p.padding(), "number", "scalePoint padding() getter");
});

test("AnimationGroups with different tween content hash apart", () => {
  const scene = silentScene();
  const c = new Circle({ radius: 1 });
  const g1 = new AnimationGroup([tweenTo(c, { x: 1 }, 1)]);
  const g2 = new AnimationGroup([tweenTo(c, { x: 2 }, 1)]);
  assert.notEqual(
    scene.hashAnimations([g1], "play"),
    scene.hashAnimations([g2], "play"),
    "group hash recurses into children",
  );
});

test("geometry-less animations fold the scene fingerprint into their hash", () => {
  const sceneA = silentScene();
  const sceneB = silentScene();
  const ca = new Circle({ radius: 1 });
  const cb = new Circle({ radius: 2 });
  cb.moveTo([3, 0, 0]);
  sceneA.add(ca);
  sceneB.add(cb);
  const cb1 = tween(1, (t) => { void t; });
  const cb2 = tween(1, (t) => { void t; }); // byte-identical callback source
  assert.notEqual(
    sceneA.hashAnimations([cb1], "play"),
    sceneB.hashAnimations([cb2], "play"),
    "different scene content -> different hash despite identical closures",
  );
});

test("FadeOut then FadeIn round-trips to full visibility (manim parity)", async () => {
  const scene = silentScene();
  const c = new Circle({ radius: 1, fillOpacity: 0.8, strokeOpacity: 1 });
  scene.add(c);
  await scene.play(new FadeOut(c));
  assert.ok(!scene.mobjects.includes(c), "removed from scene");
  close((c as any).fillOpacity, 0.8, 1e-9, "fill opacity restored after removal");
  await scene.play(new FadeIn(c));
  assert.ok(scene.mobjects.includes(c));
  close((c as any).fillOpacity, 0.8, 1e-9, "FadeIn lands at the original opacity");
});

test("CameraFrameTween is exported from the barrel", () => {
  assert.equal(typeof CameraFrameTween, "function");
});
