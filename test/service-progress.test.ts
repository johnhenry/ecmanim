import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { ServiceWorker } from "../src/service/worker.ts";
import { MemoryJobStore } from "../src/service/queue.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

for (const source of ["progress", "heartbeat", "rejected progress", "no renderer stats"]) {
  test(`worker preserves final progress after a delayed ${source} request`, { timeout: 5000 }, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "ecmanim-progress-"));
    writeFileSync(join(dir, "scene.ts"), "export default () => {};");
    const store = new MemoryJobStore();
    const job = store.createJob({ scene: "scene.ts" });
    const held = deferred(), release = deferred(), rendered = deferred();
    const workerId = "test-worker";
    let delayed = false, reported = 0, heartbeat: (() => void) | undefined;
    // Drive heartbeats explicitly: no wall-clock sleeps or scheduler races.
    t.mock.method(globalThis, "setInterval", (fn: () => void) => {
      heartbeat = fn;
      return { unref() {} } as any;
    });
    t.mock.method(globalThis, "clearInterval", () => {});
    t.mock.method(globalThis, "fetch", async (input: any, init: any = {}) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/claim")) return Response.json({ job: store.claimJob(workerId, 60_000) });
      if (path.endsWith("/progress")) {
        const body = JSON.parse(init.body);
        // Delay either an ordinary report or the heartbeat that repeats it.
        reported++;
        const shouldDelay = !delayed && reported === (source === "heartbeat" ? 2 : 1);
        if (shouldDelay) {
          delayed = true;
          held.resolve();
          await release.promise;
          if (source === "rejected progress") throw new Error("connection lost");
        }
        store.heartbeat(job.id, workerId, 60_000, body.progress ?? body);
        return Response.json({ ok: true });
      }
      if (path.endsWith("/artifact")) {
        // Keep the job active until the delayed report arrives, so the store
        // cannot incidentally hide the race by rejecting it after completion.
        await release.promise;
        for await (const _chunk of init.body) { /* consume the upload like fetch */ }
        store.markUploading(job.id, workerId);
        return Response.json({ artifactKey: "out.mp4" });
      }
      if (path.endsWith("/complete")) {
        store.completeJob(job.id, workerId, "out.mp4");
        return Response.json({ ok: true });
      }
      throw new Error(`unexpected worker request: ${path}`);
    });
    const worker = new ServiceWorker({
      projectDir: dir, cacheDir: join(dir, "cache"), coordinatorUrl: "http://coordinator.test",
      workerId, once: true,
      renderImpl: async (_job, ctx) => {
        ctx.onProgress({ segmentsDone: 1, segmentsTotal: 3 });
        if (source === "heartbeat") heartbeat!();
        await held.promise;
        ctx.onProgress({ segmentsDone: 3, segmentsTotal: 3 });
        writeFileSync(ctx.outputPath, "video");
        rendered.resolve();
        return source === "no renderer stats" ? undefined : { reusedPartials: 3 };
      },
    });
    const running = worker.run();
    try {
      await rendered.promise;
      await setImmediate();
      // A slow progress report must not stop lease-renewal heartbeats.
      const before = reported;
      heartbeat!();
      assert.equal(reported, before + 1);
      await setImmediate();
      release.resolve();
      await running;
      const done = store.getJob(job.id)!;
      assert.equal(done.state, "done");
      assert.deepEqual(done.progress, {
        segmentsDone: 3, segmentsTotal: 3,
        ...(source === "no renderer stats" ? {} : { reusedPartials: 3 }),
      });
    } finally {
      release.resolve();
      await running;
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
