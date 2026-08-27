import { test, before } from "node:test";
import assert from "node:assert/strict";
import { Code } from "../src/mobject/text/code.ts";
import { Transform, FadeIn, FadeOut } from "../src/animation/Animation.ts";
import * as V from "../src/core/math/vector.ts";

// Code.diffTo(): morphs one Code snapshot into another via
// TransformMatchingAuto over the flat codeTokens group (Code-Surfer-style
// code-diff-morph), reusing that engine as-is rather than building a new one
// -- every token is already a Text mobject keyed by its own literal string.
// The one real gap (autoKey() matches by text content alone, so two
// instances of the same token on one line can't be disambiguated) is closed
// by seeding matchId as "text:line:col" before matching.

before(async () => {
  await (await import("../src/renderer/fonts-node.ts")).loadVectorFont();
});

test("color-only changes produce Transforms, not FadeIn/FadeOut", () => {
  const a = new Code("let x = 1;", { language: "js", lineNumbers: false });
  const b = new Code("let x = 1;", { language: "js", lineNumbers: false, style: { default: "#FFFFFF" } });
  const group = a.diffTo(b);
  assert.ok(group.animations.length > 0);
  for (const anim of group.animations) {
    assert.ok(anim instanceof Transform, `expected only Transforms for an unchanged token sequence, got ${anim.constructor.name}`);
  }
});

test("a duplicated identifier on one line morphs the correct instance, not an arbitrary FIFO pairing", () => {
  // Two "x" tokens on the same line in both versions, but only the SECOND
  // one's neighboring text differs between a and b.
  const a = new Code("x + x", { language: "js", lineNumbers: false });
  const b = new Code("x + y", { language: "js", lineNumbers: false });

  const group = a.diffTo(b);
  const transforms = group.animations.filter((x: any) => x instanceof Transform) as Transform[];

  // Find the Transform whose SOURCE is the first "x" token of `a` (line 0,
  // col 0) via the matchId seeded by diffTo().
  const firstX = a.codeTokens.submobjects.find((m: any) => m.matchId === "x:0:0")!;
  const firstXTransform = transforms.find((t) => t.mobject === firstX)!;
  assert.ok(firstXTransform, "the first 'x' token should have a matched Transform (it's unchanged)");
  assert.equal((firstXTransform.target as any).text, "x", "the first 'x' should pair to the unchanged first 'x' in b, not to y");

  // The second "x" (col 4, after "x + ") has no matching token in b at all
  // (b's line is "x + y") -- it should fade rather than force-pair to "y".
  const secondX = a.codeTokens.submobjects.find((m: any) => m.matchId === "x:0:4")!;
  const secondXTransform = transforms.find((t) => t.mobject === secondX);
  assert.equal(secondXTransform, undefined, "the second 'x' has no counterpart in b and should not be force-paired");
  const fadeOuts = group.animations.filter((x: any) => x instanceof FadeOut);
  assert.ok(fadeOuts.some((f: any) => f.mobject === secondX), "the second 'x' should fade out, not morph into 'y'");
});

test("a line inserted at the top fades unrelated content below it (known, documented limitation)", () => {
  const a = new Code("first\nsecond", { language: "js", lineNumbers: false });
  const b = new Code("inserted\nfirst\nsecond", { language: "js", lineNumbers: false });

  const group = a.diffTo(b);
  const transforms = group.animations.filter((x: any) => x instanceof Transform) as Transform[];
  // Because matchId is position-sensitive (text:line:col), "first" moved
  // from line 0 in `a` to line 1 in `b` -- its key no longer matches, so it
  // must fade rather than morph. This assertion locks in that documented
  // trade-off as expected behavior, not a silent regression.
  const firstTok = a.codeTokens.submobjects.find((m: any) => m.matchId === "first:0:0")!;
  assert.ok(!transforms.some((t) => t.mobject === firstTok), "'first' shifted to a new line/col and should not be treated as unchanged");
  const fadeOuts = group.animations.filter((x: any) => x instanceof FadeOut);
  const fadeIns = group.animations.filter((x: any) => x instanceof FadeIn);
  assert.ok(fadeOuts.some((f: any) => f.mobject === firstTok), "'first' from `a` should fade out");
  assert.ok(fadeIns.length > 0, "the shifted 'first' (and the new 'inserted' line) in `b` should fade in");
});

test(
  "diffTo() anchors before/after by top-left when line counts differ, so mismatched lines don't visually collide " +
  "(showcase-parity/01-hackreels regression: a real rendering defect, not the documented fade-vs-morph limitation)",
  () => {
    // The exact before/after pair from examples/showcase-parity/01-hackreels.ts
    // (4 lines -> 6 lines: an inserted parameter plus a wrapped/inserted body
    // line). The demo positions both by moveTo()-ing them to the SAME center
    // point, which is the natural thing to do and is exactly what exposed
    // the bug: two independently-self-centered Code blocks of different
    // heights don't share a line-to-y mapping, so an unmatched (inserted/
    // removed) token from one side could fade in/out at nearly the same
    // y-position as an unrelated unmatched token from the other side --
    // rendering as overlapping/ghosted text, confirmed via an actual
    // extracted golden-parity frame.
    const before = new Code(
      "function fib(n) {\n  if (n < 2) return n;\n  return fib(n - 1) + fib(n - 2);\n}",
      { language: "js", fontSize: 0.36, lineNumbers: false },
    );
    const after = new Code(
      "function fib(n, memo = {}) {\n  if (n < 2) return n;\n  memo[n] ??= fib(n - 1, memo)\n    + fib(n - 2, memo);\n  return memo[n];\n}",
      { language: "js", fontSize: 0.36, lineNumbers: false },
    );
    before.moveTo([0, -0.4, 0]);
    after.moveTo([0, -0.4, 0]);
    const beforeUL = before.getCorner(V.UL);

    before.diffTo(after);

    // `after` must now be anchored to `before`'s ORIGINAL top-left corner --
    // this is what keeps line 0 (and everything above the first divergence)
    // visually stable, instead of letting the two blocks' different total
    // heights put same-index lines at different y's (or, as in the actual
    // bug, put UNRELATED lines at the same y).
    const afterUL = after.getCorner(V.UL);
    assert.ok(
      V.distance(beforeUL, afterUL) < 1e-9,
      `after's top-left should be anchored to before's original top-left; before=${beforeUL} after=${afterUL}`,
    );

    // Concretely reproduce the observed collision: `before`'s line 2
    // ("return fib(n - 1) + fib(n - 2);", unmatched -> fades out at its own
    // position) must NOT land at the same y as `after`'s line 3
    // ("+ fib(n - 2, memo);", unmatched -> fades in at its own position) --
    // that exact pairing is what rendered as ghosted/superimposed text.
    const beforeLine2Y = before.codeLines.submobjects[2].getCenter()[1];
    const afterLine3Y = after.codeLines.submobjects[3].getCenter()[1];
    assert.ok(
      Math.abs(beforeLine2Y - afterLine3Y) > 0.05,
      `before's line 2 and after's line 3 must not visually collide; before=${beforeLine2Y} after=${afterLine3Y}`,
    );
  },
);

test("diffTo includes a Transform for the background rectangle", () => {
  const a = new Code("x", { language: "js", lineNumbers: false });
  const b = new Code("a much longer line of code here", { language: "js", lineNumbers: false });
  const group = a.diffTo(b);
  const bgTransform = group.animations.find((x: any) => x instanceof Transform && x.mobject === a.background);
  assert.ok(bgTransform, "the background rectangle should get its own resize Transform");
  assert.equal((bgTransform as any).target, b.background);
});
