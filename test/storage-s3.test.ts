// S3Storage (src/service/storage-s3.ts) with injected fake clients — key
// shaping, put buffering, exists via HeadObject, presigned GET URLs, and the
// coordinator's 302 redirect for presigning drivers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createS3Storage } from "../src/service/storage-s3.ts";
import { startCoordinator } from "../src/service/coordinator.ts";
import { MemoryJobStore } from "../src/service/queue.ts";

class FakeCommand {
  input: any;
  constructor(input: any) { this.input = input; }
}
class PutObjectCommand extends FakeCommand {}
class GetObjectCommand extends FakeCommand {}
class HeadObjectCommand extends FakeCommand {}

function makeFakes() {
  const objects = new Map<string, Buffer>();
  const client = {
    async send(cmd: any) {
      if (cmd instanceof PutObjectCommand) {
        objects.set(cmd.input.Key, cmd.input.Body);
        return {};
      }
      if (cmd instanceof HeadObjectCommand) {
        if (!objects.has(cmd.input.Key)) throw new Error("NotFound");
        return {};
      }
      throw new Error(`unexpected command`);
    },
  };
  const presigner = async (_c: any, cmd: any, opts: { expiresIn: number }) =>
    `https://fake-s3.test/${cmd.input.Bucket}/${cmd.input.Key}?expires=${opts.expiresIn}`;
  return { objects, client, presigner, commands: { PutObjectCommand, GetObjectCommand, HeadObjectCommand } };
}

test("S3Storage: put buffers the stream under a sanitized prefixed key; exists via Head", async () => {
  const fakes = makeFakes();
  const storage = await createS3Storage({ bucket: "renders", prefix: "art/", ...fakes });
  const key = await storage.put("job-1", "../evil.mp4", Readable.from([Buffer.from("MP4")]));
  assert.ok(!key.includes(".."), `sanitized: ${key}`);
  assert.ok(fakes.objects.has(`art/${key}`), "stored under the prefix");
  assert.equal(fakes.objects.get(`art/${key}`)!.toString(), "MP4");
  assert.equal(await storage.exists(key), true);
  assert.equal(await storage.exists("job-1/nope.mp4"), false);
  assert.equal(storage.localPath(key), null);
  const url = await storage.presignGetUrl(key);
  assert.match(url, /^https:\/\/fake-s3\.test\/renders\/art\/job-1\/.*expires=3600$/);
});

test("coordinator artifact route 302-redirects for presigning storage drivers", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ecmanim-s3-"));
  const projectDir = join(tmp, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "demo.ts"), "export default async () => {};\n");
  const fakes = makeFakes();
  const storage = await createS3Storage({ bucket: "renders", ...fakes });
  const store = new MemoryJobStore();
  const c = await startCoordinator({ projectDir, port: 0, store, storage, dataDir: join(tmp, "data") });
  try {
    const { job } = await (await fetch(`${c.url}/api/v1/jobs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scene: "demo.ts" }),
    })).json() as any;
    // Simulate a worker completing with an S3-stored artifact.
    const claim = await (await fetch(`${c.url}/api/v1/worker/claim?workerId=w1`, { method: "POST" })).json() as any;
    assert.equal(claim.job.id, job.id);
    const key = await storage.put(job.id, "out.mp4", Readable.from([Buffer.from("BYTES")]));
    const complete = await fetch(`${c.url}/api/v1/worker/jobs/${job.id}/complete?workerId=w1`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifactKey: key }),
    });
    assert.equal(complete.status, 200);
    const artifact = await fetch(`${c.url}/api/v1/jobs/${job.id}/artifact`, { redirect: "manual" });
    assert.equal(artifact.status, 302);
    assert.match(artifact.headers.get("location")!, /^https:\/\/fake-s3\.test\/renders\//);
  } finally {
    await c.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
