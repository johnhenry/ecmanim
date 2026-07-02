// Quality gates + heuristics for the authoring layer (OpenMontage-inspired):
// automated checks over a plan/render, incl. a "slideshow-risk" score (is the
// output actually animated, or mostly static stills?) and "delivery-promise"
// contracts (does the output match a declared intent?). Pure data.

export interface QualityContext {
  fps: number;
  width: number;
  height: number;
  durationSeconds: number;
  segments: Array<{ kind: string; startFrame: number; endFrame: number }>;
  /** Fraction of frames that changed vs. the previous frame, if known [0,1]. */
  motionFraction?: number;
  /** A declared intent, e.g. "motion-led" | "explainer" | "static". */
  promise?: string;
}

export interface QualityGate {
  name: string;
  check: (ctx: QualityContext) => { ok: boolean; message: string; severity?: "error" | "warn" };
}

/**
 * Slideshow-risk score in [0,1]: high = the output is likely mostly static
 * ("a slideshow"). Combines the ratio of wait vs play time and (if known) the
 * measured motion fraction.
 */
export function slideshowRisk(ctx: QualityContext): number {
  const total = ctx.segments.reduce((s, seg) => s + (seg.endFrame - seg.startFrame), 0) || 1;
  const waitFrames = ctx.segments.filter((s) => s.kind === "wait").reduce((s, seg) => s + (seg.endFrame - seg.startFrame), 0);
  const waitRatio = waitFrames / total;
  if (ctx.motionFraction != null) {
    // Blend: mostly-still frames + lots of waiting → high risk.
    return Math.max(0, Math.min(1, 0.6 * (1 - ctx.motionFraction) + 0.4 * waitRatio));
  }
  return Math.max(0, Math.min(1, waitRatio));
}

/** Does the output honor its declared promise? (delivery-promise contract). */
export function checkDeliveryPromise(ctx: QualityContext): { ok: boolean; message: string } {
  const risk = slideshowRisk(ctx);
  if (ctx.promise === "motion-led" || ctx.promise === "animated") {
    if (risk > 0.6) return { ok: false, message: `promised "${ctx.promise}" but slideshow-risk is ${risk.toFixed(2)} (mostly static)` };
  }
  if (ctx.promise === "static" && risk < 0.2) {
    return { ok: false, message: `promised "static" but the output is quite animated (risk ${risk.toFixed(2)})` };
  }
  return { ok: true, message: `delivery-promise "${ctx.promise ?? "none"}" satisfied (risk ${risk.toFixed(2)})` };
}

/** Built-in gates. */
export const DEFAULT_QUALITY_GATES: QualityGate[] = [
  { name: "min_fps", check: (c) => ({ ok: c.fps >= 12, message: `fps ${c.fps} (>= 12)`, severity: "warn" }) },
  { name: "even_dimensions", check: (c) => ({ ok: c.width % 2 === 0 && c.height % 2 === 0, message: `dims ${c.width}x${c.height} even`, severity: "error" }) },
  { name: "nonempty", check: (c) => ({ ok: c.durationSeconds > 0 && c.segments.length > 0, message: `has ${c.segments.length} segments`, severity: "error" }) },
  { name: "slideshow_risk", check: (c) => { const r = slideshowRisk(c); return { ok: r <= 0.8, message: `slideshow-risk ${r.toFixed(2)} (<= 0.8)`, severity: "warn" }; } },
  { name: "delivery_promise", check: (c) => { const d = checkDeliveryPromise(c); return { ok: d.ok, message: d.message, severity: "warn" }; } },
];

export interface QualityReport {
  ok: boolean;
  slideshowRisk: number;
  results: Array<{ gate: string; ok: boolean; message: string; severity: string }>;
}

/** Run the gates (default + extra) over a context. `ok` = no error-severity failures. */
export function runQualityGates(ctx: QualityContext, extra: QualityGate[] = []): QualityReport {
  const gates = [...DEFAULT_QUALITY_GATES, ...extra];
  const results = gates.map((g) => {
    const r = g.check(ctx);
    return { gate: g.name, ok: r.ok, message: r.message, severity: r.severity ?? "warn" };
  });
  const ok = results.every((r) => r.ok || r.severity !== "error");
  return { ok, slideshowRisk: slideshowRisk(ctx), results };
}
