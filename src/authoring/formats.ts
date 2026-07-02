// Pluggable "formats" (scrollmark/showrunner-style Format lifecycle) + a provider
// abstraction (llm / tts / render). A Format turns a topic/params into a plan,
// optionally generates assets, and composes an output; `revise` feeds feedback
// back into the plan. Providers are swappable backends the format calls.

// --- provider abstraction --------------------------------------------------

export type ProviderKind = "llm" | "tts" | "render";

export interface Provider {
  kind: ProviderKind;
  name: string;
  available?(): boolean | Promise<boolean>;
  invoke(input: any, opts?: Record<string, any>): Promise<any>;
}

const providers = new Map<string, Provider>();
const pkey = (kind: string, name: string) => `${kind}:${name}`;

export function registerProvider(p: Provider): void { providers.set(pkey(p.kind, p.name), p); }
export function getProvider(kind: ProviderKind, name: string): Provider | undefined { return providers.get(pkey(kind, name)); }
export function listProviders(kind?: ProviderKind): Provider[] {
  const all = Array.from(providers.values());
  return kind ? all.filter((p) => p.kind === kind) : all;
}

export interface ProviderSet { llm?: Provider; tts?: Provider; render?: Provider; }

// --- Format lifecycle ------------------------------------------------------

export interface FormatContext {
  topic?: string;
  params?: Record<string, any>;
  workDir?: string;
  providers?: ProviderSet;
  [key: string]: any;
}

export interface Format {
  name: string;
  description?: string;
  requiredProviders?: ProviderKind[];
  /** topic/params → a plan (a scene spec / plan IR / whatever the format consumes). */
  plan(ctx: FormatContext): Promise<any> | any;
  /** Optional: fetch/generate assets (audio, images, …) referenced by the plan. */
  generateAssets?(plan: any, ctx: FormatContext): Promise<any> | any;
  /** Produce the final output (usually a render) from plan + assets. */
  compose(plan: any, assets: any, ctx: FormatContext): Promise<any> | any;
  /** Optional: revise the plan given feedback (the iterative loop). */
  revise?(plan: any, feedback: any, ctx: FormatContext): Promise<any> | any;
}

const formats = new Map<string, Format>();
export function registerFormat(f: Format): void { formats.set(f.name, f); }
export function getFormat(name: string): Format | undefined { return formats.get(name); }
export function listFormats(): Format[] { return Array.from(formats.values()); }

export interface FormatResult { plan: any; assets: any; output: any; }

/** Run a format's lifecycle: plan → generateAssets → compose. */
export async function runFormat(format: Format | string, ctx: FormatContext = {}): Promise<FormatResult> {
  const f = typeof format === "string" ? getFormat(format) : format;
  if (!f) throw new Error(`unknown format "${format}"`);
  for (const kind of f.requiredProviders ?? []) {
    if (!ctx.providers?.[kind]) throw new Error(`format "${f.name}" requires a ${kind} provider`);
  }
  const plan = await f.plan(ctx);
  const assets = f.generateAssets ? await f.generateAssets(plan, ctx) : null;
  const output = await f.compose(plan, assets, ctx);
  return { plan, assets, output };
}
