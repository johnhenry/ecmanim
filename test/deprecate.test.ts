import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { deprecate, _resetDeprecations } from "../src/core/deprecate.ts";
import * as pub from "../src/index.ts";

function capture(fn: () => void): string[] {
  const orig = console.warn;
  const calls: string[] = [];
  console.warn = (...a: unknown[]) => void calls.push(a.join(" "));
  try { fn(); } finally { console.warn = orig; }
  return calls;
}

beforeEach(() => _resetDeprecations());

test("deprecate: warns once per id", () => {
  const calls = capture(() => {
    deprecate("old-thing", "Use newThing() instead.");
    deprecate("old-thing", "Use newThing() instead.");
    deprecate("old-thing", "different message, same id");
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /old-thing/);
  assert.match(calls[0], /Use newThing\(\) instead\./);
  assert.match(calls[0], /deprecated/i);
});

test("deprecate: distinct ids each warn once", () => {
  const calls = capture(() => {
    deprecate("a", "x");
    deprecate("b", "y");
    deprecate("a", "x");
  });
  assert.equal(calls.length, 2);
});

test("deprecate: is exported from the root barrel (and so node/browser)", () => {
  assert.equal(pub.deprecate, deprecate);
  assert.equal((pub as any)._resetDeprecations, undefined);
});
