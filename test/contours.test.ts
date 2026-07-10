// Marching-squares isobands (src/layout/contours.ts): single peak, donut
// with hole (winding + hole attachment), saddle disambiguation by center
// value, smooth on/off interpolation, threshold helper, and the real
// volcano.json fixture (87x61 grid, values 94..195).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contours, contourThresholds } from "../src/layout/contours.ts";
import type { ContourRing } from "../src/layout/contours.ts";

// d3-contour's signed-area convention: positive = exterior ring (CCW on a
// y-down screen), negative = hole.
function d3Area(ring: ContourRing): number {
  const n = ring.length;
  let area = ring[n - 1][1] * ring[0][0] - ring[n - 1][0] * ring[0][1];
  for (let i = 1; i < n; i++) area += ring[i - 1][1] * ring[i][0] - ring[i - 1][0] * ring[i][1];
  return area;
}

function assertClosedFinite(ring: ContourRing, w: number, h: number): void {
  assert.ok(ring.length >= 4, `ring has ${ring.length} points`);
  assert.deepEqual(ring[0], ring[ring.length - 1], "ring is closed (first === last)");
  for (const [x, y] of ring) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), `NaN/∞ point (${x}, ${y})`);
    assert.ok(x >= 0 && x <= w && y >= 0 && y <= h, `(${x}, ${y}) outside [0,${w}]x[0,${h}]`);
  }
}

test("single peak: one closed CCW polygon around the maximum", () => {
  // 5x5, peak of 10 in the middle, zeros at the border.
  const values = [
    0, 0, 0, 0, 0,
    0, 3, 5, 3, 0,
    0, 5, 10, 5, 0,
    0, 3, 5, 3, 0,
    0, 0, 0, 0, 0,
  ];
  const gen = contours({ size: [5, 5] });
  const band = gen.contour(values, 4);
  assert.equal(band.type, "MultiPolygon");
  assert.equal(band.value, 4);
  assert.equal(band.coordinates.length, 1, "one polygon");
  assert.equal(band.coordinates[0].length, 1, "no holes");
  const ring = band.coordinates[0][0];
  assertClosedFinite(ring, 5, 5);
  assert.ok(d3Area(ring) > 0, "exterior ring winds positive (d3 convention)");
  // The band hugs the center: every point within the middle 3x3 pixels.
  for (const [x, y] of ring) assert.ok(x > 0.5 && x < 4.5 && y > 0.5 && y < 4.5);
  // Threshold above the max → empty; threshold below the min → full grid.
  assert.equal(gen.contour(values, 11).coordinates.length, 0);
  const full = gen.contour(values, -1);
  assert.equal(full.coordinates.length, 1);
  assertClosedFinite(full.coordinates[0][0], 5, 5);
});

test("donut: hole is attached to its exterior polygon with opposite winding", () => {
  // 7x7 ring of high values around a low center.
  const H = 10, L = 0;
  const values = [
    L, L, L, L, L, L, L,
    L, H, H, H, H, H, L,
    L, H, L, L, L, H, L,
    L, H, L, L, L, H, L,
    L, H, L, L, L, H, L,
    L, H, H, H, H, H, L,
    L, L, L, L, L, L, L,
  ];
  const band = contours({ size: [7, 7] }).contour(values, 5);
  assert.equal(band.coordinates.length, 1, "one polygon");
  assert.equal(band.coordinates[0].length, 2, "exterior + hole");
  const [outer, hole] = band.coordinates[0];
  assertClosedFinite(outer, 7, 7);
  assertClosedFinite(hole, 7, 7);
  assert.ok(d3Area(outer) > 0, "exterior positive");
  assert.ok(d3Area(hole) < 0, "hole negative (opposite winding)");
  assert.ok(Math.abs(d3Area(hole)) < d3Area(outer));
});

test("saddle cells: center-value average picks connected vs separated", () => {
  // 2x2 grid, above corners on the main diagonal. Center average = 0.5.
  const values = [1, 0, 0, 1];
  const gen = contours({ size: [2, 2] });
  // Threshold 0.5: center (0.5) >= threshold → the diagonal connects: ONE band.
  const connected = gen.contour(values, 0.5);
  assert.equal(connected.coordinates.length, 1, "connected saddle → single polygon");
  // Threshold 0.6: center below → two separate corner bands.
  const separated = gen.contour(values, 0.6);
  assert.equal(separated.coordinates.length, 2, "separated saddle → two polygons");
  for (const poly of [...connected.coordinates, ...separated.coordinates]) {
    for (const ring of poly) assertClosedFinite(ring, 2, 2);
  }
  // The anti-diagonal saddle (case 10) behaves symmetrically.
  const values10 = [0, 1, 1, 0];
  assert.equal(gen.contour(values10, 0.5).coordinates.length, 1);
  assert.equal(gen.contour(values10, 0.6).coordinates.length, 2);
});

test("smooth (default) interpolates crossings; smooth:false stays on the half-pixel lattice", () => {
  // Values increase with x: crossing 2.25 lies 1/4 of the way from sample 2
  // (pixel center 2.5) to sample 3 (center 3.5) → x = 2.75 when smoothed.
  const w = 5, h = 3;
  const values: number[] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) values.push(i);
  const smoothBand = contours({ size: [w, h] }).contour(values, 2.25);
  const blockyBand = contours({ size: [w, h], smooth: false }).contour(values, 2.25);

  const xsAt = (band: typeof smoothBand): number[] =>
    band.coordinates[0][0].filter(([, y]) => y > 0.9 && y < h - 0.9).map(([x]) => x);
  // Left edge of the band (interior points, away from the border rows).
  const smoothLeft = Math.min(...xsAt(smoothBand));
  const blockyLeft = Math.min(...xsAt(blockyBand));
  assert.ok(Math.abs(smoothLeft - 2.75) < 1e-9, `smoothed edge at ${smoothLeft}, expected 2.75`);
  assert.equal(blockyLeft, 3, "unsmoothed crossing sits on the pixel boundary");
  for (const band of [smoothBand, blockyBand]) {
    for (const poly of band.coordinates) for (const ring of poly) assertClosedFinite(ring, w, h);
  }
});

test("contourThresholds: nice ticks over the extent; arrays pass through", () => {
  const values = [94, 100, 150, 195];
  const tz = contourThresholds(values, 10);
  assert.ok(tz.length >= 8 && tz.length <= 13, `~10 thresholds, got ${tz.length}`);
  for (let i = 1; i < tz.length; i++) assert.ok(tz[i] > tz[i - 1], "ascending");
  const step = tz[1] - tz[0];
  for (let i = 1; i < tz.length; i++) assert.ok(Math.abs(tz[i] - tz[i - 1] - step) < 1e-9, "uniform step");
  assert.ok(tz[tz.length - 1] < 195, "no threshold at/above the max");
  assert.ok(tz[1] >= 94, "at most one threshold below the min (base band)");
  assert.deepEqual(contourThresholds(values, [1, 2, 3]), [1, 2, 3]);
  assert.deepEqual(contourThresholds([], 10), []);
  assert.deepEqual(contourThresholds([7, 7], 10), [7]);
});

test("volcano fixture: 10 thresholds each produce closed, finite polygons", () => {
  const volcano = JSON.parse(
    readFileSync(new URL("../examples/d3-parity/data/volcano.json", import.meta.url), "utf8"),
  ) as { width: number; height: number; values: number[] };
  assert.equal(volcano.values.length, volcano.width * volcano.height);

  const gen = contours({ size: [volcano.width, volcano.height] });
  const tz = contourThresholds(volcano.values, 10);
  assert.ok(tz.length >= 8, `thresholds: ${tz.join(", ")}`);

  let totalRings = 0;
  let totalPoints = 0;
  let prevOuterArea = Infinity;
  for (const t of tz) {
    const band = gen.contour(volcano.values, t);
    assert.ok(band.coordinates.length > 0, `threshold ${t} produces polygons`);
    let outerArea = 0;
    for (const poly of band.coordinates) {
      assert.ok(d3Area(poly[0]) > 0, "first ring of each polygon is the exterior");
      // (<= 0: like d3, degenerate zero-area rings classify as holes.)
      for (let r = 1; r < poly.length; r++) assert.ok(d3Area(poly[r]) <= 0, "holes wind opposite");
      for (const ring of poly) {
        assertClosedFinite(ring, volcano.width, volcano.height);
        totalRings++;
        totalPoints += ring.length;
      }
      outerArea += d3Area(poly[0]) / 2;
    }
    // Higher thresholds enclose (weakly) less area.
    assert.ok(outerArea <= prevOuterArea + 1e-9, `area shrinks with threshold (${t})`);
    prevOuterArea = outerArea;
  }
  assert.ok(totalRings >= tz.length, `rings: ${totalRings}`);
  assert.ok(totalPoints > 1_000 && totalPoints < 200_000, `total ring points: ${totalPoints}`);
});
