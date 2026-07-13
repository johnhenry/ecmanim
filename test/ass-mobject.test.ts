// ASS/SSA subtitle player (v1): golden-frame regression tests over the 14
// synthetic fixtures in examples/ass-parity/fixtures/, one feature focus
// each. Mirrors test/snapshot.test.ts's captureFrames+matchSnapshot shape
// (tight-tolerance direct render, no video/ffmpeg) -- ASS output is
// deterministic vector Text driven entirely by ecmanim's own font pipeline,
// same as the reasoning behind that file's own goldens, just with real text
// this time (loadVectorFont() is called explicitly below since
// captureFrames bypasses render()'s own automatic font-loading step).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Scene } from "../src/scene/Scene.ts";
import { loadASS } from "../src/mobject/ass_mobject.ts";
import { loadVectorFont } from "../src/renderer/fonts-node.ts";
import { captureFrames, matchSnapshot, loadNapiCanvas } from "./_snapshot_util.ts";

const canvasAvailable = await loadNapiCanvas().then((m) => !!m);
if (canvasAvailable) await loadVectorFont().catch(() => null);

function fixtureText(name: string): string {
  return readFileSync(new URL(`../examples/ass-parity/fixtures/${name}`, import.meta.url), "utf8");
}

function fixtureScene(fixtureName: string, waitSeconds: number, width = 12): any {
  return class extends Scene {
    async construct() {
      const subs = loadASS(fixtureText(fixtureName), { width });
      subs.attachTo(this);
      await this.wait(waitSeconds);
    }
  };
}

const FPS = 15;
const frameAt = (seconds: number) => Math.round(seconds * FPS);

interface Case { name: string; fixture: string; waitSeconds: number; frames: Record<string, number>; width?: number }

const CASES: Case[] = [
  { name: "01-minimal", fixture: "01-minimal.ass", waitSeconds: 2, frames: { line: frameAt(1) } },
  { name: "02-pos-alignment", fixture: "02-pos-alignment.ass", waitSeconds: 1, width: 13, frames: { all9: frameAt(0.5) } },
  { name: "03-move", fixture: "03-move.ass", waitSeconds: 10, width: 13, frames: { untimedMid: frameAt(2.5), timedMid: frameAt(7.5) } },
  { name: "04-fade-simple", fixture: "04-fade-simple.ass", waitSeconds: 5, width: 13, frames: { fadeIn: frameAt(0.5), hold: frameAt(2.5), fadeOut: frameAt(4.5) } },
  { name: "05-fade-complex", fixture: "05-fade-complex.ass", waitSeconds: 10, width: 13, frames: { transitionIn: frameAt(0.5), hold: frameAt(5), transitionOut: frameAt(8.5) } },
  { name: "06-colors-alpha", fixture: "06-colors-alpha.ass", waitSeconds: 10, width: 13, frames: { colors: frameAt(1), alpha: frameAt(6) } },
  { name: "07-scale-font", fixture: "07-scale-font.ass", waitSeconds: 10, width: 13, frames: { scale: frameAt(1), fontFallback: frameAt(6) } },
  { name: "08-toggles-reset", fixture: "08-toggles-reset.ass", waitSeconds: 10, width: 13, frames: { toggles: frameAt(1), reset: frameAt(6) } },
  { name: "09-rotation", fixture: "09-rotation.ass", waitSeconds: 10, width: 13, frames: { frz: frameAt(1), fr: frameAt(6) } },
  { name: "10-karaoke-k", fixture: "10-karaoke-k.ass", waitSeconds: 4, width: 10, frames: { midSyllable: frameAt(1.25), allSung: frameAt(3.5) } },
  { name: "11-wrap-newlines", fixture: "11-wrap-newlines.ass", waitSeconds: 10, width: 13, frames: { hardBreak: frameAt(1), softBreak: frameAt(6) } },
  { name: "12-multi-style-layers", fixture: "12-multi-style-layers.ass", waitSeconds: 1, width: 13, frames: { all3: frameAt(0.5) } },
  { name: "13-legacy-ssa", fixture: "13-legacy-ssa.ass", waitSeconds: 1, width: 13, frames: { line: frameAt(0.5) } },
  { name: "14-malformed-tolerant", fixture: "14-malformed-tolerant.ass", waitSeconds: 15, width: 13, frames: { unknownTag: frameAt(1), unterminatedBrace: frameAt(6), missingStyle: frameAt(11) } },
  // v1.5 (Stage 3): \t transform, rectangular \clip/\iclip, \kf/\K/\ko sweep
  // karaoke, \org-pivoted rotation/shear, \be/\blur -- see task #29. Times
  // avoid each dialogue's exact end boundary (cue visibility is [start,end),
  // so t=durationSeconds itself samples the NEXT/blank state, not a bug).
  { name: "15-transform-t", fixture: "15-transform-t.ass", waitSeconds: 4, width: 13, frames: { start: frameAt(0), mid: frameAt(2), nearEnd: frameAt(3.9) } },
  { name: "16-clip-rect", fixture: "16-clip-rect.ass", waitSeconds: 4, width: 13, frames: { clip: frameAt(1), iclip: frameAt(3) } },
  { name: "17-clip-vector", fixture: "17-clip-vector.ass", waitSeconds: 2, width: 13, frames: { unclipped: frameAt(1) } },
  { name: "18-karaoke-kf", fixture: "18-karaoke-kf.ass", waitSeconds: 4, width: 10, frames: { sweep25: frameAt(0.5), sweep50: frameAt(1.0), sweep75: frameAt(1.5), kAliasMidSweep: frameAt(2.15) } },
  { name: "19-karaoke-ko", fixture: "19-karaoke-ko.ass", waitSeconds: 3, width: 10, frames: { syl0: frameAt(0.4), syl1: frameAt(1.4), syl2: frameAt(2.4) } },
  { name: "20-org-shear", fixture: "20-org-shear.ass", waitSeconds: 4, width: 13, frames: { orgRotation: frameAt(1), orgShear: frameAt(3) } },
  { name: "21-blur-shadow", fixture: "21-blur-shadow.ass", waitSeconds: 4, width: 13, frames: { blurred: frameAt(1), shadowed: frameAt(3) } },
  // v2 (Stage 4): \p<n> drawing-mode dialogue lines -- see task #31.
  { name: "22-drawing-p", fixture: "22-drawing-p.ass", waitSeconds: 4, width: 13, frames: { triangle: frameAt(1), rotated: frameAt(3) } },
  { name: "23-drawing-bspline", fixture: "23-drawing-bspline.ass", waitSeconds: 2, width: 13, frames: { blob: frameAt(1) } },
];

for (const c of CASES) {
  test(`ass-mobject: ${c.name}`, { skip: !canvasAvailable && "@napi-rs/canvas not available" }, async () => {
    const scene = fixtureScene(c.fixture, c.waitSeconds, c.width);
    const frameIdx = Object.values(c.frames);
    const caps = await captureFrames(scene, frameIdx, { width: 480, height: 270 });
    for (const [label, idx] of Object.entries(c.frames)) {
      const cap = caps.get(idx);
      assert.ok(cap, `frame ${idx} was captured`);
      const failure = await matchSnapshot(`ass/${c.name}.${label}`, cap!);
      assert.equal(failure, null, failure ?? undefined);
    }
  });
}

// Fixture 14 specifically exercises "never throws on malformed input" --
// assert that directly too, not just that a snapshot matches.
test("ass-mobject: malformed input never throws", { skip: !canvasAvailable && "@napi-rs/canvas not available" }, async () => {
  assert.doesNotThrow(() => loadASS(fixtureText("14-malformed-tolerant.ass"), { width: 10 }));
});

function alphaAt(cap: { data: Uint8ClampedArray; width: number }, x: number, y: number): number {
  return cap.data[(y * cap.width + x) * 4 + 3];
}

// Rectangular \clip/\iclip: per the plan's verification guidance, confirm
// the mask geometry itself (not just eyeball the golden) by sampling alpha=0
// at a pixel that's unambiguously on the clipped-away side of the 960/1920
// (PlayResX) split -- \clip(0,0,960,1080) keeps the LEFT half, \iclip(...)
// keeps the RIGHT half.
test("ass-mobject: 16-clip-rect masks the correct half (sampled alpha)", { skip: !canvasAvailable && "@napi-rs/canvas not available" }, async () => {
  const scene = fixtureScene("16-clip-rect.ass", 4, 13);
  const caps = await captureFrames(scene, [frameAt(1), frameAt(3)], { width: 480, height: 270 });
  const clipCap = caps.get(frameAt(1))!;
  const iclipCap = caps.get(frameAt(3))!;
  assert.equal(alphaAt(clipCap, 400, 135), 0, "\\clip(0,0,960,1080) must hide the right half");
  assert.equal(alphaAt(iclipCap, 80, 135), 0, "\\iclip(0,0,960,1080) must hide the left half");
});

// Vector-form \clip/\iclip (a drawing-command shape, not 4 numeric args) is a
// documented v1.5 non-goal (needs the v2 drawing parser) -- confirm it's
// recognized and warned about by name, distinctly from "no clip at all", and
// that the line still renders (unclipped) rather than being dropped.
test("ass-mobject: 17-clip-vector warns and renders unclipped", { skip: !canvasAvailable && "@napi-rs/canvas not available" }, async () => {
  const subs = loadASS(fixtureText("17-clip-vector.ass"), { width: 13 });
  assert.ok(
    subs.warnings.some((w) => w.includes("vector-drawing shape is not yet implemented")),
    `expected a vector-clip warning, got: ${JSON.stringify(subs.warnings)}`,
  );
});
