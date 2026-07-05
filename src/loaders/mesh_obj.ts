// Import a Wavefront .obj mesh as a real, animatable Mobject. OBJLoader.parse()
// is a pure string -> geometry function (no DOM/fetch dependency), so this is
// fully isomorphic -- no Node/browser split needed, unlike loadImage/loadVideo.
//
// The mesh becomes a Polyhedron (src/mobject/polyhedra.ts): Polyhedron already
// accepts arbitrary (vertexCoords, facesList), so rotate()/scale()/moveTo()/
// copy() all work for free via the same real per-point transform code every
// other Mobject uses -- no new Mobject subclass needed for this tier. The
// parse step (parseOBJToMeshData) is exported separately so loadMesh3D
// (src/loaders/mesh3d_loader.ts, the GPU tier) can reuse the exact same
// OBJLoader resolution + extraction logic without duplicating it.
//
// three is an optionalDependency (already used by ThreeRenderer/browser-three);
// this loader fails with a clear, catchable rejection if it isn't installed,
// since importing a mesh is a deliberate user action, not an internal
// fallback path (contrast with src/wasm.ts's loadWasm(), which silently
// degrades because its caller has a pure-JS fallback ready either way).

import { Polyhedron } from "../mobject/polyhedra.ts";
import type { FacesConfig } from "../mobject/polyhedra.ts";
import { extractMeshDataFromGeometry, markThreeLoaded } from "./mesh_util.ts";

export { isMeshLoaderAvailable, extractMeshDataFromGeometry } from "./mesh_util.ts";

export interface MeshOBJImportOptions {
  /** Inject an OBJLoader class (tests / bundler control) instead of a lazy
   *  dynamic import of three's bundled loader. */
  OBJLoader?: new () => { parse(text: string): any };
  /** Add vertex Dots to the group (default false for an imported mesh -- see
   *  Polyhedron's showVertices, which defaults true for the Platonic solids). */
  showVertices?: boolean;
  /** Add edge Lines to the group (default false for an imported mesh). */
  showEdges?: boolean;
  facesConfig?: FacesConfig;
}

export async function resolveOBJLoader(options: MeshOBJImportOptions): Promise<new () => { parse(text: string): any }> {
  if (options.OBJLoader) return options.OBJLoader;
  try {
    const mod: any = await import("three/examples/jsm/loaders/OBJLoader.js");
    markThreeLoaded();
    return mod.OBJLoader;
  } catch {
    throw new Error(
      "3D mesh import requires the optional 'three' dependency -- install it (npm install three) to enable .obj/.stl import.",
    );
  }
}

/** Walk an Object3D/Group (OBJLoader's result shape), merging every Mesh's
 *  geometry into one combined {vertexCoords, facesList} (face indices offset
 *  per mesh -- dedup itself stays per-mesh, not merged across meshes). */
export function extractMeshData(obj3D: any, precision = 5): { vertexCoords: number[][]; facesList: number[][] } {
  const vertexCoords: number[][] = [];
  const facesList: number[][] = [];
  const walk = (node: any) => {
    if (node.isMesh && node.geometry) {
      const part = extractMeshDataFromGeometry(node.geometry, precision);
      const offset = vertexCoords.length;
      vertexCoords.push(...part.vertexCoords);
      for (const face of part.facesList) facesList.push(face.map((i) => i + offset));
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(obj3D);
  return { vertexCoords, facesList };
}

/** Parse .obj text into {vertexCoords, facesList}, shared by loadMeshOBJ
 *  (-> Polyhedron, Tier A) and loadMesh3D (-> Mesh3D, Tier B). */
export async function parseOBJToMeshData(
  text: string,
  options: MeshOBJImportOptions = {},
): Promise<{ vertexCoords: number[][]; facesList: number[][] }> {
  const OBJLoader = await resolveOBJLoader(options);
  const obj3D = new OBJLoader().parse(text);
  const data = extractMeshData(obj3D);
  if (data.vertexCoords.length === 0) throw new Error("the .obj text contained no mesh geometry.");
  return data;
}

export async function loadMeshOBJ(text: string, options: MeshOBJImportOptions = {}): Promise<Polyhedron> {
  let vertexCoords: number[][], facesList: number[][];
  try {
    ({ vertexCoords, facesList } = await parseOBJToMeshData(text, options));
  } catch (e: any) {
    throw new Error(`loadMeshOBJ: ${e.message}`);
  }
  return new Polyhedron(vertexCoords, facesList, {
    showVertices: options.showVertices ?? false,
    showEdges: options.showEdges ?? false,
    facesConfig: options.facesConfig,
  });
}
