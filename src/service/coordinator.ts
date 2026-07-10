// The render-service coordinator: an HTTP control plane (node:http, house
// style — no framework) over JobStore + StorageDriver + WebhookScheduler.
// Workers PULL work via long-poll claim (no inbound networking to workers);
// clients submit jobs referencing scene files inside the deployed
// --project directory only (see protocol.ts's security model).
//
// Auth: bearer tokens (ECMANIM_API_TOKEN for clients, ECMANIM_WORKER_TOKEN
// for workers), constant-time compared. Leaving a token unset disables that
// check — the default bind is 127.0.0.1, so exposing the service means
// choosing --host AND setting tokens.

import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { validateJobSpec, artifactExtension } from "./protocol.ts";
import type { JobRecord } from "./protocol.ts";
import { SqliteJobStore } from "./queue.ts";
import type { JobStore } from "./queue.ts";
import { FsStorage } from "./storage.ts";
import type { StorageDriver } from "./storage.ts";
import { WebhookScheduler } from "./webhooks.ts";
import type { WebhookTransport } from "./webhooks.ts";

export interface CoordinatorOptions {
  /** Root directory of the deployed project; jobs may only reference scene
   *  files under it. REQUIRED. */
  projectDir: string;
  /** Queue db + artifacts live here (default <projectDir>/.ecmanim-service). */
  dataDir?: string;
  host?: string;
  port?: number;
  /** Client bearer token (default: env ECMANIM_API_TOKEN). */
  apiToken?: string;
  /** Worker bearer token (default: env ECMANIM_WORKER_TOKEN). */
  workerToken?: string;
  /** Claim lease duration (default 60s; heartbeats renew). */
  leaseMs?: number;
  sweepIntervalMs?: number;
  maxAttempts?: number;
  /** Injectables for tests. */
  store?: JobStore;
  storage?: StorageDriver;
  webhookTransport?: WebhookTransport;
  verbose?: boolean;
}

export interface Coordinator {
  url: string;
  port: number;
  store: JobStore;
  storage: StorageDriver;
  close(): Promise<void>;
}

const MAX_JSON_BODY = 1 << 20; // 1 MiB

function tokenMatches(expected: string | undefined, header: string | undefined): boolean {
  if (!expected) return true; // auth disabled
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : "";
  // Hash both sides so timingSafeEqual gets equal lengths.
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(presented).digest();
  return timingSafeEqual(a, b);
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_JSON_BODY) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolvePromise(undefined);
      try { resolvePromise(JSON.parse(text)); } catch { reject(new Error("invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: any): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

/** Public (client-facing) view of a job. */
function jobView(job: JobRecord): any {
  return {
    id: job.id,
    state: job.state,
    scene: job.spec.scene,
    exportName: job.spec.exportName,
    priority: job.priority,
    attempts: job.attempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    error: job.error,
    artifact: job.artifactKey ? `/api/v1/jobs/${job.id}/artifact` : null,
  };
}

export async function startCoordinator(options: CoordinatorOptions): Promise<Coordinator> {
  const projectDir = realpathSync(resolve(options.projectDir));
  if (!statSync(projectDir).isDirectory()) throw new Error(`--project is not a directory: ${projectDir}`);
  const dataDir = resolve(options.dataDir ?? join(projectDir, ".ecmanim-service"));
  // FsStorage construction also creates dataDir, so queue.db's directory exists.
  const storage = options.storage ?? new FsStorage(join(dataDir, "artifacts"));
  const store = options.store ?? new SqliteJobStore(join(dataDir, "queue.db"));
  const apiToken = options.apiToken ?? process.env.ECMANIM_API_TOKEN;
  const workerToken = options.workerToken ?? process.env.ECMANIM_WORKER_TOKEN;
  const leaseMs = options.leaseMs ?? 60_000;
  const maxAttempts = options.maxAttempts;
  const verbose = options.verbose ?? false;

  const webhooks = new WebhookScheduler(store, {
    ...(options.webhookTransport ? { transport: options.webhookTransport } : {}),
  });
  webhooks.start();

  // --- SSE ------------------------------------------------------------------
  const sseClients: http.ServerResponse[] = [];
  const emitEvent = (event: object): void => {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of sseClients) c.write(line);
  };

  const onTerminal = (job: JobRecord): void => {
    emitEvent({ type: "job", jobId: job.id, state: job.state });
    if (job.spec.webhook && ["done", "failed", "canceled"].includes(job.state)) {
      webhooks.enqueue(job.id, job.spec.webhook.url, job.spec.webhook.secret ?? null, {
        jobId: job.id,
        state: job.state,
        scene: job.spec.scene,
        exportName: job.spec.exportName,
        error: job.error,
        artifact: job.artifactKey ? `/api/v1/jobs/${job.id}/artifact` : null,
      });
    }
  };

  // --- scene path check (second line after protocol.ts's shape check) -------
  const sceneFileError = (scenePath: string): string | null => {
    const abs = resolve(projectDir, scenePath);
    if (abs !== projectDir && !abs.startsWith(projectDir + sep)) return "scene: resolves outside the project directory";
    if (!existsSync(abs)) return `scene: file not found in project: ${scenePath}`;
    // realpath defeats symlinks pointing out of the project.
    const real = realpathSync(abs);
    if (real !== projectDir && !real.startsWith(projectDir + sep)) return "scene: resolves outside the project directory (symlink)";
    if (!statSync(real).isFile()) return "scene: not a file";
    return null;
  };

  // --- request handling -------------------------------------------------------
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const auth = req.headers.authorization;
    try {
      if (path === "/healthz") return sendJson(res, 200, { ok: true });

      // ---- worker API ----
      if (path.startsWith("/api/v1/worker/")) {
        if (!tokenMatches(workerToken, auth)) return sendJson(res, 401, { error: "unauthorized" });

        if (path === "/api/v1/worker/claim" && req.method === "POST") {
          const workerId = String(url.searchParams.get("workerId") ?? "anonymous");
          const waitSec = Math.min(60, Math.max(0, Number(url.searchParams.get("wait") ?? 0)));
          const deadline = Date.now() + waitSec * 1000;
          for (;;) {
            const job = store.claimJob(workerId, leaseMs);
            if (job) {
              emitEvent({ type: "job", jobId: job.id, state: job.state });
              return sendJson(res, 200, { job, leaseMs });
            }
            if (Date.now() >= deadline || res.destroyed) { res.writeHead(204); return res.end(); }
            await new Promise((r) => setTimeout(r, Math.min(500, Math.max(1, deadline - Date.now()))));
          }
        }

        const m = /^\/api\/v1\/worker\/jobs\/([^/]+)\/(progress|artifact|complete|fail)$/.exec(path);
        if (m) {
          const [, jobId, action] = m;
          const workerId = String(url.searchParams.get("workerId") ?? "anonymous");
          if (action === "progress" && req.method === "POST") {
            const body = await readJsonBody(req);
            const ok = store.heartbeat(jobId, workerId, leaseMs, body?.progress ?? body);
            return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 409, { error: "claim not held" });
          }
          if (action === "artifact" && req.method === "PUT") {
            if (!store.markUploading(jobId, workerId)) return sendJson(res, 409, { error: "claim not held" });
            const filename = String(url.searchParams.get("filename") ?? "artifact.bin");
            const key = await storage.put(jobId, filename, req as any);
            return sendJson(res, 200, { artifactKey: key });
          }
          if (action === "complete" && req.method === "POST") {
            const body = await readJsonBody(req);
            const key = body?.artifactKey;
            if (typeof key !== "string" || !(await Promise.resolve(storage.exists(key)))) return sendJson(res, 400, { error: "artifactKey missing or not uploaded" });
            if (!store.completeJob(jobId, workerId, key)) return sendJson(res, 409, { error: "claim not held" });
            onTerminal(store.getJob(jobId)!);
            return sendJson(res, 200, { ok: true });
          }
          if (action === "fail" && req.method === "POST") {
            const body = await readJsonBody(req);
            if (!store.failJob(jobId, workerId, String(body?.error ?? "worker reported failure"))) {
              return sendJson(res, 409, { error: "claim not held" });
            }
            const job = store.getJob(jobId)!;
            if (job.state === "failed") onTerminal(job);
            else emitEvent({ type: "job", jobId: job.id, state: job.state });
            return sendJson(res, 200, { ok: true, state: job.state });
          }
        }
        return sendJson(res, 404, { error: "not found" });
      }

      // ---- client API ----
      if (path.startsWith("/api/v1/")) {
        if (!tokenMatches(apiToken, auth)) return sendJson(res, 401, { error: "unauthorized" });

        if (path === "/api/v1/jobs" && req.method === "POST") {
          const body = await readJsonBody(req);
          const { spec, errors } = validateJobSpec(body);
          if (!spec) return sendJson(res, 400, { errors });
          const sceneErr = sceneFileError(spec.scene);
          if (sceneErr) return sendJson(res, 400, { errors: [sceneErr] });
          const job = store.createJob(spec, maxAttempts ? { maxAttempts } : {});
          emitEvent({ type: "job", jobId: job.id, state: job.state });
          if (verbose) console.log(`[coordinator] job ${job.id} queued: ${spec.scene}`);
          return sendJson(res, 201, { job: jobView(job) });
        }

        if (path === "/api/v1/jobs" && req.method === "GET") {
          const state = url.searchParams.get("state") as any;
          const jobs = store.listJobs(state ? { state } : {});
          return sendJson(res, 200, { jobs: jobs.map(jobView) });
        }

        if (path === "/api/v1/stats" && req.method === "GET") {
          const jobs = store.listJobs();
          const byState: Record<string, number> = {};
          for (const j of jobs) byState[j.state] = (byState[j.state] ?? 0) + 1;
          return sendJson(res, 200, { total: jobs.length, byState });
        }

        if (path === "/api/v1/events" && req.method === "GET") {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
          res.write("\n");
          sseClients.push(res);
          req.on("close", () => { const i = sseClients.indexOf(res); if (i >= 0) sseClients.splice(i, 1); });
          return;
        }

        const jm = /^\/api\/v1\/jobs\/([^/]+)(\/artifact)?$/.exec(path);
        if (jm) {
          const job = store.getJob(jm[1]);
          if (!job) return sendJson(res, 404, { error: "no such job" });
          if (jm[2]) {
            if (job.state !== "done" || !job.artifactKey) return sendJson(res, 409, { error: `job is ${job.state}` });
            // Presigning drivers (S3) redirect instead of proxying bytes.
            if (typeof (storage as any).presignGetUrl === "function") {
              const url = await (storage as any).presignGetUrl(job.artifactKey);
              res.writeHead(302, { location: url });
              return res.end();
            }
            const local = storage.localPath(job.artifactKey);
            if (local == null) return sendJson(res, 404, { error: "artifact not locally available" });
            const ext = artifactExtension(job.spec);
            const type = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webm" ? "video/webm" : "video/mp4";
            res.writeHead(200, { "content-type": type, "content-length": storage.size(job.artifactKey) });
            storage.getStream(job.artifactKey).pipe(res);
            return;
          }
          if (req.method === "DELETE") {
            if (!store.cancelJob(job.id)) return sendJson(res, 409, { error: `job is ${job.state}` });
            onTerminal(store.getJob(job.id)!);
            return sendJson(res, 200, { ok: true });
          }
          return sendJson(res, 200, { job: jobView(job) });
        }
      }

      sendJson(res, 404, { error: "not found" });
    } catch (e: any) {
      if (!res.headersSent) sendJson(res, e?.message === "body too large" ? 413 : e?.message === "invalid JSON body" ? 400 : 500, { error: e?.message ?? "internal error" });
      else res.end();
    }
  });

  const sweep = setInterval(() => {
    const n = store.sweepExpiredLeases();
    if (n && verbose) console.log(`[coordinator] requeued ${n} expired lease(s)`);
  }, options.sweepIntervalMs ?? 10_000);
  sweep.unref?.();

  const host = options.host ?? "127.0.0.1";
  const port = await new Promise<number>((resolvePort) => {
    server.listen(options.port ?? 5990, host, () => resolvePort((server.address() as any).port));
  });

  if (verbose) console.log(`[coordinator] listening on http://${host}:${port} (project: ${projectDir})`);

  return {
    url: `http://${host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host}:${port}`,
    port,
    store,
    storage,
    close: async () => {
      clearInterval(sweep);
      webhooks.stop();
      for (const c of sseClients.splice(0)) c.end();
      await new Promise<void>((r) => server.close(() => r()));
      store.close();
    },
  };
}
