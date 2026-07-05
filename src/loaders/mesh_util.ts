// Shared utilities for mesh import loaders (mesh_obj.ts, mesh_stl.ts) -- kept
// separate so both loaders share one "has three successfully loaded" signal
// and one vertex-dedup implementation, rather than drifting apart.

let threeLoaded = false;

/** Whether a mesh import has previously loaded three successfully (mirrors
 *  wasm.ts's isWasmLoaded() -- reflects past attempts, not a predictive
 *  availability check; the authoritative signal for "will this work right
 *  now" is still a loader's own rejection). */
export function isMeshLoaderAvailable(): boolean {
  return threeLoaded;
}

/** Called by each loader's resolve*Loader() once a dynamic import of three's
 *  bundled loader module succeeds. */
export function markThreeLoaded(): void {
  threeLoaded = true;
}

/** Merge coincident vertices (rounded to `precision` decimal places) from a
 *  single BufferGeometry into a deduped {vertexCoords, facesList}. Raw
 *  parser output is often one triangle per 3 unique-in-that-triangle
 *  vertices with zero sharing; Polyhedron.getEdges() (src/mobject/polyhedra.ts)
 *  relies on shared indices to dedupe edges, so skipping this makes every
 *  triangle a disconnected island. */
export function extractMeshDataFromGeometry(
  geometry: any,
  precision = 5,
): { vertexCoords: number[][]; facesList: number[][] } {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const rawIndexAt = (i: number) => (idx ? idx.getX(i) : i);
  const readVert = (i: number): number[] => [pos.getX(i), pos.getY(i), pos.getZ(i)];

  const indexOf = new Map<string, number>();
  const vertexCoords: number[][] = [];
  const dedupe = (rawIdx: number): number => {
    const p = readVert(rawIdx);
    const key = p.map((c) => c.toFixed(precision)).join(",");
    let vi = indexOf.get(key);
    if (vi === undefined) {
      vi = vertexCoords.length;
      vertexCoords.push(p);
      indexOf.set(key, vi);
    }
    return vi;
  };

  const facesList: number[][] = [];
  const count = idx ? idx.count : pos.count;
  for (let f = 0; f + 2 < count; f += 3) {
    facesList.push([dedupe(rawIndexAt(f)), dedupe(rawIndexAt(f + 1)), dedupe(rawIndexAt(f + 2))]);
  }
  return { vertexCoords, facesList };
}
