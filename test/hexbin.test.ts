// Hexagonal binning (src/layout/hexbin.ts): d3-hexbin lattice math —
// known point sets land in expected centers, boundary points resolve to the
// truly nearest center (brute-force cross-check), counts are conserved,
// accessors and NaN skipping work, hexagonPoints matches the pointy-top
// corner order.

import { test } from "node:test";
import assert from "node:assert/strict";
import { hexbin, hexagonPoints } from "../src/layout/hexbin.ts";

const DX = 2 * Math.sin(Math.PI / 3); // ≈ 1.7320508 for radius 1
const DY = 1.5;

test("hexagonPoints: six pointy-top corners at the radius, starting at the top", () => {
  const corners = hexagonPoints(2);
  assert.equal(corners.length, 6);
  // d3's order: angle k·π/3 → [sin·r, -cos·r]; first corner is the top (0, -r).
  assert.ok(Math.hypot(corners[0][0] - 0, corners[0][1] + 2) < 1e-12);
  const s3 = Math.sqrt(3);
  const expected: Array<[number, number]> = [
    [0, -2], [s3, -1], [s3, 1], [0, 2], [-s3, 1], [-s3, -1],
  ];
  corners.forEach(([x, y], k) => {
    assert.ok(Math.abs(x - expected[k][0]) < 1e-12 && Math.abs(y - expected[k][1]) < 1e-12,
      `corner ${k}: (${x}, ${y})`);
    assert.ok(Math.abs(Math.hypot(x, y) - 2) < 1e-12, "corner sits on the radius");
  });
});

test("known small point sets land in the expected centers", () => {
  const h = hexbin({ radius: 1 });
  assert.ok(Math.abs(h.dx - DX) < 1e-12 && h.dy === DY);
  const bins = h.bin([
    [0, 0], [0.1, -0.1],       // origin hex
    [DX, 0],                    // next column, same row
    [DX / 2, DY],               // odd row, offset by dx/2
    [-DX / 2, -DY],             // odd row below/left (negative indices)
  ]);
  const byCenter = new Map(bins.map((b) => [`${b.x.toFixed(6)},${b.y.toFixed(6)}`, b]));
  assert.equal(bins.length, 4);
  assert.equal(byCenter.get(`${(0).toFixed(6)},${(0).toFixed(6)}`)!.length, 2);
  assert.equal(byCenter.get(`${DX.toFixed(6)},${(0).toFixed(6)}`)!.length, 1);
  assert.equal(byCenter.get(`${(DX / 2).toFixed(6)},${DY.toFixed(6)}`)!.length, 1);
  assert.equal(byCenter.get(`${(-DX / 2).toFixed(6)},${(-DY).toFixed(6)}`)!.length, 1);
  for (const b of bins) assert.equal(b.length, b.points.length);
});

test("two-candidate disambiguation near cell boundaries matches d3-hexbin exactly", () => {
  const h = hexbin({ radius: 1 });
  // (0.1, 0.76) is in the overlap band between row 0 and row 1 but clearly
  // closer to (0,0) than to the row-1 centers (±dx/2, 1.5).
  assert.deepEqual(
    h.bin([[0.1, 0.76]]).map((b) => [b.x, b.y]),
    [[0, 0]],
  );
  // Just under a row-1 center → that center wins.
  const [b2] = h.bin([[DX / 2 - 0.01, DY - 0.01]]);
  assert.ok(Math.abs(b2.x - DX / 2) < 1e-12 && Math.abs(b2.y - DY) < 1e-12);

  // Golden values from the real d3-hexbin (verified 2026-07-10, v0.2.x):
  // d3 compares the two candidates in row/column-NORMALIZED space, so this
  // edge-sliver point does NOT go to the Euclidean-nearest center (0,0).
  const [b3] = h.bin([[0, 0.95]]);
  assert.ok(Math.abs(b3.x - DX / 2) < 1e-9 && Math.abs(b3.y - DY) < 1e-9,
    `(0, 0.95) bins to (${b3.x}, ${b3.y}); d3-hexbin gives (0.8660, 1.5)`);
  const h13 = hexbin({ radius: 1.3 });
  const [b4] = h13.bin([[18.213684558868408, 18.332502841949463]]);
  assert.ok(Math.abs(b4.x - 19.1392) < 1e-3 && Math.abs(b4.y - 17.55) < 1e-9,
    `boundary point bins to (${b4.x}, ${b4.y}); d3-hexbin gives (19.1392, 17.5500)`);
});

test("property: assignment is the argmin of d3's normalized metric; counts conserved", () => {
  const h = hexbin({ radius: 1.3 });
  // Deterministic LCG points in [0, 20)^2.
  let seed = 12345;
  const rand = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 500; i++) points.push([rand() * 20, rand() * 20]);

  const bins = h.bin(points);
  assert.equal(bins.reduce((s, b) => s + b.length, 0), 500, "count conservation");

  // Brute force over a neighborhood superset of lattice centers, in the
  // metric d3-hexbin actually minimizes: ((Δx/dx)² + (Δy/dy)²). (See the
  // module fidelity note — this is NOT Euclidean in an edge sliver.)
  const normDist2 = (px: number, py: number, cx: number, cy: number): number => {
    const nx = (px - cx) / h.dx;
    const ny = (py - cy) / h.dy;
    return nx * nx + ny * ny;
  };
  for (const bin of bins) {
    for (const [px, py] of bin.points as Array<[number, number]>) {
      const dAssigned = normDist2(px, py, bin.x, bin.y);
      let dBest = Infinity;
      const j0 = Math.round(py / h.dy);
      for (let j = j0 - 2; j <= j0 + 2; j++) {
        const i0 = Math.round(px / h.dx - (j & 1) / 2);
        for (let i = i0 - 2; i <= i0 + 2; i++) {
          const cx = (i + (j & 1) / 2) * h.dx;
          const cy = j * h.dy;
          dBest = Math.min(dBest, normDist2(px, py, cx, cy));
        }
      }
      assert.ok(dAssigned <= dBest + 1e-9, `(${px}, ${py}): assigned ${dAssigned}, best ${dBest}`);
      // Euclidean distance still bounded by the circumradius neighborhood:
      // the chosen center is one of the two nearest-row candidates.
      assert.ok(Math.hypot(px - bin.x, py - bin.y) <= 2 * h.radius);
    }
  }
});

test("custom accessors and NaN skipping", () => {
  type P = { lon: number; lat: number };
  const h = hexbin<P>({ radius: 1, x: (d) => d.lon, y: (d) => d.lat });
  const bins = h.bin([
    { lon: 0, lat: 0 },
    { lon: 0.05, lat: 0.05 },
    { lon: NaN, lat: 3 },
    { lon: 2, lat: NaN },
  ]);
  assert.equal(bins.length, 1);
  assert.equal(bins[0].length, 2);
  assert.deepEqual([bins[0].x, bins[0].y], [0, 0]);
  assert.equal(bins[0].points[0].lon, 0);
});

test("centers(): lattice covers the extent with alternating row offsets", () => {
  const h = hexbin({ radius: 1, extent: [[0, 0], [10, 10]] });
  const centers = h.centers();
  assert.ok(centers.length > 30);
  assert.ok(centers.some(([x, y]) => x === 0 && y === 0), "includes the origin center");
  for (const [x, y] of centers) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
    assert.ok(x >= -h.dx && x <= 10 + h.dx && y >= -h.dy && y <= 10 + h.dy);
    const j = Math.round(y / h.dy);
    const expectedOffset = (j & 1) * (h.dx / 2);
    const rem = Math.abs((((x - expectedOffset) / h.dx) % 1));
    assert.ok(rem < 1e-9 || rem > 1 - 1e-9, `row ${j} offset for x=${x}`);
  }
  // Every binned point's center exists on the same lattice parity.
  const bins = h.bin([[3.3, 4.4], [7.7, 8.8]]);
  for (const b of bins) {
    const j = Math.round(b.y / h.dy);
    assert.ok(Math.abs(b.y - j * h.dy) < 1e-9);
  }
});

test("invalid radius throws", () => {
  assert.throws(() => hexbin({ radius: 0 }), /radius/);
  assert.throws(() => hexbin({ radius: -1 }), /radius/);
  assert.throws(() => hexbin({ radius: NaN }), /radius/);
});
