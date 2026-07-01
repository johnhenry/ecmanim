import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registry } from "../src/index.ts";
import { Color } from "../src/core/color.ts";
import { compileExpr, evalExpr } from "../packages/plugin-spec/expr.ts";
import { loadManifest, loadManifestFromFile } from "../src/plugins/manifest.ts";

const EXAMPLE_PATH = fileURLToPath(
  new URL("../examples/plugins/cyberpunk.manifest.json", import.meta.url),
);

// --- expression evaluator -------------------------------------------------

test("compileExpr: arithmetic and variables", () => {
  assert.equal(compileExpr("2*t+1", ["t"])({ t: 3 }), 7);
  assert.equal(compileExpr("(1+2)*3", [])({}), 9);
  assert.equal(compileExpr("2^3^2", [])({}), 512); // right-associative
  assert.equal(compileExpr("-2^2", [])({}), -4); // unary binds looser than ^
});

test("compileExpr: functions and constants", () => {
  assert.ok(Math.abs(compileExpr("sin(pi/2)", [])({}) - 1) < 1e-12);
  assert.ok(Math.abs(evalExpr("max(1,2,3)") - 3) < 1e-12);
  assert.ok(Math.abs(evalExpr("sqrt(2)") - Math.SQRT2) < 1e-12);
  assert.ok(Math.abs(compileExpr("0.5 - 0.5*cos(t*2*pi)", ["t"])({ t: 0.5 }) - 1) < 1e-12);
});

test("compileExpr: rejects unknown names / eval-like input safely", () => {
  assert.throws(() => compileExpr("process", []));
  assert.throws(() => compileExpr("t", [])); // t not declared
});

// --- manifest loading -----------------------------------------------------

test("loadManifest registers colors, rate functions, surfaces, and shapes", () => {
  const manifestText = readExample();
  const summary = loadManifest(manifestText);

  assert.equal(summary.name, "cyberpunk");
  assert.ok(summary.colors >= 4);
  assert.ok(summary.rateFunctions >= 2);
  assert.ok(summary.surfaces >= 2);
  assert.ok(summary.shapes >= 1);

  // Colors: registered + resolvable via Color.parse (names resolve through registry).
  assert.ok(registry.has("color", "NEON_PINK"));
  const c = Color.parse("NEON_PINK");
  assert.ok(c instanceof Color);
  assert.ok(c.r > 0.8 && c.g < 0.4); // #ff2d95 -> mostly red

  // Rate function: registered and computes thump(0)=0, thump(0.5)=1.
  assert.ok(registry.has("rateFunction", "thump"));
  const thump = registry.get("rateFunction", "thump");
  assert.ok(Math.abs(thump(0)) < 1e-9);
  assert.ok(Math.abs(thump(0.5) - 1) < 1e-9);

  // Surface mobject: builds a Surface with finite points.
  assert.ok(registry.has("mobject", "MobiusStrip"));
  const MobiusStrip = registry.get("mobject", "MobiusStrip");
  const surf = new MobiusStrip();
  assert.ok(surf.submobjects.length > 0, "surface should have faces");
  const pts = surf.getAllPoints ? surf.getAllPoints() : surf.submobjects[0].points;
  assert.ok(pts.length > 0);
  for (const p of pts) for (const coord of p) assert.ok(Number.isFinite(coord));

  // Shape mobject: builds an SVGMobject with drawable submobjects.
  assert.ok(registry.has("mobject", "NeonStar"));
  const NeonStar = registry.get("mobject", "NeonStar");
  const star = new NeonStar();
  assert.ok(star.submobjects.length > 0, "star SVG should produce submobjects");
});

test("loadManifestFromFile loads the example from disk", async () => {
  const summary = await loadManifestFromFile(EXAMPLE_PATH);
  assert.equal(summary.name, "cyberpunk");
  assert.ok(summary.surfaces >= 2 && summary.shapes >= 1);
  assert.ok(registry.has("mobject", "NeonTorus"));
});

// helper: read the example JSON as a string (exercises loadManifest's
// string-parsing path, distinct from loadManifestFromFile).
function readExample(): string {
  return readFileSync(EXAMPLE_PATH, "utf8");
}
