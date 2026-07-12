// Text-to-speech provider abstraction for voiceover (manim-voiceover style).
// A provider turns text into an audio file + duration (+ optional word timings).
// Node-only in practice (writes temp audio via ffmpeg / system TTS / HTTP), but
// import-safe under any environment (all heavy work is lazy inside methods).
//
// Built-ins: "silent" (no key — generates a silent clip of estimated duration,
// for timing/offline), "system" (macOS `say` / Linux `espeak-ng`), and thin
// "openai"/"elevenlabs" HTTP adapters used only when an API key is present.
// Register your own with registerTTSProvider().

export interface WordBoundary { word: string; startMs: number; endMs: number; }

export interface TTSResult {
  /** Path to the synthesized audio file. */
  file: string;
  durationSeconds: number;
  /** Per-word timings, if the provider supplies them (enables precise bookmarks). */
  wordBoundaries?: WordBoundary[];
}

export interface TTSSynthesizeOptions {
  voice?: string;
  speed?: number;          // words-per-second hint for estimators (default ~2.6)
  language?: string;
  cacheDir?: string;
  [key: string]: any;
}

export interface TTSProvider {
  name: string;
  /** Whether this provider can run here (binary/key present). */
  available(): boolean | Promise<boolean>;
  synthesize(text: string, opts?: TTSSynthesizeOptions): Promise<TTSResult>;
}

const providers = new Map<string, TTSProvider>();

export function registerTTSProvider(p: TTSProvider): void { providers.set(p.name, p); }
export function getTTSProvider(name: string): TTSProvider | undefined { return providers.get(name); }
export function listTTSProviders(): string[] { return Array.from(providers.keys()); }

/** Pick the first available provider from `preferred` (falls back to "silent"). */
export async function resolveTTSProvider(preferred?: string): Promise<TTSProvider> {
  const order = [preferred, "system", "openai", "elevenlabs", "silent"].filter(Boolean) as string[];
  for (const name of order) {
    const p = providers.get(name);
    if (p && (await p.available())) return p;
  }
  return providers.get("silent")!;
}

// --- helpers ---------------------------------------------------------------

async function nodeMods() {
  const cp = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const crypto = await import("node:crypto");
  return { cp, fs, os, path, crypto };
}

function hasBinary(cp: any, bin: string): boolean {
  try { cp.execSync(`${bin} ${bin === "say" ? "-?" : "--version"}`, { stdio: "ignore" }); return true; }
  catch { try { cp.execSync(`command -v ${bin}`, { stdio: "ignore" }); return true; } catch { return false; } }
}

/** Audio duration (seconds) via ffprobe. */
export async function audioDurationSeconds(file: string): Promise<number> {
  const { cp } = await nodeMods();
  try {
    const out = cp.execSync(
      `ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "${file}"`,
      { encoding: "utf8" },
    );
    const d = parseFloat(String(out).trim());
    return Number.isFinite(d) ? d : 0;
  } catch { return 0; }
}

function estimateDuration(text: string, wordsPerSecond = 2.6): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(0.4, words / wordsPerSecond);
}

async function cacheFile(text: string, provider: string, ext: string, cacheDir?: string): Promise<string> {
  const { fs, os, path, crypto } = await nodeMods();
  const dir = cacheDir ?? path.join(os.tmpdir(), "ecmanim-voiceover");
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash("sha1").update(provider + "|" + text).digest("hex").slice(0, 16);
  return path.join(dir, `${hash}.${ext}`);
}

// --- built-in providers ----------------------------------------------------

/** No-key fallback: a silent clip of the estimated duration (timing/offline). */
export const silentProvider: TTSProvider = {
  name: "silent",
  available() { return true; },
  async synthesize(text, opts = {}) {
    const { cp, fs } = await nodeMods();
    const duration = estimateDuration(text, opts.speed ?? 2.6);
    const file = await cacheFile(text, "silent", "wav", opts.cacheDir);
    if (!fs.existsSync(file)) {
      try {
        cp.execSync(
          `ffmpeg -v error -f lavfi -i anullsrc=r=44100:cl=mono -t ${duration.toFixed(3)} -y "${file}"`,
          { stdio: "ignore" },
        );
      } catch { /* ffmpeg missing: still return the (missing) path + estimate */ }
    }
    return { file, durationSeconds: duration };
  },
};

/** System TTS: macOS `say` or Linux `espeak-ng`. */
export const systemProvider: TTSProvider = {
  name: "system",
  async available() {
    const { cp } = await nodeMods();
    return hasBinary(cp, "say") || hasBinary(cp, "espeak-ng") || hasBinary(cp, "espeak");
  },
  async synthesize(text, opts = {}) {
    const { cp, fs } = await nodeMods();
    const file = await cacheFile(text, "system", "wav", opts.cacheDir);
    if (!fs.existsSync(file)) {
      // escape ", $, `, \ -- execSync runs this through a shell, and `text` is
      // caller-supplied narration prose, not a fixed string.
      const safe = text.replace(/[\\$`"]/g, "\\$&");
      try {
        if (hasBinary(cp, "say")) {
          // macOS `say` writes AIFF; convert to wav via ffmpeg.
          const aiff = file.replace(/\.wav$/, ".aiff");
          cp.execSync(`say ${opts.voice ? `-v "${opts.voice}"` : ""} -o "${aiff}" "${safe}"`, { stdio: ["ignore", "ignore", "pipe"] });
          cp.execSync(`ffmpeg -v error -i "${aiff}" -y "${file}"`, { stdio: ["ignore", "ignore", "pipe"] });
        } else {
          const bin = hasBinary(cp, "espeak-ng") ? "espeak-ng" : "espeak";
          cp.execSync(`${bin} -w "${file}" "${safe}"`, { stdio: ["ignore", "ignore", "pipe"] });
        }
      } catch (err) {
        // stdio:"ignore" on stderr used to swallow the real reason (missing
        // ffmpeg, no default voice installed, etc.) -- surface it instead of
        // letting the caller see only a bare, message-less crash.
        const stderr = (err as any).stderr?.toString().trim();
        throw new Error(`system TTS synthesis failed: ${stderr || (err as Error).message}`);
      }
    }
    return { file, durationSeconds: await audioDurationSeconds(file) };
  },
};

/** OpenAI TTS (uses OPENAI_API_KEY). No word timings. */
export const openaiProvider: TTSProvider = {
  name: "openai",
  available() { return !!process.env.OPENAI_API_KEY; },
  async synthesize(text, opts = {}) {
    const { fs } = await nodeMods();
    const file = await cacheFile(text, "openai", "mp3", opts.cacheDir);
    if (!fs.existsSync(file)) {
      const resp = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: opts.model ?? "gpt-4o-mini-tts", voice: opts.voice ?? "alloy", input: text }),
      });
      if (!resp.ok) throw new Error("OpenAI TTS failed: " + resp.status);
      fs.writeFileSync(file, Buffer.from(await resp.arrayBuffer()));
    }
    return { file, durationSeconds: await audioDurationSeconds(file) };
  },
};

/** ElevenLabs TTS (uses ELEVENLABS_API_KEY). No word timings in this minimal adapter. */
export const elevenLabsProvider: TTSProvider = {
  name: "elevenlabs",
  available() { return !!process.env.ELEVENLABS_API_KEY; },
  async synthesize(text, opts = {}) {
    const { fs } = await nodeMods();
    const file = await cacheFile(text, "elevenlabs", "mp3", opts.cacheDir);
    if (!fs.existsSync(file)) {
      const voice = opts.voice ?? "21m00Tcm4TlvDq8ikWAM";
      const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: "POST",
        headers: { "xi-api-key": String(process.env.ELEVENLABS_API_KEY), "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: opts.model ?? "eleven_multilingual_v2" }),
      });
      if (!resp.ok) throw new Error("ElevenLabs TTS failed: " + resp.status);
      fs.writeFileSync(file, Buffer.from(await resp.arrayBuffer()));
    }
    return { file, durationSeconds: await audioDurationSeconds(file) };
  },
};

// Register built-ins.
for (const p of [silentProvider, systemProvider, openaiProvider, elevenLabsProvider]) registerTTSProvider(p);
