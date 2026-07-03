import { test } from "node:test";
import assert from "node:assert/strict";

import { attachInteractiveCamera, pickAt } from "../src/studio/interactive.ts";
import { Camera } from "../src/renderer/CanvasRenderer.ts";
import { ManimChartElement, defineManimChart } from "../src/studio/chart_element.ts";

// A minimal fake canvas: records addEventListener/removeEventListener calls in
// a type->Set map and exposes dispatch(type, ev) to invoke every live handler,
// mirroring how a real EventTarget would fan events out to listeners.
function makeFakeCanvas(): any {
  const listeners = new Map<string, Set<(ev: any) => void>>();
  return {
    width: 800,
    height: 450,
    style: {},
    listeners,
    getBoundingClientRect() {
      return { left: 0, top: 0 };
    },
    addEventListener(type: string, fn: any) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: any) {
      listeners.get(type)?.delete(fn);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    dispatch(type: string, ev: any) {
      for (const fn of listeners.get(type) ?? []) fn(ev);
    },
  };
}

function makeFakeMobject(min: number[], max: number[]): any {
  // `submobjects: []` matters for the <manim-chart> tests below: renderScene()'s
  // internal collect() walks `m.submobjects` unconditionally, so a bare object
  // without it throws when CanvasRenderer actually renders these fakes.
  return { getBoundingBox: () => ({ min, max }), submobjects: [] };
}

// --- pickAt() -----------------------------------------------------------

test("pickAt() returns the mobject whose projected bounding box contains the pixel", () => {
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const mob = makeFakeMobject([-1, -1, 0], [1, 1, 0]);
  const [cx, cy] = camera.toPixel([0, 0, 0]);
  const hit = pickAt(cx, cy, [mob], camera);
  assert.equal(hit?.mobject, mob);
  assert.equal(hit?.index, 0);
});

test("pickAt() returns null when the pixel misses every mobject's box", () => {
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const mob = makeFakeMobject([-1, -1, 0], [1, 1, 0]);
  const hit = pickAt(0, 0, [mob], camera);
  assert.equal(hit, null);
});

test("pickAt() prefers the topmost (last-drawn) mobject on overlap", () => {
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const bottom = makeFakeMobject([-1, -1, 0], [1, 1, 0]);
  const top = makeFakeMobject([-1, -1, 0], [1, 1, 0]);
  const [cx, cy] = camera.toPixel([0, 0, 0]);
  const hit = pickAt(cx, cy, [bottom, top], camera);
  assert.equal(hit?.mobject, top);
  assert.equal(hit?.index, 1);
});

test("mobjects without getBoundingBox are skipped, not thrown on", () => {
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const noBox = {};
  const mob = makeFakeMobject([-1, -1, 0], [1, 1, 0]);
  const [cx, cy] = camera.toPixel([0, 0, 0]);
  let hit: any;
  assert.doesNotThrow(() => {
    hit = pickAt(cx, cy, [mob, noBox], camera);
  });
  assert.equal(hit?.mobject, mob);
});

// --- attachInteractiveCamera(): 2D pan -----------------------------------

test("2D drag pans camera.frameCenter by the expected world-space amount", () => {
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const canvas = makeFakeCanvas();
  let renderCalls = 0;
  const handle = attachInteractiveCamera(canvas, camera, { render: () => renderCalls++ });

  canvas.dispatch("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
  canvas.dispatch("pointermove", { clientX: 150, clientY: 120, pointerId: 1 });

  const dx = 50;
  const dy = 20;
  const expectedWorldDx = (-dx / camera.pixelWidth) * camera.frameWidth;
  const expectedWorldDy = (dy / camera.pixelHeight) * camera.frameHeight;
  assert.ok(Math.abs(camera.frameCenter[0] - expectedWorldDx) < 1e-9);
  assert.ok(Math.abs(camera.frameCenter[1] - expectedWorldDy) < 1e-9);
  assert.equal(renderCalls, 1);

  handle.detach();
});

test("detach() removes listeners so further drags are no-ops", () => {
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const canvas = makeFakeCanvas();
  let renderCalls = 0;
  const handle = attachInteractiveCamera(canvas, camera, { render: () => renderCalls++ });
  handle.detach();

  canvas.dispatch("pointerdown", { clientX: 100, clientY: 100, pointerId: 1 });
  canvas.dispatch("pointermove", { clientX: 150, clientY: 120, pointerId: 1 });

  assert.deepEqual(camera.frameCenter, [0, 0, 0]);
  assert.equal(renderCalls, 0);
});

// --- attachInteractiveCamera(): wheel zoom -------------------------------

test("wheel zooms camera.zoom and clamps to [minZoom, maxZoom]", () => {
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const canvas = makeFakeCanvas();
  let renderCalls = 0;
  attachInteractiveCamera(canvas, camera, { render: () => renderCalls++, zoomSensitivity: 0.001, minZoom: 0.5, maxZoom: 2 });

  canvas.dispatch("wheel", { deltaY: -100, preventDefault() {} });
  const expected = Math.exp(-(-100) * 0.001);
  assert.ok(Math.abs((camera.zoom ?? 1) - expected) < 1e-9);
  assert.equal(renderCalls, 1);

  // Zoom out far enough to hit the clamp.
  canvas.dispatch("wheel", { deltaY: 100000, preventDefault() {} });
  assert.equal(camera.zoom, 0.5);

  // Zoom in far enough to hit the top clamp.
  canvas.dispatch("wheel", { deltaY: -100000, preventDefault() {} });
  assert.equal(camera.zoom, 2);
});

test("toPixel() reflects zoom for a round-tripped world point", () => {
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const before = camera.toPixel([1, 1, 0]);
  camera.zoom = 2;
  const after = camera.toPixel([1, 1, 0]);
  // Zooming out (larger zoom divisor) pulls points toward the frame center.
  assert.notDeepEqual(before, after);
  const center = [camera.pixelWidth / 2, camera.pixelHeight / 2];
  assert.ok(Math.abs(after[0] - center[0]) < Math.abs(before[0] - center[0]));
  assert.ok(Math.abs(after[1] - center[1]) < Math.abs(before[1] - center[1]));
});

// --- attachInteractiveCamera(): 3D orbit ---------------------------------

test("3D drag mutates phi/theta and leaves frameCenter untouched", () => {
  const camera: any = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [1, 2, 0] });
  camera.projectionDepth = () => 0; // marks this as a 3D camera per is3D()
  camera.phi = 0;
  camera.theta = 0;
  const canvas = makeFakeCanvas();
  attachInteractiveCamera(canvas, camera, { render: () => {}, orbitSensitivity: 0.5 });

  canvas.dispatch("pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
  canvas.dispatch("pointermove", { clientX: 40, clientY: 10, pointerId: 1 });

  assert.notEqual(camera.theta, 0);
  assert.notEqual(camera.phi, 0);
  assert.deepEqual(camera.frameCenter, [1, 2, 0]);
});

// --- picking wired through onClick/onHover -------------------------------

test("click dispatches onClick with the picked mobject", () => {
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const canvas = makeFakeCanvas();
  const mob = makeFakeMobject([-1, -1, 0], [1, 1, 0]);
  const [cx, cy] = camera.toPixel([0, 0, 0]);
  let clicked: any;
  attachInteractiveCamera(canvas, camera, {
    render: () => {},
    mobjects: [mob],
    onClick: (hit) => { clicked = hit; },
  });

  canvas.dispatch("click", { clientX: cx, clientY: cy });
  assert.equal(clicked?.mobject, mob);
});

// --- <manim-chart> --------------------------------------------------------

// A minimal fake DOM node, mirroring test/web-component.test.ts's makeFakeNode,
// with just enough surface (appendChild/removeChild, getAttribute) for
// chart_element.ts's connectedCallback/disconnectedCallback path.
function makeFakeElementNode(tag: string): any {
  const attrs = new Map<string, string>();
  const canvas = makeFakeCanvas();
  canvas.getContext = () => ({
    save() {}, restore() {}, fillRect() {}, fillStyle: "",
  });
  return {
    tagName: tag,
    children: [] as any[],
    _attrs: attrs,
    getAttribute(name: string) { return attrs.has(name) ? attrs.get(name)! : null; },
    setAttribute(name: string, value: string) { attrs.set(name, String(value)); },
    appendChild(child: any) { this.children.push(child); child.parentNode = this; return child; },
    removeChild(child: any) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    dispatchEvent() { return true; },
    _fakeCanvas: canvas,
  };
}

test("importing chart_element does not throw and exports are present", () => {
  assert.equal(typeof ManimChartElement, "function");
  assert.equal(typeof defineManimChart, "function");
});

test("defineManimChart() returns false under Node (no customElements) and does not throw", () => {
  assert.equal(typeof (globalThis as any).customElements, "undefined");
  let result: boolean;
  assert.doesNotThrow(() => {
    result = defineManimChart();
  });
  assert.equal(result!, false);
});

test("with a stubbed DOM, <manim-chart> renders once on connect and cleans up listeners on disconnect", () => {
  const g = globalThis as any;
  const hadHTMLElement = "HTMLElement" in g;
  const hadDocument = "document" in g;
  const hadCustomElements = "customElements" in g;
  const savedHTMLElement = g.HTMLElement;
  const savedDocument = g.document;
  const savedCustomElements = g.customElements;

  try {
    g.HTMLElement = class {};
    g.document = {
      createElement(tag: string) {
        if (tag === "canvas") {
          const node = makeFakeElementNode("canvas");
          return node._fakeCanvas;
        }
        return makeFakeElementNode(tag);
      },
    };
    g.customElements = {
      _reg: new Map<string, any>(),
      define(tag: string, cls: any) { this._reg.set(tag, cls); },
      get(tag: string) { return this._reg.get(tag); },
    };

    assert.equal(defineManimChart("x-test-chart"), true);
    const Cls = g.customElements.get("x-test-chart");
    const el: any = new Cls();
    Object.assign(el, makeFakeElementNode("manim-chart"));

    let builderCalls = 0;
    const mob = makeFakeMobject([-1, -1, 0], [1, 1, 0]);
    el.graph = () => { builderCalls++; return [mob]; };

    el.connectedCallback();
    assert.equal(builderCalls, 1, "graph builder runs once on connect");
    assert.ok(el.camera, "camera is exposed after connect");

    // Picking works against the live mobject the builder returned.
    const [cx, cy] = el.camera.toPixel([0, 0, 0]);
    let picked: any;
    el.addEventListener = () => {}; // dispatchEvent is stubbed via makeFakeElementNode
    el.dispatchEvent = (ev: any) => { picked = ev; return true; };
    el._canvas.dispatch("click", { clientX: cx, clientY: cy });
    assert.equal(picked?.detail?.hit?.mobject, mob);

    // refresh() re-runs the builder and keeps picking working against the
    // SAME mobjects array reference (see chart_element.ts's in-place mutation).
    const mob2 = makeFakeMobject([-1, -1, 0], [1, 1, 0]);
    el.graph = () => { builderCalls++; return [mob2]; };
    assert.equal(builderCalls, 2);
    picked = undefined;
    el._canvas.dispatch("click", { clientX: cx, clientY: cy });
    assert.equal(picked?.detail?.hit?.mobject, mob2);

    const canvasRef = el._canvas;
    const canvasListenersBeforeDetach = canvasRef.listeners.get("click")?.size ?? 0;
    assert.ok(canvasListenersBeforeDetach > 0);

    el.disconnectedCallback();
    assert.equal(canvasRef.listeners.get("click")?.size ?? 0, 0, "disconnect removes all listeners");
  } finally {
    if (hadHTMLElement) g.HTMLElement = savedHTMLElement; else delete g.HTMLElement;
    if (hadDocument) g.document = savedDocument; else delete g.document;
    if (hadCustomElements) g.customElements = savedCustomElements; else delete g.customElements;
  }
});
