// A small signals-based reactivity core (inspired by SolidJS / Motion Canvas),
// offered as a cleaner alternative to manim's updater / always_redraw
// bookkeeping. It implements a classic push-pull dependency-tracking scheme:
//
//   - reading a signal registers the currently-running computation as a
//     dependent,
//   - writing a signal marks its dependents dirty and re-runs effects /
//     invalidates computeds.
//
// Integration helpers (`reactive`, `bind`, `signalTracker`) bridge signals to
// the existing Mobject / ValueTracker machinery so signals compose with the
// rest of the library and keep working during rendering via `update(dt)`.

import { Mobject } from "../mobject/Mobject.ts";
import { ValueTracker } from "../mobject/value_tracker.ts";
import { copyMemberwiseStyle } from "../mobject/copy_style.ts";

// --- core types ------------------------------------------------------------

/** A reactive computation (effect or computed) that depends on signals. */
interface Computation {
  /** Re-run / invalidate this computation. */
  run: () => void;
  /** Signal dependency sets this computation currently belongs to. */
  deps: Set<Set<Computation>>;
}

/**
 * A readable/writable reactive value.
 * `s()` reads (and tracks), `s(v)` / `s.set(v)` writes, `s.set(fn)` updates
 * functionally, `s.peek()` reads without tracking.
 */
export interface Signal<T> {
  (): T;
  (next: T): T;
  set(next: T | ((prev: T) => T)): T;
  peek(): T;
}

/** A read-only reactive value derived from other signals. */
export interface ReadonlySignal<T> {
  (): T;
  peek(): T;
}

// --- tracking state --------------------------------------------------------

// Stack of currently-running computations; the top is the "current" one that
// reads should register themselves against.
const computationStack: Computation[] = [];

function currentComputation(): Computation | undefined {
  return computationStack[computationStack.length - 1];
}

// Batching: while batching, notifications are collected and flushed once.
let batchDepth = 0;
const pendingComputations = new Set<Computation>();

function scheduleComputation(c: Computation): void {
  if (batchDepth > 0) {
    pendingComputations.add(c);
  } else {
    c.run();
  }
}

function flushPending(): void {
  const toRun = [...pendingComputations];
  pendingComputations.clear();
  for (const c of toRun) c.run();
}

/** Coalesce all writes inside `fn` into a single flush of dependents. */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flushPending();
  }
}

/** Run `fn` without registering any signal reads as dependencies. */
export function untrack<T>(fn: () => T): T {
  computationStack.push(undefined as unknown as Computation);
  try {
    return fn();
  } finally {
    computationStack.pop();
  }
}

// Wire the current computation up to a signal's dependent set (bidirectional so
// dependencies can be cleaned up before a recompute).
function subscribe(subscribers: Set<Computation>): void {
  const c = currentComputation();
  if (!c) return;
  subscribers.add(c);
  c.deps.add(subscribers);
}

function cleanup(c: Computation): void {
  for (const dep of c.deps) dep.delete(c);
  c.deps.clear();
}

// --- createSignal ----------------------------------------------------------

/**
 * Create a writable reactive signal.
 *
 * ```ts
 * const s = createSignal(0);
 * s();          // read (tracks the current computation)
 * s(5);         // write
 * s.set(5);     // write
 * s.set(v => v + 1); // functional update
 * s.peek();     // read without tracking
 * ```
 */
export function createSignal<T>(initial: T): Signal<T> {
  let value = initial;
  const subscribers = new Set<Computation>();

  function write(next: T): T {
    if (Object.is(next, value)) return value;
    value = next;
    // Notify a snapshot: computations may re-subscribe as they run.
    for (const c of [...subscribers]) scheduleComputation(c);
    return value;
  }

  const signal = function (this: unknown, ...args: [] | [T]): T {
    if (args.length === 0) {
      subscribe(subscribers);
      return value;
    }
    return write(args[0]);
  } as Signal<T>;

  signal.set = (next: T | ((prev: T) => T)): T =>
    write(typeof next === "function" ? (next as (prev: T) => T)(value) : next);
  signal.peek = () => value;

  return signal;
}

// --- computed --------------------------------------------------------------

/**
 * Create a memoized derived signal. It lazily recomputes only when read after
 * one of its dependencies changed; reading it inside another computation tracks
 * the dependency transitively.
 */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  let value: T;
  let dirty = true;
  const subscribers = new Set<Computation>();

  const computation: Computation = {
    deps: new Set(),
    run() {
      // A dependency changed: mark dirty (recompute lazily on next read) and
      // propagate to our own subscribers.
      if (!dirty) {
        dirty = true;
        for (const c of [...subscribers]) scheduleComputation(c);
      }
    },
  };

  function recompute(): void {
    cleanup(computation);
    computationStack.push(computation);
    try {
      value = fn();
    } finally {
      computationStack.pop();
    }
    dirty = false;
  }

  const read = function (): T {
    subscribe(subscribers);
    if (dirty) recompute();
    return value;
  } as ReadonlySignal<T>;

  read.peek = () => {
    if (dirty) recompute();
    return value;
  };

  return read;
}

// --- effect ----------------------------------------------------------------

/**
 * Run `fn` immediately, then re-run it whenever any signal it read changes.
 * Returns a disposer that stops future runs and releases dependencies.
 */
export function effect(fn: () => void): () => void {
  let disposed = false;

  const computation: Computation = {
    deps: new Set(),
    run() {
      if (disposed) return;
      cleanup(computation);
      computationStack.push(computation);
      try {
        fn();
      } finally {
        computationStack.pop();
      }
    },
  };

  computation.run();

  return () => {
    disposed = true;
    cleanup(computation);
  };
}

// --- integration: reactive (always_redraw for signals) ---------------------

/**
 * Like manim's `always_redraw`, but driven by signals. Builds the mobject once,
 * then rebuilds/rebinds it whenever any signal read inside `fn` changes.
 *
 * An internal effect marks the mobject dirty only when a dependency actually
 * changes (not every frame). The applied rebuild happens on `update(dt)` so it
 * also works during rendering, where signals may be driven by animations.
 */
export function reactive(fn: () => Mobject): Mobject {
  // Build once, tracking dependencies via the effect below.
  let fresh: Mobject | null = null;
  let dirty = false;
  let current!: Mobject;
  let first = true;

  // The effect tracks whatever signals `fn` reads; on any change it flags the
  // wrapper as dirty (and captures the freshly-built mobject to copy from).
  effect(() => {
    fresh = fn();
    if (first) {
      first = false;
    } else {
      dirty = true;
    }
  });

  current = fresh as unknown as Mobject;

  function apply(): void {
    if (!fresh) return;
    current.points = fresh.points;
    current.submobjects = fresh.submobjects;
    // Copy every style field (not a hardcoded allowlist) so custom fields on
    // a user's Mobject subclass rebuild correctly too.
    copyMemberwiseStyle(current, fresh);
  }

  current.addUpdater((_mob: Mobject) => {
    if (dirty) {
      apply();
      dirty = false;
    }
  });

  return current;
}

// --- integration: bind -----------------------------------------------------

/**
 * Attach an updater that assigns `mobject[prop] = signal()` on every
 * `update(dt)`, a simple one-way property binding from a signal (or computed).
 */
export function bind<M extends Mobject, K extends keyof M>(
  mobject: M,
  prop: K,
  signalOrComputed: ReadonlySignal<M[K]>,
): M {
  mobject.addUpdater((mob: Mobject) => {
    (mob as any)[prop] = signalOrComputed.peek();
  });
  return mobject;
}

// --- integration: signalTracker --------------------------------------------

/**
 * Adapt a numeric signal so it behaves like a `ValueTracker`
 * (`getValue`/`setValue` delegate to the signal). This lets signals drive the
 * existing animation machinery. The returned object is a real `ValueTracker`
 * whose value stays mirrored to the signal in both directions.
 *
 * Note: a `ValueTracker` can equally *drive* a signal — create an effect that
 * reads the tracker's value and writes the signal.
 */
export function signalTracker(signal: Signal<number>): ValueTracker {
  const tracker = new ValueTracker(signal.peek());

  // Keep the tracker's stored point mirrored to the signal.
  effect(() => {
    tracker.setValue(signal());
  });

  // Override so writes flow back into the signal (keeping animations working).
  tracker.setValue = function (this: ValueTracker, v: number): ValueTracker {
    this.points[0][0] = v;
    if (!Object.is(signal.peek(), v)) signal.set(v);
    return this;
  };

  return tracker;
}
