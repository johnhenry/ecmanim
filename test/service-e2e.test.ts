// S3: the whole render service end-to-end in one process — coordinator +
// worker (DEFAULT renderImpl: real @napi-rs render + ffmpeg encode) + a local
// webhook receiver. A 3-segment 10fps scene renders to a real mp4 (verified
// with ffprobe), the signed webhook arrives exactly once, and a second
// identical submit reuses content-addressed partials instead of re-encoding.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCoordinator } from "../src/service/coordinator.ts";
import { ServiceWorker } from "../src/service/worker.ts";
import { verifyWebhook, SIGNATURE_HEADER } from "../src/service/webhooks.ts";

const canvasAvailable = await import("@napi-rs/canvas").then(() => true, () => false);
const ffmpegAvailable = (() => {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
})();
const skip = !canvasAvailable ? "@napi-rs/canvas not available"
  : !ffmpegAvailable ? "ffmpeg not available" : false;

const SCENE_SOURCE = `
import { Circle, Square, FadeIn } from "${join(import.meta.dirname, "..", "src", "index.ts")}";
export default async (scene, params) => {
  const c = new Circle({ radius: 1, color: params?.color ?? "#58C4DD" });
  await scene.play(new FadeIn(c), { runTime: 0.3 });
  await scene.play(c.animate.shift([2, 0, 0]), { runTime: 0.3 });
  const s = new Square({ sideLength: 1 });
  await scene.play(new FadeIn(s), { runTime: 0.3 });
};
`;

test("E2E: submit → real render → mp4 artifact + exactly-once verified webhook + partial reuse", { skip, timeout: 180_000 }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ecmanim-svc-e2e-"));
  const projectDir = join(tmp, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "demo.ts"), SCENE_SOURCE);

  // Local webhook receiver capturing raw bodies + signature headers.
  const hooks: Array<{ body: string; sig: string | undefined }> = [];
  const receiver = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hooks.push({ body, sig: req.headers[SIGNATURE_HEADER] as string | undefined });
      res.writeHead(200);
      res.end();
    });
  });
  const receiverPort = await new Promise<number>((r) => receiver.listen(0, "127.0.0.1", () => r((receiver.address() as any).port)));

  const c = await startCoordinator({ projectDir, port: 0, dataDir: join(tmp, "data") });
  const cacheDir = join(tmp, "worker-cache");
  try {
    const submitBody = {
      scene: "demo.ts",
      render: { quality: "low", fps: 10 },
      webhook: { url: `http://127.0.0.1:${receiverPort}/hook`, secret: "whsec_e2e" },
    };
    const submit = await fetch(`${c.url}/api/v1/jobs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(submitBody),
    });
    assert.equal(submit.status, 201);
    const { job } = await submit.json() as any;

    const worker = new ServiceWorker({ coordinatorUrl: c.url, projectDir, once: true, cacheDir });
    await worker.run();

    // Job done, artifact is a real mp4.
    const done = await (await fetch(`${c.url}/api/v1/jobs/${job.id}`)).json() as any;
    assert.equal(done.job.state, "done", `job should be done: ${JSON.stringify(done.job)}`);
    const artifact = await fetch(`${c.url}/api/v1/jobs/${job.id}/artifact`);
    assert.equal(artifact.status, 200);
    const bytes = Buffer.from(await artifact.arrayBuffer());
    assert.ok(bytes.length > 5000, `artifact should be a real video (${bytes.length} bytes)`);
    const mp4Path = join(tmp, "check.mp4");
    writeFileSync(mp4Path, bytes);
    const probe = execFileSync("ffprobe", [
      "-v", "quiet", "-print_format", "json", "-show_streams", mp4Path,
    ]).toString();
    const streams = JSON.parse(probe).streams;
    assert.ok(streams.some((s: any) => s.codec_type === "video"), "ffprobe sees a video stream");

    // Exactly-once, signature-verified webhook.
    for (let i = 0; i < 50 && hooks.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(hooks.length, 1, "webhook delivered exactly once");
    assert.ok(verifyWebhook("whsec_e2e", hooks[0].sig, hooks[0].body), "signature verifies over the raw body");
    const payload = JSON.parse(hooks[0].body);
    assert.equal(payload.jobId, job.id);
    assert.equal(payload.state, "done");

    // Second identical submit: content-addressed partials are reused.
    const submit2 = await fetch(`${c.url}/api/v1/jobs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scene: "demo.ts", render: { quality: "low", fps: 10 } }),
    });
    const { job: job2 } = await submit2.json() as any;
    const worker2 = new ServiceWorker({ coordinatorUrl: c.url, projectDir, once: true, cacheDir });
    await worker2.run();
    const done2 = await (await fetch(`${c.url}/api/v1/jobs/${job2.id}`)).json() as any;
    assert.equal(done2.job.state, "done");
    assert.ok(
      (done2.job.progress?.reusedPartials ?? 0) > 0,
      `second identical render should reuse partials (progress: ${JSON.stringify(done2.job.progress)})`,
    );
  } finally {
    await c.close();
    receiver.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("E2E: params-varied jobs render distinct artifacts without cache collisions", { skip, timeout: 180_000 }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ecmanim-svc-e2e2-"));
  const projectDir = join(tmp, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "demo.ts"), SCENE_SOURCE);
  const c = await startCoordinator({ projectDir, port: 0, dataDir: join(tmp, "data") });
  const cacheDir = join(tmp, "worker-cache");
  try {
    const ids: string[] = [];
    for (const color of ["#FF0000", "#0000FF"]) {
      const res = await fetch(`${c.url}/api/v1/jobs`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ scene: "demo.ts", params: { color }, render: { quality: "low", fps: 10 } }),
      });
      ids.push(((await res.json()) as any).job.id);
    }
    const worker = new ServiceWorker({ coordinatorUrl: c.url, projectDir, once: true, cacheDir });
    await worker.run();
    await worker.run();
    const artifacts: Buffer[] = [];
    for (const id of ids) {
      const j = await (await fetch(`${c.url}/api/v1/jobs/${id}`)).json() as any;
      assert.equal(j.job.state, "done", `job ${id}: ${JSON.stringify(j.job.error)}`);
      artifacts.push(Buffer.from(await (await fetch(`${c.url}/api/v1/jobs/${id}/artifact`)).arrayBuffer()));
    }
    // Different params → different pixels → different encodes. If the cache
    // collided (unsalted), the second render would REUSE the first's reds.
    assert.ok(!artifacts[0].equals(artifacts[1]), "param-varied renders must differ");
  } finally {
    await c.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});
