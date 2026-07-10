// TopoJSON decoder (src/loaders/topojson.ts): synthetic two-square topology
// with a shared arc (delta decoding, negative-index reversal, join-point
// dedup, mesh filtering), decodeArc caching, the real US atlas fixture
// (counties/states feature counts, ids, properties, NaN sweep, mesh
// partition), and the loader's new "none"/"identity" projection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { feature, mesh, decodeArc } from "../src/loaders/topojson.ts";
import type {
  Topology,
  GeoJSONFeature,
  GeoJSONFeatureCollection,
} from "../src/loaders/topojson.ts";
import { loadGeoJSON } from "../src/loaders/geojson_loader.ts";
import { PROJECTIONS } from "../src/loaders/geo_projection.ts";

// --- Synthetic topology: two unit squares sharing a vertical edge ----------
// arc0: (1,0)→(1,1) shared edge; arc1: rest of left square; arc2: rest of
// right square. Right ring uses NEGATIVE refs (~i reversal) for both arcs.
function makePair(): Topology {
  return {
    type: "Topology",
    transform: { scale: [0.5, 2], translate: [10, 100] },
    arcs: [
      [[1, 0], [0, 1]], // (1,0)→(1,1) delta-encoded
      [[1, 1], [-1, 0], [0, -1], [1, 0]], // (1,1)→(0,1)→(0,0)→(1,0)
      [[1, 1], [1, 0], [0, -1], [-1, 0]], // (1,1)→(2,1)→(2,0)→(1,0)
    ],
    objects: {
      pair: {
        type: "GeometryCollection",
        geometries: [
          { type: "Polygon", arcs: [[0, 1]], id: 1, properties: { name: "L" } },
          { type: "Polygon", arcs: [[-3, -1]], id: 2, properties: { name: "R" } },
        ],
      },
    },
  };
}

const T = (p: [number, number]): [number, number] => [p[0] * 0.5 + 10, p[1] * 2 + 100];

test("decodeArc: delta-decodes through the quantization transform and caches per topology", () => {
  const topo = makePair();
  const arc0 = decodeArc(topo, 0);
  assert.deepEqual(arc0, [T([1, 0]), T([1, 1])]);
  assert.equal(decodeArc(topo, 0), arc0, "second call returns the cached array");
  // A structurally identical but distinct topology gets its own cache entry.
  const topo2 = makePair();
  assert.notEqual(decodeArc(topo2, 0), arc0);
  assert.deepEqual(decodeArc(topo2, 0), arc0);
  assert.throws(() => decodeArc(topo, 99), /out of range/);
});

test("feature: GeometryCollection → FeatureCollection with ids, copied properties, stitched closed rings", () => {
  const topo = makePair();
  const fc = feature(topo, "pair") as GeoJSONFeatureCollection;
  assert.equal(fc.type, "FeatureCollection");
  assert.equal(fc.features.length, 2);

  const [left, right] = fc.features;
  assert.equal(left.id, 1);
  assert.deepEqual(left.properties, { name: "L" });
  assert.notEqual(left.properties, topo.objects.pair.geometries![0].properties, "properties are copied");

  // Left ring: (1,0),(1,1),(0,1),(0,0),(1,0) — join point dropped, ring closed.
  assert.deepEqual(left.geometry, {
    type: "Polygon",
    coordinates: [[T([1, 0]), T([1, 1]), T([0, 1]), T([0, 0]), T([1, 0])]],
  });
  // Right ring via negative refs: (1,0),(2,0),(2,1),(1,1),(1,0).
  assert.deepEqual(right.geometry, {
    type: "Polygon",
    coordinates: [[T([1, 0]), T([2, 0]), T([2, 1]), T([1, 1]), T([1, 0])]],
  });

  // Unknown object name throws with the available list.
  assert.throws(() => feature(topo, "nope"), /Available: pair/);
});

test("feature: single geometry object → single Feature; Point applies the transform", () => {
  const topo = makePair();
  topo.objects.capital = { type: "Point", coordinates: [3, 4], id: "cap" };
  const f = feature(topo, "capital") as GeoJSONFeature;
  assert.equal(f.type, "Feature");
  assert.equal(f.id, "cap");
  assert.deepEqual(f.geometry, { type: "Point", coordinates: T([3, 4]) });
});

test("mesh: filter (a,b)=>a!==b keeps only the shared arc; a===b only the outline", () => {
  const topo = makePair();
  const internal = mesh(topo, "pair", (a, b) => a !== b);
  assert.equal(internal.type, "MultiLineString");
  assert.deepEqual(internal.coordinates, [[T([1, 0]), T([1, 1])]]);

  const outline = mesh(topo, "pair", (a, b) => a === b);
  assert.equal(outline.coordinates.length, 2, "the two non-shared arcs");

  const all = mesh(topo, "pair");
  assert.equal(all.coordinates.length, 3, "each arc exactly once, unfiltered");

  // Omitting the object meshes every arc in the topology.
  assert.equal(mesh(topo).coordinates.length, 3);
});

// --- Real fixture: US atlas (pre-projected Albers, quantized) --------------

const us = JSON.parse(
  readFileSync(new URL("../examples/d3-parity/data/counties-albers-10m.json", import.meta.url), "utf8"),
) as Topology;

function sweepCoords(geometry: any, visit: (x: number, y: number) => void): void {
  const walk = (c: any): void => {
    if (typeof c[0] === "number") visit(c[0], c[1]);
    else for (const child of c) walk(child);
  };
  if (geometry?.coordinates) walk(geometry.coordinates);
}

test("US atlas: counties → ~3.1k features, numeric ids, finite coords in the atlas viewport", () => {
  const counties = feature(us, "counties") as GeoJSONFeatureCollection;
  assert.equal(counties.type, "FeatureCollection");
  assert.equal(counties.features.length, 3142);
  let points = 0;
  for (const f of counties.features) {
    assert.match(String(f.id), /^\d+$/, `county id ${String(f.id)} is numeric`);
    assert.ok(f.geometry, "county has geometry");
    assert.ok(f.geometry!.type === "Polygon" || f.geometry!.type === "MultiPolygon");
    sweepCoords(f.geometry, (x, y) => {
      points++;
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `NaN coordinate in county ${String(f.id)}`);
      // All decoded coordinates stay inside the topology's own bbox.
      const [bx0, by0, bx1, by1] = us.bbox!;
      assert.ok(
        x >= bx0 - 1e-6 && x <= bx1 + 1e-6 && y >= by0 - 1e-6 && y <= by1 + 1e-6,
        `coordinate (${x}, ${y}) outside bbox ${us.bbox}`,
      );
    });
  }
  assert.ok(points > 50_000, `county boundary points: ${points}`);
});

test("US atlas: states → 51 named features; nation → single Feature", () => {
  const states = feature(us, "states") as GeoJSONFeatureCollection;
  assert.equal(states.features.length, 51);
  const names = new Set(states.features.map((f) => (f.properties as { name?: string }).name));
  assert.equal(names.size, 51, "every state has a distinct name property");
  assert.ok(names.has("Arizona") && names.has("California"));
  for (const f of states.features) {
    sweepCoords(f.geometry, (x, y) => assert.ok(Number.isFinite(x) && Number.isFinite(y)));
  }

  const nation = feature(us, "nation") as GeoJSONFeature | GeoJSONFeatureCollection;
  // nation is a GeometryCollection of one geometry in this fixture.
  const nationFeature = nation.type === "FeatureCollection" ? nation.features[0] : nation;
  assert.equal(nationFeature.type, "Feature");
  assert.equal(nationFeature.geometry!.type, "MultiPolygon");
});

test("US atlas: mesh(states, a!==b) is a non-empty finite MultiLineString; filters partition the arcs", () => {
  const internal = mesh(us, "states", (a, b) => a !== b);
  assert.equal(internal.type, "MultiLineString");
  assert.ok(internal.coordinates.length > 100, `internal border lines: ${internal.coordinates.length}`);
  for (const line of internal.coordinates) {
    assert.ok(line.length >= 2);
    for (const [x, y] of line) assert.ok(Number.isFinite(x) && Number.isFinite(y), "no NaN in mesh");
  }
  const outline = mesh(us, "states", (a, b) => a === b);
  const all = mesh(us, "states");
  assert.equal(
    internal.coordinates.length + outline.coordinates.length,
    all.coordinates.length,
    "internal + outline partition the state arcs",
  );
  assert.ok(all.coordinates.length < us.arcs.length, "states use a subset of all topology arcs");
});

// --- Loader integration: "none"/"identity" projection for pre-projected data

test('projection "none" passes planar coords through with a y-flip (pixel space is y-down)', () => {
  // Two squares: "Top" sits at small y (top of the image in pixel space),
  // "Bottom" at large y. After loading with projection "none", Top must be
  // ABOVE Bottom in world space (larger world y).
  const planar = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Top" },
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      },
      {
        type: "Feature",
        properties: { name: "Bottom" },
        geometry: { type: "Polygon", coordinates: [[[0, 10], [1, 10], [1, 11], [0, 11], [0, 10]]] },
      },
    ],
  };
  const map = loadGeoJSON(planar, { projection: "none", width: 8 });
  const topY = map.byName("Top").getCenter()[1];
  const bottomY = map.byName("Bottom").getCenter()[1];
  assert.ok(topY > bottomY, `pixel-space top (${topY}) renders above bottom (${bottomY})`);

  // "identity" is an alias of "none".
  const map2 = loadGeoJSON(planar, { projection: "identity", width: 8 });
  assert.deepEqual(map2.byName("Top").getCenter(), map.byName("Top").getCenter());
  assert.equal(PROJECTIONS.none, PROJECTIONS.identity);
});

test('projection "none" + feature(): the US atlas loads with addressable state regions', () => {
  const states = feature(us, "states") as GeoJSONFeatureCollection;
  const map = loadGeoJSON(states as unknown as object, { projection: "none", width: 8 });
  assert.equal(map.regions.size, 51);
  assert.ok(map.hasRegion("Arizona"));
  assert.ok(Math.abs(map.getWidth() - 8) < 1e-6);
  // Sanity: Maine (northeast) is right of and above Texas (south-center).
  const maine = map.byName("Maine").getCenter();
  const texas = map.byName("Texas").getCenter();
  assert.ok(maine[0] > texas[0], "Maine east of Texas");
  assert.ok(maine[1] > texas[1], "Maine north of Texas (y-flip applied)");
});
