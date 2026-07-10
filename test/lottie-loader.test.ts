// Lottie player (campaign 5, L1): keyframe engine, shape generation, trim /
// repeater / parenting / precomp semantics, and the real 5-sample corpus.
// Fixtures in examples/lottie-parity/fixtures/ are minimal hand-written
// Lottie JSONs (one feature each); corpus files in .../data/ are the five
// lottie-web demo animations (MIT).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cubicBezierEase,
  evalScalar,
  evalVector,
  evalShapePath,
  parseGradientStops,
  parseLottie,
  trimWindow,
  normalizeColor,
} from "../src/loaders/lottie_loader.ts";
import { loadLottie, LottieMobject } from "../src/mobject/lottie_mobject.ts";
import { VMobject } from "../src/mobject/VMobject.ts";
import type { Mobject } from "../src/mobject/Mobject.ts";

const fixture = (name: string): any =>
  JSON.parse(
    readFileSync(
      new URL(`../examples/lottie-parity/fixtures/${name}`, import.meta.url),
      "utf8",
    ),
  );
const corpus = (name: string): any =>
  JSON.parse(
    readFileSync(
      new URL(`../examples/lottie-parity/data/${name}`, import.meta.url),
      "utf8",
    ),
  );

const leaves = (mob: Mobject): VMobject[] =>
  mob.getFamily().filter((m): m is VMobject => m instanceof VMobject && m.points.length > 0);

const near = (a: number, b: number, eps = 1e-6): void =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b} (±${eps})`);

// World map for the 400×400 fixtures fit to 10 units wide.
const K = 10 / 400;
const wx = (x: number): number => (x - 200) * K;
const wy = (y: number): number => (200 - y) * K;

// ---------------------------------------------------------------------------
// Cubic-bezier easing
// ---------------------------------------------------------------------------

test("cubicBezierEase: endpoints, symmetric midpoint, identity curve", () => {
  const ease = cubicBezierEase(0.5, 0, 0.5, 1);
  near(ease(0), 0);
  near(ease(1), 1);
  // Symmetric control points: x(0.5) = 0.5 exactly, and y(0.5) = 0.5
  // (hand-computed: 3·(1-t)²t·0 + 3·(1-t)t²·1 + t³ = 0.375 + 0.125).
  near(ease(0.5), 0.5, 1e-6);
  // Slow start: below the diagonal in the first half.
  assert.ok(ease(0.25) < 0.25);
  assert.ok(ease(0.25) > 0);
  // Identity curve (control points on the diagonal): ease(u) = u.
  const id = cubicBezierEase(1 / 3, 1 / 3, 2 / 3, 2 / 3);
  for (const u of [0.1, 0.25, 0.5, 0.9]) near(id(u), u, 1e-6);
});

test("eased scalar keyframes: hand-computed midpoint", () => {
  const anim = fixture("01-eased-keyframes.json");
  const r = anim.layers[0].ks.r;
  near(evalScalar(r, 0), 0);
  // Symmetric cubic-bezier(0.5, 0, 0.5, 1): at u=0.5 the eased value is
  // exactly 0.5 → rotation 45.
  near(evalScalar(r, 5), 45, 1e-4);
  near(evalScalar(r, 10), 90);
  near(evalScalar(r, 15), 90); // clamps after the last keyframe
  const quarter = evalScalar(r, 2.5);
  assert.ok(quarter > 0 && quarter < 22.5, "ease-in undershoots linear");
});

test("eased vector keyframes: componentwise midpoint", () => {
  const anim = fixture("01-eased-keyframes.json");
  const p = anim.layers[0].ks.p;
  const mid = evalVector(p, 5);
  near(mid[0], 200, 1e-3); // 100 → 300, eased midpoint = 200
  near(mid[1], 220, 1e-3); // 200 → 240
});

test("hold keyframes step, never interpolate", () => {
  const prop = { a: 1, k: [{ t: 0, s: [10], h: 1 }, { t: 10, s: [20], h: 1 }, { t: 20 }] };
  near(evalScalar(prop, 0), 10);
  near(evalScalar(prop, 9.5), 10);
  near(evalScalar(prop, 10), 20);
  near(evalScalar(prop, 25), 20);
});

test("legacy quirks: bare k with a:1, final keyframe without s, missing e", () => {
  near(evalScalar({ a: 1, k: 5 }, 3), 5);
  assert.deepEqual(evalVector({ k: [1, 2, 3] }, 0), [1, 2, 3]);
  // Final bare {t} keyframe → previous keyframe's e.
  const legacy = { a: 1, k: [{ t: 0, s: [0], e: [50], o: { x: [1 / 3], y: [1 / 3] }, i: { x: [2 / 3], y: [2 / 3] } }, { t: 10 }] };
  near(evalScalar(legacy, 10), 50);
  near(evalScalar(legacy, 99), 50);
  near(evalScalar(legacy, 5), 25, 1e-6);
  // Modern keyframes without e → next keyframe's s.
  const modern = { a: 1, k: [{ t: 0, s: [0], o: { x: [1 / 3], y: [1 / 3] }, i: { x: [2 / 3], y: [2 / 3] } }, { t: 10, s: [80] }] };
  near(evalScalar(modern, 5), 40, 1e-6);
});

test("spatial position keyframes follow the ti/to bezier", () => {
  const anim = fixture("02-spatial-bezier.json");
  const p = anim.layers[0].ks.p;
  const mid = evalVector(p, 5);
  // Hand-computed: x = B(0, 0, 100, 100)(0.5) = 50;
  //                y = B(0, 100, 100, 0)(0.5) = 75 (identity easing).
  near(mid[0], 50, 1e-6);
  near(mid[1], 75, 1e-6);
  // And the geometry lands there in world space (y flipped).
  const mob = loadLottie(anim);
  mob.setFrame(5);
  const [dot] = leaves(mob);
  const c = dot.getCenter();
  near(c[0], wx(50), 1e-6);
  near(c[1], wy(75), 1e-6);
});

test("animated shape paths interpolate vertices", () => {
  const zeros = [[0, 0], [0, 0], [0, 0]];
  const prop = {
    a: 1,
    k: [{
      t: 0,
      s: [{ c: true, v: [[0, 0], [10, 0], [10, 10]], i: zeros, o: zeros }],
      e: [{ c: true, v: [[0, 10], [20, 0], [10, 30]], i: zeros, o: zeros }],
      o: { x: 1 / 3, y: 1 / 3 }, i: { x: 2 / 3, y: 2 / 3 },
    }, { t: 10 }],
  };
  const mid = evalShapePath(prop, 5)!;
  assert.deepEqual(mid.v, [[0, 5], [15, 0], [10, 20]]);
  assert.equal(mid.c, true);
});

// ---------------------------------------------------------------------------
// Shape geometry at f = 0
// ---------------------------------------------------------------------------

test("rect / ellipse / path / star geometry at frame 0", () => {
  const mob = loadLottie(fixture("03-shapes.json"));
  mob.setFrame(0);
  const ls = leaves(mob);
  assert.equal(ls.length, 4);
  const [rect, ellipse, star, tri] = ls;

  // Rect: 80×60 px centered at (100, 100).
  near(rect.getCenter()[0], wx(100), 1e-9);
  near(rect.getCenter()[1], wy(100), 1e-9);
  near(rect.getWidth(), 80 * K, 1e-9);
  near(rect.getHeight(), 60 * K, 1e-9);

  // Ellipse: 100×50 px at (300, 100) (control handles stay inside the bbox).
  near(ellipse.getCenter()[0], wx(300), 1e-9);
  near(ellipse.getCenter()[1], wy(100), 1e-9);
  near(ellipse.getWidth(), 100 * K, 1e-9);
  near(ellipse.getHeight(), 50 * K, 1e-9);

  // Star: anchors alternate outer radius 40 px and inner radius 20 px
  // around (100, 300).
  const cx = wx(100);
  const cy = wy(300);
  const dists = star.getAnchors().map((a) => Math.hypot(a[0] - cx, a[1] - cy));
  const outer = dists.filter((d) => Math.abs(d - 40 * K) < 1e-6).length;
  const inner = dists.filter((d) => Math.abs(d - 20 * K) < 1e-6).length;
  assert.equal(outer + inner, dists.length, "every star anchor on a radius");
  assert.ok(outer >= 5 && inner >= 5);

  // Path: triangle vertices map through the pixel→world fit exactly.
  const anchors = tri.getAnchors().map((a) => [a[0], a[1]]);
  for (const [px, py] of [[200, 350], [250, 350], [225, 320]]) {
    assert.ok(
      anchors.some((a) => Math.abs(a[0] - wx(px)) < 1e-9 && Math.abs(a[1] - wy(py)) < 1e-9),
      `triangle vertex (${px}, ${py}) present`,
    );
  }
});

// ---------------------------------------------------------------------------
// Trim paths
// ---------------------------------------------------------------------------

test("trim path window animates strokeStart/strokeEnd", () => {
  const mob = loadLottie(fixture("04-trim.json"));
  mob.setFrame(0);
  near(leaves(mob)[0].strokeEnd, 0, 1e-6);
  mob.setFrame(5);
  const line = leaves(mob)[0];
  near(line.strokeStart, 0, 1e-6);
  near(line.strokeEnd, 0.5, 1e-6); // linear ease, midpoint
  mob.setFrame(10);
  near(leaves(mob)[0].strokeEnd, 1, 1e-6);
});

test("trimWindow: offset rotation, wrap clamping, empty windows", () => {
  assert.deepEqual(trimWindow(0, 50, 0), [0, 0.5]);
  // Offset rotates the window: 60–90% + half a turn → 10–40%.
  const [a, b] = trimWindow(60, 90, 180);
  near(a, 0.1);
  near(b, 0.4);
  // A wrapped window clamps at the seam (documented approximation).
  const [c, d] = trimWindow(0, 60, 180);
  near(c, 0.5);
  near(d, 1);
  // s = e → empty.
  const [e1, e2] = trimWindow(100, 100, 0);
  near(e1, e2);
});

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

test("gradient stop parsing, incl. alpha tail resampling", () => {
  const stops = parseGradientStops(
    { p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1, /* alpha tail */ 0, 1, 1, 0] } },
    0,
  );
  assert.equal(stops.length, 2);
  near(stops[0].offset, 0);
  near(stops[0].r, 1);
  near(stops[0].a, 1);
  near(stops[1].offset, 1);
  near(stops[1].b, 1);
  near(stops[1].a, 0);
});

test("linear gradient fill maps to gradientColors + sheenDirection; radial flattens", () => {
  const mob = loadLottie(fixture("05-gradient.json"));
  mob.setFrame(0);
  const ls = leaves(mob);
  const linear = ls.find((l) => l.gradientColors);
  const radial = ls.find((l) => !l.gradientColors);
  assert.ok(linear && radial);
  assert.equal(linear!.gradientColors!.length, 2);
  near(linear!.gradientColors![0].r, 1, 1e-6); // red …
  near(linear!.gradientColors![1].b, 1, 1e-6); // … to blue
  // s→e runs +x in pixel space → +x in world space.
  assert.ok(linear!.sheenDirection[0] > 0);
  near(linear!.sheenDirection[1], 0, 1e-9);
  // Radial approximates as the flat middle stop (grey).
  near(radial!.fillColor.r, 0.5, 1e-6);
  assert.ok(mob.warnings.some((w) => w.includes("radial")));
});

// ---------------------------------------------------------------------------
// Repeater
// ---------------------------------------------------------------------------

test("repeater: copy count, transform accumulation, opacity ramp", () => {
  const mob = loadLottie(fixture("06-repeater.json"));
  mob.setFrame(0);
  const ls = leaves(mob);
  assert.equal(ls.length, 5);
  // Copies step +60 px in x: centers at 50, 110, …, 290.
  for (let i = 0; i < 5; i++) {
    near(ls[i].getCenter()[0], wx(50 + 60 * i), 1e-6);
    near(ls[i].getCenter()[1], wy(200), 1e-6);
  }
  // Opacity ramps 100% → 20% across copies.
  near(ls[0].fillOpacity, 1, 1e-6);
  near(ls[4].fillOpacity, 0.2, 1e-6);
});

// ---------------------------------------------------------------------------
// Parenting
// ---------------------------------------------------------------------------

test("layer parent chain: child rides the animated null", () => {
  const mob = loadLottie(fixture("07-parenting.json"));
  // f=0: parent rotation 0 → child at (200+50, 200).
  mob.setFrame(0);
  let c = leaves(mob)[0].getCenter();
  near(c[0], wx(250), 1e-6);
  near(c[1], wy(200), 1e-6);
  // f=10: parent rotation 90° (clockwise in y-down px space) → (200, 250).
  mob.setFrame(10);
  c = leaves(mob)[0].getCenter();
  near(c[0], wx(200), 1e-6);
  near(c[1], wy(250), 1e-6);
});

// ---------------------------------------------------------------------------
// Precomp
// ---------------------------------------------------------------------------

test("precomp: startTime offsets the child comp's clock", () => {
  const mob = loadLottie(fixture("08-precomp.json"));
  // Root f=5 → child f=0 → inner x=100 → world x = wx(100).
  mob.setFrame(5);
  near(leaves(mob)[0].getCenter()[0], wx(100), 1e-6);
  // Root f=10 → child f=5 → inner x=200 (linear midpoint) → world 0.
  mob.setFrame(10);
  near(leaves(mob)[0].getCenter()[0], 0, 1e-6);
  // Root f=15 → child f=10 → inner x=300.
  mob.setFrame(15);
  near(leaves(mob)[0].getCenter()[0], wx(300), 1e-6);
});

// ---------------------------------------------------------------------------
// Solids, text, addressing, clocks
// ---------------------------------------------------------------------------

test("solid layer: sized rect, color, layer opacity", () => {
  const mob = loadLottie(fixture("09-solid.json"));
  mob.setFrame(0);
  const [panel] = leaves(mob);
  near(panel.getWidth(), 200 * K, 1e-9);
  near(panel.getHeight(), 100 * K, 1e-9);
  near(panel.getCenter()[0], 0, 1e-9);
  near(panel.getCenter()[1], 0, 1e-9);
  near(panel.fillColor.r, 0x33 / 255, 1e-6);
  near(panel.fillColor.g, 0x66 / 255, 1e-6);
  near(panel.fillColor.b, 0xcc / 255, 1e-6);
  near(panel.fillOpacity, 0.5, 1e-6);
});

test("text layer renders best-effort and records a warning", () => {
  const mob = loadLottie(fixture("10-text.json"));
  mob.setFrame(0);
  assert.ok(mob.getFamily().length > 1, "text produced a mobject");
  assert.ok(mob.warnings.some((w) => w.includes("best-effort")));
});

test("layer()/layers() give stable per-layer handles", () => {
  const mob = loadLottie(fixture("07-parenting.json"));
  assert.deepEqual(mob.layers(), ["pivot", "rider"]);
  const rider = mob.layer("rider");
  assert.ok(rider);
  mob.setFrame(0);
  const at0 = rider!.getCenter()[0];
  mob.setFrame(10);
  assert.equal(mob.layer("rider"), rider, "handle identity stable across frames");
  assert.notEqual(rider!.getCenter()[0], at0, "content re-poses inside the handle");
  assert.equal(mob.layer("nope"), undefined);
});

test("setTime maps seconds to frames; attachTo drives a dt clock", () => {
  const mob = loadLottie(fixture("04-trim.json")); // fr = 10
  mob.setTime(0.5);
  assert.equal(mob.currentFrame, 5);
  near(mob.duration, 2, 1e-9); // 20 frames @ 10 fps
  const added: unknown[] = [];
  mob.attachTo({ add: (...m: unknown[]) => added.push(...m) });
  assert.equal(added[0], mob);
  mob.update(0.5);
  assert.equal(mob.currentFrame, 5);
  mob.update(2); // loops: 2.5 s % 2 s = 0.5 s
  assert.equal(mob.currentFrame, 5);
});

test("normalizeColor: 0..1 passthrough and legacy 0..255", () => {
  assert.deepEqual(normalizeColor([1, 0.5, 0]), [1, 0.5, 0, 1]);
  const [r, g, b, a] = normalizeColor([255, 238, 230, 255]);
  near(r, 1);
  near(g, 238 / 255);
  near(b, 230 / 255);
  near(a, 1);
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("setFrame is pure: identical geometry after scrubbing", () => {
  const mob = loadLottie(corpus("gatin.json"));
  mob.setFrame(30);
  const first = JSON.stringify(mob.getAllPoints());
  mob.setFrame(30);
  assert.equal(JSON.stringify(mob.getAllPoints()), first, "same frame twice");
  mob.setFrame(0);
  mob.setFrame(63);
  mob.setFrame(30);
  assert.equal(JSON.stringify(mob.getAllPoints()), first, "after scrubbing away and back");
});

// ---------------------------------------------------------------------------
// Real corpus
// ---------------------------------------------------------------------------

for (const name of ["adrock", "bodymovin", "gatin", "happy2016", "navidad"]) {
  test(`corpus: ${name} loads, renders nonzero families, never NaNs`, () => {
    const mob = loadLottie(corpus(`${name}.json`));
    assert.ok(mob instanceof LottieMobject);
    assert.ok(mob.totalFrames > 0 && mob.fps > 0);
    mob.setFrame(mob.inPoint);
    assert.ok(leaves(mob).length > 0, "nonzero family at the in point");
    let scanned = 0;
    for (let f = 0; f < mob.outPoint; f += 3) {
      mob.setFrame(f);
      for (const p of mob.allPoints()) {
        scanned++;
        assert.ok(
          Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]),
          `finite point at frame ${f}`,
        );
      }
    }
    assert.ok(scanned > 1000, "scan actually covered geometry");
  });
}

test("corpus: bodymovin exhibits animated trim paths", () => {
  const mob = loadLottie(corpus("bodymovin.json"));
  const trimmed = (f: number): string => {
    mob.setFrame(f);
    return JSON.stringify(
      mob
        .getFamily()
        .filter((m): m is VMobject => m instanceof VMobject)
        .map((m) => [m.strokeStart, m.strokeEnd])
        .filter(([s, e]) => s !== 0 || e !== 1),
    );
  };
  const a = trimmed(40);
  const b = trimmed(44);
  assert.notEqual(a, "[]", "trim windows active at frame 40");
  assert.notEqual(a, b, "trim window changes between frames");
  // At least one partially-drawn stroke (strictly inside (0, 1)).
  mob.setFrame(40);
  assert.ok(
    mob
      .getFamily()
      .some(
        (m) =>
          m instanceof VMobject && m.strokeEnd > 0 && m.strokeEnd < 1,
      ),
    "some stroke partially drawn mid-animation",
  );
});

test("parseLottie rejects non-Lottie input", () => {
  assert.throws(() => parseLottie({ hello: 1 }));
  assert.throws(() => parseLottie("[]"));
});
