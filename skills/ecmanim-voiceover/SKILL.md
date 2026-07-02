---
name: ecmanim-voiceover
description: Add TTS-synthesized narration to an ecmanim Scene via voiceover(), sync animations to speech with bookmark tags and the returned duration tracker, and configure or extend the TTS provider abstraction (system/openai/elevenlabs/silent, custom providers, env-key config, offline fallback). Use this when the user wants narration, voiceover, spoken text, TTS, or bookmark-synced timing in an ecmanim video.
metadata:
  tags: ecmanim, voiceover, tts, narration, bookmarks
---

# ecmanim-voiceover

Narration for ecmanim: `voiceover()` synthesizes speech, muxes it into the
scene's audio track at the current time, and hands your callback a tracker you
use to sync animations to the words being spoken. This is Node-only (TTS
providers shell out to ffmpeg/system binaries/HTTP APIs).

Read `../ecmanim/SKILL.md` first for the shared Plan→Code→Render→Verify→Iterate
loop and `checkhealth`-first convention — this skill only adds what's specific
to narration. Full reference: [../../docs/voiceover.md](../../docs/voiceover.md).

## Quickstart

```ts
import { render, Scene, voiceover, Create, FadeIn } from "ecmanim/node";

class Narrated extends Scene {
  async construct() {
    await voiceover(
      this,
      "First a circle <bookmark mark='sq'/> then a square.",
      async (vt) => {
        await this.play(new Create(circle), { runTime: vt.duration });
        await vt.waitUntilBookmark("sq");
        await this.play(new FadeIn(square));
      },
      { provider: "system" }, // or "openai" | "elevenlabs" | "silent"
    );
  }
}

await render(Narrated, { output: "narrated.mp4", quality: "high" });
```

`voiceover(scene, text, callback, options?)` — all exported from `ecmanim/node`:

1. Strips `<bookmark mark="name"/>` tags out of `text` (they're never spoken).
2. Resolves a provider and calls `provider.synthesize(cleanText, options)`.
3. Adds the resulting audio file to the scene at `scene.time` (the current
   time when `voiceover()` was called), via `scene.addSound(file, { timeOffset, gain })`.
4. Builds a `VoiceoverTracker` and awaits your `callback(tracker)`.
5. After the callback returns, waits out any remaining audio so scene time
   lands exactly at `startTime + duration` — you don't need a trailing
   `this.wait()` yourself.

`voiceover()` resolves to the `VoiceoverTracker` if you need it after the call.

## The tracker

`VoiceoverTracker` (from `voiceover.duration` etc.) exposes:

- `duration: number` — total synthesized clip length in seconds. Feed this as
  `runTime` into `this.play(..., { runTime: vt.duration })` to stretch an
  animation to exactly match the narration.
- `timingSource: "word-boundaries" | "proportional"` — how bookmark times were
  computed (see below). Check this at runtime if sync precision matters.
- `timeAtBookmark(name)` — absolute scene time (seconds) of a bookmark.
- `timeUntilBookmark(name)` — seconds from *now* until a bookmark, clamped to
  `>= 0`.
- `waitUntilBookmark(name): Promise<void>` — advances the scene (via
  `scene.wait(dt)`) until that bookmark's estimated time. This is the normal
  way to gate a `this.play(...)` call on a specific word being spoken.

Multiple bookmarks in one narration string are all resolved up front — call
`waitUntilBookmark` for each in the order they occur.

## Bookmark timing accuracy

Bookmark position is estimated from the character offset of the `<bookmark>`
tag in the (bookmark-stripped) text, unless the provider returned per-word
`wordBoundaries`. **None of the four built-in providers return word
boundaries** — `openai` and `elevenlabs` use plain audio endpoints with no
timing metadata, and `system`/`silent` never had any. So in practice every
built-in provider gives `timingSource === "proportional"`: expect drift up to
a few hundred milliseconds, worse on long sentences with pauses.

To tighten sync:
- Keep narrated segments short — drift scales with segment length, so prefer
  several short `voiceover()` calls over one long paragraph.
- Place bookmarks near the start of a sentence/clause rather than mid-word.
- Register a custom provider (see below) for a TTS API that *does* return word
  timings (e.g. Azure Speech word-boundary events, ElevenLabs'
  `/with-timestamps` endpoint) and pass them through as `wordBoundaries` —
  that flips `timingSource` to `"word-boundaries"` and bookmarks become exact.

## Provider abstraction

```ts
import { resolveTTSProvider, registerTTSProvider, getTTSProvider, listTTSProviders } from "ecmanim/node";
```

A `TTSProvider` is `{ name, available(), synthesize(text, opts?) }`, where
`available()` may be sync or async and `synthesize()` returns
`{ file, durationSeconds, wordBoundaries? }`.

Built-ins, in the order `resolveTTSProvider(preferred)` tries them
(`[preferred, "system", "openai", "elevenlabs", "silent"]`, first one whose
`available()` is true wins, `silent` is the unconditional last resort):

| name | availability check | needs | notes |
|---|---|---|---|
| `system` | `say` (macOS) or `espeak-ng`/`espeak` on `PATH` | a system TTS binary | real local speech; macOS `say` writes AIFF then converts via ffmpeg, Linux uses `espeak-ng`/`espeak` directly. |
| `openai` | `process.env.OPENAI_API_KEY` set | API key | `gpt-4o-mini-tts` via `POST https://api.openai.com/v1/audio/speech`, default voice `alloy`. No word timings. |
| `elevenlabs` | `process.env.ELEVENLABS_API_KEY` set | API key | `eleven_multilingual_v2`, default voice id `21m00Tcm4TlvDq8ikWAM`. No word timings in this adapter. |
| `silent` | always `true` | ffmpeg (for the actual audio; degrades further if absent) | generates a silent clip of the *estimated* duration (`words / wordsPerSecond`, default 2.6 wps, via `opts.speed`). Good for laying out timing offline / in CI without hitting any network or binary. |

`options.provider` in `voiceover(...)` (or `resolveTTSProvider(name)` directly)
just moves that name to the front of the try order — it still falls through to
`silent` if that provider reports itself unavailable.

Synthesized files are cached by a hash of `provider + text` under
`os.tmpdir()/ecmanim-voiceover` (or `opts.cacheDir`), so re-running the same
narration text is a no-op after the first synthesis.

### Registering a custom provider

```ts
import { registerTTSProvider } from "ecmanim/node";

registerTTSProvider({
  name: "piper",
  available: () => hasPiperBinary(), // your own check
  async synthesize(text, opts) {
    const file = await runPiper(text, opts?.voice);   // write a WAV
    return { file, durationSeconds: await audioDurationSeconds(file) };
    // optionally add: wordBoundaries: [{ word, startMs, endMs }, ...]
  },
});

await voiceover(this, "...", cb, { provider: "piper" });
```

`registerTTSProvider` just adds to (or overwrites) the module-level provider
map — call it once before any `voiceover()` call that needs it (e.g. at the
top of your scene file). `audioDurationSeconds(file)` (also exported) shells
out to `ffprobe` and is handy for computing `durationSeconds` yourself.

Natural local speech beyond `espeak-ng`'s formant synthesis: wrap
[Piper](https://github.com/OHF-Voice/piper1-gpl) (neural, fast, offline, emits
WAV — a few lines of adapter) the same way. Festival/flite are classic/robotic
alternatives in the same space; Coqui/XTTS is a heavier neural option. None of
these are wired in — they're all "register your own provider" territory.

## Gotchas

- **No network and no API key is not an error** — `resolveTTSProvider` walks
  the fallback chain and lands on `silent`, which needs no key and no
  binary except ffmpeg for the actual clip. Narration *pacing* (bookmarks,
  `vt.duration`) still works with `silent`; the rendered video is just mute.
  Run `npx ecmanim checkhealth` to see what's actually available before
  assuming a failure is a code bug.
- **`silent` degrades again if ffmpeg is missing**: it still returns
  `{ file, durationSeconds }` with the *estimated* duration, but `file` won't
  exist on disk (the `ffmpeg` call is wrapped in try/catch and silently
  swallowed) — `scene.addSound(file, ...)` will then be pointing at a missing
  path. Timing math is unaffected; only the audio mux is affected.
- **`openai`/`elevenlabs` have no request timeout.** Their `synthesize()` is a
  bare `fetch()` with no `AbortSignal`/timeout wired up — a slow or hanging
  API call blocks the render indefinitely rather than failing fast. There is
  no `synthesisTimeoutMs` option or similar in this codebase; if you need a
  hard timeout, wrap the `voiceover()` call yourself (`Promise.race` against a
  timer) or register a custom provider that adds one.
- **`ffprobe` (not just `ffmpeg`) is required** for `system`/`openai`/
  `elevenlabs` to know clip duration — `audioDurationSeconds()` shells out to
  `ffprobe` and returns `0` on failure (parse error or missing binary), which
  will silently produce a zero-length wait/runTime rather than throwing.
  `checkhealth` reports ffprobe availability alongside ffmpeg.
- **Bookmark sync is estimated, not exact**, for every built-in provider (see
  above) — don't rely on frame-accurate lip/beat sync without a custom
  word-boundary-returning provider.
- **`system` on Linux is not preinstalled** — `espeak-ng` must be installed
  (`nix-install espeak-ng` on this machine); without it `system` reports
  unavailable and resolution silently falls through, so a missing binary looks
  like "narration works but no voice," not a thrown error.
