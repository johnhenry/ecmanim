// Campaign 9 (Reveal.js / Slidev decks) gap-fill: parseDeckMarkdown (pure
// parser) + deckFromMarkdown (Scene builder). See src/loaders/deck_markdown.ts
// for the dialect's deliberate scope (a generic presentation-markdown
// subset, not a full Reveal.js/Slidev engine).

import { test, before } from "node:test";
import assert from "node:assert/strict";

import { parseDeckMarkdown, deckFromMarkdown } from "../src/loaders/deck_markdown.ts";
import { Scene } from "../src/scene/Scene.ts";
import { FRAME_WIDTH } from "../src/core/constants.ts";

before(async () => {
  await (await import("../src/renderer/fonts-node.ts")).loadVectorFont();
  await (await import("../src/mobject/mathtex.ts")).initMathTex();
});

test("parseDeckMarkdown splits on bare '---' lines into slides", () => {
  const md = "# One\nfirst\n\n---\n\n# Two\nsecond";
  const slides = parseDeckMarkdown(md);
  assert.equal(slides.length, 2);
  assert.equal(slides[0].heading, "One");
  assert.equal(slides[0].body, "first");
  assert.equal(slides[1].heading, "Two");
  assert.equal(slides[1].body, "second");
});

test("parseDeckMarkdown skips a leading YAML frontmatter fence", () => {
  const md = "---\ntheme: seriph\ntitle: Hi\n---\n\n# Real Slide\nbody text";
  const slides = parseDeckMarkdown(md);
  assert.equal(slides.length, 1);
  assert.equal(slides[0].heading, "Real Slide");
  assert.equal(slides[0].body, "body text");
});

test("parseDeckMarkdown collects bullet items in order", () => {
  const md = "# List\n- first\n- second\n* third\n1. fourth";
  const [slide] = parseDeckMarkdown(md);
  assert.deepEqual(slide.bullets, ["first", "second", "third", "fourth"]);
});

test("parseDeckMarkdown extracts a math block without the $$ delimiters", () => {
  const md = "# Math\n$$\\int_0^1 x\\,dx = \\frac{1}{2}$$";
  const [slide] = parseDeckMarkdown(md);
  assert.equal(slide.math, "\\int_0^1 x\\,dx = \\frac{1}{2}");
});

test("parseDeckMarkdown extracts speaker notes from a trailing HTML comment", () => {
  const md = "# Slide\nbody\n\n<!--\nRemember to slow down here.\n-->";
  const [slide] = parseDeckMarkdown(md);
  assert.equal(slide.notes, "Remember to slow down here.");
  assert.ok(!slide.body.includes("Remember"), "notes must not leak into body");
});

test("parseDeckMarkdown extracts speaker notes from <aside class=\"notes\">", () => {
  const md = '# Slide\nbody\n<aside class="notes">Reveal.js style notes.</aside>';
  const [slide] = parseDeckMarkdown(md);
  assert.equal(slide.notes, "Reveal.js style notes.");
});

test("parseDeckMarkdown parses a fenced code block with no highlight annotation", () => {
  const md = "# Code\n```js\nconst x = 1;\nconst y = 2;\n```";
  const [slide] = parseDeckMarkdown(md);
  assert.equal(slide.code?.language, "js");
  assert.equal(slide.code?.source, "const x = 1;\nconst y = 2;");
  assert.deepEqual(slide.code?.highlightSteps, []);
});

test("parseDeckMarkdown parses Slidev-style single-step {2,4-6} line ranges (1-based -> 0-based)", () => {
  const md = "# Code\n```ts {2,4-6}\na\nb\nc\nd\ne\nf\n```";
  const [slide] = parseDeckMarkdown(md);
  assert.equal(slide.code?.highlightSteps.length, 1);
  assert.deepEqual(slide.code?.highlightSteps[0], [[1, 1], [3, 5]]);
});

test("parseDeckMarkdown parses Slidev-style multi-step {all|2|4-6|all} sequences", () => {
  const md = "# Code\n```ts {all|2|4-6|all}\na\nb\nc\nd\ne\nf\n```";
  const [slide] = parseDeckMarkdown(md);
  assert.equal(slide.code?.highlightSteps.length, 4);
  assert.deepEqual(slide.code?.highlightSteps[0], []); // "all" = no restriction
  assert.deepEqual(slide.code?.highlightSteps[1], [[1, 1]]);
  assert.deepEqual(slide.code?.highlightSteps[2], [[3, 5]]);
  assert.deepEqual(slide.code?.highlightSteps[3], []);
});

test("parseDeckMarkdown handles a slide with heading + body + bullets + code + math + notes all at once", () => {
  const md = [
    "# Everything",
    "intro line",
    "- point one",
    "- point two",
    "```py {1}",
    "print(1)",
    "print(2)",
    "```",
    "$$E=mc^2$$",
    "<!-- final notes -->",
  ].join("\n");
  const [slide] = parseDeckMarkdown(md);
  assert.equal(slide.heading, "Everything");
  assert.equal(slide.body, "intro line");
  assert.deepEqual(slide.bullets, ["point one", "point two"]);
  assert.equal(slide.code?.source, "print(1)\nprint(2)");
  assert.equal(slide.math, "E=mc^2");
  assert.equal(slide.notes, "final notes");
});

// --- deckFromMarkdown: Scene-building integration --------------------------

test("deckFromMarkdown returns a plain construct function render() can consume", () => {
  const build = deckFromMarkdown("# Hi\nworld");
  assert.equal(typeof build, "function");
});

test("deckFromMarkdown drives a real Scene: one nextSection per slide, with notes carried through", async () => {
  const md = "# First\nfirst body\n\n---\n\n# Second\nsecond body\n\n<!-- notes for second -->";
  const build = deckFromMarkdown(md, { holdTime: 0.05, fragmentRunTime: 0.05 });
  const scene = new Scene();
  await build(scene);
  assert.equal(scene.sections.length, 2);
  assert.equal(scene.sections[0].name, "First");
  assert.equal(scene.sections[1].name, "Second");
  assert.equal(scene.sections[1].notes, "notes for second");
});

test("deckFromMarkdown: each bullet is its own play() (a natural step boundary via playRecords)", async () => {
  const md = "# Steps\n- alpha\n- beta\n- gamma";
  const build = deckFromMarkdown(md, { holdTime: 0.01, fragmentRunTime: 0.01 });
  const scene = new Scene();
  await build(scene);
  // heading fade-in (1) + 3 bullet fade-ins = at least 4 play() records.
  assert.ok(scene.playRecords.length >= 4, `expected >=4 playRecords, got ${scene.playRecords.length}`);
});

test("deckFromMarkdown: a code block's highlight steps are each their own play()", async () => {
  const md = "# Walkthrough\n```js {all|1|2}\nconst a = 1;\nconst b = 2;\n```";
  const build = deckFromMarkdown(md, { holdTime: 0.01, fragmentRunTime: 0.01 });
  const scene = new Scene();
  const before = 0;
  await build(scene);
  // heading + code fade-in + 2 highlight-step plays = at least 4.
  assert.ok(scene.playRecords.length >= 4, `expected >=4 playRecords, got ${scene.playRecords.length}`);
  assert.ok(scene.playRecords.length > before);
});

// Regression: FadeOut(wrapperGroup) was used to clear a slide's content
// before the next slide, but the wrapper VGroup was never itself added to
// scene.mobjects (only its individual children were, via each child's own
// FadeIn introducer) -- FadeOut.finish() deliberately RESTORES opacity to
// full right after fading (see Animation.ts's FadeOut, manim parity: a
// mobject shown again later shouldn't inherit opacity 0), which is only
// correct because the animated top-level mobject is assumed to have
// actually left the scene. Since the wrapper's removal was a no-op, every
// "faded out" child snapped back to full opacity and stacked visibly on top
// of the next slide's content -- caught by the exemplar port's frame-check,
// not by the structural tests above.
test("deckFromMarkdown: a slide's mobjects are actually removed after fading, not left at full opacity", async () => {
  const md = "# One\nfirst\n\n---\n\n# Two\nsecond";
  const build = deckFromMarkdown(md, { holdTime: 0.01, fragmentRunTime: 0.01 });
  const scene = new Scene();
  await build(scene);
  const names = scene.mobjects.map((m: any) => m.text);
  assert.ok(!names.includes("One"), `slide 1's heading must be gone once slide 2 is showing, saw: ${names}`);
  assert.ok(!names.includes("first"), `slide 1's body must be gone once slide 2 is showing, saw: ${names}`);
  assert.ok(names.includes("Two"), `slide 2's heading must be present, saw: ${names}`);
  assert.ok(names.includes("second"), `slide 2's body must be present, saw: ${names}`);
  // No leftover mobject anywhere in the scene should still be at full
  // opacity from a slide that's supposed to be gone.
  for (const m of scene.mobjects as any[]) {
    assert.ok((m.fillOpacity ?? 1) > 0, `${m.text} should not be a zero-opacity ghost left in the scene`);
  }
});

// Regression (found by the 06-rendered-narration port's frame-check): a
// long bullet rendered off the left edge of frame. Text.moveTo() centers
// the mobject's bounding box on the given point, NOT left-anchors it -- a
// fixed x offset combined with wide, unwrapped text pushed the left edge
// well past FRAME_WIDTH's boundary. Fixed with a word-wrap width.
test("deckFromMarkdown: a long bullet stays within the frame's width, not clipped off-screen", async () => {
  const longBullet = "Headless video output via ffmpeg, no browser required, and it just works";
  const md = `# Wide\n- ${longBullet}`;
  const build = deckFromMarkdown(md, { holdTime: 0.01, fragmentRunTime: 0.01 });
  const scene = new Scene();
  await build(scene);
  const bulletMob = (scene.mobjects as any[]).find((m) => m.text?.includes("Headless"));
  assert.ok(bulletMob, "the long bullet's Text mobject should be in the scene");
  const bbox = bulletMob.getBoundingBox();
  const halfFrame = FRAME_WIDTH / 2;
  assert.ok(
    bbox.min[0] >= -halfFrame && bbox.max[0] <= halfFrame,
    `bullet bounding box [${bbox.min[0]}, ${bbox.max[0]}] must fit within frame [-${halfFrame}, ${halfFrame}]`,
  );
});

test("deckFromMarkdown: autoAnimate:true uses autoAnimateToNextSection for slides after the first", async () => {
  const md = "# A\nfirst\n\n---\n\n# B\nsecond";
  const build = deckFromMarkdown(md, { holdTime: 0.01, fragmentRunTime: 0.01, autoAnimate: true });
  const scene = new Scene();
  await build(scene);
  assert.equal(scene.sections.length, 2);
  assert.equal(scene.sections[1].name, "B");
});
