// F4 — parallel frame-range rendering (planning layer).
//
// The parallel unit here is the SEGMENT (each play()/wait() call), NOT the
// individual frame. Frame N inside a play() depends on the mobject state left
// by frames 0..N-1, so frames within one segment cannot be parallelized. But
// distinct play()/wait() segments each produce their own partial-movie-file
// (content-addressed by hash), so *whole segments* can be rendered on separate
// workers and concatenated afterwards — exactly the cache path node.ts already
// uses, just sharded.
//
// This module is the pure PLANNING layer: discover the ordered segment manifest
// and partition it across workers. It intentionally avoids worker_threads and
// other node-only heavy imports so it can be reasoned about (and unit-tested)
// on its own. The node-only orchestration lives in ../node-parallel.ts.

import { Scene } from "./Scene.ts";

/**
 * One play()/wait() segment, mirroring Scene.PlayRecord. `startFrame`/`endFrame`
 * are absolute frame counts; the segment's frame span is `endFrame - startFrame`.
 */
export interface SegmentRecord {
  index: number;
  kind: string;
  hash: string;
  startFrame: number;
  endFrame: number;
}

/**
 * Run construct() purely to harvest the segment manifest. Every segment is
 * skipped (so no PNG is ever encoded) and the frameHandler is a no-op, but time
 * and frameCount still advance — so `scene.playRecords` comes out with correct,
 * deterministic frame ranges and content hashes. Cheap: no rendering happens.
 *
 * `makeScene` builds a fresh Scene (or Scene subclass instance / construct fn);
 * `sceneInput` is passed to a plain construct function form. `opts.camera` is
 * optional — most scenes don't touch the camera during construct(), but if the
 * scene needs one it may be supplied.
 */
export async function discoverSegments(
  makeScene: () => any,
  sceneInput: any,
  opts: { fps: number; camera?: any; params?: Record<string, any> },
): Promise<SegmentRecord[]> {
  const { fps, camera, params } = opts;
  const target = makeScene();

  // Build the Scene instance. We support three shapes, matching node.ts's
  // runConstruct(): a Scene subclass (constructor), a Scene instance, or a
  // plain async construct(scene) function.
  let scene: Scene;
  let plainConstruct: ((s: Scene) => any) | null = null;

  if (target instanceof Scene) {
    scene = target;
    // Re-apply fps/camera in case the caller built it without them.
    if (typeof fps === "number") (scene as any).fps = fps;
    if (camera) (scene as any).camera = camera;
    if (params !== undefined) scene.params = params;
  } else if (typeof target === "function" && !(target.prototype instanceof Scene)) {
    // Plain construct function.
    scene = new Scene({ fps, camera: camera ?? null, ...(params !== undefined ? { params } : {}) });
    plainConstruct = target as (s: Scene) => any;
  } else if (typeof target === "function" && target.prototype instanceof Scene) {
    // A Scene subclass constructor.
    scene = new (target as any)({ fps, camera: camera ?? null, ...(params !== undefined ? { params } : {}) });
  } else {
    // Fallback: treat as an object we can't construct — wrap in a bare Scene.
    scene = new Scene({ fps, camera: camera ?? null, ...(params !== undefined ? { params } : {}) });
  }

  // Skip every segment (no frames emitted) and make frame emission a no-op. The
  // Scene still advances time/frameCount for skipped segments, so playRecords
  // ends up fully populated with correct ranges.
  scene.frameHandler = async () => {};
  scene.onSegment = () => ({ skip: true });

  if (plainConstruct) {
    await (plainConstruct as any)(scene, params);
    scene.finalizeSections();
  } else {
    await scene.render();
  }

  return scene.playRecords.map((r) => ({
    index: r.index,
    kind: r.kind,
    hash: r.hash,
    startFrame: r.startFrame,
    endFrame: r.endFrame,
  }));
}

/**
 * Partition segment indices across `workers`, load-balanced by frame span
 * (endFrame - startFrame). Returns an array of length `workers`; each entry is
 * the list of segment INDICES assigned to that worker.
 *
 * Strategy: longest-processing-time-first (LPT) greedy bin packing — sort
 * segments by descending frame count, then assign each to the currently
 * least-loaded worker. This gives good balance even when segment lengths vary
 * widely. Every index appears exactly once across all buckets.
 */
export function partitionSegments(records: SegmentRecord[], workers: number): number[][] {
  const n = Math.max(1, Math.floor(workers));
  const buckets: number[][] = Array.from({ length: n }, () => []);
  const loads: number[] = new Array(n).fill(0);

  // Sort a copy by descending frame span (ties broken by index for determinism).
  const sorted = [...records].sort((a, b) => {
    const la = a.endFrame - a.startFrame;
    const lb = b.endFrame - b.startFrame;
    if (lb !== la) return lb - la;
    return a.index - b.index;
  });

  for (const rec of sorted) {
    const span = Math.max(0, rec.endFrame - rec.startFrame);
    // Pick the least-loaded bucket (lowest index wins ties for determinism).
    let best = 0;
    for (let i = 1; i < n; i++) {
      if (loads[i] < loads[best]) best = i;
    }
    buckets[best].push(rec.index);
    loads[best] += span;
  }

  // Keep each bucket's indices in ascending order — nicer for logging/debug and
  // does not affect correctness (workers use a membership set, not order).
  for (const b of buckets) b.sort((a, c) => a - c);
  return buckets;
}
