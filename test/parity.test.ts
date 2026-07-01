// Parity + coverage harness. Real manim (Python) is not installed here, so
// "parity" means STRUCTURAL self-consistency + coverage: registry counts, key
// names present across subsystems, finite points + sane bounds on a
// representative of each major mobject, and begin()/interpolate()/finish()
// integrity across a representative of each major animation.
//
// This is the final regression/coverage layer over the ~380-name public API.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { registry } from "../src/index.ts";
import { loadVectorFont } from "../src/renderer/fonts-node.ts";
import { initMathTex } from "../src/mobject/mathtex.ts";

import { Circle, Square, Rectangle, Line } from "../src/mobject/geometry.ts";
import { Matrix } from "../src/mobject/matrix.ts";
import { Brace } from "../src/mobject/brace.ts";
import { Graph } from "../src/mobject/graph.ts";
import { Union } from "../src/mobject/boolean_ops.ts";
import { Axes } from "../src/mobject/coordinate_systems.ts";
import { MathTex } from "../src/mobject/mathtex.ts";
import { Sphere, Torus } from "../src/mobject/surface.ts";
import { Tetrahedron } from "../src/mobject/polyhedra.ts";
import { BarChart } from "../src/mobject/probability.ts";
import { ArrowVectorField } from "../src/mobject/vector_field.ts";

import { Transform, Create } from "../src/animation/Animation.ts";
import {
  TransformFromCopy, MoveToTarget, Restore, FadeTransform,
} from "../src/animation/transform_extra.ts";
import { DrawBorderThenFill } from "../src/animation/creation_extra.ts";
import { ShowPassingFlash } from "../src/animation/indication_extra.ts";
import { Homotopy } from "../src/animation/movement.ts";
import { LaggedStart } from "../src/animation/composition.ts";
import { FadeIn } from "../src/animation/Animation.ts";

import {
  getSmoothCubicBezierHandlePoints,
} from "../src/core/math/bezier.ts";
import {
  earclipTriangulation, rotationMatrix, matrixVectorProduct,
} from "../src/core/math/vector.ts";
import { colorGradient, invertColor, Color } from "../src/core/color.ts";
import { loadManifest } from "../src/plugins/manifest.ts";
import { loadWasm } from "../src/wasm.ts";

// Vector Text + MathTex both build glyphs lazily from a font / MathJax; warm
// them once so every representative below constructs real geometry.
before(async () => {
  await loadVectorFont().catch(() => null);
  await initMathTex();
});

// --- shared helpers -------------------------------------------------------

// True iff every point across the whole family is finite in x/y/z.
function allPointsFinite(mob: any): boolean {
  const pts: number[][] = mob.getAllPoints();
  if (pts.length === 0) return false;
  for (const p of pts) {
    for (let i = 0; i < 3; i++) if (!Number.isFinite(p[i] ?? 0)) return false;
  }
  return true;
}

// True iff the bounding box is finite and non-degenerate in at least one axis.
function saneBounds(mob: any): boolean {
  const { min, max } = mob.getBoundingBox();
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(min[i]) || !Number.isFinite(max[i])) return false;
    if (max[i] < min[i]) return false;
  }
  const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
  return w > 1e-9 || h > 1e-9 || d > 1e-9;
}

// Drive an animation through its full lifecycle and assert the target stays
// finite at every checkpoint (0, 0.5, 1).
function driveAnimation(anim: any, target: any, label: string) {
  anim.begin();
  assert.ok(allPointsFinite(target), `${label}: finite after begin()`);
  anim.interpolate(0.5);
  assert.ok(allPointsFinite(target), `${label}: finite at alpha=0.5`);
  anim.finish();
  assert.ok(allPointsFinite(target), `${label}: finite after finish()`);
}

// =========================================================================
// 1. Registry coverage: counts across every subsystem.
// =========================================================================
test("registry has broad coverage across every subsystem", () => {
  const mobjects = registry.list("mobject");
  const animations = registry.list("animation");
  const rateFunctions = registry.list("rateFunction");
  const colors = registry.list("color");
  const scenes = registry.list("scene");

  assert.ok(mobjects.length >= 120, `>=120 mobjects (got ${mobjects.length})`);
  assert.ok(animations.length >= 60, `>=60 animations (got ${animations.length})`);
  assert.ok(rateFunctions.length >= 40, `>=40 rate functions (got ${rateFunctions.length})`);
  assert.ok(colors.length >= 2000, `>=2000 colors (got ${colors.length})`);
  assert.ok(scenes.length >= 6, `>=6 scenes (got ${scenes.length})`);
});

// =========================================================================
// 2. Registry key-name presence across subsystems.
// =========================================================================
test("registry contains the expected mobject names across subsystems", () => {
  const expected = [
    // geometry / arcs / polygram
    "Circle", "Polygon", "Sector", "Angle", "Star",
    // structured
    "Matrix", "Table", "Brace",
    // graph theory
    "Graph", "DiGraph",
    // boolean
    "Union",
    // coordinate systems / charts
    "Axes", "NumberPlane", "PolarPlane", "ComplexPlane", "BarChart",
    "ArrowVectorField",
    // 3D
    "Sphere", "Torus", "Tetrahedron", "Icosahedron",
    // text
    "MathTex", "Text", "VText", "Code",
  ];
  for (const name of expected) {
    assert.ok(registry.has("mobject", name), `mobject "${name}" registered`);
  }
});

test("registry contains the expected animation names", () => {
  const expected = [
    "Create", "Write", "Transform", "TransformMatchingShapes",
    "MoveToTarget", "Restore", "FadeTransform", "Homotopy",
    "ShowPassingFlash", "DrawBorderThenFill",
  ];
  for (const name of expected) {
    assert.ok(registry.has("animation", name), `animation "${name}" registered`);
  }
});

// =========================================================================
// 3. Representative of each MAJOR mobject: finite points + sane bounds.
// =========================================================================
test("a representative of each major mobject builds finite, well-bounded geometry", () => {
  const cases: Array<[string, () => any]> = [
    ["Circle (geometry)", () => new Circle({ radius: 1.5 })],
    ["Matrix", () => new Matrix([[1, 2], [3, 4]])],
    ["Brace", () => new Brace(new Square({ sideLength: 2 }), { direction: [0, -1, 0] })],
    ["Graph", () => new Graph([0, 1, 2], [[0, 1], [1, 2]], { layout: "circular" })],
    ["Union (boolean)", () => new Union(new Circle({ radius: 1 }), new Circle({ radius: 1 }).shift([0.6, 0, 0]))],
    ["Sphere", () => new Sphere()],
    ["Torus", () => new Torus()],
    ["Tetrahedron", () => new Tetrahedron({ edgeLength: 2 })],
    ["BarChart", () => new BarChart([1, 2.5, 3, 1.5], { barNames: ["a", "b", "c", "d"], yRange: [0, 4, 1] })],
    ["ArrowVectorField", () => new ArrowVectorField((p: number[]) => [-p[1], p[0], 0], { xRange: [-2, 2, 1], yRange: [-2, 2, 1] })],
  ];
  for (const [label, build] of cases) {
    const m = build();
    assert.ok(allPointsFinite(m), `${label}: all points finite`);
    assert.ok(saneBounds(m), `${label}: sane bounds`);
  }
});

test("Matrix exposes 4 entries and 2 brackets", () => {
  const m = new Matrix([[1, 2], [3, 4]]);
  assert.equal(m.getEntries().submobjects.length, 4);
  assert.equal(m.getBrackets().submobjects.length, 2);
});

test("Axes.getRiemannRectangles produces finite rectangles under a parabola", () => {
  const ax = new Axes({ xRange: [0, 4, 1], yRange: [0, 16, 4] });
  const graph = ax.plot((x: number) => x * x, { xRange: [0, 4] });
  const rects = ax.getRiemannRectangles(graph, { dx: 0.5, inputSampleType: "center" });
  assert.equal(rects.submobjects.length, 8);
  assert.ok(allPointsFinite(rects));
  assert.ok(saneBounds(rects));
});

test("MathTex builds addressable parts and getPartByTex resolves", () => {
  const m = new MathTex("x^2", "+", "1");
  assert.equal(m.parts.length, 3);
  assert.ok(allPointsFinite(m));
  const plus = m.getPartByTex("+");
  assert.ok(plus && plus.submobjects.length > 0);
  assert.equal(m.getPartByTex("\\notThere"), null);
});

// =========================================================================
// 4. Representative of each MAJOR animation: lifecycle keeps points finite.
// =========================================================================
test("Transform lifecycle keeps the target finite", () => {
  const src = new Circle({ radius: 1 });
  const tgt = new Square({ sideLength: 2 });
  driveAnimation(new Transform(src, tgt), src, "Transform");
});

test("TransformFromCopy lifecycle keeps the target finite", () => {
  const src = new Circle({ radius: 1 });
  const tgt = new Square({ sideLength: 1.5 });
  const anim = new TransformFromCopy(src, tgt);
  anim.begin();
  anim.interpolate(0.5);
  anim.finish();
  // The copy that morphs is internal; assert both endpoints stayed finite.
  assert.ok(allPointsFinite(src) && allPointsFinite(tgt), "TransformFromCopy endpoints finite");
});

test("MoveToTarget + generateTarget lifecycle keeps the mobject finite", () => {
  const m = new Square({ sideLength: 1 });
  m.generateTarget();
  m.target.scale(2).shift([1, 0.5, 0]);
  driveAnimation(new MoveToTarget(m), m, "MoveToTarget");
});

test("Restore + saveState lifecycle keeps the mobject finite", () => {
  const m = new Circle({ radius: 1 }).shift([1, 0, 0]);
  m.saveState();
  m.scale(2).shift([2, 0, 0]);
  driveAnimation(new Restore(m), m, "Restore");
});

test("FadeTransform lifecycle keeps both mobjects finite", () => {
  const src = new Square({ sideLength: 1 });
  const tgt = new Circle({ radius: 1 });
  const anim = new FadeTransform(src, tgt);
  anim.begin();
  anim.interpolate(0.5);
  anim.finish();
  assert.ok(allPointsFinite(src) && allPointsFinite(tgt), "FadeTransform endpoints finite");
});

test("DrawBorderThenFill lifecycle keeps the mobject finite", () => {
  const m = new Square({ sideLength: 2, fillOpacity: 0.8 });
  driveAnimation(new DrawBorderThenFill(m), m, "DrawBorderThenFill");
});

test("ShowPassingFlash lifecycle keeps the mobject finite", () => {
  const m = new Circle({ radius: 1.5 });
  driveAnimation(new ShowPassingFlash(m, { timeWidth: 0.2 }), m, "ShowPassingFlash");
});

test("Homotopy lifecycle keeps the mobject finite", () => {
  const m = new Circle({ radius: 1 });
  const wave = (x: number, y: number, z: number, t: number) =>
    [x, y + Math.sin(x) * Math.sin(t * Math.PI) * 0.5, z];
  driveAnimation(new Homotopy(wave, m, { runTime: 1 }), m, "Homotopy");
});

test("LaggedStart of several FadeIns keeps all targets finite", () => {
  const dots = [new Circle({ radius: 0.3 }), new Circle({ radius: 0.3 }).shift([1, 0, 0]), new Circle({ radius: 0.3 }).shift([2, 0, 0])];
  const anim = new LaggedStart(dots.map((d) => new FadeIn(d)), { lagRatio: 0.2 });
  anim.begin();
  anim.interpolate(0.5);
  anim.finish();
  for (const d of dots) assert.ok(allPointsFinite(d), "LaggedStart member finite");
});

// =========================================================================
// 5. Utilities: math, color, manifest, wasm.
// =========================================================================
test("getSmoothCubicBezierHandlePoints yields a spline through its anchors", () => {
  const anchors = [[0, 0, 0], [1, 1, 0], [2, -1, 0], [3, 0, 0]];
  const [h1, h2] = getSmoothCubicBezierHandlePoints(anchors);
  assert.equal(h1.length, 3);
  assert.equal(h2.length, 3);
  for (const h of [...h1, ...h2]) {
    for (const c of h) assert.ok(Number.isFinite(c));
  }
});

test("rotationMatrix rotates X onto Y at PI/2 about z", () => {
  const out = matrixVectorProduct(rotationMatrix(Math.PI / 2, [0, 0, 1]), [1, 0, 0]);
  assert.ok(Math.abs(out[0]) < 1e-9 && Math.abs(out[1] - 1) < 1e-9);
});

test("colorGradient length and invertColor round behavior", () => {
  const grad = colorGradient(["#000000", "#ffffff"], 5);
  assert.equal(grad.length, 5);
  for (const c of grad) assert.ok(c instanceof Color);
  const inv = invertColor("#000000");
  assert.equal(inv.toHex().toLowerCase(), "#ffffff");
});

test("loadManifest registers a portable plugin manifest", () => {
  const path = fileURLToPath(new URL("../examples/plugins/cyberpunk.manifest.json", import.meta.url));
  const summary = loadManifest(readFileSync(path, "utf8"));
  assert.equal(summary.name, "cyberpunk");
  assert.ok(summary.colors >= 4 && summary.surfaces >= 2 && summary.shapes >= 1);
  assert.ok(registry.has("mobject", "MobiusStrip"));
});

test("loadWasm leaves earclipTriangulation of a square correct (2 covering triangles)", async () => {
  await loadWasm().catch(() => false); // optional accelerator; correctness must hold either way
  const square = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
  const tris = earclipTriangulation(square);
  assert.equal(tris.length, 6); // 2 triangles * 3 indices
  let area = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = square[tris[i]], b = square[tris[i + 1]], c = square[tris[i + 2]];
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  assert.ok(Math.abs(area - 1) < 1e-9, "triangles cover the unit square");
});
