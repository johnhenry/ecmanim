// ecmanim/service — the render service: a coordinator (HTTP control plane
// over a SQLite job queue) plus pull-model workers, signed webhooks, and
// pluggable artifact storage. See website/src/content/docs/guides/
// render-service.md for the security model and deployment guide.

export { startCoordinator } from "./service/coordinator.ts";
export type { CoordinatorOptions, Coordinator } from "./service/coordinator.ts";
export { ServiceWorker } from "./service/worker.ts";
export type { WorkerOptions, RenderImpl, RenderContext } from "./service/worker.ts";
export { validateJobSpec, sanitizeRenderOptions, isUnsafeScenePath, artifactExtension, JOB_STATES, RENDER_OPTION_ALLOWLIST } from "./service/protocol.ts";
export type { JobSpec, JobRecord, JobState, JobProgress, WebhookSpec, ParallelismSpec } from "./service/protocol.ts";
export { SqliteJobStore, MemoryJobStore, DEFAULT_MAX_ATTEMPTS } from "./service/queue.ts";
export type { JobStore, WebhookDelivery } from "./service/queue.ts";
export { FsStorage } from "./service/storage.ts";
export type { StorageDriver } from "./service/storage.ts";
export { createS3Storage } from "./service/storage-s3.ts";
export type { S3StorageOptions, S3StorageDriver } from "./service/storage-s3.ts";
export { signWebhook, verifyWebhook, WebhookScheduler, SIGNATURE_HEADER, WEBHOOK_BACKOFF_MS } from "./service/webhooks.ts";
export type { WebhookTransport, WebhookSchedulerOptions } from "./service/webhooks.ts";
