// p5.js parity demo 07: ref/07-ten-print-maze.js — "Wolfram CA" (p5.js
// gallery, LGPL; see ref/README.md's substitution note: no "10 PRINT" /
// diagonal-line-maze example exists in the official corpus, so this is the
// documented substitute — the closest official minimal-rule emergent-grid-
// texture generator). The ref is genuinely a 1-DIMENSIONAL elementary
// cellular automaton (Wolfram's `rules(left, me, right)` applied per cell,
// NOT a diagonal-tile maze despite the demo's "ten print maze" name), whose
// `ruleset = [0,1,0,1,1,0,1,0]` is Wolfram's classic Rule 90 (verified by
// decoding the 8-entry truth table against the standard 111..000 pattern
// ordering the ref's own `rules()` switch uses) — the Sierpinski-triangle
// rule. Each generation is a new ROW stacked below the last (`rect(i*w,
// generation*w, w, w)`), so the visible image is the ACCUMULATED HISTORY of
// every past generation, not just the current one.
//
// IMPLEMENTATION CHOICE — hand-rolled accumulator, not CellularAutomaton:
// src/mobject/cellular_automaton.ts's own header documents "pass rows: 1 and
// a custom 3-neighbor rule function" as a supported use case for this exact
// scenario, and its rule signature is `(neighbors: number, alive: boolean)`.
// But CellularAutomaton._countNeighbors (cellular_automaton.ts:199-217) computes
// neighbors via a Moore 3x3 scan with `rr = (row + dr + rows) % rows` — for
// rows=1 every dr (-1, 0, 1) wraps to the SAME row 0, so the left neighbor
// (dc=-1) is counted 3x, the cell's own state (dc=0, dr=±1) is counted 2x as
// a "neighbor", and the right neighbor (dc=1) is counted 3x: neighbors =
// 3*left + 2*me + 3*right, not a clean {left, me, right} triple. This
// happens to be *recoverable* for Rule 90 specifically only because Rule 90
// is symmetric in (left, right) and ignores `me` entirely (newState = left
// XOR right — confirmed by decoding the ruleset above), so `me` is already
// passed separately and (left + right) can be backed out of the distorted
// count. That recovery is fragile/non-general (it would silently break for
// any rule that isn't left/right-symmetric), and threading a real 3-value
// rule through a neighbor-COUNT abstraction that conflates and multiply-
// counts positions is misleading regardless of whether one rule's math
// happens to survive it. So this file instead reimplements the ref's exact
// `rules(a, b, c)` table lookup directly (still fully deterministic — no
// randomness at all, matching the ref, which starts from a single fixed seed
// cell, not a random grid) and accumulates each generation's row into a
// history grid itself, rendering only ALIVE cells as filled squares.
//
// NOTE: this IS a real CellularAutomaton bug worth a fix-wave look (not
// fixed here per this campaign's rule not to touch src/) — see the
// _countNeighbors analysis above; repro: `rows: 1, cols: 5`, seed a single
// alive cell, and compare the `neighbors` a custom rule observes against the
// true count of alive cells among {grid[0][c-1], grid[0][c+1]}.
//
// VISUAL MAPPING: the ref never actually draws alive cells (`if (cells[i]===1)
// fill(200)` sets a fill color but the `rect()` call only happens in the
// `else` / dead branch) — since the canvas is never cleared, alive cells
// simply show through as whatever the (light) default background is, while
// dead cells get an explicit dark rect. Net visible result: light squares
// trace out the Sierpinski-triangle "alive" shape against a darker field —
// exactly what this port reproduces directly: only alive cells are drawn, as
// light squares, against this harness's black background (which already
// plays the "dead cell" role with zero extra draws).

import { Scene, VGroup, Rectangle } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

// Wolfram's Rule 90 (Sierpinski triangle), as an explicit {left, me, right}
// truth table — matches the ref's `rules(a, b, c)` switch verbatim (`me` is
// unused by Rule 90 but kept in the signature for fidelity to the ref).
const RULESET = [0, 1, 0, 1, 1, 0, 1, 0];
function rules(a: number, b: number, c: number): number {
  if (a === 1 && b === 1 && c === 1) return RULESET[0];
  if (a === 1 && b === 1 && c === 0) return RULESET[1];
  if (a === 1 && b === 0 && c === 1) return RULESET[2];
  if (a === 1 && b === 0 && c === 0) return RULESET[3];
  if (a === 0 && b === 1 && c === 1) return RULESET[4];
  if (a === 0 && b === 1 && c === 0) return RULESET[5];
  if (a === 0 && b === 0 && c === 1) return RULESET[6];
  if (a === 0 && b === 0 && c === 0) return RULESET[7];
  return 0;
}

const COLS = 64; // ref: floor(640 / 10)
const ROWS = 40; // ref: 400 / 10 generations drawn before draw() runs off-canvas
const CELL_SIZE = 0.17; // world units/cell; 64:40 grid keeps the ref's 640:400 (1.6:1) aspect

class TenPrintMaze extends Scene {
  async construct() {
    // --- Build the full generation history (deterministic, no randomness:
    // a single fixed seed cell in the middle, exactly like the ref). ---
    let cells = new Array(COLS).fill(0);
    cells[COLS / 2] = 1;
    const history: number[][] = [];
    for (let g = 0; g < ROWS; g++) {
      history.push(cells);
      const next = new Array(COLS).fill(0); // edges (i=0, i=COLS-1) never updated, same as ref
      for (let i = 1; i < COLS - 1; i++) next[i] = rules(cells[i - 1], cells[i], cells[i + 1]);
      cells = next;
    }

    const halfW = (COLS * CELL_SIZE) / 2;
    const halfH = (ROWS * CELL_SIZE) / 2;

    // One Rectangle per alive cell (256 total across the whole history for
    // this ruleset/size -- cheap; no need for CellularAutomaton's packed-
    // subpath trick at this scale), tagged with its generation row so the
    // reveal below can stagger by row.
    const cellRects: { row: number; rect: Rectangle }[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (history[r][c] !== 1) continue;
        const x = -halfW + (c + 0.5) * CELL_SIZE;
        const y = halfH - (r + 0.5) * CELL_SIZE;
        const rect = new Rectangle({
          width: CELL_SIZE,
          height: CELL_SIZE,
          point: [x, y, 0],
          fillColor: "#e5e7eb",
          fillOpacity: 0, // revealed progressively below
          strokeWidth: 0,
        });
        cellRects.push({ row: r, rect });
      }
    }

    const group = new VGroup(...cellRects.map((cr) => cr.rect));
    this.add(group);

    // Reveal row by row over ~3s (echoing the ref's own per-generation
    // growth down the canvas), then hold the finished pattern.
    const revealTime = 3.0;
    const rowInterval = revealTime / ROWS;
    group.addUpdater((_m: any, _dt: number) => {
      const revealedRows = Math.min(ROWS, Math.floor(this.time / rowInterval) + 1);
      for (const cr of cellRects) {
        if (cr.row < revealedRows) cr.rect.fillOpacity = 1;
      }
    });

    await this.wait(5);
  }
}

await demoRender(TenPrintMaze, import.meta.url);
