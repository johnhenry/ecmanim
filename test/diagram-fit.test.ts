// Diagram node boxes grow to fit long labels (#109). Short labels keep the
// exact historical geometry (values below were captured from the pre-fix code).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiagram, layoutDiagram, buildBoard } from "../src/diagram/diagram.ts";
import { estimateTextSize, RasterText } from "../src/mobject/text/Text.ts";
import { Scene } from "../src/scene/Scene.ts";
import { captureFrames, matchSnapshot, loadNapiCanvas } from "./_snapshot_util.ts";

const FONT = 0.32;
const PAD = 0.3; // per side, mirrors the documented padding
const node = (board: any, id: string) => board.submobjects.find((m: any) => m.matchId === "node:" + id);
const box = (board: any, id: string) => node(board, id).submobjects[0];
const edge = (board: any, id: string) => board.submobjects.find((m: any) => m.matchId === "edge:" + id);
const bounds = (m: any) => {
  const c = m.getCenter();
  return { l: c[0] - m.getWidth() / 2, r: c[0] + m.getWidth() / 2, t: c[1] + m.getHeight() / 2, b: c[1] - m.getHeight() / 2, cx: c[0], cy: c[1] };
};

const LONG = "A[Hypotenuse c] --> B[Perpendicular Leg]\nB --> C[Base]";

test("long label: box width >= measured label width + padding", () => {
  const board: any = buildBoard(parseDiagram(LONG));
  for (const [id, label] of [["A", "Hypotenuse c"], ["B", "Perpendicular Leg"]]) {
    const need = estimateTextSize(label, FONT).width + 2 * PAD;
    assert.ok(box(board, id).getWidth() >= need - 1e-9, `${id}: ${box(board, id).getWidth()} < ${need}`);
    // and the label sits inside the box
    const lb = bounds(node(board, id).submobjects[1]), bb = bounds(box(board, id));
    assert.ok(lb.l >= bb.l && lb.r <= bb.r);
  }
});

test("fontSize option feeds the fit", () => {
  const board: any = buildBoard(parseDiagram("A[Short label] --> B"), { fontSize: 0.6 });
  assert.ok(box(board, "A").getWidth() >= estimateTextSize("Short label", 0.6).width + 2 * PAD - 1e-9);
});

test("short labels keep exactly the historical geometry", () => {
  const g = parseDiagram("A[Start] --> B[Mid]\nB --> C[End]\nA -- go --> D");
  assert.deepEqual([...layoutDiagram(g)], [["A", [-3, 0, 0]], ["B", [0, -0.8, 0]], ["D", [0, 0.8, 0]], ["C", [3, 0, 0]]]);
  const board: any = buildBoard(g);
  for (const id of ["A", "B", "C", "D"]) {
    assert.ok(Math.abs(box(board, id).getWidth() - 1.8) < 1e-12);
    assert.ok(Math.abs(box(board, id).getHeight() - 0.9) < 1e-12);
  }
  const p = edge(board, "A->B").points;
  assert.deepEqual([p[0][0], p[0][1]].map((v: number) => +v.toFixed(6)), [-1.850864, -0.429239]);
  assert.deepEqual([p[3][0], p[3][1]].map((v: number) => +v.toFixed(6)), [-1.149136, -0.370761]);
});

test("layoutDiagram without nodeSizes is unchanged even for long labels", () => {
  const pos = layoutDiagram(parseDiagram(LONG));
  assert.deepEqual([...pos.values()], [[-3, 0, 0], [0, 0, 0], [3, 0, 0]]);
});

test("3-node chain with one long label: no node overlap, layers keep clearance", () => {
  const board: any = buildBoard(parseDiagram("A[Start] --> B[A really quite long node label]\nB --> C[End]"));
  const [a, b, c] = ["A", "B", "C"].map((id) => bounds(box(board, id)));
  assert.ok(a.r < b.l && b.r < c.l, "boxes overlap");
  assert.ok(b.l - a.r >= 1.0 && c.l - b.r >= 1.0, `gaps ${b.l - a.r}, ${c.l - b.r}`);
});

test("edges still end near their box borders (same offset as for fitting boxes)", () => {
  const board: any = buildBoard(parseDiagram("A[Start] --> B[A really quite long node label]\nB --> C[End]"));
  const ab = edge(board, "A->B").points, bc = edge(board, "B->C").points;
  const a = bounds(box(board, "A")), b = bounds(box(board, "B")), c = bounds(box(board, "C"));
  const first = ab[0], last = ab[ab.length - 1];
  assert.ok(Math.abs(first[0] - a.r) < 0.4 && first[0] >= a.r - 1e-6, `start ${first[0]} vs ${a.r}`);
  assert.ok(Math.abs(b.l - last[0]) < 0.4 && last[0] <= b.l + 1e-6, `end ${last[0]} vs ${b.l}`);
  assert.ok(Math.abs(bc[0][0] - b.r) < 0.4 && bc[0][0] >= b.r - 1e-6);
  assert.ok(Math.abs(c.l - bc[bc.length - 1][0]) < 0.4);
});

test("circular layout: long labels do not overlap neighbours", () => {
  const board: any = buildBoard(parseDiagram("A[Hypotenuse c] --> B[Perpendicular Leg]\nA --> C[Base]\nA --> D[Another long label]"), { algorithm: "circular" });
  const ids = ["A", "B", "C", "D"], bs = ids.map((id) => bounds(box(board, id)));
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const sepX = bs[i].l >= bs[j].r || bs[j].l >= bs[i].r, sepY = bs[i].b >= bs[j].t || bs[j].b >= bs[i].t;
    assert.ok(sepX || sepY, `${ids[i]} overlaps ${ids[j]}`);
  }
});

const canvasAvailable = await loadNapiCanvas().then((m) => !!m);
test("diagram golden: long labels", { skip: !canvasAvailable && "@napi-rs/canvas not available" }, async () => {
  class S extends Scene {
    async construct() {
      const board: any = buildBoard(parseDiagram("A[Hypotenuse c] --> B[Perpendicular Leg]\nB --> C[Base]"));
      // Strip the RasterText labels: they render with system fonts, so their pixels
      // differ between machines (CI has fonts, some hosts don't). Box sizes are still
      // computed from the labels, which is what this golden pins.
      for (const m of board.getFamily()) m.submobjects = m.submobjects.filter((c: any) => !(c instanceof RasterText));
      this.add(board);
      await this.wait(0.2);
    }
  }
  const caps = await captureFrames(S, [2]);
  const failure = await matchSnapshot("diagram.long-labels", caps.get(2)!);
  assert.equal(failure, null, failure ?? undefined);
});
