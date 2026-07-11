// Campaign 8 (p5.js generative subset) Phase 2 gap-fill: a deterministic
// cellular-automaton mobject covering both references in
// examples/p5-parity/ref/ -- 06-game-of-life.js (2D Conway's Game of Life on
// a toroidal grid) and 07-ten-print-maze.js (a 1D elementary/Wolfram CA,
// this corpus's documented substitute for a "ten print maze" example). This
// mobject targets 06's 2D grid cleanly (rows x cols, wrap toggle, pluggable
// neighbor-counting rule) while staying general enough to model 1D CA too --
// pass rows: 1 and a custom 3-neighbor rule function to reproduce 07's
// Wolfram automaton (see rule docs below).
//
// DETERMINISM CONTRACT (why this file exists in Campaign 8's Phase 2 policy):
// renders are a pure function of scene time, so any randomness anywhere in a
// mobject's definition must be seeded and replayable. Game of Life's
// EVOLUTION is already fully deterministic given an initial grid (no
// randomness in the rules themselves) -- the only nondeterminism risk is the
// common "randomly seed the initial board" demo pattern. This class always
// seeds via mulberry32(seed) (src/core/noise.ts), never Math.random(), so:
//   same seed -> same initial grid -> same sequence of grids after N calls
//   to step(), in any process, on any run.
// step() itself takes no random input and is a pure function of the current
// grid, so this holds independent of how many times / in what order step()
// is called relative to other rendering work.
//
// RENDERING TECHNIQUE (the roadmap explicitly asks for "raster-tier like
// particles" -- see src/mobject/particles.ts for that mobject's actual
// technique before assuming this one copies it verbatim):
// ParticleSystem's raster tier works by setting `_isParticles = true` and
// having CanvasRenderer dispatch to a dedicated `drawParticles()` method that
// rasterizes particles directly with fillRect/arc -- bypassing the VMobject
// bezier-path pipeline entirely. That requires renderer-side plumbing
// (CanvasRenderer.ts changes) which is out of scope here (this gap-fill only
// touches this file, src/index.ts, and its test).
//
// Given that constraint, and that this campaign's own reference grid is only
// ~36x20 = 720 cells (20px cells on a 720x400 canvas), building 720
// *separate* Rectangle Mobjects (each walking the full Mobject/VMobject
// machinery, each a node the renderer's tree-walk and z-sort visit
// individually) was judged wasteful for something that is fundamentally one
// piece of raster-like content. Instead: alive cells (and, if `deadColor` is
// configured, dead cells) are drawn as disjoint rectangle *subpaths* packed
// into a SINGLE VMobject per color (VMobject already supports multiple
// subpaths via startNewPath/subpathStarts -- see Polygon/Rectangle for the
// single-subpath case, and CanvasRenderer.drawVMobject's `ctx.fill("evenodd")`
// for why disjoint same-winding subpaths in one path fill correctly with no
// extra renderer work). The result: one (or two) fill() calls per generation
// for the whole grid, no matter how many cells are alive -- the same
// "one draw call for many logical cells" outcome as the particle raster
// tier, achieved by reusing the existing VMobject subpath machinery instead
// of adding a new renderer code path. If a caller needs genuinely huge grids
// (tens of thousands of cells) where even this becomes a bottleneck, a true
// ImageData/pixel-buffer mobject (mirroring ParticleSystem's renderer-level
// raster tier) would be the next step -- out of scope for this gap-fill.

import { VGroup, VMobject } from "./VMobject.ts";
import type { MobjectConfig } from "./Mobject.ts";
import { mulberry32 } from "../core/noise.ts";
import { Color } from "../core/color.ts";
import type { ColorLike } from "../core/types.ts";

/**
 * A cell's next-state rule: given its live-neighbor count and current
 * alive/dead state, return whether it is alive next generation. `'conway'`
 * selects Conway's classic B3/S23 rule (a dead cell with exactly 3 live
 * neighbors is born; a live cell with 2 or 3 live neighbors survives; all
 * other live cells die of under/overpopulation).
 */
export type CellularAutomatonRule = "conway" | ((neighbors: number, alive: boolean) => boolean);

export interface CellularAutomatonConfig extends MobjectConfig {
  cols: number;
  rows: number;
  /** Seed for the mulberry32 stream used ONLY for the random initial grid
   *  (ignored when `initialGrid` is supplied). Default 0. */
  seed?: number;
  /** Fraction of cells alive in the random initial grid. Default 0.3. */
  initialDensity?: number;
  /** Next-state rule. Default `'conway'`. */
  rule?: CellularAutomatonRule;
  /** Toroidal (wraparound) edges, matching the 06-game-of-life.js reference.
   *  Default true. When false, off-grid neighbors simply don't count. */
  wrap?: boolean;
  /** World units per cell (both width and height). Default 1. */
  cellSize?: number;
  /** Fill color for alive cells. Default white. */
  aliveColor?: ColorLike;
  /** Fill color for dead cells. When omitted (the default), dead cells are
   *  simply not drawn (transparent) -- cheaper, and the usual look for a
   *  GoL demo composited over a scene background. Set this to reproduce the
   *  06-game-of-life.js reference's opaque white/black board. */
  deadColor?: ColorLike;
  /** Bypass random seeding entirely and start from this exact grid
   *  (indexed [row][col]). Must match `rows`/`cols`. Intended for tests and
   *  hand-authored starting patterns (blinkers, gliders, still lifes, ...). */
  initialGrid?: boolean[][];
}

/** Conway's classic B3/S23 rule. */
function conwayRule(neighbors: number, alive: boolean): boolean {
  return alive ? neighbors === 2 || neighbors === 3 : neighbors === 3;
}

function resolveRule(rule: CellularAutomatonRule | undefined): (neighbors: number, alive: boolean) => boolean {
  return typeof rule === "function" ? rule : conwayRule;
}

/**
 * A deterministic cellular automaton (Conway's Game of Life by default, or
 * any custom neighbor-counting rule) rendered as up to two raster-like
 * VMobjects (alive / optionally dead), one subpath per live cell -- see the
 * file header for the full rendering-technique rationale.
 *
 * `grid[row][col]` is the authoritative cell-alive state: `true` = alive.
 * It's a stable array reference for the object's lifetime (step() mutates
 * cell values in place rather than reassigning the array), so tests/callers
 * may freely read or hand-set `grid[r][c]` between construction and step()
 * calls -- exactly how the blinker/still-life correctness tests bypass
 * random init to plant a known pattern.
 */
export class CellularAutomaton extends VGroup {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly wrap: boolean;
  readonly grid: boolean[][];

  private readonly _rule: (neighbors: number, alive: boolean) => boolean;
  private readonly _aliveColor: Color;
  private readonly _deadColor?: Color;
  private readonly _aliveMesh: VMobject;
  private readonly _deadMesh?: VMobject;

  constructor(config: CellularAutomatonConfig) {
    super();
    this.cols = config.cols;
    this.rows = config.rows;
    this.cellSize = config.cellSize ?? 1;
    this.wrap = config.wrap ?? true;
    this._rule = resolveRule(config.rule);
    this._aliveColor = Color.parse(config.aliveColor ?? "#FFFFFF");
    this._deadColor = config.deadColor != null ? Color.parse(config.deadColor) : undefined;

    if (config.initialGrid) {
      const g = config.initialGrid;
      if (g.length !== this.rows || g.some((row) => row.length !== this.cols)) {
        throw new Error(
          `CellularAutomaton: initialGrid dimensions (${g.length}x${g[0]?.length ?? 0}) ` +
          `must match rows/cols (${this.rows}x${this.cols})`,
        );
      }
      this.grid = g.map((row) => row.slice());
    } else {
      const rand = mulberry32(config.seed ?? 0);
      const density = config.initialDensity ?? 0.3;
      this.grid = [];
      for (let r = 0; r < this.rows; r++) {
        const row: boolean[] = new Array(this.cols);
        for (let c = 0; c < this.cols; c++) row[c] = rand() < density;
        this.grid.push(row);
      }
    }

    // Dead mesh drawn first (if present) so alive cells layer visually on
    // top, though the two never actually overlap.
    if (this._deadColor) {
      this._deadMesh = new VMobject({ fillColor: this._deadColor, fillOpacity: 1, strokeWidth: 0 });
      this.add(this._deadMesh);
    }
    this._aliveMesh = new VMobject({ fillColor: this._aliveColor, fillOpacity: 1, strokeWidth: 0 });
    this.add(this._aliveMesh);

    this._rebuildMesh();
  }

  /**
   * Advance exactly one generation using `rule` (Conway B3/S23 by default).
   * Pure function of the CURRENT grid: every cell's next state is computed
   * from a full pass over the old grid before any cell is mutated, so there
   * is no order-dependence within a step. No randomness is consulted here --
   * see the file header's determinism contract.
   */
  step(): this {
    const { rows, cols, grid, _rule } = this;
    const next: boolean[][] = new Array(rows);
    for (let r = 0; r < rows; r++) {
      const row: boolean[] = new Array(cols);
      for (let c = 0; c < cols; c++) row[c] = _rule(this._countNeighbors(r, c), grid[r][c]);
      next[r] = row;
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) grid[r][c] = next[r][c];
    }
    this._rebuildMesh();
    return this;
  }

  /** Count of the (up to) 8 Moore-neighborhood live neighbors of (row, col),
   *  wrapping toroidally when `wrap` is true (matching 06-game-of-life.js),
   *  or simply not counting off-grid neighbors when false. */
  private _countNeighbors(row: number, col: number): number {
    const { rows, cols, grid, wrap } = this;
    let count = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        let rr = row + dr;
        let cc = col + dc;
        if (wrap) {
          rr = (rr + rows) % rows;
          cc = (cc + cols) % cols;
        } else if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) {
          continue;
        }
        if (grid[rr][cc]) count++;
      }
    }
    return count;
  }

  // Rebuild the alive/dead meshes' subpaths from the current grid. Cell
  // (row, col) occupies a cellSize x cellSize square in world space; the
  // whole grid is centered on the origin, row 0 at the top (world +Y up).
  private _rebuildMesh(): void {
    this._packMesh(this._aliveMesh, (r, c) => this.grid[r][c]);
    if (this._deadMesh) this._packMesh(this._deadMesh, (r, c) => !this.grid[r][c]);
  }

  private _packMesh(mesh: VMobject, alive: (row: number, col: number) => boolean): void {
    mesh.points = [];
    mesh.subpathStarts = [];
    const s = this.cellSize;
    const halfW = (this.cols * s) / 2;
    const halfH = (this.rows * s) / 2;
    for (let r = 0; r < this.rows; r++) {
      const yTop = halfH - r * s;
      const yBot = yTop - s;
      for (let c = 0; c < this.cols; c++) {
        if (!alive(r, c)) continue;
        const xLeft = c * s - halfW;
        const xRight = xLeft + s;
        mesh.startNewPath([xLeft, yTop, 0]);
        mesh.addLineTo([xRight, yTop, 0]);
        mesh.addLineTo([xRight, yBot, 0]);
        mesh.addLineTo([xLeft, yBot, 0]);
        mesh.close();
      }
    }
  }

  // Object.assign (via Mobject.copy()) aliases private mesh references and
  // the grid array -- repoint them at the copy's own cloned submobjects/grid
  // so mutating a copy (e.g. calling .step()) can't retroactively affect the
  // original, mirroring ParticleSystem.copy()'s fix for its bursts array.
  copy(): this {
    const c = super.copy();
    (c as any).grid = this.grid.map((row) => row.slice());
    const aliveIdx = this.submobjects.indexOf(this._aliveMesh);
    (c as any)._aliveMesh = c.submobjects[aliveIdx];
    if (this._deadMesh) {
      const deadIdx = this.submobjects.indexOf(this._deadMesh);
      (c as any)._deadMesh = c.submobjects[deadIdx];
    }
    return c;
  }
}
