// Minimal TopoJSON decoder — a dependency-free equivalent of the parts of
// topojson-client that d3 examples use: `feature()` (topology → GeoJSON) and
// `mesh()` (shared-arc borders). Pure JSON + math; isomorphic (no node:
// imports, no renderer/mobject types).
//
// Quantized topologies store each arc as delta-encoded integer pairs that are
// decoded via the topology's transform: absolute = cumsum(delta) * scale +
// translate. Decoded arcs are cached per topology (WeakMap) so repeated
// feature()/mesh() calls don't re-decode the (often ~10k) arcs.
//
// Divergences from topojson-client (documented):
// - mesh() does NOT fuse contiguous filtered arcs into longer LineStrings
//   (topojson-client's stitch step); each selected arc is emitted as its own
//   line. The geometric union is identical — there are just more, shorter
//   lines in the MultiLineString.
// - Coordinates are strictly 2D; extra per-point dimensions in arcs are
//   dropped.

export interface TopoTransform {
  scale: [number, number];
  translate: [number, number];
}

/** A TopoJSON geometry object (arc-indexed, possibly quantized). */
export interface TopoGeometry {
  type:
    | "Point"
    | "MultiPoint"
    | "LineString"
    | "MultiLineString"
    | "Polygon"
    | "MultiPolygon"
    | "GeometryCollection"
    | null;
  id?: string | number;
  properties?: Record<string, unknown>;
  /** Point/MultiPoint positions (quantized when the topology has a transform). */
  coordinates?: number[] | number[][];
  /** Arc index lists; negative index ~i means arc i reversed. */
  arcs?: number[] | number[][] | number[][][];
  geometries?: TopoGeometry[];
}

export interface Topology {
  type: "Topology";
  transform?: TopoTransform;
  objects: Record<string, TopoGeometry>;
  arcs: number[][][];
  bbox?: number[];
}

// --- GeoJSON output types (self-contained; no external @types dependency) ---

export type GeoPosition = [number, number];

export interface GeoJSONGeometry {
  type: string;
  coordinates?: unknown;
  geometries?: Array<GeoJSONGeometry | null>;
}

export interface GeoJSONFeature {
  type: "Feature";
  id?: string | number;
  properties: Record<string, unknown>;
  geometry: GeoJSONGeometry | null;
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

export interface GeoJSONMultiLineString {
  type: "MultiLineString";
  coordinates: GeoPosition[][];
}

// --- Arc decoding (delta + quantization transform), cached per topology -----

const arcCache = new WeakMap<Topology, Array<GeoPosition[] | undefined>>();

/**
 * Decode arc `index` (non-negative) of `topology` to absolute [x, y] points,
 * applying delta-decoding and the quantization transform when present.
 * Results are cached per topology; do not mutate the returned array.
 */
export function decodeArc(topology: Topology, index: number): GeoPosition[] {
  let cache = arcCache.get(topology);
  if (!cache) arcCache.set(topology, (cache = new Array(topology.arcs.length)));
  const hit = cache[index];
  if (hit) return hit;
  const arc = topology.arcs[index];
  if (!arc) throw new Error(`topojson: arc index ${index} out of range (0..${topology.arcs.length - 1})`);
  const t = topology.transform;
  const points: GeoPosition[] = new Array(arc.length);
  if (t) {
    const [kx, ky] = t.scale;
    const [tx, ty] = t.translate;
    let x = 0, y = 0;
    for (let k = 0; k < arc.length; k++) {
      x += arc[k][0];
      y += arc[k][1];
      points[k] = [x * kx + tx, y * ky + ty];
    }
  } else {
    for (let k = 0; k < arc.length; k++) points[k] = [arc[k][0], arc[k][1]];
  }
  cache[index] = points;
  return points;
}

// Point/MultiPoint positions are stored ABSOLUTE (quantized when transformed),
// not delta-encoded — only the scale/translate applies.
function transformPoint(topology: Topology, p: number[]): GeoPosition {
  const t = topology.transform;
  return t
    ? [p[0] * t.scale[0] + t.translate[0], p[1] * t.scale[1] + t.translate[1]]
    : [p[0], p[1]];
}

// Stitch a list of arc index refs (negative ~i = reversed arc i) into one
// point list, dropping the duplicated join point between consecutive arcs.
// Points are fresh arrays (the per-topology cache is never exposed here).
function stitchArcs(topology: Topology, arcIndexes: number[]): GeoPosition[] {
  const points: GeoPosition[] = [];
  for (const ref of arcIndexes) {
    const arc = decodeArc(topology, ref < 0 ? ~ref : ref);
    const n = arc.length;
    // Skip the first point of every arc after the first: it duplicates the
    // previous arc's endpoint (TopoJSON arcs share join points).
    let k = points.length ? 1 : 0;
    if (ref < 0) {
      for (; k < n; k++) { const p = arc[n - 1 - k]; points.push([p[0], p[1]]); }
    } else {
      for (; k < n; k++) { const p = arc[k]; points.push([p[0], p[1]]); }
    }
  }
  return points;
}

function line(topology: Topology, arcIndexes: number[]): GeoPosition[] {
  const points = stitchArcs(topology, arcIndexes);
  if (points.length < 2) points.push([points[0][0], points[0][1]]); // degenerate arc
  return points;
}

function ring(topology: Topology, arcIndexes: number[]): GeoPosition[] {
  const points = line(topology, arcIndexes);
  while (points.length < 4) points.push([points[0][0], points[0][1]]); // degenerate ring
  return points;
}

function geometryToGeoJSON(topology: Topology, geom: TopoGeometry): GeoJSONGeometry | null {
  if (!geom || geom.type == null) return null;
  switch (geom.type) {
    case "GeometryCollection":
      return {
        type: "GeometryCollection",
        geometries: (geom.geometries ?? []).map((g) => geometryToGeoJSON(topology, g)),
      };
    case "Point":
      return { type: "Point", coordinates: transformPoint(topology, geom.coordinates as number[]) };
    case "MultiPoint":
      return {
        type: "MultiPoint",
        coordinates: (geom.coordinates as number[][]).map((p) => transformPoint(topology, p)),
      };
    case "LineString":
      return { type: "LineString", coordinates: line(topology, geom.arcs as number[]) };
    case "MultiLineString":
      return {
        type: "MultiLineString",
        coordinates: (geom.arcs as number[][]).map((a) => line(topology, a)),
      };
    case "Polygon":
      return { type: "Polygon", coordinates: (geom.arcs as number[][]).map((a) => ring(topology, a)) };
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: (geom.arcs as number[][][]).map((poly) => poly.map((a) => ring(topology, a))),
      };
    default:
      throw new Error(`topojson: unsupported geometry type ${JSON.stringify(geom.type)}`);
  }
}

function toFeature(topology: Topology, geom: TopoGeometry): GeoJSONFeature {
  const f: GeoJSONFeature = {
    type: "Feature",
    properties: geom.properties ? { ...geom.properties } : {},
    geometry: geometryToGeoJSON(topology, geom),
  };
  if (geom.id !== undefined) f.id = geom.id;
  return f;
}

function resolveObject(topology: Topology, o: string | TopoGeometry, caller: string): TopoGeometry {
  if (typeof o !== "string") return o;
  const obj = topology.objects[o];
  if (!obj) {
    const available = Object.keys(topology.objects).join(", ") || "(none)";
    throw new Error(`topojson.${caller}: no object named ${JSON.stringify(o)}. Available: ${available}`);
  }
  return obj;
}

/**
 * Convert a TopoJSON object (by name or reference) to GeoJSON — the
 * equivalent of topojson-client's `feature()`. A GeometryCollection becomes
 * a FeatureCollection (one Feature per geometry, `id` and `properties`
 * copied); any other geometry becomes a single Feature.
 */
export function feature(
  topology: Topology,
  o: string | TopoGeometry,
): GeoJSONFeature | GeoJSONFeatureCollection {
  const obj = resolveObject(topology, o, "feature");
  if (obj.type === "GeometryCollection") {
    return {
      type: "FeatureCollection",
      features: (obj.geometries ?? []).map((g) => toFeature(topology, g)),
    };
  }
  return toFeature(topology, obj);
}

// For each arc used by `object`, record which geometries reference it (in
// d3's convention: the FIRST and LAST geometry to use the arc — identical
// when only one geometry uses it). The filter then sees (a, b) per arc.
function extractArcs(
  topology: Topology,
  object: TopoGeometry,
  filter?: (a: TopoGeometry, b: TopoGeometry) => boolean,
): number[] {
  const geomsByArc: Array<Array<{ i: number; g: TopoGeometry }> | undefined> = [];
  let geom: TopoGeometry = object;

  const extract0 = (i: number): void => {
    const j = i < 0 ? ~i : i;
    (geomsByArc[j] ??= []).push({ i, g: geom });
  };
  const extract1 = (arcs: number[]): void => arcs.forEach(extract0);
  const extract2 = (arcs: number[][]): void => arcs.forEach(extract1);
  const extract3 = (arcs: number[][][]): void => arcs.forEach(extract2);

  const walk = (o: TopoGeometry): void => {
    geom = o;
    switch (o.type) {
      case "GeometryCollection": (o.geometries ?? []).forEach(walk); break;
      case "LineString": extract1(o.arcs as number[]); break;
      case "MultiLineString":
      case "Polygon": extract2(o.arcs as number[][]); break;
      case "MultiPolygon": extract3(o.arcs as number[][][]); break;
      // Point/MultiPoint contribute no arcs.
    }
  };
  walk(object);

  const arcs: number[] = [];
  for (const geoms of geomsByArc) {
    if (!geoms) continue;
    if (!filter || filter(geoms[0].g, geoms[geoms.length - 1].g)) arcs.push(geoms[0].i);
  }
  return arcs;
}

/**
 * The mesh of arcs in `object`, optionally filtered — d3's `topojson.mesh`
 * semantics. `filter(a, b)` receives the first and last geometry adjacent to
 * each arc (a === b when only one geometry uses it), so
 * `(a, b) => a !== b` yields internal borders only and
 * `(a, b) => a === b` the exterior outline. Omitting `object` meshes every
 * arc in the topology. Each surviving arc becomes one line of the
 * MultiLineString (contiguous arcs are not fused — see module header).
 */
export function mesh(
  topology: Topology,
  o?: string | TopoGeometry,
  filter?: (a: TopoGeometry, b: TopoGeometry) => boolean,
): GeoJSONMultiLineString {
  let arcIndexes: number[];
  if (o == null) {
    arcIndexes = topology.arcs.map((_, i) => i);
  } else {
    arcIndexes = extractArcs(topology, resolveObject(topology, o, "mesh"), filter);
  }
  return { type: "MultiLineString", coordinates: arcIndexes.map((i) => line(topology, [i])) };
}
