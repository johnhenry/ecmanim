// Polyhedra for the projection-camera renderer, mirroring ManimCommunity
// manim/mobject/three_d/polyhedra.py. A Polyhedron holds three things:
//   - this.faces:  a VGroup of filled polygon VMobjects (one per face), each
//                  Lambertian-shaded by its face normal (as surface.ts does).
//   - this.graph / this.vertices: Dots at each vertex.
//   - this.edges:  a Map of unique edges to Line mobjects.
// The Platonic solids are subclasses supplying the standard vertex/face tables
// (scaled so the edge length is `edgeLength`). ConvexHull3D builds a Polyhedron
// from the 3D convex hull (triangular faces) of the given points. No GPU/WebGL.

import { VMobject, VGroup } from "./VMobject.ts";
import type { VMobjectConfig } from "./VMobject.ts";
import { Dot, Line } from "./geometry.ts";
import { Color } from "../core/color.ts";
import * as V from "../core/math/vector.ts";
import type { ColorLike } from "../core/types.ts";

const DEFAULT_LIGHT = V.normalize([-1, -1, 1]); // upper-left, toward viewer
const AMBIENT = 0.35;
const DIFFUSE = 0.65;

export interface FacesConfig extends VMobjectConfig {
  fillColor?: ColorLike;
  fillOpacity?: number;
  strokeColor?: ColorLike;
  strokeWidth?: number;
  lightDirection?: number[];
  shade?: boolean;
}

export interface GraphConfig extends VMobjectConfig {
  vertexRadius?: number;
  vertexColor?: ColorLike;
  edgeColor?: ColorLike;
  edgeWidth?: number;
}

export interface PolyhedronConfig {
  facesConfig?: FacesConfig;
  graphConfig?: GraphConfig;
  /** Add the vertex Dots to the group (default true, preserving the existing
   *  Platonic-solid look). An imported mesh generally wants false — dots at
   *  every vertex read as a wireframe overlay, not a solid model. Vertices
   *  are still built (this.vertices is populated) either way. */
  showVertices?: boolean;
  /** Same as showVertices, for the edge Lines (default true). */
  showEdges?: boolean;
}

// A single polygonal face carrying its unshaded base color, shaded by normal.
class PolyhedronFace extends VMobject {
  baseColor: Color;

  constructor(coords: number[][], baseColor: ColorLike, config: VMobjectConfig) {
    super(config);
    this.baseColor = Color.parse(baseColor);
    this.setPointsAsCorners([...coords, coords[0]]);
    this.fillColor = Color.parse(baseColor);
    this.fillOpacity = config.fillOpacity ?? 0.85;
    this.strokeColor = Color.parse(config.strokeColor ?? "#ffffff");
    this.strokeWidth = config.strokeWidth ?? 1;
    this.strokeOpacity = config.strokeOpacity ?? (this.strokeWidth > 0 ? 1 : 0);
  }
}

export class Polyhedron extends VGroup {
  vertexCoords: number[][];
  facesList: number[][];
  faces: VGroup;
  graph: VGroup;
  vertices: VGroup;
  edges: Map<string, Line>;
  _faceCfg: FacesConfig;
  _graphCfg: GraphConfig;
  _lightDirection: number[];
  _shade: boolean;

  constructor(
    vertexCoords: number[][],
    facesList: number[][],
    config: PolyhedronConfig = {},
  ) {
    super();
    this.vertexCoords = vertexCoords.map((p) => V.clone(p));
    this.facesList = facesList.map((f) => [...f]);

    this._faceCfg = config.facesConfig ?? {};
    this._graphCfg = config.graphConfig ?? {};
    this._lightDirection = this._faceCfg.lightDirection
      ? V.normalize(this._faceCfg.lightDirection)
      : DEFAULT_LIGHT;
    this._shade = this._faceCfg.shade ?? true;

    // Faces (shaded polygons).
    this.faces = new VGroup();
    this.createFaces();

    // Vertices (Dots) and edges (Lines).
    const vertexRadius = this._graphCfg.vertexRadius ?? 0.05;
    const vertexColor = this._graphCfg.vertexColor ?? "#58C4DD";
    this.vertices = new VGroup();
    for (const p of this.vertexCoords) {
      this.vertices.add(new Dot({ point: V.clone(p), radius: vertexRadius, fillColor: vertexColor }));
    }
    this.graph = this.vertices;

    this.edges = new Map<string, Line>();
    const edgeColor = this._graphCfg.edgeColor ?? "#ffffff";
    const edgeWidth = this._graphCfg.edgeWidth ?? 2;
    for (const [i, j] of this.getEdges(this.facesList)) {
      const line = new Line(V.clone(this.vertexCoords[i]), V.clone(this.vertexCoords[j]), {
        strokeColor: edgeColor,
        strokeWidth: edgeWidth,
      });
      this.edges.set(`${i},${j}`, line);
    }

    this.add(this.faces);
    if (config.showVertices ?? true) this.add(this.vertices);
    if (config.showEdges ?? true) this.add(...this.edges.values());
  }

  // Unique undirected edges (i < j) across all faces.
  getEdges(facesList: number[][]): number[][] {
    const seen = new Set<string>();
    const out: number[][] = [];
    for (const face of facesList) {
      for (let k = 0; k < face.length; k++) {
        let a = face[k];
        let b = face[(k + 1) % face.length];
        if (a > b) [a, b] = [b, a];
        const key = `${a},${b}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push([a, b]);
        }
      }
    }
    return out;
  }

  // Coordinates of each face's vertices (list of point-lists).
  getFaceCoords(): number[][][] {
    return this.facesList.map((face) => face.map((idx) => V.clone(this.vertexCoords[idx])));
  }

  // Alias mirroring manim's extract_face_coords.
  extractFaceCoords(): number[][][] {
    return this.getFaceCoords();
  }

  // Face brightness from its outward normal vs the light direction.
  _brightness(coords: number[][]): number {
    if (!this._shade) return 1;
    const center = V.centerOfMass(this.vertexCoords);
    const faceCenter = V.centerOfMass(coords);
    const a = coords[0], b = coords[1], c = coords[2];
    let n = V.normalize(V.cross(V.sub(b, a), V.sub(c, a)));
    // Orient outward from the solid's center for consistent lit/unlit sides.
    if (V.dot(n, V.sub(faceCenter, center)) < 0) n = V.neg(n);
    return Math.min(1, AMBIENT + DIFFUSE * Math.max(0, V.dot(n, this._lightDirection)));
  }

  // Build the faces VGroup from the current vertex coordinates.
  createFaces(): VGroup {
    this.faces.submobjects = [];
    const baseColor = this._faceCfg.fillColor ?? "#58C4DD";
    const faceCfg: VMobjectConfig = {
      fillOpacity: this._faceCfg.fillOpacity ?? 0.85,
      strokeColor: this._faceCfg.strokeColor ?? "#ffffff",
      strokeWidth: this._faceCfg.strokeWidth ?? 1,
    };
    for (const coords of this.getFaceCoords()) {
      const brightness = this._brightness(coords);
      const base = Color.parse(baseColor);
      const shaded = new Color(base.r * brightness, base.g * brightness, base.b * brightness, base.a);
      const face = new PolyhedronFace(coords, shaded, faceCfg);
      face.fillColor = shaded;
      this.faces.add(face);
    }
    return this.faces;
  }

  // Recompute face polygons + shading from the current vertex positions. Usable
  // as an updater: after the vertex Dots move, sync coords then rebuild faces.
  updateFaces(): this {
    // Pull the latest vertex positions from the vertex Dots so this works as an
    // updater even when a caller has shifted a Dot directly.
    for (let i = 0; i < this.vertices.submobjects.length; i++) {
      this.vertexCoords[i] = V.clone(this.vertices.submobjects[i].getCenter());
    }
    const baseColor = this._faceCfg.fillColor ?? "#58C4DD";
    const coordsList = this.getFaceCoords();
    for (let f = 0; f < this.faces.submobjects.length; f++) {
      const face = this.faces.submobjects[f] as PolyhedronFace;
      const coords = coordsList[f];
      face.setPointsAsCorners([...coords, coords[0]]);
      const brightness = this._brightness(coords);
      const base = Color.parse(baseColor);
      face.baseColor = base;
      face.fillColor = new Color(base.r * brightness, base.g * brightness, base.b * brightness, base.a);
    }
    return this;
  }

  getVertexMobjects(): VMobject[] {
    return this.vertices.submobjects as VMobject[];
  }

  getFaceMobjects(): VMobject[] {
    return this.faces.submobjects as VMobject[];
  }
}

// ---------------------------------------------------------------------------
// Platonic solids. Vertex/face tables scaled so edge length == edgeLength.
// ---------------------------------------------------------------------------

export interface PlatonicConfig extends PolyhedronConfig {
  edgeLength?: number;
}

// Scale a vertex table so its (uniform) edge length equals edgeLength.
function scaleToEdgeLength(
  verts: number[][],
  faces: number[][],
  edgeLength: number,
): number[][] {
  // Measure one existing edge length.
  const [i, j] = [faces[0][0], faces[0][1]];
  const current = V.distance(verts[i], verts[j]);
  const s = current === 0 ? 1 : edgeLength / current;
  return verts.map((p) => V.scale(p, s));
}

export class Tetrahedron extends Polyhedron {
  constructor(config: PlatonicConfig = {}) {
    const edgeLength = config.edgeLength ?? 1;
    const verts = [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
    ];
    const faces = [
      [0, 1, 2],
      [0, 1, 3],
      [0, 2, 3],
      [1, 2, 3],
    ];
    super(scaleToEdgeLength(verts, faces, edgeLength), faces, config);
  }
}

export class Octahedron extends Polyhedron {
  constructor(config: PlatonicConfig = {}) {
    const edgeLength = config.edgeLength ?? 1;
    const verts = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    const faces = [
      [0, 2, 4],
      [2, 1, 4],
      [1, 3, 4],
      [3, 0, 4],
      [2, 0, 5],
      [1, 2, 5],
      [3, 1, 5],
      [0, 3, 5],
    ];
    super(scaleToEdgeLength(verts, faces, edgeLength), faces, config);
  }
}

export class Icosahedron extends Polyhedron {
  constructor(config: PlatonicConfig = {}) {
    const edgeLength = config.edgeLength ?? 1;
    const phi = (1 + Math.sqrt(5)) / 2;
    // 12 vertices: cyclic permutations of (0, ±1, ±phi).
    const verts = [
      [0, 1, phi],
      [0, 1, -phi],
      [0, -1, phi],
      [0, -1, -phi],
      [1, phi, 0],
      [1, -phi, 0],
      [-1, phi, 0],
      [-1, -phi, 0],
      [phi, 0, 1],
      [phi, 0, -1],
      [-phi, 0, 1],
      [-phi, 0, -1],
    ];
    // 20 triangular faces (edge length between adjacent verts is 2).
    const faces = [
      [0, 2, 8],
      [0, 8, 4],
      [0, 4, 6],
      [0, 6, 10],
      [0, 10, 2],
      [2, 5, 8],
      [8, 5, 9],
      [8, 9, 4],
      [4, 9, 1],
      [4, 1, 6],
      [6, 1, 11],
      [6, 11, 10],
      [10, 11, 7],
      [10, 7, 2],
      [2, 7, 5],
      [3, 5, 7],
      [3, 9, 5],
      [3, 1, 9],
      [3, 11, 1],
      [3, 7, 11],
    ];
    super(scaleToEdgeLength(verts, faces, edgeLength), faces, config);
  }
}

export class Dodecahedron extends Polyhedron {
  constructor(config: PlatonicConfig = {}) {
    const edgeLength = config.edgeLength ?? 1;
    const phi = (1 + Math.sqrt(5)) / 2;
    const iphi = 1 / phi;
    // 20 vertices: (±1,±1,±1) and even permutations of (0, ±1/phi, ±phi).
    const verts = [
      // cube corners 0..7
      [1, 1, 1], // 0
      [1, 1, -1], // 1
      [1, -1, 1], // 2
      [1, -1, -1], // 3
      [-1, 1, 1], // 4
      [-1, 1, -1], // 5
      [-1, -1, 1], // 6
      [-1, -1, -1], // 7
      // (0, ±1/phi, ±phi) 8..11
      [0, iphi, phi], // 8
      [0, iphi, -phi], // 9
      [0, -iphi, phi], // 10
      [0, -iphi, -phi], // 11
      // (±1/phi, ±phi, 0) 12..15
      [iphi, phi, 0], // 12
      [iphi, -phi, 0], // 13
      [-iphi, phi, 0], // 14
      [-iphi, -phi, 0], // 15
      // (±phi, 0, ±1/phi) 16..19
      [phi, 0, iphi], // 16
      [phi, 0, -iphi], // 17
      [-phi, 0, iphi], // 18
      [-phi, 0, -iphi], // 19
    ];
    // 12 pentagonal faces (each edge length = 2/phi).
    const faces = [
      [0, 8, 10, 2, 16],
      [0, 16, 17, 1, 12],
      [0, 12, 14, 4, 8],
      [8, 4, 18, 6, 10],
      [10, 6, 15, 13, 2],
      [2, 13, 3, 17, 16],
      [1, 17, 3, 11, 9],
      [1, 9, 5, 14, 12],
      [4, 14, 5, 19, 18],
      [6, 18, 19, 7, 15],
      [3, 13, 15, 7, 11],
      [5, 9, 11, 7, 19],
    ];
    super(scaleToEdgeLength(verts, faces, edgeLength), faces, config);
  }
}

// ---------------------------------------------------------------------------
// ConvexHull3D — incremental 3D convex hull of the given points (triangular
// faces), built as a Polyhedron.
// ---------------------------------------------------------------------------

export interface ConvexHull3DConfig extends PolyhedronConfig {
  tolerance?: number;
}

// Compute the convex hull of `points` (>= 4 non-coplanar). Returns the unique
// hull vertices and triangular faces indexing into those vertices.
function convexHull3D(
  points: number[][],
  tolerance: number,
): { verts: number[][]; faces: number[][] } {
  const n = points.length;
  if (n < 4) throw new Error("ConvexHull3D requires at least 4 points.");

  // Find an initial tetrahedron of 4 affinely-independent points.
  let i0 = 0, i1 = -1, i2 = -1, i3 = -1;
  for (let i = 1; i < n; i++) {
    if (V.distance(points[i0], points[i]) > tolerance) { i1 = i; break; }
  }
  if (i1 < 0) throw new Error("ConvexHull3D: all points coincide.");
  const e1 = V.sub(points[i1], points[i0]);
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1) continue;
    const c = V.cross(e1, V.sub(points[i], points[i0]));
    if (V.length(c) > tolerance) { i2 = i; break; }
  }
  if (i2 < 0) throw new Error("ConvexHull3D: points are collinear.");
  const normal012 = V.cross(e1, V.sub(points[i2], points[i0]));
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2) continue;
    if (Math.abs(V.dot(normal012, V.sub(points[i], points[i0]))) > tolerance) { i3 = i; break; }
  }
  if (i3 < 0) throw new Error("ConvexHull3D: points are coplanar.");

  // Build the seed tetrahedron with outward-facing triangles (CCW seen from
  // outside). Ensure each face's normal points away from the 4th point.
  type Face = { a: number; b: number; c: number };
  const centroid = V.scale(
    V.add(V.add(points[i0], points[i1]), V.add(points[i2], points[i3])),
    0.25,
  );
  const makeFace = (a: number, b: number, c: number): Face => {
    const nrm = V.cross(V.sub(points[b], points[a]), V.sub(points[c], points[a]));
    // Flip so the normal points away from the tetra centroid (outward).
    if (V.dot(nrm, V.sub(points[a], centroid)) < 0) return { a, b: c, c: b };
    return { a, b, c };
  };
  let faces: Face[] = [
    makeFace(i0, i1, i2),
    makeFace(i0, i1, i3),
    makeFace(i0, i2, i3),
    makeFace(i1, i2, i3),
  ];

  const faceNormal = (f: Face): number[] =>
    V.cross(V.sub(points[f.b], points[f.a]), V.sub(points[f.c], points[f.a]));
  const visibleFrom = (f: Face, p: number[]): boolean =>
    V.dot(faceNormal(f), V.sub(p, points[f.a])) > tolerance;

  // Add remaining points one at a time.
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2 || i === i3) continue;
    const p = points[i];
    const visible = faces.filter((f) => visibleFrom(f, p));
    if (visible.length === 0) continue; // inside the current hull

    // Collect boundary (horizon) edges: edges belonging to exactly one visible
    // face. Directed edges of visible faces that have no opposite twin.
    const edgeCount = new Map<string, number>();
    const edgeDir = new Map<string, [number, number]>();
    for (const f of visible) {
      const tri = [[f.a, f.b], [f.b, f.c], [f.c, f.a]];
      for (const [a, b] of tri) {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
        if (!edgeDir.has(key)) edgeDir.set(key, [a, b]);
      }
    }
    const visibleSet = new Set(visible);
    faces = faces.filter((f) => !visibleSet.has(f));
    // Horizon edges appear once among visible faces. Keep the directed form.
    const horizon: [number, number][] = [];
    for (const f of visible) {
      const tri: [number, number][] = [[f.a, f.b], [f.b, f.c], [f.c, f.a]];
      for (const [a, b] of tri) {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (edgeCount.get(key) === 1) horizon.push([a, b]);
      }
    }
    // New faces from horizon edge -> new point, preserving winding.
    for (const [a, b] of horizon) {
      faces.push({ a, b, c: i });
    }
  }

  // Reindex used vertices to a compact vertex list.
  const used = new Set<number>();
  for (const f of faces) { used.add(f.a); used.add(f.b); used.add(f.c); }
  const usedList = [...used];
  const remap = new Map<number, number>();
  usedList.forEach((oldIdx, newIdx) => remap.set(oldIdx, newIdx));
  const verts = usedList.map((idx) => V.clone(points[idx]));
  const outFaces = faces.map((f) => [remap.get(f.a)!, remap.get(f.b)!, remap.get(f.c)!]);
  return { verts, faces: outFaces };
}

export class ConvexHull3D extends Polyhedron {
  constructor(...args: any[]) {
    // Signature: ConvexHull3D(...points, config?). Points are [x,y,z] arrays.
    let config: ConvexHull3DConfig = {};
    const last = args[args.length - 1];
    if (last && !Array.isArray(last) && typeof last === "object") {
      config = args.pop() as ConvexHull3DConfig;
    }
    const points = (args as number[][]).map((p) => V.clone(p));
    const tolerance = config.tolerance ?? 1e-5;
    const { verts, faces } = convexHull3D(points, tolerance);
    super(verts, faces, config);
  }
}
