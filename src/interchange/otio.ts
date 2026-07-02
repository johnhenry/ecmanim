// OpenTimelineIO (OTIO) — a frame-exact editorial timeline model, reimplemented
// in TS (the JS/WASM bindings are immature). Export a scene's play/wait segments
// (or sections) as a `.otio` JSON that round-trips to Resolve/Premiere/FCPXML/EDL.
// Pure data. RationalTime avoids float drift; tracks/stacks nest.

export interface RationalTime { value: number; rate: number; }
export function rationalTime(value: number, rate: number): RationalTime { return { value, rate }; }
export function rtSeconds(rt: RationalTime): number { return rt.rate ? rt.value / rt.rate : 0; }

export interface TimeRange { startTime: RationalTime; duration: RationalTime; }
export function timeRange(startTime: RationalTime, duration: RationalTime): TimeRange { return { startTime, duration }; }

export interface OtioClip {
  name: string;
  sourceRange: TimeRange;
  metadata?: Record<string, any>;
  mediaReference?: { targetUrl?: string };
}
export interface OtioTrack { name?: string; kind: "Video" | "Audio"; children: OtioClip[]; }
export interface OtioTimeline { name: string; globalStartRate: number; tracks: OtioTrack[]; }

// --- JSON (OTIO_SCHEMA) serialization --------------------------------------

function rtJSON(rt: RationalTime) {
  return { OTIO_SCHEMA: "RationalTime.1", value: rt.value, rate: rt.rate };
}
function trJSON(tr: TimeRange) {
  return { OTIO_SCHEMA: "TimeRange.1", start_time: rtJSON(tr.startTime), duration: rtJSON(tr.duration) };
}
function clipJSON(c: OtioClip) {
  const out: any = { OTIO_SCHEMA: "Clip.1", name: c.name, source_range: trJSON(c.sourceRange) };
  if (c.metadata) out.metadata = c.metadata;
  if (c.mediaReference?.targetUrl) {
    out.media_reference = { OTIO_SCHEMA: "ExternalReference.1", target_url: c.mediaReference.targetUrl };
  }
  return out;
}

/** Serialize a timeline to the OTIO JSON schema (a `.otio` file's contents). */
export function toOtioJSON(tl: OtioTimeline): Record<string, any> {
  return {
    OTIO_SCHEMA: "Timeline.1",
    name: tl.name,
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      children: tl.tracks.map((t) => ({
        OTIO_SCHEMA: "Track.1",
        name: t.name ?? t.kind,
        kind: t.kind,
        children: t.children.map(clipJSON),
      })),
    },
  };
}

/** Parse OTIO JSON back into the light model (clips with names + time ranges). */
export function fromOtioJSON(json: any): OtioTimeline {
  const rt = (o: any): RationalTime => ({ value: Number(o?.value ?? 0), rate: Number(o?.rate ?? 0) });
  const tracks: OtioTrack[] = (json?.tracks?.children ?? []).map((t: any) => ({
    name: t.name,
    kind: t.kind === "Audio" ? "Audio" : "Video",
    children: (t.children ?? []).filter((c: any) => (c.OTIO_SCHEMA ?? "").startsWith("Clip")).map((c: any) => ({
      name: c.name,
      sourceRange: { startTime: rt(c.source_range?.start_time), duration: rt(c.source_range?.duration) },
      metadata: c.metadata,
    })),
  }));
  const rate = tracks[0]?.children[0]?.sourceRange.duration.rate ?? 30;
  return { name: json?.name ?? "timeline", globalStartRate: rate, tracks };
}

// --- Scene → OTIO ----------------------------------------------------------

/**
 * Build an OTIO timeline from a rendered scene: one Video clip per play()/wait()
 * segment (from `scene.playRecords`), frame-exact via the scene fps. Falls back to
 * `scene.sections` if no play records are present.
 */
export function sceneToOtio(scene: any, opts: { name?: string; mediaUrl?: string } = {}): OtioTimeline {
  const fps = scene?.fps ?? 30;
  const clips: OtioClip[] = [];
  const records = scene?.playRecords ?? [];
  const source = records.length ? records : (scene?.sections ?? []);
  for (const rec of source) {
    const startFrame = rec.startFrame ?? 0;
    const endFrame = rec.endFrame ?? startFrame;
    clips.push({
      name: rec.name ?? `${rec.kind ?? "segment"}_${rec.index ?? clips.length}`,
      sourceRange: timeRange(rationalTime(startFrame, fps), rationalTime(Math.max(0, endFrame - startFrame), fps)),
      metadata: rec.hash ? { hash: rec.hash, kind: rec.kind } : undefined,
      mediaReference: opts.mediaUrl ? { targetUrl: opts.mediaUrl } : undefined,
    });
  }
  return { name: opts.name ?? "ecmanim", globalStartRate: fps, tracks: [{ kind: "Video", children: clips }] };
}

/** Convenience: a scene's `.otio` JSON string. */
export function sceneToOtioString(scene: any, opts?: { name?: string; mediaUrl?: string }): string {
  return JSON.stringify(toOtioJSON(sceneToOtio(scene, opts)), null, 2);
}
