import { test } from "node:test";
import assert from "node:assert/strict";
import {
  delayRender,
  continueRender,
  delayRenderUntil,
  waitForRender,
  getPendingRenders,
  _resetRenderGate,
} from "../src/core/async_gate.ts";

test("waitForRender resolves immediately when nothing pending", async () => {
  _resetRenderGate();
  await waitForRender();
  assert.equal(getPendingRenders().length, 0);
});

test("delayRender makes gate pending; continueRender clears it", async () => {
  _resetRenderGate();
  const handle = delayRender("asset-load");
  assert.equal(getPendingRenders().length, 1);
  assert.equal(getPendingRenders()[0].label, "asset-load");

  const waiting = waitForRender();
  continueRender(handle);
  await waiting;

  assert.equal(getPendingRenders().length, 0);
});

test("unresolved delayRender causes waitForRender to reject with the label", async () => {
  _resetRenderGate();
  delayRender("stuck-font");
  await assert.rejects(waitForRender(50), (err: Error) => {
    assert.match(err.message, /stuck-font/);
    assert.match(err.message, /timed out after 50ms/);
    return true;
  });
  _resetRenderGate();
});

test("delayRenderUntil resolves and leaves no pending blocker", async () => {
  _resetRenderGate();
  const result = await delayRenderUntil(Promise.resolve(42), "async-value");
  assert.equal(result, 42);
  assert.equal(getPendingRenders().length, 0);
  await waitForRender();
});

test("delayRenderUntil clears the blocker even when the promise rejects", async () => {
  _resetRenderGate();
  const p = delayRenderUntil(Promise.reject(new Error("boom")), "failing");
  await assert.rejects(p, /boom/);
  // Give the finally() microtask a chance to run.
  await Promise.resolve();
  assert.equal(getPendingRenders().length, 0);
});

test("waitForRender resolves only after BOTH concurrent delays continue", async () => {
  _resetRenderGate();
  const a = delayRender("a");
  const b = delayRender("b");
  assert.equal(getPendingRenders().length, 2);

  let resolved = false;
  const waiting = waitForRender().then(() => {
    resolved = true;
  });

  continueRender(a);
  await Promise.resolve();
  assert.equal(resolved, false, "should still be waiting after first continue");
  assert.equal(getPendingRenders().length, 1);

  continueRender(b);
  await waiting;
  assert.equal(resolved, true);
  assert.equal(getPendingRenders().length, 0);
});
