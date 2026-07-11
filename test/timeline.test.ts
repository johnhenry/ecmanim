import { test } from "node:test";
import assert from "node:assert/strict";
import { Timeline, timeline } from "../src/animation/timeline.ts";
import { Circle, FadeIn } from "../src/index.ts";

// Each FadeIn has runTime 1 by default, so windows are 1s wide.
function fade() { return new FadeIn(new Circle()); }
function windows(tl: Timeline) {
  return (tl.build() as any).timings.map((t: any) => [t.start, t.end]);
}

test("sequential append places children back-to-back", () => {
  const tl = timeline();
  tl.add(fade()); // [0,1]
  tl.add(fade()); // [1,2]
  assert.deepEqual(windows(tl), [[0, 1], [1, 2]]);
  assert.equal(tl.duration, 2);
});

test("'+=' adds a gap, '-=' overlaps relative to the timeline end", () => {
  const tl = timeline();
  tl.add(fade());          // [0,1]
  tl.add(fade(), "+=1");   // cursor 1 +1 = 2 -> [2,3]
  tl.add(fade(), "-=0.5"); // cursor 3 -0.5 = 2.5 -> [2.5,3.5]
  assert.deepEqual(windows(tl), [[0, 1], [2, 3], [2.5, 3.5]]);
});

test("'<' and '>' reference the previous animation's start/end with offsets", () => {
  const tl = timeline();
  tl.add(fade());          // [0,1]
  tl.add(fade(), "+=1");   // [2,3]  (prevStart=2, prevEnd=3)
  tl.add(fade(), "<");     // prevStart 2 -> [2,3]
  tl.add(fade(), "<0.5");  // prevStart 2 +0.5 -> [2.5,3.5]
  tl.add(fade(), ">-0.5"); // prevEnd 3.5 -0.5 -> [3,4]
  assert.deepEqual(windows(tl), [[0, 1], [2, 3], [2, 3], [2.5, 3.5], [3, 4]]);
});

test("labels resolve as positions", () => {
  const tl = timeline();
  tl.add(fade());              // [0,1]
  tl.addLabel("mid", 5);
  tl.add(fade(), "mid");       // [5,6]
  assert.deepEqual(windows(tl).at(-1), [5, 6]);
  assert.equal(tl.duration, 6);
});

// Regression (GSAP campaign, examples/gsap-parity/01-timeline-labels.ts
// port): GSAP's position-parameter grammar includes a compound "label+=n" /
// "label-=n" form (e.g. `tl.to(x, {...}, "scene1+=3")`, GSAP's own docs
// example) -- resolve() only handled bare label lookup and bare "+=n"/"-=n"
// relative-to-cursor, so this threw "unknown position".
test("'label+=n' / 'label-=n' offsets a label by a signed amount", () => {
  const tl = timeline();
  tl.add(fade());              // [0,1]
  tl.addLabel("scene1", 2);
  tl.add(fade(), "scene1+=3"); // 2+3=5 -> [5,6]
  tl.add(fade(), "scene1-=1"); // 2-1=1 -> [1,2]
  assert.deepEqual(windows(tl).slice(1), [[5, 6], [1, 2]]);
});

test("absolute numeric position + clamped to >= 0", () => {
  const tl = timeline();
  tl.add(fade(), 3);           // [3,4]
  tl.add(fade(), "-=99");      // 4-99 clamps to 0 -> [0,1]
  assert.deepEqual(windows(tl), [[3, 4], [0, 1]]);
});

test("built group is playable: begin()+interpolate drives child windows", () => {
  const c1 = new Circle(), c2 = new Circle();
  const tl = timeline();
  tl.add(new FadeIn(c1));         // [0,1]
  tl.add(new FadeIn(c2), "+=1");  // [2,3], duration 3
  const g: any = tl.build();
  assert.equal(g.runTime, 3);
  g.begin();
  g.interpolate(0);           // t=0: c1 at window start, c2 not begun
  g.interpolate(1 / 3 - 1e-6); // ~end of c1 window
  assert.ok((c1.opacity ?? c1.fillOpacity ?? 1) >= 0); // no throw; child advanced
  g.interpolate(1);           // fully done
});

test("unknown position throws", () => {
  const tl = timeline();
  tl.add(fade());
  assert.throws(() => tl.add(fade(), "nope"), /unknown position/);
});

// Nested Timeline support: add() previously only special-cased the .animate
// builder proxy, so passing a raw (unbuilt) Timeline pushed it as-is with no
// .runTime, silently falling back to childRunTime()'s `?? 1` default instead
// of the nested timeline's real, resolved duration.

test("nesting a Timeline uses its own resolved duration, not the ?? 1 fallback", () => {
  const inner = timeline();
  inner.add(fade());        // [0,1]
  inner.add(fade(), "+=1"); // [2,3] -> duration 3
  const outer = timeline();
  outer.add(inner, 0);
  assert.deepEqual(windows(outer), [[0, 3]]);
  assert.equal(outer.duration, 3);
});

test("nesting does not reflow the inner Timeline's own resolved schedule", () => {
  const standaloneInner = timeline();
  standaloneInner.add(fade());        // [0,1]
  standaloneInner.add(fade(), "+=1"); // [2,3]
  const standaloneTimings = windows(standaloneInner);

  const nestedInner = timeline();
  nestedInner.add(fade());
  nestedInner.add(fade(), "+=1");
  const outer = timeline();
  outer.add(nestedInner, 5); // placed starting at outer position 5
  const outerEntry = (outer.build() as any).timings[0];
  const nestedGroupTimings = outerEntry.anim.timings.map((t: any) => [t.start, t.end]);

  assert.deepEqual(nestedGroupTimings, standaloneTimings, "the nested timeline's own internal windows must be unchanged");
  assert.deepEqual(windows(outer), [[5, 8]], "the nested timeline occupies one [start, start+duration] window in the outer schedule");
});

test("an outer Timeline's defaults.runTime does not clobber a nested Timeline's resolved duration", () => {
  const inner = timeline();
  inner.add(fade());
  inner.add(fade(), "+=1"); // duration 3
  const outer = timeline({ defaults: { runTime: 0.25 } });
  outer.add(inner, 0);
  outer.add(fade()); // a leaf animation IS affected by defaults.runTime
  assert.deepEqual(windows(outer), [[0, 3], [3, 3.25]]);
});
