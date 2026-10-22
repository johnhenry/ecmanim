// Clip: nested animation with its own local clock (epic #61, #72).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Clip } from "../src/mobject/clip.ts";
import { Skeleton } from "../src/mobject/skeleton.ts";
import { poseTrack } from "../src/animation/pose.ts";
import { Group, Mobject } from "../src/mobject/Mobject.ts";
import { Dot } from "../src/mobject/geometry.ts";
import { registerBuiltins } from "../src/plugins/builtins.ts";
import { registry } from "../src/plugins/registry.ts";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

/** Records every setTime call; stands in for Lottie / particle presets. */
class Probe extends Group {
  times: number[] = [];
  setTime(t: number) { this.times.push(t); return this; }
  override copy(): this { const c = super.copy(); c.times = []; return c; }
  get last() { return this.times[this.times.length - 1]; }
}

test("localTime: loop wraps (incl. negative raw time), speed and startOffset apply", () => {
  const c = new Clip(new Probe(), { mode: "loop", duration: 2 });
  near(c.localTime(0), 0);
  near(c.localTime(1.5), 1.5);
  near(c.localTime(2), 0);
  near(c.localTime(5.25), 1.25);
  const f = new Clip(new Probe(), { mode: "loop", duration: 2, speed: 2 });
  near(f.localTime(1.25), 0.5);
  const o = new Clip(new Probe(), { mode: "loop", duration: 2, startOffset: 1.5 });
  near(o.localTime(1), 0.5);
  const neg = new Clip(new Probe(), { mode: "loop", duration: 2, speed: -1 });
  near(neg.localTime(0.5), 1.5);
});

test("localTime: once-hold clamps to [0, duration]", () => {
  const c = new Clip(new Probe(), { mode: "once-hold", duration: 2 });
  near(c.localTime(-1), 0);
  near(c.localTime(1), 1);
  near(c.localTime(9), 2);
});

test("once-hide hides after the end (and before the start), shows inside", () => {
  const p = new Probe();
  const c = new Clip(p, { mode: "once-hide", duration: 1 });
  assert.equal(c.isVisibleAt(0.5), true);
  assert.equal(c.isVisibleAt(1), true);
  assert.equal(c.isVisibleAt(1.01), false);
  c.setTime(0.5);
  assert.equal(c.submobjects.length, 1);
  c.setTime(2);
  assert.equal(c.submobjects.length, 0, "hidden clips render nothing");
  assert.equal(p.times.length, 1, "hidden content is not evaluated");
  c.setTime(0.25);
  assert.equal(c.submobjects.length, 1);
  assert.equal(c.submobjects[0], p);
  near(p.last, 0.25);
});

test("single-frame pins the content at startOffset regardless of time", () => {
  const p = new Probe();
  const c = new Clip(p, { mode: "single-frame", startOffset: 0.7, duration: 2 });
  for (const t of [0, 1, 99]) { c.setTime(t); near(p.last, 0.7); }
  near(c.localTime(5), 0.7);
});

test("no duration: unbounded, linear local time", () => {
  const c = new Clip(new Probe(), { mode: "loop" });
  near(c.localTime(12.5), 12.5);
});

test("setTime/seek is pure of history (shuffled order, same results)", () => {
  const mk = () => { const p = new Probe(); return [new Clip(p, { mode: "loop", duration: 1.5, speed: 1.3 }), p] as const; };
  const [a, pa] = mk(); const [b, pb] = mk();
  const ts = [0.2, 3.1, 0.9, 7.7, 1.4];
  const ra = ts.map((t) => (a.seek(t), pa.last));
  const rb = new Map<number, number>();
  for (const t of [...ts].reverse()) { b.setTime(t); rb.set(t, pb.last); }
  ts.forEach((t, i) => near(ra[i], rb.get(t)!));
});

test("builder content receives local time", () => {
  const seen: number[] = [];
  const c = new Clip((t) => seen.push(t), { mode: "once-hold", duration: 1, speed: 0.5 });
  c.setTime(1); c.setTime(10);
  near(seen[0], 0.5); near(seen[1], 1);
});

test("update(dt) advances the clip's own clock and scales dt by speed", () => {
  const p = new Probe();
  const c = new Clip(p, { mode: "loop", duration: 10, speed: 2 });
  c.update(0.25); c.update(0.25);
  near(p.last, 1);
  assert.equal(p.times.length, 2, "child evaluated once per update, not re-driven by default recursion");
});

test("update respects updatingSuspended; explicit seek still works", () => {
  const p = new Probe();
  const c = new Clip(p, { duration: 10 });
  c.suspendUpdating();
  c.update(1);
  assert.equal(p.times.length, 0);
  c.resumeUpdating();
  c.update(1);
  near(p.last, 1, 1e-9);
  c.suspendUpdating();
  c.seek(4);
  near(p.last, 4);
});

test("seek then update continues from the sought time", () => {
  const p = new Probe();
  const c = new Clip(p, { duration: 10 });
  c.seek(3); c.update(0.5);
  near(p.last, 3.5);
});

test("nested clips compose speed and offsets", () => {
  const p = new Probe();
  const inner = new Clip(p, { mode: "loop", duration: 1, speed: 2 });
  const outer = new Clip(inner, { mode: "loop", duration: 4, speed: 0.5, startOffset: 1 });
  outer.setTime(1);   // outer local = 1*0.5+1 = 1.5 ; inner = 1.5*2 = 3 -> wraps to 0
  near(p.last, 0);
  outer.setTime(1.25); // outer 1.625 ; inner 3.25 -> 0.25
  near(p.last, 0.25);
  outer.update(0.5);   // clock 1.75 -> 1.875 -> 3.75 -> 0.75
  near(p.last, 0.75);
});

test("drives a Skeleton via its bound pose track", () => {
  const s = new Skeleton([{ id: "a", parent: null, length: 1, angle: 0 }]);
  s.bindPoseTrack(poseTrack([
    { t: 0, value: { bones: { a: { angle: 0 } } } },
    { t: 1, value: { bones: { a: { angle: 1 } } } },
  ]));
  const c = new Clip(s, { mode: "loop", duration: 1, speed: 1 });
  c.setTime(0.5);
  near(s.model.getPose().bones.a.angle, 0.5, 1e-6);
  c.setTime(1.5);
  near(s.model.getPose().bones.a.angle, 0.5, 1e-6);
});

test("non-time-driven children are left alone", () => {
  const d = new Dot();
  const c = new Clip([d, new Probe()], { duration: 1 });
  c.setTime(0.3);
  assert.equal(c.submobjects.length, 2);
});

test("copy(): independent clock, re-armed driver, shared builder; original unaffected", () => {
  const p = new Probe();
  const c = new Clip(p, { mode: "loop", duration: 2 });
  c.update(0.5);
  const k = c.copy();
  assert.notEqual(k, c);
  const kp = k.submobjects[0] as Probe;
  assert.notEqual(kp, p);
  k.update(0.5);
  near(kp.last, 1);
  near(p.last, 0.5, 1e-9);
  assert.equal(k.hasUpdaters(), true, "copy keeps driving itself");
  assert.equal(k.getUpdaters().length, 1);
});

test("copy() of a hidden once-hide clip keeps content restorable", () => {
  const c = new Clip(new Probe(), { mode: "once-hide", duration: 1 });
  c.setTime(5);
  const k = c.copy();
  assert.equal(k.submobjects.length, 0);
  k.setTime(0.5);
  assert.equal(k.submobjects.length, 1);
  assert.equal(c.submobjects.length, 0);
});

test("hashExtra changes with clock/config so wait() fingerprints don't go stale", () => {
  const c = new Clip(new Probe(), { duration: 2 });
  const h = () => (c.getUpdaters()[0] as any).hashExtra() as string;
  const h0 = h();
  c.update(0.5);
  assert.notEqual(h(), h0);
  const c2 = new Clip(new Probe(), { duration: 2, speed: 3 });
  assert.notEqual((c2.getUpdaters()[0] as any).hashExtra(), h0);
});

test("isolate option marks the clip as a CompositeGroup layer; default does not", () => {
  assert.equal((new Clip(new Probe()) as any)._isCompositeGroup, undefined);
  assert.equal((new Clip(new Probe(), { isolate: true }) as any)._isCompositeGroup, true);
});

test("validation: bad duration / speed throw", () => {
  assert.throws(() => new Clip(new Probe(), { duration: 0 }));
  assert.throws(() => new Clip(new Probe(), { speed: NaN }));
  assert.throws(() => new Clip(new Probe(), { mode: "nope" as any }));
});

test("registerBuiltins registers Clip", () => {
  registerBuiltins();
  assert.equal(registry.get("mobject", "Clip"), Clip);
  assert.ok(new Clip(new Probe()) instanceof Mobject);
});
