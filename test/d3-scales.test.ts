// D1 (D3-parity campaign): scales, ticks/nice, formats, UTC intervals,
// array utils, and color schemes/interpolators.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scaleLinear, scaleLog, scaleSqrt, scaleRadial, scaleBand, scalePoint,
  scaleOrdinal, scaleSequential, scaleQuantize, scaleDiverging, scaleUtc,
} from "../src/core/scales.ts";
import {
  ticks, tickStep, niceExtent, extent, max, sum, rangeOf, quantile,
  group, rollup, groupSort, pairs, ascending,
} from "../src/core/array_utils.ts";
import { format, utcFormat, utcDay, utcSunday, utcMonday, utcYear, utcMonth } from "../src/core/format.ts";
import {
  schemeTableau10, schemeBlues, interpolateBlues, interpolatePiYG,
  interpolateTerrain, interpolateHcl, makeInterpolator, hsv, interpolateHsvLong,
} from "../src/core/color_schemes.ts";

const close = (a: number, b: number, eps = 1e-9, msg?: string) =>
  assert.ok(Math.abs(a - b) < eps, msg ?? `${a} !~ ${b}`);

// --- ticks / nice (the d3 algorithm) -------------------------------------------

test("ticks produces d3's canonical 1-2-5 sequences", () => {
  assert.deepEqual(ticks(0, 1, 10), [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  assert.deepEqual(ticks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(ticks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(ticks(0, 0.95, 5), [0, 0.2, 0.4, 0.6, 0.8]);
  assert.deepEqual(ticks(10, 0, 5).slice(0, 2), [10, 8], "reversed domain descends");
  close(tickStep(0, 1, 10), 0.1);
});

test("niceExtent expands to tick-aligned bounds like d3.nice", () => {
  assert.deepEqual(niceExtent(0.201, 0.997, 10), [0.2, 1]);
  assert.deepEqual(niceExtent(3, 97, 10), [0, 100]);
});

// --- linear/log/sqrt/radial ------------------------------------------------------

test("scaleLinear maps, inverts, clamps, ticks, formats", () => {
  const x = scaleLinear().domain([0, 100]).range([0, 720]);
  close(x(50), 360);
  close(x.invert(360), 50);
  assert.equal(x.clamp(true)(150), 720, "clamped");
  const fmt = x.tickFormat(10);
  assert.equal(fmt(20), "20");
  const nice = scaleLinear().domain([0.201, 0.997]).nice(10);
  assert.deepEqual(nice.domain(), [0.2, 1]);
});

test("scaleLog ticks give 1-9 mantissa powers", () => {
  const s = scaleLog().domain([1, 100]).range([0, 1]);
  close(s(10), 0.5);
  const t = s.ticks(20);
  assert.ok(t.includes(1) && t.includes(10) && t.includes(100));
  assert.ok(t.includes(2) && t.includes(50), `mantissas present: ${t}`);
});

test("scaleSqrt and scaleRadial are area-true", () => {
  const s = scaleSqrt().domain([0, 100]).range([0, 10]);
  close(s(25), 5);
  const r = scaleRadial().domain([0, 100]).range([0, 10]);
  close(r(25), 5, 1e-9, "radial: area-proportional radius");
  close(r(100), 10);
});

// --- band/point/ordinal ------------------------------------------------------------

test("scaleBand matches d3 band arithmetic", () => {
  const b = scaleBand().domain(["a", "b", "c"]).range([0, 120]);
  close(b("a"), 0); close(b("b"), 40); close(b.bandwidth(), 40);
  const padded = scaleBand().domain(["a", "b", "c"]).range([0, 120]).padding(0.2);
  // d3: step = range / (n - pi + 2*po) = 120 / (3 - 0.2 + 0.4) = 37.5
  close(padded.step(), 37.5);
  close(padded.bandwidth(), 30);
  close(padded("a"), 7.5, 1e-9, "outer padding shifts start");
  assert.ok(Number.isNaN(padded("zzz")), "unknown key -> NaN");
});

test("scalePoint puts points at band centers with zero bandwidth", () => {
  const p = scalePoint().domain(["a", "b", "c"]).range([0, 100]);
  close(p.bandwidth(), 0);
  close(p("a"), 0); close(p("b"), 50); close(p("c"), 100);
});

test("scaleOrdinal cycles range and grows domain implicitly", () => {
  const o = scaleOrdinal().range(["red", "green"]);
  assert.equal(o("x"), "red");
  assert.equal(o("y"), "green");
  assert.equal(o("z"), "red", "cycles");
  assert.equal(o("x"), "red", "stable per key");
  assert.deepEqual(o.domain(), ["x", "y", "z"]);
});

// --- sequential/quantize/diverging ---------------------------------------------------

test("sequential, quantize, diverging map values through their ranges", () => {
  const seq = scaleSequential([0, 10] as [number, number], (t: number) => t * 100);
  close(seq(5), 50);
  const q = scaleQuantize([0, 1] as [number, number], ["a", "b", "c"]);
  assert.equal(q(0.1), "a"); assert.equal(q(0.5), "b"); assert.equal(q(0.9), "c");
  assert.deepEqual(q.invertExtent("b"), [1 / 3, 2 / 3]);
  const d = scaleDiverging([-1, 0, 2], (t: number) => t);
  close(d(-1), 0); close(d(0), 0.5); close(d(2), 1); close(d(1), 0.75);
});

// --- time ------------------------------------------------------------------------------

test("scaleUtc ticks snap to natural boundaries", () => {
  const s = scaleUtc().domain([Date.UTC(2020, 0, 1), Date.UTC(2020, 0, 8)]).range([0, 700]);
  close(s(Date.UTC(2020, 0, 4, 12)), 350);
  const t = s.ticks(7);
  assert.ok(t.length >= 6 && t.length <= 9, `daily ticks (${t.length})`);
  assert.ok(t.every((d) => d.getUTCHours() === 0), "midnight-aligned");
  const years = scaleUtc().domain([Date.UTC(2000, 0, 1), Date.UTC(2020, 0, 1)]).ticks(10);
  assert.ok(years.every((d) => d.getUTCMonth() === 0 && d.getUTCDate() === 1), "year ticks");
});

// --- array utils --------------------------------------------------------------------------

test("extent/max/sum/quantile/range behave like d3", () => {
  assert.deepEqual(extent([3, 1, 4, 1, 5]), [1, 5]);
  assert.equal(max([{ v: 2 }, { v: 7 }], (d) => d.v), 7);
  assert.equal(sum([1, 2, 3, null as any, 4]), 10);
  assert.deepEqual(rangeOf(3), [0, 1, 2]);
  assert.deepEqual(rangeOf(1, 7, 2), [1, 3, 5]);
  close(quantile([1, 2, 3, 4], 0.5), 2.5);
  close(quantile([3, 1, 2], 0.5), 2, 1e-9, "unsorted input");
});

test("group/rollup/groupSort/pairs", () => {
  const data = [
    { k: "a", v: 1 }, { k: "b", v: 5 }, { k: "a", v: 3 }, { k: "b", v: 1 },
  ];
  assert.equal(group(data, (d) => d.k).get("a")!.length, 2);
  assert.equal(rollup(data, (g) => sum(g, (d) => d.v), (d) => d.k).get("b"), 6);
  assert.deepEqual(
    groupSort(data, (g: typeof data) => sum(g, (d) => d.v), (d) => d.k),
    ["a", "b"],
    "sorted ascending by reduced value",
  );
  assert.deepEqual(pairs([1, 2, 3]), [[1, 2], [2, 3]]);
  assert.equal(ascending(1, 2), -1);
});

// --- format ---------------------------------------------------------------------------------

test("format handles the gallery's specifiers", () => {
  assert.equal(format(",d")(1234567), "1,234,567");
  assert.equal(format(".2f")(3.14159), "3.14");
  assert.equal(format("%")(0.42), "42.000000%");
  assert.equal(format(".0%")(0.42), "42%");
  assert.equal(format("+.1%")(0.081), "+8.1%");
  assert.equal(format("~s")(1500), "1.5k");
  assert.equal(format("~s")(2_500_000), "2.5M");
  assert.equal(format("d")(3.7), "4");
  assert.equal(format(",d")(-9812.5), "-9,813");
});

test("utcFormat handles the calendar/race specifiers", () => {
  const d = new Date(Date.UTC(2019, 3, 7)); // Sunday April 7 2019
  assert.equal(utcFormat("%Y")(d), "2019");
  assert.equal(utcFormat("%b")(d), "Apr");
  assert.equal(utcFormat("%B %-d, %Y")(d), "April 7, 2019");
  assert.equal(utcFormat("%a %d")(d), "Sun 07");
});

test("UTC intervals: floor/offset/count/range", () => {
  const d = new Date(Date.UTC(2019, 3, 10, 15, 30)); // Wed
  assert.equal(utcDay.floor(d).toISOString(), "2019-04-10T00:00:00.000Z");
  assert.equal(utcSunday.floor(d).getUTCDay(), 0);
  assert.equal(utcMonday.floor(d).getUTCDay(), 1);
  assert.equal(utcYear.floor(d).toISOString(), "2019-01-01T00:00:00.000Z");
  assert.equal(utcMonth.offset(utcMonth.floor(d), 2).getUTCMonth(), 5);
  // Week-of-year arithmetic the calendar scene uses:
  const weeks = utcSunday.count(utcYear.floor(d), d);
  assert.equal(weeks, 14, "April 10 2019 is in week 14 (Sunday-based)");
  assert.equal(utcDay.range(Date.UTC(2020, 0, 1), Date.UTC(2020, 0, 5)).length, 4);
});

// --- schemes / interpolators ----------------------------------------------------------------

test("scheme data + piecewise interpolators", () => {
  assert.equal(schemeTableau10.length, 10);
  assert.equal(schemeTableau10[0], "#4e79a7");
  assert.equal(schemeBlues[9]![8], "#08306b");
  assert.equal(interpolateBlues(0).toLowerCase(), "#f7fbff");
  assert.equal(interpolateBlues(1).toLowerCase(), "#08306b");
  const mid = interpolatePiYG(0.5).toLowerCase();
  assert.equal(mid, "#f7f7f7", "diverging midpoint is the neutral stop");
  const ramp = makeInterpolator(["#000000", "#ffffff"]);
  assert.equal(ramp(0.5).toLowerCase(), "#808080");
});

test("interpolateTerrain and interpolateHcl produce sane colors", () => {
  const lo = interpolateTerrain(0);
  const hi = interpolateTerrain(1);
  assert.match(lo, /^#[0-9a-fA-F]{6}$/);
  // t=0 is hsv(120,1,.65): pure-ish green; t=1 is hsv(0,0,.95): light gray.
  assert.equal(lo.toLowerCase(), "#00a600");
  assert.equal(hi.toLowerCase(), "#f2f2f2");
  const mid = interpolateHsvLong(hsv(120, 1, 0.65), hsv(60, 1, 0.9))(1);
  assert.equal(mid.toLowerCase(), "#e6e600", "hsv endpoint (yellow)");
  const hcl = interpolateHcl("#ff0000", "#0000ff");
  const h = hcl(0.5);
  assert.match(h, /^#[0-9a-fA-F]{6}$/);
  assert.equal(hcl(0).toLowerCase(), "#ff0000", "hcl roundtrip at t=0");
  assert.equal(hcl(1).toLowerCase(), "#0000ff", "hcl roundtrip at t=1");
});
