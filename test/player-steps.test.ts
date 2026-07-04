import { test } from "node:test";
import assert from "node:assert/strict";
import { Player } from "../src/player.ts";

// Mirrors test/player-presenter.test.ts's fakePlayer() pattern, but with
// playRecords (steps) instead of sections.
function fakePlayer() {
  const p: any = new Player({ fps: 10 });
  p.frames = new Array(30).fill({ width: 1, height: 1 });
  p.scene = { playRecords: [
    { index: 0, kind: "play", hash: "a", startFrame: 0, endFrame: 8 },
    { index: 1, kind: "wait", hash: "b", startFrame: 8, endFrame: 20 },
    { index: 2, kind: "play", hash: "c", startFrame: 20, endFrame: 30 },
  ] };
  return p;
}

test("stepContaining + seekToStep", () => {
  const p = fakePlayer();
  assert.equal(p.stepContaining(5).index, 0);
  assert.equal(p.stepContaining(15).index, 1);
  assert.equal(p.stepContaining(25).index, 2);
  p.seekToStep(1);
  assert.equal(p.currentFrame, 8);
  p.seekToStep(2);
  assert.equal(p.currentFrame, 20);
});

test("nextStep / prevStep navigate boundaries", () => {
  const p = fakePlayer();
  p.seek(0);
  p.nextStep(); assert.equal(p.currentFrame, 8);
  p.nextStep(); assert.equal(p.currentFrame, 20);
  p.prevStep(); assert.equal(p.currentFrame, 8);
});

test("steps() empty when no scene", () => {
  const p: any = new Player({ fps: 10 });
  assert.deepEqual(p.steps(), []);
});

test("steps navigate independently of section boundaries", () => {
  const p = fakePlayer();
  // No sections defined on this fake scene at all -- step nav must still work.
  assert.deepEqual(p.sections(), []);
  p.seek(0);
  p.nextStep();
  assert.equal(p.currentFrame, 8);
});
