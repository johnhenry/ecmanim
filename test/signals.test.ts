import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSignal,
  computed,
  effect,
  untrack,
  batch,
  reactive,
  bind,
  signalTracker,
} from "../src/reactive/signal.ts";
import { Circle } from "../src/mobject/geometry.ts";

test("createSignal: read and write (call, .set, functional, .peek)", () => {
  const s = createSignal(0);
  assert.equal(s(), 0);
  s(5);
  assert.equal(s(), 5);
  s.set(10);
  assert.equal(s(), 10);
  s.set((v) => v + 1);
  assert.equal(s(), 11);
  assert.equal(s.peek(), 11);
});

test("computed: recomputes only when a dependency changes", () => {
  const a = createSignal(2);
  let count = 0;
  const doubled = computed(() => {
    count++;
    return a() * 2;
  });
  // Reading twice without a change computes once (memoized).
  assert.equal(doubled(), 4);
  assert.equal(doubled(), 4);
  assert.equal(count, 1);
  // Changing a dependency invalidates; next read recomputes.
  a.set(3);
  assert.equal(doubled(), 6);
  assert.equal(count, 2);
});

test("effect: re-runs on dependency change and not otherwise", () => {
  const s = createSignal(1);
  const unrelated = createSignal(100);
  let runs = 0;
  let seen = 0;
  effect(() => {
    runs++;
    seen = s();
  });
  assert.equal(runs, 1); // immediate run
  assert.equal(seen, 1);
  s.set(2);
  assert.equal(runs, 2);
  assert.equal(seen, 2);
  // Writing an unread signal must not re-run the effect.
  unrelated.set(200);
  assert.equal(runs, 2);
});

test("effect: disposer stops further runs", () => {
  const s = createSignal(0);
  let runs = 0;
  const dispose = effect(() => {
    s();
    runs++;
  });
  assert.equal(runs, 1);
  dispose();
  s.set(1);
  assert.equal(runs, 1);
});

test("untrack: prevents dependency tracking", () => {
  const s = createSignal(0);
  let runs = 0;
  effect(() => {
    runs++;
    untrack(() => s());
  });
  assert.equal(runs, 1);
  s.set(5);
  assert.equal(runs, 1); // not re-run because read was untracked
});

test("diamond dependency computes correctly and once per change", () => {
  const a = createSignal(1);
  const b = computed(() => a() + 1);
  const c = computed(() => a() * 2);
  let dCount = 0;
  const d = computed(() => {
    dCount++;
    return b() + c();
  });
  assert.equal(d(), (1 + 1) + (1 * 2)); // 4
  assert.equal(dCount, 1);
  a.set(4);
  assert.equal(d(), (4 + 1) + (4 * 2)); // 13
  // Recomputed exactly once for the change (memoized, not per-path).
  assert.equal(dCount, 2);
});

test("batch: coalesces notifications", () => {
  const a = createSignal(1);
  const b = createSignal(2);
  let runs = 0;
  effect(() => {
    runs++;
    a();
    b();
  });
  assert.equal(runs, 1);
  batch(() => {
    a.set(10);
    b.set(20);
  });
  assert.equal(runs, 2); // single re-run despite two writes
});

test("reactive: rebuilds a Circle when its radius signal changes on update", () => {
  const r = createSignal(1);
  const mob = reactive(() => new Circle({ radius: r() }));
  assert.equal((mob as any).radius, 1);
  const w1 = mob.getWidth();
  r.set(2);
  mob.update(0); // apply the pending rebuild
  assert.equal((mob as any).radius, 2);
  assert.ok(mob.getWidth() > w1 * 1.5); // geometry actually grew
});

test("reactive: rebuild copies custom fields too, not just the old hardcoded allowlist", () => {
  const n = createSignal(1);
  const mob = reactive(() => {
    const c: any = new Circle({ radius: 1 });
    c.myCustomField = n();
    return c;
  });
  assert.equal((mob as any).myCustomField, 1);
  n.set(5);
  mob.update(0);
  assert.equal((mob as any).myCustomField, 5);
});

test("bind: sets a mobject property from a signal on update", () => {
  const opacity = createSignal(1);
  const c = new Circle();
  bind(c, "opacity", opacity);
  opacity.set(0.25);
  c.update(0);
  assert.equal(c.opacity, 0.25);
});

test("signalTracker: mirrors a numeric signal as a ValueTracker", () => {
  const s = createSignal(3);
  const tracker = signalTracker(s);
  assert.equal(tracker.getValue(), 3);
  // Signal drives the tracker.
  s.set(7);
  assert.equal(tracker.getValue(), 7);
  // Tracker writes flow back into the signal.
  tracker.setValue(9);
  assert.equal(s(), 9);
  assert.equal(tracker.getValue(), 9);
});
