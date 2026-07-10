// Hierarchy layouts (src/layout/hierarchy.ts): d3-hierarchy parity — node
// model semantics (sum/count/sort/traversals/links), stratify (id/parentId and
// path forms), treemap tiling (squarify classic example, binary/slice/dice/
// sliceDice, padding, round), partition bands, circle packing (enclose,
// siblings, pack layout), tidy tree (Buchheim) and cluster (dendrogram), plus
// invariant checks over the real flare-2.json fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  hierarchy,
  stratify,
  treemap,
  treemapSquarify,
  treemapBinary,
  treemapSlice,
  treemapDice,
  treemapSliceDice,
  partition,
  pack,
  packSiblings,
  packEnclose,
  tree,
  cluster,
  HierarchyNode,
} from "../src/layout/hierarchy.ts";

interface Datum {
  name?: string;
  value?: number;
  children?: Datum[];
}

const flare = JSON.parse(
  readFileSync(new URL("../examples/d3-parity/data/flare-2.json", import.meta.url), "utf8"),
) as Datum;

const round2 = (x: number) => Math.round(x * 100) / 100;
const rectOf = (n: HierarchyNode<Datum>) => ({
  x0: round2(n.x0!),
  y0: round2(n.y0!),
  x1: round2(n.x1!),
  y1: round2(n.y1!),
});
const near = (a: number, b: number, eps = 1e-9) => {
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ~ ${b}`);
};
const names = (nodes: HierarchyNode<Datum>[]) => nodes.map((n) => n.data.name);

// A tree where BFS, pre-order and post-order all differ:
// root ── a ── aa
//     └── b
const unevenData = (): Datum => ({
  name: "root",
  children: [{ name: "a", children: [{ name: "aa", value: 4 }] }, { name: "b", value: 2 }],
});

// ---------------------------------------------------------------------------
// hierarchy(): node model
// ---------------------------------------------------------------------------

test("hierarchy() builds depth/height/parent/children structure", () => {
  const root = hierarchy(unevenData());
  assert.equal(root.depth, 0);
  assert.equal(root.height, 2);
  assert.equal(root.parent, null);
  assert.equal(root.children!.length, 2);
  const [a, b] = root.children!;
  assert.equal(a.depth, 1);
  assert.equal(a.height, 1);
  assert.equal(a.parent, root);
  assert.equal(b.height, 0);
  assert.equal(a.children![0].depth, 2);
  assert.equal(a.children![0].data.name, "aa");
  assert.equal(b.children, undefined);
});

test("each() is breadth-first; eachBefore pre-order; eachAfter post-order; index increments", () => {
  const root = hierarchy(unevenData());
  const bfs: (string | undefined)[] = [];
  const indices: number[] = [];
  root.each((n, i) => {
    bfs.push(n.data.name);
    indices.push(i);
  });
  assert.deepEqual(bfs, ["root", "a", "b", "aa"]);
  assert.deepEqual(indices, [0, 1, 2, 3]);

  const pre: (string | undefined)[] = [];
  root.eachBefore((n) => pre.push(n.data.name));
  assert.deepEqual(pre, ["root", "a", "aa", "b"]);

  const post: (string | undefined)[] = [];
  root.eachAfter((n) => post.push(n.data.name));
  assert.deepEqual(post, ["aa", "a", "b", "root"]);

  assert.deepEqual(names(root.descendants()), ["root", "a", "b", "aa"]); // BFS, like d3
});

test("sum() is post-order and INCLUDES the node's own value (d3 semantics)", () => {
  const root = hierarchy<Datum>({
    name: "root",
    value: 1,
    children: [{ name: "a", value: 2 }, { name: "b", value: 3 }],
  });
  const visited: (string | undefined)[] = [];
  root.sum((d) => {
    visited.push(d.name);
    return d.value ?? 0;
  });
  assert.deepEqual(visited, ["a", "b", "root"]); // post-order: children before parent
  assert.equal(root.value, 6); // own 1 + 2 + 3
  assert.equal(root.children![0].value, 2);
  // Non-numeric own values coerce to 0 (d3's `+value(d) || 0`).
  const r2 = hierarchy(unevenData()).sum((d) => d.value as number);
  assert.equal(r2.value, 6); // root/a undefined → 0; aa 4 + b 2
});

test("count() sets value to the number of leaves", () => {
  const root = hierarchy(unevenData()).count();
  assert.equal(root.value, 2);
  assert.equal(root.children![0].value, 1); // a has one leaf
  assert.equal(root.children![1].value, 1); // b is itself a leaf
});

test("sort() mutates children order in place (pre-order)", () => {
  const root = hierarchy<Datum>({
    name: "root",
    children: [{ name: "s", value: 1 }, { name: "l", value: 5 }, { name: "m", value: 3 }],
  }).sum((d) => d.value ?? 0);
  const before = root.children!;
  const result = root.sort((a, b) => b.value! - a.value!);
  assert.equal(result, root);
  assert.equal(root.children, before); // same array, mutated
  assert.deepEqual(names(root.children!), ["l", "m", "s"]);
});

test("leaves(), find(), ancestors(), path(), links()", () => {
  const root = hierarchy(unevenData());
  assert.deepEqual(names(root.leaves()), ["aa", "b"]);

  const aa = root.find((n) => n.data.name === "aa")!;
  assert.equal(aa.data.name, "aa");
  assert.equal(root.find((n) => n.data.name === "nope"), undefined);

  assert.deepEqual(names(aa.ancestors()), ["aa", "a", "root"]);
  const b = root.find((n) => n.data.name === "b")!;
  assert.deepEqual(names(aa.path(b)), ["aa", "a", "root", "b"]);

  const links = root.links();
  assert.equal(links.length, root.descendants().length - 1);
  for (const link of links) {
    assert.ok(link.source instanceof HierarchyNode);
    assert.ok(link.target instanceof HierarchyNode);
    assert.equal(link.target.parent, link.source);
  }
  assert.deepEqual(
    links.map((l) => [l.source.data.name, l.target.data.name]),
    [["root", "a"], ["root", "b"], ["a", "aa"]],
  );
});

test("hierarchy() supports a custom children accessor and Map input", () => {
  const root = hierarchy(
    { id: 1, items: [{ id: 2 }, { id: 3, items: [{ id: 4 }] }] } as {
      id: number;
      items?: { id: number; items?: unknown[] }[];
    },
    (d) => d.items as never,
  );
  assert.deepEqual(root.descendants().map((n) => (n.data as { id: number }).id), [1, 2, 3, 4]);

  // Maps: children of a [key, map] entry are the map's entries (d3 parity).
  const map = new Map<string, unknown>([["a", 1], ["b", new Map([["c", 2]])]]);
  const mroot = hierarchy(map as never) as HierarchyNode<unknown>;
  assert.equal(mroot.children!.length, 2);
  assert.deepEqual(mroot.children![0].data, ["a", 1]);
  assert.equal(mroot.children![1].children!.length, 1);
  assert.deepEqual(mroot.children![1].children![0].data, ["c", 2]);
});

// ---------------------------------------------------------------------------
// stratify()
// ---------------------------------------------------------------------------

test("stratify() round-trips id/parentId tables (defaults d.id / d.parentId)", () => {
  const table = [
    { id: "root" },
    { id: "a", parentId: "root" },
    { id: "b", parentId: "root" },
    { id: "ba", parentId: "b" },
  ];
  const root = stratify<(typeof table)[number]>()(table);
  assert.equal(root.id, "root");
  assert.equal(root.depth, 0);
  assert.equal(root.height, 2);
  assert.deepEqual(root.descendants().map((n) => n.id), ["root", "a", "b", "ba"]);
  const ba = root.find((n) => n.id === "ba")!;
  assert.equal(ba.parent!.id, "b");
  assert.equal(ba.depth, 2);
  assert.equal(ba.data, table[3]); // original datum preserved
});

test("stratify({id, parentId}) accepts custom accessors via options", () => {
  const table = [
    { key: "r", parent: "" },
    { key: "x", parent: "r" },
  ];
  const root = stratify<(typeof table)[number]>({
    id: (d) => d.key,
    parentId: (d) => d.parent,
  })(table);
  assert.equal(root.id, "r");
  assert.equal(root.children![0].id, "x");
});

test("stratify({path}) imputes missing internal nodes with data null", () => {
  const root = stratify<{ path: string }>({ path: (d) => d.path })([
    { path: "/a/b" },
    { path: "/a/c" },
  ]);
  // "/" and "/a" are imputed; the single-child chain above "/a" is trimmed.
  assert.equal(root.id, "/a");
  assert.equal(root.data, null); // imputed
  assert.deepEqual(root.children!.map((n) => n.id).sort(), ["/a/b", "/a/c"]);
  assert.equal(root.children![0].depth, 1);
  assert.equal(root.height, 1);

  const full = stratify<{ path: string }>({ path: (d) => d.path })([
    { path: "/" },
    { path: "/a" },
    { path: "/a/b" },
  ]);
  assert.equal(full.id, "/");
  assert.equal(full.children![0].id, "/a");
  assert.equal(full.children![0].children![0].id, "/a/b");
});

test("stratify() error cases: missing, ambiguous, multiple roots, no root, cycle", () => {
  const s = stratify<{ id: string; parentId?: string }>();
  assert.throws(() => s([{ id: "root" }, { id: "a", parentId: "nope" }]), /missing/);
  assert.throws(
    () =>
      s([
        { id: "root" },
        { id: "a", parentId: "root" },
        { id: "a", parentId: "root" },
        { id: "b", parentId: "a" },
      ]),
    /ambiguous/,
  );
  assert.throws(() => s([{ id: "a" }, { id: "b" }]), /multiple roots/);
  assert.throws(() => s([{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }]), /no root/);
  assert.throws(
    () => s([{ id: "root" }, { id: "a", parentId: "b" }, { id: "b", parentId: "a" }]),
    /cycle/,
  );
});

// ---------------------------------------------------------------------------
// treemap tiling
// ---------------------------------------------------------------------------

test("treemapSquarify matches d3 on the classic [6,6,4,3,2,2,1] example", () => {
  const root = hierarchy<Datum>({
    children: [6, 6, 4, 3, 2, 2, 1].map((value) => ({ value })),
  }).sum((d) => d.value ?? 0);
  treemap<Datum>().size([6, 4])(root);
  // Expected values are d3-hierarchy's own squarify test vectors (2 dp).
  assert.deepEqual(root.children!.map(rectOf), [
    { x0: 0.0, y0: 0.0, x1: 3.0, y1: 2.0 },
    { x0: 0.0, y0: 2.0, x1: 3.0, y1: 4.0 },
    { x0: 3.0, y0: 0.0, x1: 4.71, y1: 2.33 },
    { x0: 4.71, y0: 0.0, x1: 6.0, y1: 2.33 },
    { x0: 3.0, y0: 2.33, x1: 5.4, y1: 3.17 },
    { x0: 3.0, y0: 3.17, x1: 5.4, y1: 4.0 },
    { x0: 5.4, y0: 2.33, x1: 6.0, y1: 4.0 },
  ]);
  // Worst aspect ratio in the squarified layout stays modest: for this
  // classic example the worst rects are the value-2 pair at 2.4/0.8333 = 2.88
  // (matching the Bruls et al. paper / d3);
  // area of each rect is proportional to its value (row invariant).
  for (const c of root.children!) {
    const w = c.x1! - c.x0!;
    const h = c.y1! - c.y0!;
    const aspect = Math.max(w / h, h / w);
    assert.ok(aspect <= 2.88 + 1e-9, `aspect ${aspect}`);
    near((w * h) / 24, c.value! / 24, 1e-9); // 6×4 region has area 24 = total value
  }
  // Default tile is squarify with the golden ratio.
  assert.equal(treemap().tile(), treemapSquarify);
  assert.equal(typeof treemapSquarify.ratio(1), "function");
});

test("treemapDice lays children along x; treemapSlice along y; proportional to value", () => {
  const data: Datum = { children: [{ value: 1 }, { value: 2 }, { value: 1 }] };
  const r1 = hierarchy(data).sum((d) => d.value ?? 0);
  treemap<Datum>().tile(treemapDice).size([4, 1])(r1);
  assert.deepEqual(r1.children!.map(rectOf), [
    { x0: 0, y0: 0, x1: 1, y1: 1 },
    { x0: 1, y0: 0, x1: 3, y1: 1 },
    { x0: 3, y0: 0, x1: 4, y1: 1 },
  ]);

  const r2 = hierarchy(data).sum((d) => d.value ?? 0);
  treemap<Datum>().tile(treemapSlice).size([1, 4])(r2);
  assert.deepEqual(r2.children!.map(rectOf), [
    { x0: 0, y0: 0, x1: 1, y1: 1 },
    { x0: 0, y0: 1, x1: 1, y1: 3 },
    { x0: 0, y0: 3, x1: 1, y1: 4 },
  ]);
});

test("treemapBinary recursively balances value halves", () => {
  const root = hierarchy<Datum>({
    children: [{ value: 1 }, { value: 1 }, { value: 1 }, { value: 1 }],
  }).sum((d) => d.value ?? 0);
  treemap<Datum>().tile(treemapBinary).size([4, 1])(root);
  assert.deepEqual(root.children!.map(rectOf), [
    { x0: 0, y0: 0, x1: 1, y1: 1 },
    { x0: 1, y0: 0, x1: 2, y1: 1 },
    { x0: 2, y0: 0, x1: 3, y1: 1 },
    { x0: 3, y0: 0, x1: 4, y1: 1 },
  ]);
});

test("treemapSliceDice alternates orientation by depth (dice at even depth)", () => {
  const root = hierarchy<Datum>({
    children: [
      { name: "g1", children: [{ value: 1 }, { value: 1 }] },
      { name: "g2", children: [{ value: 2 }] },
    ],
  }).sum((d) => d.value ?? 0);
  treemap<Datum>().tile(treemapSliceDice).size([4, 4])(root);
  const [g1, g2] = root.children!;
  // depth 0 → dice: groups side by side along x, full height.
  assert.deepEqual(rectOf(g1), { x0: 0, y0: 0, x1: 2, y1: 4 });
  assert.deepEqual(rectOf(g2), { x0: 2, y0: 0, x1: 4, y1: 4 });
  // depth 1 → slice: leaves stacked along y, full width of the group.
  const [a, b] = g1.children!;
  assert.deepEqual(rectOf(a), { x0: 0, y0: 0, x1: 2, y1: 2 });
  assert.deepEqual(rectOf(b), { x0: 0, y0: 2, x1: 2, y1: 4 });
});

test("treemap padding (inner/outer/top/right/bottom/left, number or fn) keeps children inside", () => {
  const data: Datum = {
    children: [
      { name: "g", children: [{ value: 2 }, { value: 2 }] },
      { value: 4 },
    ],
  };
  const root = hierarchy(data).sum((d) => d.value ?? 0);
  treemap<Datum>()
    .size([100, 100])
    .paddingInner(4)
    .paddingOuter(() => 6) // function form
    .paddingTop(10) // overrides outer top
    (root);
  assert.deepEqual(rectOf(root), { x0: 0, y0: 0, x1: 100, y1: 100 });
  const g = root.children![0];
  // Children of root sit inside root by the outer paddings.
  for (const c of root.children!) {
    assert.ok(c.x0! >= 6 - 1e-9, "left padding");
    assert.ok(c.y0! >= 10 - 1e-9, "top padding");
    assert.ok(c.x1! <= 100 - 6 + 1e-9, "right padding");
    assert.ok(c.y1! <= 100 - 6 + 1e-9, "bottom padding");
  }
  // Sibling gap equals paddingInner.
  const [c0, c1] = root.children!;
  const gap = Math.max(c1.x0! - c0.x1!, c0.x0! - c1.x1!, c1.y0! - c0.y1!, c0.y0! - c1.y1!);
  near(gap, 4, 1e-9);
  // Grandchildren nest inside g.
  for (const gc of g.children!) {
    assert.ok(gc.x0! >= g.x0! - 1e-9 && gc.x1! <= g.x1! + 1e-9);
    assert.ok(gc.y0! >= g.y0! - 1e-9 && gc.y1! <= g.y1! + 1e-9);
  }
});

test("treemap round(true) produces integer coordinates", () => {
  const root = hierarchy<Datum>({
    children: [{ value: 7 }, { value: 11 }, { value: 3 }],
  }).sum((d) => d.value ?? 0);
  treemap<Datum>().size([97, 41]).round(true)(root);
  root.each((n) => {
    assert.ok(Number.isInteger(n.x0!) && Number.isInteger(n.y0!));
    assert.ok(Number.isInteger(n.x1!) && Number.isInteger(n.y1!));
  });
});

// ---------------------------------------------------------------------------
// partition()
// ---------------------------------------------------------------------------

test("partition() assigns depth bands in y and value-proportional x", () => {
  const root = hierarchy<Datum>({
    children: [{ value: 1 }, { value: 3 }],
  }).sum((d) => d.value ?? 0);
  partition<Datum>().size([4, 2])(root);
  assert.deepEqual(rectOf(root), { x0: 0, y0: 0, x1: 4, y1: 1 });
  assert.deepEqual(rectOf(root.children![0]), { x0: 0, y0: 1, x1: 1, y1: 2 });
  assert.deepEqual(rectOf(root.children![1]), { x0: 1, y0: 1, x1: 4, y1: 2 });
});

test("partition() padding separates bands; polar-ready with size([2π, r])", () => {
  const data: Datum = {
    children: [{ value: 1 }, { name: "g", children: [{ value: 1 }, { value: 2 }] }],
  };
  const root = hierarchy(data).sum((d) => d.value ?? 0);
  partition<Datum>().size([10, 6]).padding(0.5)(root);
  root.each((n) => {
    if (n.parent) {
      assert.ok(n.x0! >= n.parent.x0! - 1e-9 && n.x1! <= n.parent.x1! + 1e-9);
      assert.ok(n.y0! >= n.parent.y1! - 1e-9, "child band starts below parent band");
    }
  });

  // Sunburst usage: x is an angle in [0, 2π], y a radius — caller maps to polar.
  const sun = hierarchy(data).sum((d) => d.value ?? 0);
  partition<Datum>().size([2 * Math.PI, 100])(sun);
  sun.each((n) => {
    assert.ok(n.x0! >= 0 && n.x1! <= 2 * Math.PI + 1e-9);
    assert.ok(Number.isFinite(Math.cos(n.x0!) * n.y1!));
  });
});

// ---------------------------------------------------------------------------
// packEnclose / packSiblings / pack()
// ---------------------------------------------------------------------------

test("packEnclose is exact for 1, 2 (disjoint and nested), and 3 circles", () => {
  assert.equal(packEnclose([]), undefined);

  const one = packEnclose([{ x: 5, y: -3, r: 2 }])!;
  assert.deepEqual(one, { x: 5, y: -3, r: 2 });

  const two = packEnclose([{ x: 0, y: 0, r: 1 }, { x: 4, y: 0, r: 1 }])!;
  near(two.x, 2);
  near(two.y, 0);
  near(two.r, 3);

  const nested = packEnclose([{ x: 0, y: 0, r: 3 }, { x: 1, y: 0, r: 1 }])!;
  near(nested.x, 0);
  near(nested.y, 0);
  near(nested.r, 3);

  // Three mutually tangent unit circles: centers on an equilateral triangle of
  // side 2 → enclosing circle at the centroid with r = 1 + 2/√3.
  const s3 = Math.sqrt(3);
  const three = packEnclose([
    { x: 0, y: 0, r: 1 },
    { x: 2, y: 0, r: 1 },
    { x: 1, y: s3, r: 1 },
  ])!;
  near(three.x, 1, 1e-6);
  near(three.y, s3 / 3, 1e-6);
  near(three.r, 1 + 2 / s3, 1e-6);
});

test("packSiblings packs 3 equal circles mutually tangent around the origin", () => {
  const circles = packSiblings([{ r: 1 }, { r: 1 }, { r: 1 }]) as {
    r: number;
    x: number;
    y: number;
  }[];
  // Pairwise tangency.
  for (let i = 0; i < 3; ++i) {
    for (let j = i + 1; j < 3; ++j) {
      near(Math.hypot(circles[i].x - circles[j].x, circles[i].y - circles[j].y), 2, 1e-9);
    }
  }
  // The enclosing circle of the result is centered at the origin.
  const e = packEnclose(circles)!;
  near(e.x, 0, 1e-9);
  near(e.y, 0, 1e-9);
  near(e.r, 1 + 2 / Math.sqrt(3), 1e-9);
});

test("pack() lays out 3 equal leaves tangent inside the root circle", () => {
  const root = hierarchy<Datum>({
    children: [{ value: 1 }, { value: 1 }, { value: 1 }],
  }).sum((d) => d.value ?? 0);
  pack<Datum>().size([100, 100])(root);
  near(root.x!, 50);
  near(root.y!, 50);
  near(root.r!, 50); // no padding: root circle fills min(w,h)/2
  const expectedChildR = 50 / (1 + 2 / Math.sqrt(3));
  for (const c of root.children!) {
    near(c.r!, expectedChildR, 1e-6);
    // Contained: touches the enclosing (root) circle exactly for this config.
    near(Math.hypot(c.x! - 50, c.y! - 50) + c.r!, 50, 1e-6);
  }
  // Mutually tangent.
  const [a, b, c] = root.children!;
  for (const [p, q] of [[a, b], [a, c], [b, c]] as const) {
    near(Math.hypot(p.x! - q.x!, p.y! - q.y!), p.r! + q.r!, 1e-6);
  }
});

test("pack() honors radius() and padding()", () => {
  const root = hierarchy<Datum>({
    children: [{ value: 4 }, { value: 9 }],
  }).sum((d) => d.value ?? 0);
  pack<Datum>()
    .radius((d) => d.value!) // no sqrt, no rescale (d3 semantics)
    .padding(2)(root);
  const [a, b] = root.children!;
  near(a.r!, 4);
  near(b.r!, 9);
  near(Math.hypot(a.x! - b.x!, a.y! - b.y!), 4 + 9 + 2, 1e-6); // padding separates
  assert.ok(root.r! >= 9, "root encloses children");
});

// ---------------------------------------------------------------------------
// tree() and cluster()
// ---------------------------------------------------------------------------

test("tree() default size([1,1]): exact d3 coordinates for a 3-node tree", () => {
  const root = tree<Datum>()(hierarchy<Datum>({ children: [{}, {}] }));
  near(root.x!, 0.5);
  near(root.y!, 0);
  near(root.children![0].x!, 0.25);
  near(root.children![1].x!, 0.75);
  near(root.children![0].y!, 1);
  near(root.children![1].y!, 1);
});

test("tree().nodeSize([dx,dy]) puts the root at (0,0) and spaces siblings by dx", () => {
  const root = tree<Datum>().nodeSize([10, 10])(hierarchy<Datum>({ children: [{}, {}] }));
  near(root.x!, 0);
  near(root.y!, 0);
  near(root.children![0].x!, -5);
  near(root.children![1].x!, 5);
  near(root.children![0].y!, 10);
  // size()/nodeSize() getters follow d3: the inactive one returns null.
  const t = tree<Datum>().nodeSize([10, 10]);
  assert.equal(t.size(), null);
  assert.deepEqual(t.nodeSize(), [10, 10]);
  assert.deepEqual(tree().size(), [1, 1]);
  assert.equal(tree().nodeSize(), null);
});

test("tree().separation() controls sibling spacing (visible under nodeSize)", () => {
  const root = tree<Datum>()
    .nodeSize([1, 1])
    .separation(() => 3)(hierarchy<Datum>({ children: [{}, {}] }));
  near(root.children![0].x!, -1.5);
  near(root.children![1].x!, 1.5);
  // Default separation doubles across different parents.
  const sep = tree<Datum>().separation();
  const r = hierarchy(unevenData());
  const [a, b] = r.children!;
  assert.equal(sep(a, b), 1);
  assert.equal(sep(a.children![0], b), 2);
});

test("cluster() places all leaves at equal depth (dendrogram); exact small example", () => {
  const data: Datum = { name: "root", children: [{ name: "a" }, { name: "b", children: [{ name: "ba" }] }] };
  const root = cluster<Datum>()(hierarchy(data));
  const a = root.children![0];
  const b = root.children![1];
  const ba = b.children![0];
  near(a.x!, 0.25);
  near(a.y!, 1);
  near(ba.x!, 0.75);
  near(ba.y!, 1);
  near(b.x!, 0.75);
  near(b.y!, 0.5);
  near(root.x!, 0.5);
  near(root.y!, 0);

  // tree() on the same structure has leaves at different y (depth-proportional):
  const troot = tree<Datum>()(hierarchy(data));
  near(troot.children![0].y!, 0.5); // a at depth 1 of maxDepth 2
  near(troot.children![1].children![0].y!, 1); // ba at depth 2
  // ...whereas cluster leaves share y regardless of depth.
  assert.notEqual(troot.children![0].y, troot.children![1].children![0].y);
  assert.equal(a.y, ba.y);
});

test("tree()/cluster() radial usage: size([2π, r]) keeps x in [0, 2π]", () => {
  const root = hierarchy(flare);
  tree()(root); // warm-up default; then radial size
  const radial = tree<Datum>().size([2 * Math.PI, 100])(hierarchy(flare));
  radial.each((n) => {
    assert.ok(n.x! >= -1e-9 && n.x! <= 2 * Math.PI + 1e-9);
    assert.ok(n.y! >= -1e-9 && n.y! <= 100 + 1e-9);
    assert.ok(Number.isFinite(n.y! * Math.cos(n.x!)));
  });
  const cradial = cluster<Datum>().size([2 * Math.PI, 100])(hierarchy(flare));
  cradial.leaves().forEach((n) => near(n.y!, 100, 1e-9));
});

// ---------------------------------------------------------------------------
// Real fixture: flare-2.json
// ---------------------------------------------------------------------------

function assertFinite(root: HierarchyNode<Datum>, keys: ("x0" | "y0" | "x1" | "y1" | "x" | "y" | "r")[]) {
  root.each((n) => {
    for (const k of keys) {
      const v = n[k] as number;
      assert.ok(Number.isFinite(v), `${k} is not finite: ${v}`);
    }
  });
}

test("flare: treemap runs NaN-free with containment and no sibling overlaps", () => {
  const root = hierarchy(flare)
    .sum((d) => d.value ?? 0)
    .sort((a, b) => b.value! - a.value!);
  treemap<Datum>().size([1000, 600]).paddingInner(1)(root);
  assertFinite(root, ["x0", "y0", "x1", "y1"]);
  root.each((n) => {
    assert.ok(n.x1! >= n.x0! - 1e-9 && n.y1! >= n.y0! - 1e-9, "non-degenerate rect");
    if (n.parent) {
      assert.ok(n.x0! >= n.parent.x0! - 1e-6 && n.x1! <= n.parent.x1! + 1e-6, "x containment");
      assert.ok(n.y0! >= n.parent.y0! - 1e-6 && n.y1! <= n.parent.y1! + 1e-6, "y containment");
    }
    const children = n.children;
    if (children) {
      for (let i = 0; i < children.length; ++i) {
        for (let j = i + 1; j < children.length; ++j) {
          const a = children[i];
          const b = children[j];
          const xOverlap = Math.min(a.x1!, b.x1!) - Math.max(a.x0!, b.x0!);
          const yOverlap = Math.min(a.y1!, b.y1!) - Math.max(a.y0!, b.y0!);
          assert.ok(xOverlap <= 1e-6 || yOverlap <= 1e-6, "sibling rects overlap");
        }
      }
    }
  });
});

test("flare: pack runs NaN-free; children inside parent circles, siblings disjoint", () => {
  const root = hierarchy(flare)
    .sum((d) => d.value ?? 0)
    .sort((a, b) => b.value! - a.value!);
  pack<Datum>().size([800, 800]).padding(3)(root);
  assertFinite(root, ["x", "y", "r"]);
  root.each((n) => {
    assert.ok(n.r! >= 0);
    if (n.parent) {
      const d = Math.hypot(n.x! - n.parent.x!, n.y! - n.parent.y!);
      assert.ok(d + n.r! <= n.parent.r! + 1e-6 * Math.max(1, n.parent.r!), "circle containment");
    }
    const children = n.children;
    if (children) {
      for (let i = 0; i < children.length; ++i) {
        for (let j = i + 1; j < children.length; ++j) {
          const a = children[i];
          const b = children[j];
          const d = Math.hypot(a.x! - b.x!, a.y! - b.y!);
          const tol = 1e-6 * Math.max(1, a.r! + b.r!);
          assert.ok(d >= a.r! + b.r! - tol, "sibling circles overlap");
        }
      }
    }
  });
});

test("flare: tree runs NaN-free; parents centered within children extent; links complete", () => {
  const root = hierarchy(flare);
  tree<Datum>().size([360, 500])(root);
  assertFinite(root, ["x", "y"]);
  root.each((n) => {
    assert.ok(n.x! >= -1e-9 && n.x! <= 360 + 1e-9, "x in range");
    near(n.y!, (n.depth * 500) / root.height, 1e-9);
    const children = n.children;
    if (children) {
      const xs = children.map((c) => c.x!);
      assert.ok(n.x! >= Math.min(...xs) - 1e-9 && n.x! <= Math.max(...xs) + 1e-9);
    }
  });
  assert.equal(root.links().length, root.descendants().length - 1);
});
