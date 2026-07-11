// Campaign 9 (Reveal.js / Slidev decks) gap-fill: a markdown-authored
// presentation deck loader. This is the ONE genuine new-code gap this
// campaign needed -- assessment (personal API smoke-testing) found
// everything else already built from earlier work: `Scene.nextSection()`
// already carries presenter-mode speaker `notes`; `Player.steps()` already
// derives fragment/step navigation from `scene.playRecords` (every
// `play()`/`wait()` call is already a step boundary, so THIS loader gets
// step-by-step fragment reveal "for free" just by calling `scene.play()`
// once per fragment -- no separate `Scene.step()` API was needed);
// `Scene.autoAnimateToNextSection()` already does the Reveal.js
// Auto-Animate-style snapshot+TransformMatchingAuto transition;
// `Player.presenterMode` already pauses at section boundaries with
// next-section thumbnail support; `Code.selection(lines(...))` already
// drives per-range highlight steps; `MathTex` already renders LaTeX.
//
// DELIBERATE SCOPE: this is a loader for a small, GENERIC presentation-
// markdown dialect (headings / `---` slide separators / bullet lists /
// fenced code with Slidev-style `{2,4-6}` line-highlight-step annotations /
// `$$...$$` math / trailing HTML-comment or `<aside class="notes">` speaker
// notes) -- NOT a full Reveal.js or Slidev markdown engine. Real Slidev
// decks embed Vue components, UnoCSS classes, and frontmatter-driven layout
// switching (see examples/reveal-slidev-parity/ref/slidev-demo.md) that are
// out of scope for a generic loader; ports of the real corpus decks are
// hand-adapted onto this dialect (or onto the Scene API directly), not fed
// through this loader as a literal converter.

import { Scene } from "../scene/Scene.ts";
import { Text } from "../mobject/text/Text.ts";
import type { Mobject } from "../mobject/Mobject.ts";
import { Code, lines } from "../mobject/text/code.ts";
import { MathTex } from "../mobject/mathtex.ts";
import { FadeIn, FadeOut } from "../animation/Animation.ts";
import { DOWN } from "../core/math/vector.ts";
import type { ColorLike } from "../core/types.ts";

export interface DeckCodeBlock {
  language: string;
  source: string;
  /** Parsed Slidev-style `{2,4-6}` step annotation: one entry per reveal
   *  step, each a list of 0-based [start,end] inclusive line ranges to
   *  highlight that step. Empty array = no step annotation (show all lines
   *  highlighted, single step). */
  highlightSteps: Array<Array<[number, number]>>;
}

export interface DeckSlide {
  /** The slide's first `#`/`##`/... heading text, if any. */
  heading?: string;
  /** Non-list, non-code, non-math paragraph lines, joined with "\n". */
  body: string;
  /** Parsed `-`/`*`/`1.` list items (incremental-fragment candidates). */
  bullets: string[];
  /** The slide's first fenced code block, if any. */
  code?: DeckCodeBlock;
  /** The slide's first `$$...$$` block (LaTeX, without the delimiters). */
  math?: string;
  /** Speaker notes: a trailing `<!-- ... -->` block or `<aside
   *  class="notes">...</aside>`, matching Slidev's and reveal.js's own
   *  conventions respectively. */
  notes?: string;
}

// Word-wrap width for heading/body/bullet Text (world units) -- keeps every
// slide's text within FRAME_WIDTH (~14.22, src/core/constants.ts) regardless
// of content length. See the wrap-width note in buildAndReveal() below for
// the bug this fixes (bullets could otherwise render off the left edge).
const SAFE_WIDTH = 12;

const CODE_FENCE_RE = /^```(\S*)(?:\s*\{([^}]*)\})?\s*\n([\s\S]*?)\n```$/m;
const MATH_RE = /\$\$([\s\S]*?)\$\$/;
const ASIDE_NOTES_RE = /<aside\s+class="notes">([\s\S]*?)<\/aside>/i;
const TRAILING_COMMENT_RE = /<!--([\s\S]*?)-->\s*$/;

/** Parse a Slidev-style step-highlight annotation, e.g. `"2,4-6"` ->
 *  `[[[1,1],[3,5]]]` (one step highlighting 0-based lines 1 and 3-5) for a
 *  SINGLE step, or `"all|2|4-6|all"` -> one entry per `|`-separated step
 *  (Slidev's own multi-step syntax) for a sequence of steps. `"all"` means
 *  "no highlight restriction" (represented as an empty range list). */
function parseHighlightSteps(raw: string | undefined, lineCount: number): Array<Array<[number, number]>> {
  if (!raw || !raw.trim()) return [];
  const stepsRaw = raw.includes("|") ? raw.split("|") : [raw];
  return stepsRaw.map((step) => {
    const s = step.trim();
    if (s === "" || s === "all") return [];
    return s.split(",").map((part) => {
      const p = part.trim();
      const m = /^(\d+)(?:-(\d+))?$/.exec(p);
      if (!m) return [0, lineCount - 1] as [number, number];
      const a = parseInt(m[1], 10) - 1; // 1-based -> 0-based
      const b = m[2] ? parseInt(m[2], 10) - 1 : a;
      return [Math.max(0, a), Math.max(0, b)] as [number, number];
    });
  });
}

/** Parse a deck's markdown source into slides. Pure, no rendering. Splits
 *  on lines that are exactly `---` (a bare horizontal rule / Slidev-style
 *  slide separator); a leading `---`-delimited YAML frontmatter block (if
 *  the document starts with `---`) is skipped entirely, not parsed. */
export function parseDeckMarkdown(md: string): DeckSlide[] {
  let body = md.replace(/\r\n/g, "\n");

  // Skip a LEADING frontmatter fence (--- ... ---) if present, matching
  // Slidev's convention; we don't parse its keys (layout/theme/etc are out
  // of scope for this generic loader), just discard the block.
  const fmMatch = /^---\n[\s\S]*?\n---\n/.exec(body);
  if (fmMatch) body = body.slice(fmMatch[0].length);

  const rawSlides = body.split(/\n---\n/).map((s) => s.trim()).filter((s) => s.length > 0);

  return rawSlides.map((raw): DeckSlide => {
    let text = raw;

    // Speaker notes: prefer an <aside class="notes">, else a trailing
    // HTML comment (Slidev's own "last comment block = notes" rule).
    let notes: string | undefined;
    const asideMatch = ASIDE_NOTES_RE.exec(text);
    if (asideMatch) {
      notes = asideMatch[1].trim();
      text = text.replace(asideMatch[0], "").trim();
    } else {
      const commentMatch = TRAILING_COMMENT_RE.exec(text);
      if (commentMatch) {
        notes = commentMatch[1].trim();
        text = text.slice(0, commentMatch.index).trim();
      }
    }

    // Math block.
    let math: string | undefined;
    const mathMatch = MATH_RE.exec(text);
    if (mathMatch) {
      math = mathMatch[1].trim();
      text = text.replace(mathMatch[0], "").trim();
    }

    // Fenced code block.
    let code: DeckCodeBlock | undefined;
    const codeMatch = CODE_FENCE_RE.exec(text);
    if (codeMatch) {
      const [, language, stepsRaw, source] = codeMatch;
      const lineCount = source.split("\n").length;
      code = { language: language || "text", source, highlightSteps: parseHighlightSteps(stepsRaw, lineCount) };
      text = text.replace(codeMatch[0], "").trim();
    }

    // Heading (first #.. line).
    let heading: string | undefined;
    const headingMatch = /^#{1,6}\s+(.+)$/m.exec(text);
    if (headingMatch) {
      heading = headingMatch[1].trim();
      text = text.replace(headingMatch[0], "").trim();
    }

    // Bullets (- / * / 1. list items), each on its own line.
    const bullets: string[] = [];
    const bodyLines: string[] = [];
    for (const line of text.split("\n")) {
      const bulletMatch = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
      if (bulletMatch) bullets.push(bulletMatch[1].trim());
      else if (line.trim()) bodyLines.push(line.trim());
    }

    return { heading, body: bodyLines.join("\n"), bullets, code, math, notes };
  });
}

export interface DeckConfig {
  /** Hold time (seconds) after each slide's content finishes revealing,
   *  before advancing. Default 0.5. */
  holdTime?: number;
  /** Per-fragment reveal duration (seconds). Default 0.4. */
  fragmentRunTime?: number;
  headingColor?: ColorLike;
  bodyColor?: ColorLike;
  /** Use Scene.autoAnimateToNextSection() (Reveal.js Auto-Animate-style
   *  snapshot+match transition) between slides instead of a hard cut.
   *  Default false (matches nextSection()'s own "strictly opt-in" stance —
   *  auto-animate is a deliberate authorial choice, not automatic, since
   *  matching unrelated same-shape elements by default is surprising). */
  autoAnimate?: boolean;
}

/** Build an ecmanim deck from markdown source: headings -> section titles,
 *  `---` -> slide/section boundaries (via `scene.nextSection(heading, ...,
 *  notes)` -- presenter-mode speaker notes come along for free), bullet
 *  lists -> one `play()` per item (a natural step boundary via
 *  `scene.playRecords`, so `Player.nextStep()`/`prevStep()` navigate
 *  fragments with NO extra API), fenced code -> a `Code` mobject stepped
 *  through its `{2,4-6}`-annotated highlight ranges via
 *  `code.selection(lines(...))` (again, one `play()` per step), `$$...$$`
 *  -> `MathTex` (the caller must have already run `await initMathTex()`,
 *  matching every other MathTex-using demo in this codebase).
 *
 *  Returns a plain `(scene) => Promise<void>` construct function, the same
 *  shape `render()`/`demoRender()` already accept alongside a Scene
 *  subclass (see src/scene/orchestrate.ts's `isSceneLike` dispatch). */
export function deckFromMarkdown(md: string, config: DeckConfig = {}): (scene: Scene) => Promise<void> {
  const slides = parseDeckMarkdown(md);
  const holdTime = config.holdTime ?? 0.5;
  const fragmentRunTime = config.fragmentRunTime ?? 0.4;
  const headingColor = config.headingColor ?? "#FFFFFF";
  const bodyColor = config.bodyColor ?? "#DDDDDD";

  return async function construct(scene: Scene): Promise<void> {
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const sectionName = slide.heading ?? `slide-${i + 1}`;

      // Track each slide's top-level mobjects as a plain array, NOT a
      // wrapper VGroup: FadeIn/FadeOut are each an "introducer"/"remover"
      // (see Animation.ts -- getMobjectsToIntroduce()/getMobjectsToRemove()
      // add/remove `this.mobject` from `scene.mobjects` directly when the
      // animation begins/finishes). A wrapper group that's never itself
      // added to `scene.mobjects` breaks this: FadeOut(wrapper)'s finish()
      // deliberately RESTORES the family's opacity back to full right after
      // fading (manim parity, so a mobject re-shown later doesn't inherit
      // opacity 0) -- correct ONLY because the wrapper's removal actually
      // took it out of the render tree. If the wrapper was never a real
      // scene member (only its individual children were, via each child's
      // OWN FadeIn introducer), that removal is a no-op and the restore step
      // makes every "faded out" child SNAP BACK to full opacity, stacking
      // visibly on top of the next slide. Fix: animate/remove each child
      // mobject directly (its own FadeIn/FadeOut lifecycle is then self-
      // consistent), never wrap-and-animate-the-wrapper.
      const buildAndReveal = async (): Promise<Mobject[]> => {
        const built: Mobject[] = [];
        let y = 3;

        if (slide.heading) {
          const h = new Text(slide.heading, { fontSize: 0.7, color: headingColor, width: SAFE_WIDTH });
          h.moveTo([0, y, 0]);
          built.push(h);
          await scene.play(new FadeIn(h));
          y -= 1.1;
        }

        if (slide.body) {
          const b = new Text(slide.body, { fontSize: 0.4, color: bodyColor, width: SAFE_WIDTH });
          b.moveTo([0, y, 0]);
          built.push(b);
          await scene.play(new FadeIn(b), { runTime: fragmentRunTime });
          y -= 0.8;
        }

        // Bullets: one play() per item -- each a natural step boundary.
        // Regression (found by the 06-rendered-narration port's frame-check):
        // Text.moveTo() centers the mobject's bounding box on the given
        // point, NOT left-anchors it -- a fixed x=-4.5 combined with wide,
        // unwrapped bullet text pushed the text's LEFT edge well past the
        // frame's left border. Fixed with a `width` wrap (keeps every
        // bullet's rendered width bounded) and centering on x=0 (matching
        // heading/body) rather than guessing a fixed left offset that only
        // happened to work for short strings.
        for (const bullet of slide.bullets) {
          const t = new Text(`•  ${bullet}`, { fontSize: 0.4, color: bodyColor, width: SAFE_WIDTH });
          t.moveTo([0, y, 0]);
          built.push(t);
          await scene.play(new FadeIn(t, { shift: DOWN.map((v) => v * 0.3) }), { runTime: fragmentRunTime });
          y -= 0.6;
        }

        if (slide.math) {
          const m = new MathTex(slide.math, { color: headingColor });
          m.moveTo([0, y - 0.5, 0]);
          built.push(m);
          await scene.play(new FadeIn(m), { runTime: fragmentRunTime });
        }

        if (slide.code) {
          const c = new Code(slide.code.source, { language: slide.code.language, fontSize: 0.28 });
          c.moveTo([0, y - 1.5, 0]);
          built.push(c);
          await scene.play(new FadeIn(c), { runTime: fragmentRunTime });
          // One step per highlight-annotation entry -- each play() is a
          // natural fragment/step boundary via scene.playRecords.
          for (const ranges of slide.code.highlightSteps) {
            const targets = ranges.length ? ranges.map(([a, b]) => lines(a, b)) : null;
            await scene.play(c.selection(targets, 0.25), { runTime: fragmentRunTime });
          }
        }

        return built;
      };

      if (config.autoAnimate && i > 0) {
        await scene.autoAnimateToNextSection(sectionName, async () => {
          // autoAnimateToNextSection snapshots BEFORE this callback runs and
          // removes the live "after" mobjects it finds once the callback
          // returns -- so building fresh content here (rather than
          // reproducing buildAndReveal's own play() calls) is intentional:
          // the auto-animate Transform IS the reveal, no separate fragment
          // play() sequence makes sense inside this callback.
          await buildAndReveal();
        });
      } else {
        scene.nextSection(sectionName, undefined, false, slide.notes);
        const built = await buildAndReveal();
        await scene.wait(holdTime);
        if (i < slides.length - 1 && built.length) {
          await scene.play(...built.map((m) => new FadeOut(m)), { runTime: fragmentRunTime });
        }
      }
    }
  };
}
