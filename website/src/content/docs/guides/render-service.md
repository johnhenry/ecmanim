---
title: "Render service"
---

Scale-out rendering: a **coordinator** (HTTP API + SQLite job queue + artifact
store + signed webhooks) and pull-model **workers** that claim jobs, render
with the normal Node backend, and upload the result. Import surface:
`ecmanim/service`; CLI surface: `ecmanim serve / worker / submit / jobs`.

## Quickstart (one machine)

```bash
# 1. Start the coordinator over your scene project.
export ECMANIM_API_TOKEN=$(openssl rand -hex 24)
export ECMANIM_WORKER_TOKEN=$(openssl rand -hex 24)
ecmanim serve --project ./my-scenes --port 5990

# 2. Start one or more workers (same project on disk).
ecmanim worker --coordinator http://127.0.0.1:5990 --project ./my-scenes

# 3. Submit and wait.
ecmanim submit intro.ts --quality high --wait --download intro.mp4
ecmanim jobs --watch
```

Docker (coordinator + 2 workers):

```bash
PROJECT_DIR=./my-scenes docker compose up --scale worker=4
```

## Job JSON

`POST /api/v1/jobs` (bearer `ECMANIM_API_TOKEN`):

```json
{
  "scene": "unwrapped.ts",
  "exportName": "default",
  "params": { "user": "ada", "year": 2026 },
  "render": { "quality": "high", "format": "mp4", "fps": 30 },
  "parallelism": { "mode": "workers", "workers": 4 },
  "webhook": { "url": "https://example.com/hooks/render", "secret": "whsec_..." },
  "priority": 5
}
```

- `scene` is a path **relative to the deployed `--project` directory** — see
  the security model below.
- `params` are validated by the scene's own static `schema`
  (see the metadata guide) and reach `construct()` as `scene.params` (or the
  2nd argument of a bare construct function).
- `render` is an **allowlist** (quality/format/fps/resolution/background/
  transparent/saveLastFrame/style/aspectRatio/stillFrame/workers). Unknown
  keys are 400s, not silently dropped. `renderer: "webgl"` is rejected in v1
  (the service image ships no Chrome; a Chrome-sidecar image is the future
  path for `renderGL`).
- `parallelism.mode: "workers"` uses `renderParallel` inside the claiming
  worker. `"segments"` (fanning ONE job across machines) is reserved in the
  protocol and rejected in v1.

Lifecycle: `queued → claimed → running → uploading → done | failed | canceled`.
Poll `GET /api/v1/jobs/:id`, stream `GET /api/v1/events` (SSE), download
`GET /api/v1/jobs/:id/artifact`. `DELETE /api/v1/jobs/:id` cancels.

Failed renders requeue automatically up to 3 attempts (configurable); a
worker that dies mid-render loses its lease and the sweep loop requeues the
job.

### Content-addressed partial reuse

Workers keep a stable per-scene render cache: a resubmitted identical job (or
a param variant that shares unchanged segments) reuses partial movie files
instead of re-encoding — `progress.reusedPartials` on the job reports it.
Params are hashed into every partial's cache key, so two personalized renders
can never collide.

## Webhooks

Terminal states POST your webhook URL with a Stripe-scheme signature:

```
X-Ecmanim-Signature: t=1700000000,v1=<hex hmac-sha256 of "t.body">
```

Verify with the exported helper (constant-time, 5-minute replay window):

```ts
import { verifyWebhook } from "ecmanim/service";

http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (!verifyWebhook(process.env.WEBHOOK_SECRET, req.headers["x-ecmanim-signature"], raw)) {
      res.writeHead(400); return res.end();
    }
    const { jobId, state, artifact } = JSON.parse(raw);
    // ... 2xx quickly; retries back off 0s/10s/60s/5m/30m before giving up.
    res.writeHead(200); res.end();
  });
});
```

Deliveries are durable rows (they survive coordinator restarts) and retry on
the backoff above with a 10s per-attempt timeout.

## Security model

**A render service executes `construct()`.** Accepting scene code over HTTP
would be remote code execution as a feature, so jobs may only reference scene
files **already deployed** inside the coordinator's `--project` directory —
the same deploy-your-project model as Remotion Lambda. Per-job variation goes
through schema-validated `params`. Scene paths are checked twice (shape
validation at submit, realpath containment at both coordinator and worker),
so traversal and symlink escapes 400.

Auth is two bearer tokens: `ECMANIM_API_TOKEN` (clients) and
`ECMANIM_WORKER_TOKEN` (workers), constant-time compared. An unset token
disables that check — the default bind is `127.0.0.1`, so exposing the
service means choosing `--host 0.0.0.0` **and** setting tokens.

## S3 artifacts

```ts
import { startCoordinator, createS3Storage } from "ecmanim/service";

await startCoordinator({
  projectDir: "./my-scenes",
  storage: await createS3Storage({ bucket: "my-renders", region: "us-east-1" }),
});
```

Requires `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
(lazy-imported). The artifact route 302-redirects to a presigned GET instead
of proxying bytes.

## Honest gaps vs a managed Lambda

Documented, not hidden:

| Area | v1 reality | Path forward |
|---|---|---|
| Sandboxing | None — workers run *your deployed* code, trusted | microVM isolation |
| Control plane | Single coordinator, SQLite | `JobStore` seam → Postgres |
| Autoscaling | `--scale worker=N`, no scale-to-zero | external autoscaler on queue depth |
| Artifact transit | Bytes pass through the coordinator (FsStorage) | presigned direct upload (S3 driver already presigns GETs) |
| Single-job fan-out | `parallelism.mode:"segments"` reserved, 400 | partial-file model makes it feasible; nullable `segment_manifest` column exists |
| WebGL (`renderGL`) | rejected 400 (no Chrome in image) | Chrome sidecar image |
| gif / png-sequence | render sequentially inside one worker | — |
