// Campaign 8 (p5.js generative subset) Phase 2 gap-fill: CellularAutomaton
// mobject (src/mobject/cellular_automaton.ts), covering
// examples/p5-parity/ref/06-game-of-life.js (2D Conway's Game of Life on a
// toroidal grid). See that file's header for the determinism contract and
// rendering-technique rationale this test suite is validating.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CellularAutomaton } from "../src/mobject/cellular_automaton.ts";

function emptyGrid(rows: number, cols: number): boolean[][] {
  return Array.from({ length: rows }, () => new Array(cols).fill(false));
}

function cloneGrid(g: boolean[][]): boolean[][] {
  return g.map((row) => row.slice());
}

// --- Determinism (the critical test) --------------------------------------

test("same seed -> identical initial grid across freshly-constructed instances", () => {
  const a = new CellularAutomaton({ cols: 12, rows: 8, seed: 42 });
  const b = new CellularAutomaton({ cols: 12, rows: 8, seed: 42 });
  assert.deepEqual(a.grid, b.grid);
});

test("same seed -> identical grids after N steps (exact equality, no drift)", () => {
  const a = new CellularAutomaton({ cols: 12, rows: 8, seed: 42 });
  const b = new CellularAutomaton({ cols: 12, rows: 8, seed: 42 });
  for (let i = 0; i < 10; i++) {
    a.step();
    b.step();
  }
  assert.deepEqual(a.grid, b.grid);
});

test("different seeds -> different initial grids", () => {
  const a = new CellularAutomaton({ cols: 16, rows: 16, seed: 1 });
  const b = new CellularAutomaton({ cols: 16, rows: 16, seed: 2 });
  assert.notDeepEqual(a.grid, b.grid);
});

// --- Correctness of Conway's rule on known patterns -----------------------

test("blinker: a horizontal 3-cell line rotates to vertical after one step, and back after a second", () => {
  const grid = emptyGrid(5, 5);
  // Horizontal blinker centered at row 2, cols 1-3.
  grid[2][1] = true;
  grid[2][2] = true;
  grid[2][3] = true;

  const ca = new CellularAutomaton({ cols: 5, rows: 5, wrap: false, initialGrid: grid });

  ca.step();
  const vertical = emptyGrid(5, 5);
  vertical[1][2] = true;
  vertical[2][2] = true;
  vertical[3][2] = true;
  assert.deepEqual(ca.grid, vertical, "blinker should rotate to a vertical 3-cell line after one generation");

  ca.step();
  const horizontal = emptyGrid(5, 5);
  horizontal[2][1] = true;
  horizontal[2][2] = true;
  horizontal[2][3] = true;
  assert.deepEqual(ca.grid, horizontal, "blinker should rotate back to horizontal after a second generation");
});

test("still life: a 2x2 block is unchanged by any number of steps", () => {
  const grid = emptyGrid(6, 6);
  grid[2][2] = true;
  grid[2][3] = true;
  grid[3][2] = true;
  grid[3][3] = true;

  const ca = new CellularAutomaton({ cols: 6, rows: 6, wrap: false, initialGrid: grid });
  const before = cloneGrid(ca.grid);

  ca.step();
  assert.deepEqual(ca.grid, before, "2x2 block should be stable (still life) after one step");
  ca.step();
  assert.deepEqual(ca.grid, before, "2x2 block should remain stable after a second step");
});

test("custom rule function is honored instead of the conway default", () => {
  const grid = emptyGrid(3, 3);
  grid[1][1] = true;
  const alwaysDead = () => false;
  const ca = new CellularAutomaton({ cols: 3, rows: 3, wrap: false, initialGrid: grid, rule: alwaysDead });
  ca.step();
  assert.ok(ca.grid.every((row) => row.every((v) => v === false)), "custom rule returning false everywhere should clear the grid");
});

// --- wrap: true vs wrap: false divergence at the border --------------------

test("wrap:true and wrap:false diverge for a pattern hugging the grid edge", () => {
  const grid = emptyGrid(3, 3);
  // An L-shape hugging the bottom-right corner. On a 3x3 torus these three
  // cells are exactly the wrapped Moore-neighborhood of the top-left corner
  // (0,0), so wrap:true births (0,0) (dead cell, 3 live neighbors) while
  // wrap:false leaves it dead (0 in-bounds neighbors -- row/col -1 don't exist).
  grid[2][2] = true;
  grid[2][1] = true;
  grid[1][2] = true;

  const wrapped = new CellularAutomaton({ cols: 3, rows: 3, wrap: true, initialGrid: grid });
  const bounded = new CellularAutomaton({ cols: 3, rows: 3, wrap: false, initialGrid: grid });
  wrapped.step();
  bounded.step();

  assert.equal(wrapped.grid[0][0], true, "wrap:true should birth (0,0) via its 3 toroidal neighbors");
  assert.equal(bounded.grid[0][0], false, "wrap:false should leave (0,0) dead (no in-bounds neighbors)");
  assert.notDeepEqual(wrapped.grid, bounded.grid, "the two modes should produce genuinely different grids");
});

// --- Visual representation stays in sync with grid state -------------------

test("step() rebuilds the mesh geometry to match the new grid state", () => {
  const grid = emptyGrid(4, 4);
  grid[1][1] = true;
  grid[1][2] = true;
  grid[2][1] = true;
  grid[2][2] = true; // 2x2 block (still life) -- geometry should stay non-empty

  const ca = new CellularAutomaton({ cols: 4, rows: 4, wrap: false, initialGrid: grid });
  const totalMeshPoints = () => ca.submobjects.reduce((n, m) => n + m.points.length, 0);

  assert.ok(totalMeshPoints() > 0, "alive cells should produce mesh geometry at construction");

  // Directly clear the grid (exercising the documented direct-mutation
  // affordance), then step(): an all-dead grid stays all-dead under Conway's
  // rule, and the mesh should shrink to empty in step().
  ca.grid.forEach((row) => row.fill(false));
  ca.step();
  assert.equal(totalMeshPoints(), 0, "an all-dead grid should produce no mesh geometry after step()");
});
