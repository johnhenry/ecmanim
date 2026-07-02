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

test("getVideoObject() returns a schema.org VideoObject from metadata without a DOM", () => {
  // No DOM here: ManimPlayerElement is the Node placeholder class. It still
  // carries the DOM-free metadata -> VideoObject slice of the API.
  assert.equal(typeof (globalThis as any).document, "undefined");

  const el: any = new (ManimPlayerElement as any)();
  el.metadata = {
    name: "Sine Wave",
    description: "An animated sine wave",
    provenance: true,
  };

  const obj = el.getVideoObject();
  assert.equal(obj["@type"], "VideoObject");
  assert.equal(obj["@context"], "https://schema.org");
  assert.equal(obj.name, "Sine Wave");
  assert.equal(obj.description, "An animated sine wave");
  // provenance:true adds a manim-js creator + IPTC digital-source-type.
  assert.equal(obj.creator?.name, "manim-js");
  assert.ok(Array.isArray(obj.additionalProperty));

  // Reading back the metadata getter returns what we set.
  assert.equal(el.metadata.name, "Sine Wave");
});

// A minimal fake node that records its type/textContent and tracks children,
// mirroring just enough of the DOM for injectSchema()/appendChild().
function makeFakeNode(tag: string): any {
  return {
    tagName: tag,
    type: "",
    textContent: "",
    children: [] as any[],
    parentNode: null as any,
    appendChild(child: any) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child: any) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
  };
}

// Count how many ld+json <script> children an element has.
function ldScripts(el: any): any[] {
  return (el.children || []).filter(
    (c: any) => c && c.tagName === "script" && c.type === "application/ld+json",
  );
}

test("with a stubbed DOM, setting .metadata injects exactly one ld+json script and re-setting replaces it", () => {
  const g = globalThis as any;
  const hadHTMLElement = "HTMLElement" in g;
  const hadDocument = "document" in g;
  const savedHTMLElement = g.HTMLElement;
  const savedDocument = g.document;

  try {
    g.HTMLElement = class {};
    g.document = {
      createElement(tag: string) {
        return makeFakeNode(tag);
      },
    };

    // Get the real DOM-backed class. NB: the class is built (and cached) the
    // first time HTMLElement exists, and it `extends` whatever HTMLElement was
    // then — which may be an earlier test's bare stub. So we give each instance
    // the child-tracking DOM methods a real HTMLElement would provide, rather
    // than relying on the base class.
    g.customElements = {
      _reg: new Map<string, any>(),
      define(tag: string, cls: any) {
        this._reg.set(tag, cls);
      },
      get(tag: string) {
        return this._reg.get(tag);
      },
    };
    assert.equal(defineManimPlayer("x-meta-player"), true);
    const Cls = g.customElements.get("x-meta-player");
    const el: any = new Cls();
    Object.assign(el, makeFakeNode("manim-player"));

    // Set metadata -> one injected script.
    el.metadata = { name: "Alpha", provenance: true };
    let scripts = ldScripts(el);
    assert.equal(scripts.length, 1, "exactly one ld+json script after first set");
    const first = scripts[0];
    assert.match(first.textContent, /"@type":"VideoObject"/);
    assert.match(first.textContent, /"name":"Alpha"/);

    // Re-set metadata -> still exactly one script (replaced, not stacked).
    el.metadata = { name: "Beta" };
    scripts = ldScripts(el);
    assert.equal(scripts.length, 1, "still exactly one ld+json script after re-set");
    assert.match(scripts[0].textContent, /"name":"Beta"/);
    assert.doesNotMatch(scripts[0].textContent, /"name":"Alpha"/);

    // injectSchema() is idempotent — calling again does not add a second script.
    el.injectSchema();
    assert.equal(ldScripts(el).length, 1, "injectSchema() stays idempotent");

    // Clearing metadata removes the injected script.
    el.metadata = null;
    assert.equal(ldScripts(el).length, 0, "clearing metadata removes the script");
  } finally {
    if (hadHTMLElement) g.HTMLElement = savedHTMLElement;
    else delete g.HTMLElement;
    if (hadDocument) g.document = savedDocument;
    else delete g.document;
    delete g.customElements;
  }
});

test("getVideoObject() on the real element merges nothing dangerous when metadata is unset", () => {
  const g = globalThis as any;
  const hadHTMLElement = "HTMLElement" in g;
  const savedHTMLElement = g.HTMLElement;
  try {
    g.HTMLElement = class {};
    g.customElements = {
      _reg: new Map<string, any>(),
      define(tag: string, cls: any) { this._reg.set(tag, cls); },
      get(tag: string) { return this._reg.get(tag); },
    };
    assert.equal(defineManimPlayer("x-meta-empty"), true);
    const Cls = g.customElements.get("x-meta-empty");
    const el: any = new Cls();

    // No metadata set: getVideoObject() returns a bare VideoObject shell.
    const obj = el.getVideoObject();
    assert.equal(obj["@type"], "VideoObject");
    assert.equal(obj.name, undefined);
    // injectSchema() with no metadata is a no-op.
    assert.doesNotThrow(() => el.injectSchema());
  } finally {
    if (hadHTMLElement) g.HTMLElement = savedHTMLElement;
    else delete g.HTMLElement;
    delete g.customElements;
  }
});
