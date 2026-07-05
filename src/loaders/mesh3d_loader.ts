// GPU-tier mesh import: parses the same OBJ/STL data as loadMeshOBJ/
// loadMeshSTL (src/loaders/mesh_obj.ts, mesh_stl.ts), but returns a Mesh3D
// (src/mobject/mesh3d.ts) instead of a Polyhedron -- for scenes with more
// triangles than the CPU/Polyhedron tier comfortably handles (see the
// mesh-import plan's Phase 2 perf gate). One function + a `format` option,
// rather than two parallel loadMesh3DOBJ/loadMesh3DSTL functions, since the
// only difference between formats is which parser produces the
// {vertexCoords, facesList} data both loaders already extract identically.

import { Mesh3D } from "../mobject/mesh3d.ts";
import type { MobjectConfig } from "../mobject/Mobject.ts";
import { parseOBJToMeshData } from "./mesh_obj.ts";
import type { MeshOBJImportOptions } from "./mesh_obj.ts";
import { parseSTLToMeshData } from "./mesh_stl.ts";
import type { MeshSTLImportOptions } from "./mesh_stl.ts";

export type Mesh3DImportOptions = MobjectConfig &
  (
    | ({ format: "obj" } & Pick<MeshOBJImportOptions, "OBJLoader">)
    | ({ format: "stl" } & Pick<MeshSTLImportOptions, "STLLoader">)
  );

export async function loadMesh3D(textOrBytes: string | ArrayBuffer, options: Mesh3DImportOptions): Promise<Mesh3D> {
  const { format, ...rest } = options;
  let vertexCoords: number[][], facesList: number[][];
  if (format === "obj") {
    if (typeof textOrBytes !== "string") throw new Error("loadMesh3D: format 'obj' requires string text, not bytes.");
    try {
      ({ vertexCoords, facesList } = await parseOBJToMeshData(textOrBytes, rest as MeshOBJImportOptions));
    } catch (e: any) {
      throw new Error(`loadMesh3D: ${e.message}`);
    }
  } else if (format === "stl") {
    try {
      ({ vertexCoords, facesList } = await parseSTLToMeshData(textOrBytes, rest as MeshSTLImportOptions));
    } catch (e: any) {
      throw new Error(`loadMesh3D: ${e.message}`);
    }
  } else {
    throw new Error(`loadMesh3D: unknown format ${JSON.stringify((options as any).format)} -- expected "obj" or "stl".`);
  }
  return new Mesh3D(vertexCoords, facesList, rest as MobjectConfig);
}
