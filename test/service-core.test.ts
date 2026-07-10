// Render-service S1 core: protocol validation (traversal/allowlist), the
// JobStore contract run against BOTH MemoryJobStore and SqliteJobStore
// (FIFO+priority atomic claims, lease expiry requeue, restart durability),
// FsStorage, and webhook sign/verify + retry scheduling.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateJobSpec, sanitizeRenderOptions, isUnsafeScenePath, artifactExtension } from "../src/service/protocol.ts";
import { MemoryJobStore, SqliteJobStore } from "../src/service/queue.ts";
import type { JobStore } from "../src/service/queue.ts";
import { FsStorage } from "../src/service/storage.ts";
import { signWebhook, verifyWebhook, WebhookScheduler, SIGNATURE_HEADER } from "../src/service/webhooks.ts";

// ---------------------------------------------------------------------------
// protocol
// ---------------------------------------------------------------------------

test("scene path traversal shapes are rejected; plain relative paths pass", () => {
  for (const bad of ["../secrets.ts", "a/../../b.ts", "/etc/passwd", "C:\\x.ts", "file:///x.ts", "a\0b.ts", ""]) {
    assert.ok(isUnsafeScenePath(bad), `should reject ${JSON.stringify(bad)}`);
  }
  for (const ok of ["scene.ts", "examples/intro.ts", "deep/nested/dir/scene.ts"]) {
    assert.ok(!isUnsafeScenePath(ok), `should accept ${JSON.stringify(ok)}`);
  }
  const bad = validateJobSpec({ scene: "../x.ts" });
  assert.match(bad.errors.join(), /unsafe path/);
});

test("render options: allowlist enforced, unknown keys and webgl rejected as errors", () => {
  const errors: string[] = [];
  const out = sanitizeRenderOptions(
    { quality: "low", fps: 10, output: "/tmp/evil.mp4", disableCaching: true, resolution: [320, 180] },
    errors,
  );
  assert.deepEqual(Object.keys(out).sort(), ["fps", "quality", "resolution"]);
  assert.match(errors.join(), /render\.output: not an allowed/);
  assert.match(errors.join(), /render\.disableCaching: not an allowed/);
  const errors2: string[] = [];
  sanitizeRenderOptions({ renderer: "webgl" }, errors2);
  assert.match(errors2.join(), /webgl.*not available/);
  // Type mismatches are errors too.
  const errors3: string[] = [];
  sanitizeRenderOptions({ fps: "fast" }, errors3);
  assert.match(errors3.join(), /fps: expected finite number/);
});

test("validateJobSpec: normalizes defaults; segments parallelism reserved", () => {
  const good = validateJobSpec({ scene: "demo.ts", params: { name: "x" }, priority: 5 });
  assert.equal(good.errors.length, 0);
  assert.equal(good.spec!.exportName, "default");
  assert.equal(good.spec!.priority, 5);
  const seg = validateJobSpec({ scene: "demo.ts", parallelism: { mode: "segments" } });
  assert.match(seg.errors.join(), /reserved and not implemented/);
  const wh = validateJobSpec({ scene: "demo.ts", webhook: { url: "not-a-url" } });
  assert.match(wh.errors.join(), /webhook\.url/);
  assert.equal(artifactExtension({ scene: "x", render: { format: "webm" } } as any), "webm");
  assert.equal(artifactExtension({ scene: "x", render: { saveLastFrame: true } } as any), "png");
});

// ---------------------------------------------------------------------------
// JobStore contract — parameterized over both implementations
// ---------------------------------------------------------------------------

const tmp = mkdtempSync(join(tmpdir(), "ecmanim-service-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const SPEC = { scene: "demo.ts", exportName: "default", priority: 0 };

function storeSuite(name: string, make: () => JobStore): void {
  test(`${name}: FIFO within priority, priority wins, atomic claim`, () => {
    const store = make();
    const low1 = store.createJob({ ...SPEC, priority: 0 });
    const low2 = store.createJob({ ...SPEC, priority: 0 });
    const high = store.createJob({ ...SPEC, priority: 10 });
    const c1 = store.claimJob("w1", 5000);
    assert.equal(c1!.id, high.id, "highest priority first");
    assert.equal(c1!.state, "claimed");
    assert.equal(c1!.attempts, 1);
    const c2 = store.claimJob("w2", 5000);
    assert.equal(c2!.id, low1.id, "FIFO within equal priority");
    const c3 = store.claimJob("w1", 5000);
    assert.equal(c3!.id, low2.id);
    assert.equal(store.claimJob("w1", 5000), null, "queue drained");
    store.close();
  });

  test(`${name}: full lifecycle queued→running→uploading→done`, () => {
    const store = make();
    const job = store.createJob(SPEC);
    const claimed = store.claimJob("w1", 5000)!;
    assert.equal(claimed.id, job.id);
    assert.ok(store.heartbeat(job.id, "w1", 5000, { segmentsDone: 1, segmentsTotal: 4 }));
    assert.equal(store.getJob(job.id)!.state, "running");
    assert.deepEqual(store.getJob(job.id)!.progress, { segmentsDone: 1, segmentsTotal: 4 });
    assert.ok(store.markUploading(job.id, "w1"));
    assert.ok(store.completeJob(job.id, "w1", `${job.id}/out.mp4`));
    const done = store.getJob(job.id)!;
    assert.equal(done.state, "done");
    assert.equal(done.artifactKey, `${job.id}/out.mp4`);
    // A different worker can't touch a job it doesn't hold.
    assert.equal(store.heartbeat(job.id, "w2", 5000), false);
    store.close();
  });

  test(`${name}: lease expiry requeues up to maxAttempts, then fails`, () => {
    const store = make();
    const job = store.createJob(SPEC, { maxAttempts: 2 });
    store.claimJob("w1", 1); // 1ms lease
    const requeued = store.sweepExpiredLeases(Date.now() + 10);
    assert.equal(requeued, 1);
    assert.equal(store.getJob(job.id)!.state, "queued", "first expiry requeues");
    store.claimJob("w2", 1);
    store.sweepExpiredLeases(Date.now() + 10);
    assert.equal(store.getJob(job.id)!.state, "failed", "attempts exhausted");
    assert.match(store.getJob(job.id)!.error!, /lease expired/);
    store.close();
  });

  test(`${name}: explicit fail requeues; cancel is terminal`, () => {
    const store = make();
    const job = store.createJob(SPEC);
    store.claimJob("w1", 5000);
    assert.ok(store.failJob(job.id, "w1", "boom"));
    assert.equal(store.getJob(job.id)!.state, "queued");
    assert.equal(store.getJob(job.id)!.error, "boom");
    assert.ok(store.cancelJob(job.id));
    assert.equal(store.getJob(job.id)!.state, "canceled");
    assert.equal(store.claimJob("w1", 5000), null, "canceled jobs are not claimable");
    assert.equal(store.cancelJob(job.id), false, "cancel is idempotent-false on terminal");
    store.close();
  });
}

storeSuite("MemoryJobStore", () => new MemoryJobStore());
let sqliteN = 0;
storeSuite("SqliteJobStore", () => new SqliteJobStore(join(tmp, `queue-${sqliteN++}.db`)));

test("SqliteJobStore: jobs and deliveries survive a close/reopen (restart durability)", () => {
  const path = join(tmp, "durable.db");
  const a = new SqliteJobStore(path);
  const job = a.createJob({ ...SPEC, priority: 3 });
  a.createDelivery(job.id, "http://example.test/hook", "s3cret", "{\"x\":1}");
  a.close();
  const b = new SqliteJobStore(path);
  const revived = b.getJob(job.id)!;
  assert.equal(revived.state, "queued");
  assert.equal(revived.priority, 3);
  assert.equal(revived.spec.scene, "demo.ts");
  const due = b.duePendingDeliveries(Date.now() + 1000);
  assert.equal(due.length, 1);
  assert.equal(due[0].secret, "s3cret");
  b.close();
});

// ---------------------------------------------------------------------------
// FsStorage
// ---------------------------------------------------------------------------

test("FsStorage: put/get round-trip, traversal-proof keys", async () => {
  const storage = new FsStorage(join(tmp, "artifacts"));
  const src = join(tmp, "src.bin");
  writeFileSync(src, Buffer.from("hello artifact"));
  const key = await storage.put("job-1", "out.mp4", createReadStream(src));
  assert.equal(key, "job-1/out.mp4");
  assert.ok(storage.exists(key));
  assert.equal(storage.size(key), 14);
  const chunks: Buffer[] = [];
  for await (const c of storage.getStream(key)) chunks.push(c as Buffer);
  assert.equal(Buffer.concat(chunks).toString(), "hello artifact");
  assert.throws(() => storage.getStream("../../etc/passwd"), /escapes storage root/);
  // Hostile jobId/filename get sanitized rather than traversing.
  const key2 = await storage.put("../evil", "..\\..\\x", createReadStream(src));
  assert.ok(!key2.includes(".."), `sanitized: ${key2}`);
});

// ---------------------------------------------------------------------------
// webhooks
// ---------------------------------------------------------------------------

test("webhook signature round-trips; tampered body/timestamp rejected", () => {
  const body = JSON.stringify({ jobId: "j1", state: "done" });
  const now = 1_700_000_000;
  const header = signWebhook("whsec_abc", body, now);
  assert.match(header, /^t=1700000000,v1=[0-9a-f]{64}$/);
  assert.ok(verifyWebhook("whsec_abc", header, body, { nowSec: now + 10 }));
  assert.ok(!verifyWebhook("whsec_abc", header, body + " ", { nowSec: now + 10 }), "tampered body");
  assert.ok(!verifyWebhook("wrong", header, body, { nowSec: now + 10 }), "wrong secret");
  assert.ok(!verifyWebhook("whsec_abc", header, body, { nowSec: now + 3600 }), "outside tolerance");
  assert.ok(!verifyWebhook("whsec_abc", undefined, body), "missing header");
  assert.ok(!verifyWebhook("whsec_abc", "garbage", body), "malformed header");
});

test("webhook scheduler: 2xx delivers; failures walk the backoff then exhaust", async () => {
  const store = new MemoryJobStore();
  const calls: Array<{ url: string; sig: string | undefined }> = [];
  let respondWith = 500;
  const scheduler = new WebhookScheduler(store, {
    backoffMs: [0, 100, 200], // 3 attempts max
    transport: async (url, init) => {
      calls.push({ url, sig: init.headers[SIGNATURE_HEADER] });
      return { status: respondWith };
    },
  });
  scheduler.enqueue("j1", "http://example.test/hook", "sek", { jobId: "j1", state: "done" });

  await scheduler.tick(); // attempt 1 (delay 0) → 500
  assert.equal(calls.length, 1);
  assert.ok(calls[0].sig!.startsWith("t="), "signed");
  let due = store.duePendingDeliveries(Date.now() + 150);
  assert.equal(due.length, 1, "retry scheduled ~100ms out");
  assert.equal(due[0].attempts, 1);

  await scheduler.tick(); // not due yet (needs +100ms)
  assert.equal(calls.length, 1, "backoff respected");

  respondWith = 200;
  // Force due by ticking with a shifted clock via a second scheduler view.
  const later = new WebhookScheduler(store, {
    backoffMs: [0, 100, 200],
    now: () => Date.now() + 150,
    transport: async (url, init) => {
      calls.push({ url, sig: init.headers[SIGNATURE_HEADER] });
      return { status: respondWith };
    },
  });
  await later.tick(); // attempt 2 → 200 OK
  assert.equal(calls.length, 2);
  assert.equal(store.duePendingDeliveries(Date.now() + 10_000_000).length, 0, "delivered");

  // Exhaustion: always-500 endpoint runs out of attempts.
  const store2 = new MemoryJobStore();
  let t = Date.now();
  const failer = new WebhookScheduler(store2, {
    backoffMs: [0, 10, 20],
    now: () => t,
    transport: async () => ({ status: 503 }),
  });
  failer.enqueue("j2", "http://example.test/hook", null, { x: 1 });
  // enqueue stamps nextAttemptAt with the REAL clock, which may sit a few ms
  // past the frozen t captured above — jump t safely beyond it.
  t = Date.now() + 1000;
  await failer.tick(); t += 15;
  await failer.tick(); t += 25;
  await failer.tick();
  assert.equal(store2.duePendingDeliveries(t + 10_000_000).length, 0, "exhausted deliveries never come due");
});
