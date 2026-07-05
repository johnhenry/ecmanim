// Import an STL mesh (ASCII or binary) as a real, animatable Mobject --
// mirrors mesh_obj.ts's shape exactly. STL is simpler than OBJ: STLLoader
// .parse() returns a BufferGeometry directly (no Object3D/Group to unwrap),
// and STL has zero built-in vertex sharing at all (every triangle is 3 fresh
// floats), so the shared extractMeshDataFromGeometry() dedup step in
// mesh_util.ts does correspondingly more work here than for a typical OBJ.
// parseSTLToMeshData is exported separately so loadMesh3D
// (src/loaders/mesh3d_loader.ts, the GPU tier) can reuse it without
// duplicating the STLLoader resolution + extraction logic.

import { Polyhedron } from "../mobject/polyhedra.ts";
import type { FacesConfig } from "../mobject/polyhedra.ts";
import { extractMeshDataFromGeometry, markThreeLoaded } from "./mesh_util.ts";

export interface MeshSTLImportOptions {
  /** Inject an STLLoader class (tests / bundler control) instead of a lazy
   *  dynamic import of three's bundled loader. */
  STLLoader?: new () => { parse(bytesOrText: ArrayBuffer | string): any };
  /** Add vertex Dots to the group (default false for an imported mesh). */
  showVertices?: boolean;
  /** Add edge Lines to the group (default false for an imported mesh). */
  showEdges?: boolean;
  facesConfig?: FacesConfig;
}

export async function resolveSTLLoader(
  options: MeshSTLImportOptions,
): Promise<new () => { parse(bytesOrText: ArrayBuffer | string): any }> {
  if (options.STLLoader) return options.STLLoader;
  try {
    const mod: any = await import("three/examples/jsm/loaders/STLLoader.js");
    markThreeLoaded();
    return mod.STLLoader;
  } catch {
    throw new Error(
      "3D mesh import requires the optional 'three' dependency -- install it (npm install three) to enable .obj/.stl import.",
    );
  }
}

/** Parse STL data into {vertexCoords, facesList}, shared by loadMeshSTL
 *  (-> Polyhedron, Tier A) and loadMesh3D (-> Mesh3D, Tier B). */
export async function parseSTLToMeshData(
  bytesOrText: ArrayBuffer | string,
  options: MeshSTLImportOptions = {},
): Promise<{ vertexCoords: number[][]; facesList: number[][] }> {
  const STLLoader = await resolveSTLLoader(options);
  let geometry: any;
  try {
    // STLLoader sniffs binary-vs-ASCII by probing byte offsets into the
    // input -- a too-short or otherwise malformed buffer can throw a raw
    // RangeError from inside that heuristic rather than a friendly parse
    // error, so this is wrapped into the same clear, catchable failure mode
    // as every other error path here.
    geometry = new STLLoader().parse(bytesOrText);
  } catch (e: any) {
    throw new Error(`could not parse STL data (${e?.message ?? e}).`);
  }
  const data = extractMeshDataFromGeometry(geometry);
  if (data.vertexCoords.length === 0) throw new Error("the STL data contained no mesh geometry.");
  return data;
}

export async function loadMeshSTL(
  bytesOrText: ArrayBuffer | string,
  options: MeshSTLImportOptions = {},
): Promise<Polyhedron> {
  let vertexCoords: number[][], facesList: number[][];
  try {
    ({ vertexCoords, facesList } = await parseSTLToMeshData(bytesOrText, options));
  } catch (e: any) {
    throw new Error(`loadMeshSTL: ${e.message}`);
  }
  return new Polyhedron(vertexCoords, facesList, {
    showVertices: options.showVertices ?? false,
    showEdges: options.showEdges ?? false,
    facesConfig: options.facesConfig,
  });
}
