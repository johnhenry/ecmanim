// Reveal.js/Slidev parity demo 06: Campaign 9's closer, the "surpass" demo.
// A markdown-authored deck (identical dialect to 01-markdown-deck.ts, this
// campaign's `deckFromMarkdown()`/`parseDeckMarkdown()` gap-fill — see
// src/loaders/deck_markdown.ts) rendered straight to a narrated mp4, with
// `<bookmark mark='.../>` tags in the narration script driving exactly when
// each slide reveals (examples/voiceover.ts's pattern, "silent" TTS provider
// so this needs no API key and stays deterministic for CI). One markdown
// source, two real outputs: open the SAME deck live via the Player web-
// component presenter mode (deckFromMarkdown() -> render(), as 01 does), or
// render it to video with synced spoken narration, like this file does.
// Real Reveal.js/Slidev decks can only do the former.
//
// COMPOSITION CHOICE: this demo does NOT call deckFromMarkdown() itself.
// deckFromMarkdown() returns a `(scene) => Promise<void>` construct function
// that owns its own top-level async loop (build slide -> hold -> fade ->
// next slide) with no narration hook -- by the loader's own header comment,
// that's deliberate scope (a generic step/fragment/presenter-notes loader,
// not a narration-aware one). voiceover()'s own shape (examples/voiceover.ts)
// needs to wrap the ENTIRE narrated sequence in a single call, receiving a
// `(vt: VoiceoverTracker) => Promise<void>` callback -- that callback shape
// doesn't compose with deckFromMarkdown()'s `(scene) => Promise<void>` shape
// without threading `vt` through in a way the loader doesn't support. So
// instead: use `parseDeckMarkdown()` (the PURE PARSER half of the loader --
// no rendering, no scene lifecycle) to get plain `DeckSlide[]` data, then
// drive scene-building from inside voiceover()'s callback directly. The
// slide-building code below intentionally mirrors deckFromMarkdown()'s own
// `buildAndReveal()` internals (heading -> FadeIn, body -> FadeIn, bullets ->
// one FadeIn each) for visual consistency with 01's deck, simplified since
// this demo only uses headings/body/bullets (no code/math slides).
//
// CRITICAL (see commit 70e4fad, found while porting 01): never group a
// slide's mobjects into a wrapper VGroup and FadeOut(wrapper) unless the
// wrapper itself is also a real scene member -- FadeOut's finish() restores
// the animated mobject's opacity to full right after fading (manim parity),
// which is only correct if the removal actually took the mobject out of
// scene.mobjects. Below, each slide's mobjects are tracked as a plain array
// and each is faded out INDIVIDUALLY (own FadeIn/FadeOut lifecycle), exactly
// like deckFromMarkdown() does.

import { parseDeckMarkdown, voiceover, Text, FadeIn, FadeOut, DOWN } from "../../src/node.ts";
import type { Scene, Mobject } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

// Same dialect as 01-markdown-deck.ts: headings, `---` slide separators,
// bullet lists. No code/math slides needed to tell this story.
//
// Line lengths here are deliberately short: Text mobjects don't auto-wrap
// (manim parity), and a naive port of longer prose off the narration script
// below measured wider than the frame (FRAME_WIDTH is ~14.2 units) when
// centered -- verified per-line with getBoundingBox() while authoring this,
// each line here stays comfortably under that. Body lines use an explicit
// `\n` (two adjacent non-bullet markdown lines -- parseDeckMarkdown() joins
// them with "\n", and Text renders embedded newlines as real line breaks).
const deckMd = `
# One Deck, Two Outputs

This deck is one markdown file —
no slide editor, no export step.

---

# Live or Rendered

- Live, interactive presentation
- Rendered video with synced narration
- Reveal.js and Slidev do only the first

---

# No Manual Sync Pass

These narration bookmarks are the
only timing this video ever needed.
`;

// Tells the SAME story as the deck above, in the same order, with one
// <bookmark> right before each slide's topic is introduced -- that's what
// lets waitUntilBookmark() pace each slide's reveal to when the narration
// actually gets there (the "silent" provider has no word-boundary data, so
// bookmark times are proportional to character position in the clean text;
// keeping narration and deck content in lockstep, sentence by sentence, is
// what keeps that proportional estimate visually plausible).
const narration =
  "Every deck in this framework starts as a single markdown file, with no " +
  "slide editor and no separate export step. " +
  "<bookmark mark='slide-1'/>" +
  "Here it is: one source, written once. " +
  "<bookmark mark='slide-2'/>" +
  "That same file can drive two outputs. Walk through it live with the " +
  "interactive Player component, or render it straight to video with " +
  "narration baked in and synced to every beat. Reveal J S and Slidev can " +
  "only manage the first of those. " +
  "<bookmark mark='slide-3'/>" +
  "And the sync itself needs no manual pass: the bookmarks inside this " +
  "very narration script are the only timing information the video needed.";

const HEADING_COLOR = "#FFFFFF";
const BODY_COLOR = "#DDDDDD";

async function construct(scene: Scene): Promise<void> {
  const slides = parseDeckMarkdown(deckMd);

  await voiceover(
    scene,
    narration,
    async (vt) => {
      let prevBuilt: Mobject[] = [];

      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        const bookmark = `slide-${i + 1}`;

        // Sync point: don't reveal this slide until the narration actually
        // reaches its topic.
        await vt.waitUntilBookmark(bookmark);

        // Fade out the PREVIOUS slide's mobjects individually (never a
        // wrapper group -- see file header / commit 70e4fad) before bringing
        // the next one in, so nothing stacks on screen.
        if (prevBuilt.length) {
          await scene.play(...prevBuilt.map((m) => new FadeOut(m)), { runTime: 0.35 });
        }

        scene.nextSection(slide.heading ?? bookmark, undefined, false, slide.notes);

        const built: Mobject[] = [];
        let y = 2.2;

        if (slide.heading) {
          const h = new Text(slide.heading, { fontSize: 0.7, color: HEADING_COLOR });
          h.moveTo([0, y, 0]);
          built.push(h);
          await scene.play(new FadeIn(h), { runTime: 0.6 });
          y -= 1.1;
        }

        if (slide.body) {
          const b = new Text(slide.body, { fontSize: 0.4, color: BODY_COLOR });
          b.moveTo([0, y, 0]);
          built.push(b);
          await scene.play(new FadeIn(b), { runTime: 0.4 });
          y -= 0.8;
        }

        // One FadeIn per bullet -- a natural per-fragment reveal, same as
        // deckFromMarkdown()'s own incremental-list handling. Centered at
        // x=0 (not left-indented): Text mobjects center their bounding box
        // on the given point (moveTo does not anchor the left edge), so an
        // indented x like -4.3 combined with these bullets' natural width
        // pushed several lines' worth of text off the left edge of the
        // frame -- confirmed with getBoundingBox() while authoring this,
        // and visibly reproduced (and fixed) here.
        for (const bullet of slide.bullets) {
          const t = new Text(`•  ${bullet}`, { fontSize: 0.4, color: BODY_COLOR });
          t.moveTo([0, y, 0]);
          built.push(t);
          await scene.play(new FadeIn(t, { shift: DOWN.map((v) => v * 0.3) }), { runTime: 0.4 });
          y -= 0.65;
        }

        prevBuilt = built;
      }
      // Last slide is intentionally left on screen (not faded out) -- the
      // callback returning lets voiceover() wait out any remaining audio,
      // holding the closing slide until the narration actually finishes.
    },
    { provider: "silent" },
  );

  // A short closing hold after the narration ends, matching examples/
  // voiceover.ts's own convention.
  await scene.wait(0.3);
}

await demoRender(construct, import.meta.url);
