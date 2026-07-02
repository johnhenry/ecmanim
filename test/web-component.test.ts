import { test } from "node:test";
import assert from "node:assert/strict";

import { ManimPlayerElement, defineManimPlayer } from "../src/web-component.ts";

test("importing the module does not throw and exports are present", () => {
  assert.equal(typeof ManimPlayerElement, "function");
  assert.equal(typeof defineManimPlayer, "function");
});

test("defineManimPlayer() returns false under Node (no customElements) and does not throw", () => {
  // Guard: this test is meaningful only when there is no DOM. Under plain Node,
  // customElements/HTMLElement are undefined, so registration must no-op.
  assert.equal(typeof (globalThis as any).customElements, "undefined");
  let result: boolean;
  assert.doesNotThrow(() => {
    result = defineManimPlayer();
  });
  assert.equal(result!, false);
});

test("defineManimPlayer('custom-tag') also returns false with no DOM", () => {
  assert.equal(defineManimPlayer("x-nope"), false);
});

test("ManimPlayerElement placeholder exposes observedAttributes", () => {
  const attrs = (ManimPlayerElement as any).observedAttributes;
  assert.ok(Array.isArray(attrs));
  for (const a of ["quality", "fps", "background", "autoplay", "loop", "controls", "width", "height"]) {
    assert.ok(attrs.includes(a), `expected observedAttributes to include ${a}`);
  }
});

test("with a stubbed DOM, defineManimPlayer registers and returns true", () => {
  const g = globalThis as any;
  const hadHTMLElement = "HTMLElement" in g;
  const hadCustomElements = "customElements" in g;
  const savedHTMLElement = g.HTMLElement;
  const savedCustomElements = g.customElements;

  const registry = new Map<string, any>();
  try {
    g.HTMLElement = class {};
    g.customElements = {
      define(tag: string, cls: any) {
        registry.set(tag, cls);
      },
      get(tag: string) {
        return registry.get(tag);
      },
    };

    const ok = defineManimPlayer("x-test-player");
    assert.equal(ok, true);
    assert.ok(registry.has("x-test-player"), "element should be registered in the stub registry");

    // The registered class should extend our stub HTMLElement.
    const registered = registry.get("x-test-player");
    assert.equal(typeof registered, "function");
    assert.ok(registered.prototype instanceof g.HTMLElement);

    // Re-defining the same tag returns true without throwing (already defined).
    assert.equal(defineManimPlayer("x-test-player"), true);
  } finally {
    // Restore globals so we don't leak DOM into other tests.
    if (hadHTMLElement) g.HTMLElement = savedHTMLElement;
    else delete g.HTMLElement;
    if (hadCustomElements) g.customElements = savedCustomElements;
    else delete g.customElements;
  }
});
