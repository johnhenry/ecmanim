# Voiceover / TTS-synced narration

Phase-3 adoption (manim-voiceover style). Exported from `manim-js/node`.

```js
import { render, voiceover } from "manim-js/node";

class Narrated extends Scene {
  async construct() {
    await voiceover(
      this,
      "First a circle <bookmark mark='sq'/> then a square.",
      async (vt) => {
        await this.play(new Create(circle), { _playConfig: true, runTime: vt.duration });
        await vt.waitUntilBookmark("sq");     // advance the scene to the '<bookmark>'
        await this.play(new FadeIn(square));
      },
      { provider: "system" },                  // or "openai" | "elevenlabs" | "silent"
    );
  }
}
```

`voiceover()` synthesizes the narration, adds it to the scene at the current time
(muxed into the render), invokes your callback with a **tracker**, then waits out
any remaining audio so scene time reaches the clip's end. The tracker exposes
`duration`, `timeAtBookmark(name)`, `timeUntilBookmark(name)`, and
`waitUntilBookmark(name)`.

## Providers

| name | needs | notes |
|------|-------|-------|
| `silent` | ffmpeg | no key — a silent clip of the **estimated** duration. Great for laying out timing offline / in CI. |
| `system` | macOS `say` or Linux `espeak-ng` | real local speech, no key. |
| `openai` | `OPENAI_API_KEY` | `gpt-4o-mini-tts`. |
| `elevenlabs` | `ELEVENLABS_API_KEY` | `eleven_multilingual_v2`. |

`resolveTTSProvider(preferred)` picks the first available (falling back to
`silent`). Register your own with `registerTTSProvider({ name, available, synthesize })`
— `synthesize(text) → { file, durationSeconds, wordBoundaries? }`.

### The `system` provider needs an external TTS program

`say` (macOS, built in) and `espeak-ng` (Linux, **not** built in — install it:
`apt install espeak-ng`, `nix-install espeak-ng`, `brew install espeak-ng`, …)
are system binaries, not npm dependencies. If neither is on `PATH`, `system`
reports unavailable and resolution falls through to `silent` — narration pacing
still works, the video is just mute.

Quality expectations: espeak-ng uses formant synthesis — clear and instant but
distinctly robotic. For natural local speech, [Piper](https://github.com/OHF-Voice/piper1-gpl)
(neural, fast, offline) is the usual step up — wrap it with
`registerTTSProvider` (it emits WAV files, so the adapter is a few lines).
Other local options in the same space: Festival/flite (classic, also robotic),
Coqui/XTTS (heavier neural). For cloud quality use the built-in `openai` /
`elevenlabs` providers.

Bookmarks: put `<bookmark mark="name"/>` inline in the narration text; the tag is
stripped from what's spoken and its position becomes a cue you can wait for.

## Bookmark timing accuracy — important

Bookmarks are only *word-exact* when the provider returns `wordBoundaries`.
**None of the built-in providers do** — the OpenAI and ElevenLabs adapters use
plain audio endpoints that return no word timings, and `system`/`silent` have
none either. Without word boundaries, a bookmark's time is **estimated
proportionally from its character offset** in the text. Real speech pace varies,
so expect drift — typically up to a few hundred milliseconds, more on long
sentences with pauses.

Check `tracker.timingSource` at runtime: `"word-boundaries"` (exact) or
`"proportional"` (estimated). If you need exact sync today: keep narration
segments short (drift scales with segment length), place bookmarks near the
start of sentences, or register a custom provider for a TTS API that returns
timings (e.g. Azure Speech's word-boundary events or ElevenLabs'
`/with-timestamps` endpoint) and pass them through as `wordBoundaries`.
