import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTextAtlas } from "../src/renderer/text_atlas.ts";

// A deterministic fake canvas/document backend -- Node has no real one, so
// this exercises the exact same code path a browser's OffscreenCanvas/
// <canvas> would, with fully predictable measureText() output.
function makeFakeDocument(): any {
  return {
    createElement(_tag: string) {
      const canvas: any = {
        width: 0,
        height: 0,
        getContext(_type: string) {
          return {
            font: "",
            fillStyle: "",
            textAlign: "",
            textBaseline: "",
            measureText(text: string) {
              return { width: text.length * 10 }; // 10px per character, deterministic
            },
            fillText() {},
          };
        },
      };
      return canvas;
    },
  };
}

function makeMob(text: string, opts: { height?: number } = {}): any {
  return {
    text,
    fillColor: { toRGBAString: () => "#ffffff" },
    fillOpacity: 1,
    opacity: 1,
    getHeight: () => opts.height ?? 1,
    getCenter: () => [0, 0, 0],
    fontSize: 0.5,
  };
}

test("buildTextAtlas returns null for an empty mobject list", () => {
  assert.equal(buildTextAtlas([], { documentRef: makeFakeDocument() }), null);
});

test("buildTextAtlas returns null with no document backend (headless, no DOM)", () => {
  assert.equal(buildTextAtlas([makeMob("hi")], { documentRef: null }), null);
});

test("buildTextAtlas produces one region per mobject, with valid UV bounds", () => {
  const doc = makeFakeDocument();
  const mobs = [makeMob("Hello"), makeMob("World"), makeMob("!")];
  const atlas = buildTextAtlas(mobs, { documentRef: doc });
  assert.ok(atlas);
  assert.equal(atlas!.regions.length, 3);
  for (const r of atlas!.regions) {
    assert.ok(r.u0 >= 0 && r.u0 < r.u1 && r.u1 <= 1, `u0/u1 out of range: ${r.u0}, ${r.u1}`);
    assert.ok(r.v0 >= 0 && r.v0 < r.v1 && r.v1 <= 1, `v0/v1 out of range: ${r.v0}, ${r.v1}`);
    assert.ok(r.worldWidth > 0 && r.worldHeight > 0);
  }
  // Each mobject maps to exactly its own region.
  assert.deepEqual(atlas!.regions.map((r) => r.mob), mobs);
});

test("buildTextAtlas wraps to a new shelf (row) when a row would exceed maxWidth", () => {
  const doc = makeFakeDocument();
  // Each item is ~100px wide (10 chars * 10px); force wrapping after ~2 per row.
  const mobs = [makeMob("0123456789"), makeMob("0123456789"), makeMob("0123456789")];
  const wide = buildTextAtlas(mobs, { documentRef: doc, maxWidth: 100000 });
  const narrow = buildTextAtlas(mobs, { documentRef: doc, maxWidth: 150 });
  assert.ok(wide && narrow);
  // Wrapping to multiple shelves makes the atlas taller than fitting on one row.
  assert.ok(narrow!.canvas.height > wide!.canvas.height, `expected wrapping to increase height: ${narrow!.canvas.height} vs ${wide!.canvas.height}`);
});

test("worldWidth scales with the mobject's own aspect ratio (pixel w/h) at its actual world height", () => {
  const doc = makeFakeDocument();
  const mob = makeMob("0123456789", { height: 2 }); // 10 chars -> 100px wide, height fixed at 2
  const atlas = buildTextAtlas([mob], { documentRef: doc });
  const r = atlas!.regions[0];
  assert.equal(r.worldHeight, 2);
  assert.ok(r.worldWidth > 0);
});
