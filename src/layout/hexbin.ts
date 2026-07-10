// d3-hexbin equivalent: bin 2D points into a pointy-top hexagonal lattice.
// Lattice math is identical to d3-hexbin: column pitch dx = 2r·sin(π/3),
// row pitch dy = 1.5r, odd rows offset by dx/2, with nearest-center
// disambiguation between the two candidate centers when a point falls in a
// row's overlap band.
//
// Fidelity note: d3-hexbin compares the two candidates in row/column-
// NORMALIZED space ((Δx/dx)² + (Δy/dy)²), not Euclidean space — in a thin
// sliver near hexagon edges this picks a center that is not the Euclidean
// nearest (verified against d3-hexbin 0.2.x: e.g. radius 1, point (0, 0.95)
// bins to (√3/2, 1.5), not (0, 0)). This port reproduces d3's behavior
// bit-for-bit rather than "fixing" it, so ports of d3 examples match.
//
// Documented divergence from d3-hexbin: d3's bins ARE arrays of the binned
// points with `.x`/`.y` bolted on; here each bin is a plain
// `{ x, y, points, length }` object (`points` holds the binned inputs,
// `length === points.length`) — friendlier to TypeScript and JSON.
// Also, d3's `hexagon(radius)` returns RELATIVE path offsets; here
// `hexagonPoints(radius)` returns the six ABSOLUTE corners in the same
// order (starting at the top corner (0, -r), matching d3's path order).
//
// Pure math; isomorphic — no renderer/mobject imports.

const THIRD_PI = Math.PI / 3;

export interface HexbinOptions<T> {
  /** Point accessors (defaults treat T as [x, y]). */
  x?: (d: T, i: number) => number;
  y?: (d: T, i: number) => number;
  /** Hexagon radius: center to corner. */
  radius: number;
  /** [[x0, y0], [x1, y1]] — only used by centers() (default [[0,0],[1,1]]). */
  extent?: [[number, number], [number, number]];
}

export interface HexBin<T> {
  /** Hexagon center. */
  x: number;
  y: number;
  /** The binned input points. */
  points: T[];
  /** Number of points in the bin (=== points.length). */
  length: number;
}

export interface Hexbin<T> {
  /** Bin points into hexagons; empty bins are not returned. Points whose
   *  accessors yield NaN are skipped. */
  bin(points: Iterable<T>): Array<HexBin<T>>;
  /** All lattice centers covering the configured extent. */
  centers(): Array<[number, number]>;
  readonly radius: number;
  /** Horizontal center pitch: 2·radius·sin(π/3). */
  readonly dx: number;
  /** Vertical center pitch: 1.5·radius. */
  readonly dy: number;
}

/** Six corners of a pointy-top hexagon of the given radius, centered on the
 *  origin, starting at the top corner (0, -radius) — d3-hexbin's corner
 *  order (see module header re: absolute vs relative). */
export function hexagonPoints(radius: number): Array<[number, number]> {
  const corners: Array<[number, number]> = [];
  for (let k = 0; k < 6; k++) {
    const angle = k * THIRD_PI;
    corners.push([Math.sin(angle) * radius, -Math.cos(angle) * radius]);
  }
  return corners;
}

/** Create a hexagonal binner (see module header for conventions). */
export function hexbin<T = [number, number]>(options: HexbinOptions<T>): Hexbin<T> {
  const radius = +options.radius;
  if (!(radius > 0)) throw new Error(`hexbin: radius must be > 0, got ${String(options.radius)}`);
  const x = options.x ?? ((d: T) => (d as unknown as ArrayLike<number>)[0]);
  const y = options.y ?? ((d: T) => (d as unknown as ArrayLike<number>)[1]);
  const [[ex0, ey0], [ex1, ey1]] = options.extent ?? [[0, 0], [1, 1]];
  const dx = 2 * radius * Math.sin(THIRD_PI);
  const dy = 1.5 * radius;

  function bin(points: Iterable<T>): Array<HexBin<T>> {
    const binsById = new Map<string, HexBin<T>>();
    const bins: Array<HexBin<T>> = [];
    let i = -1;
    for (const point of points) {
      ++i;
      const px = +x(point, i);
      const py = +y(point, i);
      if (isNaN(px) || isNaN(py)) continue;

      // Nearest row, then nearest column on that (possibly offset) row.
      const py1 = py / dy;
      let pj = Math.round(py1);
      const px1 = px / dx - (pj & 1) / 2;
      let pi = Math.round(px1);
      const py2 = py1 - pj;

      // In the overlap band (|py2|·3 > 1) the true nearest center may be one
      // of the two nearest centers on the ADJACENT row; keep whichever of
      // the two candidates is closer (d3-hexbin's disambiguation).
      if (Math.abs(py2) * 3 > 1) {
        const px2 = px1 - pi;
        const pi2 = pi + (px1 < pi ? -1 : 1) / 2;
        const pj2 = pj + (py1 < pj ? -1 : 1);
        const px3 = px1 - pi2;
        const py3 = py1 - pj2;
        if (px2 * px2 + py2 * py2 > px3 * px3 + py3 * py3) {
          pi = pi2 + ((pj & 1) ? 1 : -1) / 2;
          pj = pj2;
        }
      }

      const id = `${pi}-${pj}`;
      let b = binsById.get(id);
      if (b) {
        b.points.push(point);
        b.length++;
      } else {
        b = { x: (pi + (pj & 1) / 2) * dx, y: pj * dy, points: [point], length: 1 };
        binsById.set(id, b);
        bins.push(b);
      }
    }
    return bins;
  }

  function centers(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    let j = Math.round(ey0 / dy);
    const i0 = Math.round(ex0 / dx);
    for (let cy = j * dy; cy < ey1 + radius; cy += dy, ++j) {
      for (let cx = i0 * dx + ((j & 1) * dx) / 2; cx < ex1 + dx / 2; cx += dx) {
        out.push([cx, cy]);
      }
    }
    return out;
  }

  return { bin, centers, radius, dx, dy };
}
