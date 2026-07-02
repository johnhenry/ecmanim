/**
 * Remotion-style async-asset gate.
 *
 * A standalone registry of pending render blockers. A renderer can call
 * `waitForRender()` to block until every registered blocker has been released
 * (or a timeout elapses). Self-contained and safe in both Node and the browser
 * (no node-only imports).
 */

export interface DelayHandle {
  id: number;
  label: string;
  createdAt: number;
}

type Waiter = {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

const pending = new Map<number, DelayHandle>();
const waiters = new Set<Waiter>();

let idCounter = 0;
let clockFallback = 0;

function now(): number {
  // Date.now is available in Node and browsers; fall back to a counter if not.
  if (typeof Date !== "undefined" && typeof Date.now === "function") {
    return Date.now();
  }
  return ++clockFallback;
}

/** Register a pending render blocker. Returns a handle to release later. */
export function delayRender(label = "delayRender"): DelayHandle {
  const handle: DelayHandle = { id: ++idCounter, label, createdAt: now() };
  pending.set(handle.id, handle);
  return handle;
}

/** Release a previously-registered blocker. */
export function continueRender(handle: DelayHandle): void {
  if (!handle || !pending.has(handle.id)) {
    return;
  }
  pending.delete(handle.id);
  notifyWaiters();
}

/**
 * Register an existing promise as a blocker. Delays render until the promise
 * settles (success OR failure), then releases the blocker. Returns the same
 * promise so callers can chain.
 */
export function delayRenderUntil<T>(promise: Promise<T>, label = "delayRenderUntil"): Promise<T> {
  const handle = delayRender(label);
  // Release when the promise settles either way. We attach our own handlers to
  // a derived chain so the gate is cleared regardless of outcome, and swallow
  // that derived chain's rejection (the caller owns the returned promise's
  // rejection). The original `promise` is returned untouched so callers can
  // chain / catch as usual.
  Promise.resolve(promise).then(
    () => continueRender(handle),
    () => continueRender(handle),
  );
  return promise;
}

/**
 * Resolve when all pending blockers are cleared. Rejects if `timeoutMs` elapses
 * while blockers remain, with an error naming the still-pending labels.
 * Resolves immediately if nothing is pending.
 */
export function waitForRender(timeoutMs = 30000): Promise<void> {
  if (pending.size === 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = { resolve, reject, timer: null };

    waiter.timer = setTimeout(() => {
      waiters.delete(waiter);
      const labels = getPendingRenders()
        .map((h) => h.label)
        .join(", ");
      reject(
        new Error(
          `waitForRender timed out after ${timeoutMs}ms; still pending: ${labels}`,
        ),
      );
    }, timeoutMs);

    waiters.add(waiter);
  });
}

function notifyWaiters(): void {
  if (pending.size !== 0) {
    return;
  }
  for (const waiter of waiters) {
    if (waiter.timer !== null) {
      clearTimeout(waiter.timer);
    }
    waiter.resolve();
  }
  waiters.clear();
}

/** Introspection: list currently pending handles. */
export function getPendingRenders(): DelayHandle[] {
  return Array.from(pending.values());
}

/** Test helper: clear all pending blockers and waiters. */
export function _resetRenderGate(): void {
  pending.clear();
  for (const waiter of waiters) {
    if (waiter.timer !== null) {
      clearTimeout(waiter.timer);
    }
  }
  waiters.clear();
  idCounter = 0;
  clockFallback = 0;
}
