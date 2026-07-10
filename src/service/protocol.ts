// Render-service protocol: job JSON validation and render-option sanitizing.
// Deliberately node-free (pure data validation) so it's testable anywhere and
// shared verbatim by coordinator, worker, and CLI.
//
// SECURITY MODEL (the scene-source boundary): a job references a scene FILE
// inside the coordinator's deployed --project directory only — never inline
// code, uploads, or repo URLs. Rendering executes the scene's construct(), so
// accepting code over HTTP would be RCE-as-a-feature; per-job variation goes
// through schema-validated `params` instead (Remotion Lambda's own
// deploy-your-project model). Path checks here reject traversal shapes; the
// coordinator ALSO path-resolves + prefix-checks + realpath-checks against the
// project root before touching the filesystem.

export const JOB_STATES = ["queued", "claimed", "running", "uploading", "done", "failed", "canceled"] as const;
export type JobState = (typeof JOB_STATES)[number];

/** Render options a job may set — an ALLOWLIST, never a spread of raw user
 *  JSON into RenderOptions (which accepts arbitrary keys, incl. `output`). */
export const RENDER_OPTION_ALLOWLIST: Record<string, "string" | "number" | "boolean" | "resolution" | "params"> = {
  quality: "string",
  format: "string",
  fps: "number",
  pixelWidth: "number",
  pixelHeight: "number",
  resolution: "resolution",
  background: "string",
  transparent: "boolean",
  saveLastFrame: "boolean",
  style: "string",
  aspectRatio: "string",
  stillFrame: "number",
  workers: "number",
};

/** Formats the v1 service can produce. `renderer: "webgl"` (renderGL) is
 *  rejected at validation — the service image ships no Chrome (documented). */
export const ALLOWED_FORMATS = new Set(["mp4", "webm", "mov", "png", "gif"]);

export interface WebhookSpec {
  url: string;
  /** HMAC secret for X-Ecmanim-Signature (optional but recommended). */
  secret?: string;
}

export interface ParallelismSpec {
  /** "none" (sequential render) | "workers" (renderParallel inside one
   *  worker). "segments" (cross-machine fan-out of ONE job) is RESERVED in
   *  the protocol and rejected in v1. */
  mode?: "none" | "workers" | "segments";
  workers?: number;
}

export interface JobSpec {
  /** Scene module path RELATIVE to the deployed project root. */
  scene: string;
  /** Export name within the module (default "default"). */
  exportName?: string;
  /** Scene params (validated by the scene's own static `schema` at render). */
  params?: Record<string, any>;
  /** Allowlisted render options. */
  render?: Record<string, any>;
  webhook?: WebhookSpec;
  priority?: number;
  parallelism?: ParallelismSpec;
}

export interface JobProgress {
  segmentsDone?: number;
  /** -1 when unknown (sequential renders discover segments as they go). */
  segmentsTotal?: number;
  /** Partial-movie segments reused from the content-addressed cache. */
  reusedPartials?: number;
}

export interface JobRecord {
  id: string;
  spec: JobSpec;
  state: JobState;
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  /** Epoch ms the current claim's lease expires (claimed/running only). */
  leaseExpiresAt: number | null;
  workerId: string | null;
  error: string | null;
  /** Storage key of the uploaded artifact (done only). */
  artifactKey: string | null;
  progress: JobProgress | null;
}

/** True when the path has a traversal/absolute/scheme shape. This is the
 *  node-free FIRST line; the coordinator re-checks with realpath. */
export function isUnsafeScenePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0 || p.length > 512) return true;
  if (p.includes("\0")) return true;
  if (p.startsWith("/") || p.startsWith("\\")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true; // windows drive
  if (/^[a-z]+:\/\//i.test(p)) return true;   // URL scheme
  const segments = p.split(/[\\/]+/);
  if (segments.some((s) => s === "..")) return true;
  return false;
}

/**
 * Sanitize a job's `render` object down to the allowlist with per-key type
 * checks. Unknown keys and wrong-typed values are ERRORS (silently dropping
 * them would render something the submitter didn't ask for).
 */
export function sanitizeRenderOptions(raw: any, errors: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  if (raw == null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push("render: must be an object");
    return out;
  }
  for (const [key, value] of Object.entries(raw)) {
    const kind = RENDER_OPTION_ALLOWLIST[key];
    if (!kind) {
      errors.push(`render.${key}: not an allowed render option`);
      continue;
    }
    switch (kind) {
      case "string":
        if (typeof value !== "string") { errors.push(`render.${key}: expected string`); continue; }
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) { errors.push(`render.${key}: expected finite number`); continue; }
        break;
      case "boolean":
        if (typeof value !== "boolean") { errors.push(`render.${key}: expected boolean`); continue; }
        break;
      case "resolution":
        if (!Array.isArray(value) || value.length !== 2 || !value.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)) {
          errors.push(`render.${key}: expected [width, height]`);
          continue;
        }
        break;
    }
    out[key] = value;
  }
  if (out.format != null && !ALLOWED_FORMATS.has(out.format)) {
    errors.push(`render.format: "${out.format}" not supported (${[...ALLOWED_FORMATS].join(", ")})`);
    delete out.format;
  }
  if ((raw as any).renderer === "webgl" || out.renderer === "webgl") {
    errors.push("render.renderer: webgl (renderGL) is not available in the render service v1 (no Chrome in the image)");
  }
  return out;
}

/**
 * Validate a raw submitted job body into a JobSpec. Returns the normalized
 * spec, or a list of errors (never both).
 */
export function validateJobSpec(raw: any): { spec?: JobSpec; errors: string[] } {
  const errors: string[] = [];
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { errors: ["job: body must be a JSON object"] };
  }
  if (typeof raw.scene !== "string" || !raw.scene) {
    errors.push("scene: required (path relative to the deployed project)");
  } else if (isUnsafeScenePath(raw.scene)) {
    errors.push(`scene: unsafe path ${JSON.stringify(raw.scene)} (must be relative, no "..")`);
  }
  if (raw.exportName != null && (typeof raw.exportName !== "string" || !/^[A-Za-z_$][\w$]*$/.test(raw.exportName))) {
    errors.push("exportName: must be a valid identifier");
  }
  if (raw.params != null && (typeof raw.params !== "object" || Array.isArray(raw.params))) {
    errors.push("params: must be an object");
  }
  const render = sanitizeRenderOptions(raw.render, errors);
  if (raw.webhook != null) {
    if (typeof raw.webhook !== "object" || typeof raw.webhook.url !== "string" || !/^https?:\/\//.test(raw.webhook.url)) {
      errors.push("webhook.url: must be an http(s) URL");
    }
    if (raw.webhook?.secret != null && typeof raw.webhook.secret !== "string") {
      errors.push("webhook.secret: must be a string");
    }
  }
  if (raw.priority != null && (typeof raw.priority !== "number" || !Number.isFinite(raw.priority))) {
    errors.push("priority: must be a number");
  }
  if (raw.parallelism != null) {
    const mode = raw.parallelism.mode ?? "none";
    if (!["none", "workers", "segments"].includes(mode)) {
      errors.push(`parallelism.mode: unknown mode "${mode}"`);
    } else if (mode === "segments") {
      errors.push("parallelism.mode: \"segments\" (cross-machine single-job fan-out) is reserved and not implemented in v1");
    }
    if (raw.parallelism.workers != null && (typeof raw.parallelism.workers !== "number" || raw.parallelism.workers < 1)) {
      errors.push("parallelism.workers: must be a number >= 1");
    }
  }
  if (errors.length) return { errors };
  const spec: JobSpec = {
    scene: raw.scene,
    exportName: raw.exportName ?? "default",
    ...(raw.params != null ? { params: raw.params } : {}),
    ...(Object.keys(render).length ? { render } : {}),
    ...(raw.webhook != null ? { webhook: { url: raw.webhook.url, ...(raw.webhook.secret ? { secret: raw.webhook.secret } : {}) } } : {}),
    priority: raw.priority ?? 0,
    ...(raw.parallelism != null ? { parallelism: { mode: raw.parallelism.mode ?? "none", ...(raw.parallelism.workers != null ? { workers: raw.parallelism.workers } : {}) } } : {}),
  };
  return { spec, errors: [] };
}

/** File extension the job's artifact will have. */
export function artifactExtension(spec: JobSpec): string {
  const format = spec.render?.format ?? "mp4";
  if (spec.render?.saveLastFrame || spec.render?.stillFrame != null || format === "png") return "png";
  return format === "gif" ? "gif" : format === "webm" ? "webm" : format === "mov" ? "mov" : "mp4";
}
