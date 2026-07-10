import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chord,
  ribbonPoints,
  chordAngleToPoint,
  type Chord,
} from "../src/layout/chord.ts";

const TAU = Math.PI * 2;

// d3's classic 4x4 example matrix (documentation dataset).
const MATRIX = [
  [11975, 5871, 8916, 2868],
  [1951, 10048, 2060, 6171],
  [8010, 16145, 8090, 8045],
  [1013, 990, 940, 6907],
];

// ---------------------------------------------------------------------------
// chord()
// ---------------------------------------------------------------------------

test("group values are row sums and group angles sum to 2*PI - n*padAngle", () => {
  const padAngle = 0.05;
  const { groups } = chord({ padAngle })(MATRIX);
  assert.equal(groups.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.equal(groups[i].index, i);
    const rowSum = MATRIX[i].reduce((a, b) => a + b, 0);
    assert.equal(groups[i].value, rowSum);
    assert.ok(groups[i].endAngle > groups[i].startAngle);
  }
  const total = groups.reduce((s, g) => s + (g.endAngle - g.startAngle), 0);
  assert.ok(Math.abs(total - (TAU - 4 * padAngle)) < 1e-9, `total ${total}`);
});

test("groups tile the circle in index order with padAngle gaps between them", () => {
  const padAngle = 0.05;
  const { groups } = chord({ padAngle })(MATRIX);
  assert.ok(Math.abs(groups[0].startAngle) < 1e-12, "starts at 12 o'clock (angle 0)");
  for (let i = 1; i < 4; i++) {
    const gap = groups[i].startAngle - groups[i - 1].endAngle;
    assert.ok(Math.abs(gap - padAngle) < 1e-9, `gap ${gap}`);
  }
  assert.ok(Math.abs(groups[3].endAngle + padAngle - TAU) < 1e-9);
});

test("group angular spans are proportional to their values", () => {
  const padAngle = 0.05;
  const { groups } = chord({ padAngle })(MATRIX);
  const totalValue = groups.reduce((s, g) => s + g.value, 0);
  const k = (TAU - 4 * padAngle) / totalValue;
  for (const g of groups) {
    assert.ok(Math.abs(g.endAngle - g.startAngle - g.value * k) < 1e-9);
  }
});

test("chords pair matrix[i][j] with matrix[j][i]; source is the larger end", () => {
  const { chords } = chord()(MATRIX);
  // 4x4 with all-nonzero entries: 4 diagonal self-chords + 6 pairs = 10.
  assert.equal(chords.length, 10);
  const seen = new Set<string>();
  for (const c of chords) {
    const si = c.source.index;
    const sj = c.source.subindex;
    const ti = c.target.index;
    const tj = c.target.subindex;
    // paired correctly: target is the mirrored entry
    assert.equal(ti, sj);
    assert.equal(tj, si);
    assert.equal(c.source.value, MATRIX[si][sj]);
    assert.equal(c.target.value, MATRIX[ti][tj]);
    // source has the larger value of the two directions
    assert.ok(c.source.value >= c.target.value);
    // each unordered pair appears exactly once
    const key = [Math.min(si, sj), Math.max(si, sj)].join(",");
    assert.ok(!seen.has(key), `duplicate chord ${key}`);
    seen.add(key);
  }
});

test("subgroup angles lie within their group's span and tile it exactly", () => {
  const { groups, chords } = chord({ padAngle: 0.05 })(MATRIX);
  // Gather subgroups per group.
  const subs: { start: number; end: number }[][] = [[], [], [], []];
  for (const c of chords) {
    subs[c.source.index].push({ start: c.source.startAngle, end: c.source.endAngle });
    if (c.target !== c.source) {
      subs[c.target.index].push({ start: c.target.startAngle, end: c.target.endAngle });
    }
  }
  for (let i = 0; i < 4; i++) {
    const g = groups[i];
    const list = subs[i].sort((a, b) => a.start - b.start);
    assert.equal(list.length, 4); // one subgroup per column
    assert.ok(Math.abs(list[0].start - g.startAngle) < 1e-9);
    assert.ok(Math.abs(list[list.length - 1].end - g.endAngle) < 1e-9);
    for (let j = 1; j < list.length; j++) {
      assert.ok(Math.abs(list[j].start - list[j - 1].end) < 1e-9, "contiguous subgroups");
    }
  }
});

test("zero-flow chords are omitted", () => {
  const m = [
    [0, 5, 0],
    [5, 0, 0],
    [0, 0, 4],
  ];
  const { chords } = chord()(m);
  // Only the 0<->1 pair and the 2 self-chord survive.
  assert.equal(chords.length, 2);
});

test("sortGroups reorders angular placement but keeps groups indexed by row", () => {
  const { groups } = chord({ sortGroups: (a, b) => b - a })(MATRIX);
  // groups array stays index-addressable
  for (let i = 0; i < 4; i++) assert.equal(groups[i].index, i);
  // Largest row sum (row 2 = 40290) should start at angle 0.
  const largest = groups.reduce((a, b) => (b.value > a.value ? b : a));
  assert.equal(largest.index, 2);
  assert.ok(Math.abs(largest.startAngle) < 1e-12);
});

test("sortChords orders the chords array by combined value", () => {
  const { chords } = chord({ sortChords: (a, b) => b - a })(MATRIX);
  for (let i = 1; i < chords.length; i++) {
    const prev = chords[i - 1].source.value + chords[i - 1].target.value;
    const cur = chords[i].source.value + chords[i].target.value;
    assert.ok(prev >= cur);
  }
});

test("determinism: two runs produce byte-identical output", () => {
  const a = JSON.stringify(chord({ padAngle: 0.04, sortSubgroups: (x, y) => y - x })(MATRIX));
  const b = JSON.stringify(chord({ padAngle: 0.04, sortSubgroups: (x, y) => y - x })(MATRIX));
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// ribbonPoints / chordAngleToPoint
// ---------------------------------------------------------------------------

test("chordAngleToPoint: 12 o'clock at angle 0, clockwise, y-up", () => {
  const eps = 1e-12;
  const p0 = chordAngleToPoint(0, 2);
  assert.ok(Math.abs(p0[0]) < eps && Math.abs(p0[1] - 2) < eps, "angle 0 -> straight up");
  const p90 = chordAngleToPoint(Math.PI / 2, 2);
  assert.ok(Math.abs(p90[0] - 2) < eps && Math.abs(p90[1]) < eps, "quarter turn clockwise -> +x");
});

test("ribbonPoints emits arc/quad/arc/quad with a closed, connected outline", () => {
  const { chords } = chord({ padAngle: 0.05 })(MATRIX);
  const c = chords.find((ch) => ch.source.index !== ch.target.index) as Chord;
  const radius = 3;
  const segs = ribbonPoints({ source: c.source, target: c.target, radius });
  assert.equal(segs.length, 4);
  assert.deepEqual(segs.map((s) => s.type), ["arc", "quad", "arc", "quad"]);

  const [a1, q1, a2, q2] = segs;
  assert.equal(a1.type, "arc");
  assert.equal(a2.type, "arc");
  if (a1.type === "arc" && a2.type === "arc") {
    assert.equal(a1.startAngle, c.source.startAngle);
    assert.equal(a1.endAngle, c.source.endAngle);
    assert.equal(a2.startAngle, c.target.startAngle);
    assert.equal(a2.endAngle, c.target.endAngle);
    assert.equal(a1.radius, radius);
  }
  if (q1.type === "quad" && q2.type === "quad") {
    assert.deepEqual(q1.control, [0, 0]);
    assert.deepEqual(q2.control, [0, 0]);
  }
  // Connectivity: each segment starts where the previous ended, and the
  // last quad closes back to the first arc's start point.
  for (let i = 1; i < segs.length; i++) {
    assert.deepEqual(segs[i].from, segs[i - 1].to);
  }
  assert.deepEqual(segs[3].to, segs[0].from);
  // All endpoints lie on the circle of the given radius.
  for (const s of segs) {
    for (const p of [s.from, s.to]) {
      assert.ok(Math.abs(Math.hypot(p[0], p[1]) - radius) < 1e-9);
    }
  }
});
