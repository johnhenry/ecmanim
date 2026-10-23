// Wave A4 (#118): Manim CE graphing parity. Expected numbers are taken from
// Manim CE (ManimCommunity/manim): coordinate_systems.py CoordinateSystem /
// Axes / NumberPlane / ComplexPlane, number_line.py, vector_field.py.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Axes, NumberPlane, ComplexPlane } from "../src/mobject/coordinate_systems.ts";
import { initMathTex } from "../src/mobject/mathtex.ts";
import { StreamLines } from "../src/mobject/vector_field.ts";
import { AnimationGroup } from "../src/animation/composition.ts";
import { Create } from "../src/animation/Animation.ts";
import { ShowPassingFlash } from "../src/animation/indication_extra.ts";

const texts = (g: any): string[] => g.submobjects.map((t: any) => t.text);

// --- Axes defaults (CE Axes.__init__ / CoordinateSystem.__init__) ----------
test("Axes() defaults: x [-7,7,1], y [-4,4,1], 12 x 6, tips on", () => {
  const ax = new Axes();
  assert.deepEqual(ax.xRange, [-7, 7, 1]); // round(-frame_x_radius), round(frame_x_radius)
  assert.deepEqual(ax.yRange, [-4, 4, 1]);
  assert.equal(ax.xLength, 12); // round(frame_width) - 2
  assert.equal(ax.yLength, 6); // round(frame_height) - 2
  assert.equal(ax.xAxis.includeTip, true); // tips=True
  assert.equal(ax.yAxis.includeTip, true);
});

test("Axes({tips:false}) and axisConfig.includeTip still win", () => {
  assert.equal(new Axes({ tips: false }).xAxis.includeTip, false);
  assert.equal(new Axes({ axisConfig: { includeTip: false } }).yAxis.includeTip, false);
});

test("Axes with explicit ranges keeps CE's 12 x 6 default lengths", () => {
  const ax = new Axes({ xRange: [0, 5, 1], yRange: [0, 3, 1] });
  assert.equal(ax.xLength, 12);
  assert.equal(ax.yLength, 6);
  const p0 = ax.coordsToPoint(0, 0), p5 = ax.coordsToPoint(5, 0);
  assert.ok(Math.abs(p5[0] - p0[0] - 12) < 1e-9);
});

test("Axes({xRange:[a,b]}) with 2 terms gets step 1 (CE)", () => {
  assert.deepEqual(new Axes({ xRange: [0, 7], yRange: [0, 3] }).xRange, [0, 7, 1]);
});

// --- NumberPlane defaults (CE NumberPlane.__init__) -------------------------
test("NumberPlane() defaults: x +-frame_x_radius, y +-4, 1 unit = 1 world unit, no tips", () => {
  const pl = new NumberPlane();
  assert.ok(Math.abs(pl.xRange[0] + 7.111111111111111) < 1e-9);
  assert.ok(Math.abs(pl.xRange[1] - 7.111111111111111) < 1e-9);
  assert.deepEqual(pl.yRange, [-4, 4, 1]);
  assert.ok(Math.abs(pl.xLength - 14.222222222222221) < 1e-9);
  assert.equal(pl.yLength, 8);
  assert.equal(pl.xAxis.includeTip, false); // NumberPlane axis_config include_tip False
  const a = pl.coordsToPoint(0, 0), b = pl.coordsToPoint(1, 1);
  assert.ok(Math.abs(b[0] - a[0] - 1) < 1e-9 && Math.abs(b[1] - a[1] - 1) < 1e-9);
});

test("NumberPlane background lines sit at integers (CE get_tick_range is 0-anchored)", () => {
  const pl = new NumberPlane();
  const xs = pl.backgroundLines.submobjects
    .filter((l: any) => Math.abs(l.getStart()[0] - l.getEnd()[0]) < 1e-9)
    .map((l: any) => l.getStart()[0]);
  // x in -7..7 -> 15 vertical lines at integer world x (plane is centred).
  assert.equal(xs.length, 15);
  for (const x of xs) assert.ok(Math.abs(x - Math.round(x)) < 1e-9, `line at ${x}`);
});

test("NumberPlane with explicit xRange and no xLength uses 1 unit per step", () => {
  const pl = new NumberPlane({ xRange: [-4, 11, 1], yRange: [-3, 3, 1] });
  assert.equal(pl.xLength, 15);
  assert.equal(pl.yLength, 6);
});

// --- tick range / excluded origin (CE NumberLine.get_tick_range) ------------
test("Axes tick range: origin tick excluded; with a tip x_max is excluded (CE)", () => {
  const ax = new Axes(); // tips on
  const ticks = ax.xAxis.getTickRange();
  assert.deepEqual(ticks, [-7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6]);
  const noTip = new Axes({ tips: false }).xAxis.getTickRange();
  assert.deepEqual(noTip, [-7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7]);
});

// --- Axes.addCoordinates (CE add_coordinates) -------------------------------
test("Axes.addCoordinates() default labels exclude 0 (numbers_to_exclude [0])", () => {
  const ax = new Axes({ tips: false });
  ax.addCoordinates();
  assert.deepEqual(texts(ax.xAxis.numbers), ["-7", "-6", "-5", "-4", "-3", "-2", "-1", "1", "2", "3", "4", "5", "6", "7"]);
  assert.deepEqual(texts(ax.yAxis.numbers), ["-4", "-3", "-2", "-1", "1", "2", "3", "4"]);
});

test("Axes.addCoordinates([1,2],[3]) draws exactly those labels (issue B10)", () => {
  const ax = new Axes();
  ax.addCoordinates([1, 2], [3]);
  assert.deepEqual(texts(ax.xAxis.numbers), ["1", "2"]);
  assert.deepEqual(texts(ax.yAxis.numbers), ["3"]);
  const p = ax.coordsToPoint(1, 0);
  const c = ax.xAxis.numbers.submobjects[0].getCenter();
  assert.ok(Math.abs(c[0] - p[0]) < 1e-6, "label sits under its tick");
  const q = ax.coordsToPoint(0, 3);
  const cy = ax.yAxis.numbers.submobjects[0].getCenter();
  assert.ok(Math.abs(cy[1] - q[1]) < 1e-6);
  assert.ok(cy[0] < q[0], "y label sits left of the axis");
});

test("Axes.addCoordinates(xValues) only labels x; null keeps default for that axis", () => {
  const ax = new Axes({ tips: false });
  ax.addCoordinates([1, 2]);
  assert.deepEqual(texts(ax.xAxis.numbers), ["1", "2"]);
  assert.equal(ax.yAxis.numbers, undefined);
  const bx = new Axes({ tips: false });
  bx.addCoordinates(null, [2]);
  assert.equal(bx.xAxis.numbers.submobjects.length, 14);
  assert.deepEqual(texts(bx.yAxis.numbers), ["2"]);
});

test("Axes.addCoordinates({value: label}) places custom labels (CE dict form)", async () => {
  await initMathTex();
  const ax = new Axes({ xRange: [0, 7], yRange: [0, 3], tips: false });
  ax.addCoordinates({ 1: "Mon", 2: "Tue" });
  const labels = ax.xAxis.labels;
  assert.equal(labels.submobjects.length, 2);
  const p = ax.coordsToPoint(2, 0);
  assert.ok(Math.abs(labels.submobjects[1].getCenter()[0] - p[0]) < 1e-6);
});

test("addCoordinates called twice replaces rather than duplicates", () => {
  const ax = new Axes({ tips: false });
  ax.addCoordinates([1]);
  ax.addCoordinates([1, 2]);
  assert.deepEqual(texts(ax.xAxis.numbers), ["1", "2"]);
  assert.equal(ax.xAxis.submobjects.filter((m: any) => m === ax.xAxis.numbers).length, 1);
  assert.equal(ax.coordinateLabels.submobjects.length, 1); // x only (y arg absent)
});

// --- ComplexPlane.addCoordinates (CE ComplexPlane.add_coordinates) ----------
test("ComplexPlane.addCoordinates(1, 2, {re:0,im:3}) labels real and imaginary values", () => {
  const pl = new ComplexPlane();
  pl.addCoordinates(1, 2, { re: 0, im: 3 }, [0, -2]);
  assert.deepEqual(texts(pl.coordinateLabels), ["1", "2", "3i", "-2i"]);
});

test("ComplexPlane.addCoordinates() default: x ticks (no 0) then non-zero imaginary ticks", () => {
  const pl = new ComplexPlane({ xRange: [-2, 2, 1], yRange: [-1, 1, 1] });
  pl.addCoordinates();
  assert.deepEqual(texts(pl.coordinateLabels), ["-2", "-1", "1", "2", "-1i", "1i"]);
});

// --- StreamLines (CE vector_field.py StreamLines) ---------------------------
const field = (p: number[]) => [Math.sin(p[0] / 2), Math.cos(p[1] / 2), 0];
const mk = () => new StreamLines(field, { xRange: [-2, 2, 1], yRange: [-2, 2, 1], virtualTime: 1, maxAnchorsPerLine: 5 });

test("StreamLines.create() is an AnimationGroup of Create, one per line, CE lag", () => {
  const s = mk();
  const anim: any = s.create();
  assert.ok(anim instanceof AnimationGroup);
  assert.equal(anim.animations.length, s.streamLines.length);
  assert.ok(anim.animations.every((a: any) => a instanceof Create));
  assert.ok(anim.animations.every((a: any) => a.runTime === 1)); // default run_time = virtual_time
  // lag_ratio = run_time / 2 / len(submobjects)
  assert.ok(Math.abs(anim.lagRatio - 1 / 2 / s.submobjects.length) < 1e-12);
  const custom: any = s.create({ runTime: 2, lagRatio: 0.1 });
  assert.equal(custom.animations[0].runTime, 2);
  assert.equal(custom.lagRatio, 0.1);
  assert.equal((s.create({ runTime: (vt: number) => vt * 3 }) as any).animations[0].runTime, 3);
});

test("StreamLines.create() order is a deterministic shuffle", () => {
  const order = (s: any) => s.create().animations.map((a: any) => s.streamLines.indexOf(a.mobject));
  assert.deepEqual(order(mk()), order(mk()));
  assert.notDeepEqual(order(mk()), order(mk()).slice().sort((a: number, b: number) => a - b), "shuffled");
});

test("StreamLines.startAnimation(): flash windows are closed-form in time and deterministic", () => {
  const a = mk(), b = mk();
  a.startAnimation({ warmUp: false, flowSpeed: 1.5, timeWidth: 0.5 });
  b.startAnimation({ warmUp: false, flowSpeed: 1.5, timeWidth: 0.5 });
  assert.ok(a.streamLines.every((l: any) => l.anim instanceof ShowPassingFlash));
  assert.ok(Math.abs(a.streamLines[0].anim.runTime - a.streamLines[0].duration / 1.5) < 1e-12);
  // CE: duration = (ceil(virtual_time/dt)+1)*dt
  assert.ok(Math.abs(a.streamLines[0].duration - (Math.ceil(1 / 0.05) + 1) * 0.05) < 1e-9);
  const win = (s: any) => s.streamLines.map((l: any) => [l.strokeStart, l.strokeEnd]);
  for (let i = 0; i < 10; i++) { a.update(0.1); b.update(0.1); }
  assert.deepEqual(win(a), win(b));
  // The same total time reached in one big step gives the same windows (no wrap crossed).
  const c = mk(); c.startAnimation({ warmUp: false, flowSpeed: 1.5, timeWidth: 0.5 });
  const d = mk(); d.startAnimation({ warmUp: false, flowSpeed: 1.5, timeWidth: 0.5 });
  c.update(0.2); c.update(0.2); d.update(0.4);
  assert.deepEqual(win(c), win(d));
});

test("StreamLines.startAnimation(): warm-up lines start hidden (time < 0)", () => {
  const s = mk();
  s.startAnimation({ warmUp: true });
  s.update(0);
  assert.ok(s.streamLines.every((l: any) => l.time <= 0));
  assert.ok(s.streamLines.every((l: any) => l.strokeStart === 0 && l.strokeEnd === 0));
  const t0 = s.streamLines.map((l: any) => l.time);
  s.update(0.5);
  s.streamLines.forEach((l: any, i: number) => assert.ok(Math.abs(l.time - (t0[i] + 0.5)) < 1e-9 || l.time >= 0));
});

test("StreamLines flow time wraps by virtual_time (CE: time -= virtual_time)", () => {
  const s = mk();
  s.startAnimation({ warmUp: false });
  const t0 = s.streamLines.map((l: any) => l.time);
  s.update(1.25);
  s.streamLines.forEach((l: any, i: number) => {
    const raw = t0[i] + 1.25;
    assert.ok(Math.abs(l.time - (raw >= 1 ? raw % 1 : raw)) < 1e-9);
  });
});

test("StreamLines.endAnimation() throws unless running, and settles to fully drawn lines", () => {
  const s = mk();
  assert.throws(() => s.endAnimation(), /start the animation/);
  s.startAnimation({ warmUp: false, flowSpeed: 1.5, timeWidth: 0.5 });
  s.update(0.3);
  const end: any = s.endAnimation();
  assert.ok(end instanceof AnimationGroup);
  assert.equal(s.updaters.length, 0, "flow updater removed immediately (CE)");
  assert.throws(() => s.endAnimation(), /start the animation/);
  end.begin();
  end.interpolate(0.5);
  end.interpolate(1);
  end.finish();
  for (const l of s.streamLines as any[]) {
    assert.equal(l.strokeStart, 0);
    assert.equal(l.strokeEnd, 1);
    assert.equal(l.strokeOpacity, 1);
  }
  // CE max_run_time = virtual_time / flow_speed; total run time of a line is pre-roll + creation.
  assert.ok(end.runTime > 0);
});

test("StreamLines.endAnimation() is seek-safe: alpha order does not matter", () => {
  const run = (alphas: number[]) => {
    const s = mk(); s.startAnimation({ warmUp: true });
    s.update(0.1);
    const e: any = s.endAnimation(); e.begin();
    for (const a of alphas) e.interpolate(a);
    return s.streamLines.map((l: any) => [l.strokeStart, l.strokeEnd, l.strokeOpacity]);
  };
  assert.deepEqual(run([0.2, 0.9, 0.6]), run([0.6]));
});
