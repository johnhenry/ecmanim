// Caption data model + SRT round-trip + TikTok-style karaoke pages, adapted from
// Remotion's @remotion/captions. Pure data/math (no React, no DOM) — transcription
// (Whisper/etc.) is an external step that just emits Caption[]. Isomorphic.

/** A single caption token/segment. `text` is whitespace-sensitive. */
export interface Caption {
  text: string;
  startMs: number;
  endMs: number;
  /** When the word is "said" (for karaoke), or null. */
  timestampMs: number | null;
  /** ASR confidence in [0,1], or null. */
  confidence: number | null;
}

// --- SRT -------------------------------------------------------------------

function msToSrtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const millis = t % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(millis, 3)}`;
}

function srtTimeToMs(str: string): number {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(str.trim());
  if (!m) return 0;
  return Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[4].padEnd(3, "0").slice(0, 3));
}

/** Parse an SRT string into captions (one per cue; text keeps its line breaks). */
export function parseSrt(srt: string): Caption[] {
  const out: Caption[] = [];
  const blocks = srt.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.length > 0 || true);
    if (!lines.length) continue;
    // Optional numeric index line.
    let i = 0;
    if (/^\d+$/.test(lines[0].trim())) i = 1;
    const timing = lines[i];
    const arrow = /(.+?)-->(.+)/.exec(timing || "");
    if (!arrow) continue;
    const startMs = srtTimeToMs(arrow[1]);
    const endMs = srtTimeToMs(arrow[2]);
    const text = lines.slice(i + 1).join("\n").trim();
    if (!text) continue;
    out.push({ text, startMs, endMs, timestampMs: Math.round((startMs + endMs) / 2), confidence: null });
  }
  return out;
}

/** Serialize captions back to an SRT string. */
export function serializeSrt(captions: Caption[]): string {
  return captions
    .map((c, i) => `${i + 1}\n${msToSrtTime(c.startMs)} --> ${msToSrtTime(c.endMs)}\n${c.text}`)
    .join("\n\n") + "\n";
}

// --- TikTok-style karaoke pages -------------------------------------------

export interface CaptionToken {
  text: string;
  fromMs: number;
  toMs: number;
}
export interface CaptionPage {
  text: string;
  startMs: number;
  durationMs: number;
  tokens: CaptionToken[];
}

/**
 * Group caption tokens into "pages" for word-by-word/karaoke rendering: tokens
 * are combined into one page while the gap between consecutive tokens is within
 * `combineTokensWithinMilliseconds`. Mirrors Remotion's createTikTokStyleCaptions.
 */
export function createTikTokStyleCaptions(opts: {
  captions: Caption[];
  combineTokensWithinMilliseconds: number;
}): { pages: CaptionPage[] } {
  const { captions, combineTokensWithinMilliseconds } = opts;
  const pages: CaptionPage[] = [];
  let current: CaptionToken[] = [];
  let pageStart = 0;
  let lastEnd = -Infinity;

  const flush = () => {
    if (!current.length) return;
    const startMs = current[0].fromMs;
    const endMs = current[current.length - 1].toMs;
    pages.push({
      text: current.map((t) => t.text).join("").trim(),
      startMs,
      durationMs: Math.max(0, endMs - startMs),
      tokens: current,
    });
    current = [];
  };

  for (const c of captions) {
    const token: CaptionToken = { text: c.text, fromMs: c.startMs, toMs: c.endMs };
    if (current.length && c.startMs - lastEnd > combineTokensWithinMilliseconds) {
      flush();
    }
    if (!current.length) pageStart = c.startMs;
    current.push(token);
    lastEnd = c.endMs;
  }
  flush();
  void pageStart;
  return { pages };
}

/** The active caption at a given time (ms), or null. */
export function captionAt(captions: Caption[], timeMs: number): Caption | null {
  for (const c of captions) if (timeMs >= c.startMs && timeMs < c.endMs) return c;
  return null;
}
