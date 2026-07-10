// Marching squares over a caller-supplied scalar grid → filled isobands as
// GeoJSON-like MultiPolygons, following d3-contour's conventions: values are
// treated as unit pixels (sample i,j covers [i,i+1]×[j,j+1]), ring
// coordinates live in [0,w]×[0,h] grid space (y increases with row index,
// i.e. y-DOWN), rings are CLOSED (first point === last point), exterior
// rings have positive signed area under d3's y-down area convention
// (counterclockwise on screen) and holes negative, and holes are attached to
// the polygon of the exterior ring that contains them.
//
// The virtual border outside the grid is "below threshold", so regions
// touching the edge still produce closed rings. Saddle cells (two opposite
// corners above) are disambiguated by the cell-center average: center above
// threshold connects the diagonal, below separates it. Crossing positions
// are linearly interpolated when `smooth` (default true); otherwise they sit
// on the mid-pixel lattice.
//
// Pure math; isomorphic — no renderer/mobject imports.

import { ticks, niceExtent } from "../core/array_utils.ts";

export type ContourRing = Array<[number, number]>;

/** One filled isoband: everything with value >= `value`. */
export interface ContourMultiPolygon {
  type: "MultiPolygon";
  value: number;
  /** polygons → [exterior, ...holes] → closed rings of [x, y]. */
  coordinates: ContourRing[][];
}

export interface ContoursOptions {
  /** Grid dimensions [width, height]; values.length must be >= width*height,
   *  indexed values[y * width + x]. */
  size: [number, number];
  /** Linear interpolation of crossing positions (default true). */
  smooth?: boolean;
}

export interface ContourGenerator {
  /** The isoband where values >= threshold, as a MultiPolygon of closed rings. */
  contour(values: ArrayLike<number>, threshold: number): ContourMultiPolygon;
  readonly size: [number, number];
  readonly smooth: boolean;
}

type Pt = [number, number];
type Segment = [Pt, Pt];
type Fragment = { start: number; end: number; ring: Pt[] };

// Marching-squares segment templates per 4-bit case (d3-contour's table).
// Corner bits: 1 = bottom-left, 2 = bottom-right, 4 = top-right, 8 = top-left
// (in grid/y-down orientation); segments are oriented with the above-region
// on the left so stitched rings wind consistently.
const CASES: ReadonlyArray<ReadonlyArray<Segment>> = [
  [],
  [[[1.0, 1.5], [0.5, 1.0]]],
  [[[1.5, 1.0], [1.0, 1.5]]],
  [[[1.5, 1.0], [0.5, 1.0]]],
  [[[1.0, 0.5], [1.5, 1.0]]],
  [[[1.0, 1.5], [0.5, 1.0]], [[1.0, 0.5], [1.5, 1.0]]],
  [[[1.0, 0.5], [1.0, 1.5]]],
  [[[1.0, 0.5], [0.5, 1.0]]],
  [[[0.5, 1.0], [1.0, 0.5]]],
  [[[1.0, 1.5], [1.0, 0.5]]],
  [[[0.5, 1.0], [1.0, 0.5]], [[1.5, 1.0], [1.0, 1.5]]],
  [[[1.5, 1.0], [1.0, 0.5]]],
  [[[0.5, 1.0], [1.5, 1.0]]],
  [[[1.0, 1.5], [1.5, 1.0]]],
  [[[0.5, 1.0], [1.0, 1.5]]],
  [],
];

// Saddle alternates used when the cell-center average is ABOVE the
// threshold: the two above-corners connect through the center, so the
// segments pair the other way (compositions of cases 7+13 and 11+14).
const CASE5_CONNECTED: ReadonlyArray<Segment> = [
  [[1.0, 0.5], [0.5, 1.0]],
  [[1.0, 1.5], [1.5, 1.0]],
];
const CASE10_CONNECTED: ReadonlyArray<Segment> = [
  [[1.5, 1.0], [1.0, 0.5]],
  [[0.5, 1.0], [1.0, 1.5]],
];

// Non-finite / missing samples count as -Infinity (always below threshold).
function valid(v: number | undefined): number {
  return v == null || isNaN((v = +v)) ? -Infinity : v;
}

// d3-contour's area: twice the signed ring area, positive for exterior
// rings (counterclockwise in y-down screen space).
function ringArea(ring: Pt[]): number {
  const n = ring.length;
  let area = ring[n - 1][1] * ring[0][0] - ring[n - 1][0] * ring[0][1];
  for (let i = 1; i < n; i++) area += ring[i - 1][1] * ring[i][0] - ring[i - 1][0] * ring[i][1];
  return area;
}

function segmentContains(a: Pt, b: Pt, c: Pt): boolean {
  // collinear?
  if ((b[0] - a[0]) * (c[1] - a[1]) !== (c[0] - a[0]) * (b[1] - a[1])) return false;
  const i = a[0] === b[0] ? 1 : 0; // vertical segment: compare on y
  return collinearBetween(a[i], c[i], b[i]);
}

function collinearBetween(p: number, q: number, r: number): boolean {
  return (p <= q && q <= r) || (r <= q && q <= p);
}

// 1 = inside, -1 = outside, 0 = on the boundary.
function ringContains(ring: Pt[], point: Pt): number {
  const [x, y] = point;
  let contains = -1;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (segmentContains(ring[i], ring[j], point)) return 0;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) contains = -contains;
  }
  return contains;
}

// Does `ring` contain `hole`? (first hole vertex that is decisively in/out)
function contains(ring: Pt[], hole: Pt[]): number {
  for (const p of hole) {
    const c = ringContains(ring, p);
    if (c) return c;
  }
  return 0;
}

/**
 * Build a contour generator over a `size = [width, height]` grid. Feed it a
 * flat row-major `values` array (index `y * width + x`) and a threshold.
 */
export function contours(options: ContoursOptions): ContourGenerator {
  const [dx, dy] = options.size;
  if (!(Number.isInteger(dx) && Number.isInteger(dy) && dx > 0 && dy > 0)) {
    throw new Error(`contours: size must be positive integers, got [${dx}, ${dy}]`);
  }
  const smooth = options.smooth !== false;

  function contour(values: ArrayLike<number>, threshold: number): ContourMultiPolygon {
    const v = +threshold;
    if (isNaN(v)) throw new Error(`contours.contour: invalid threshold ${String(threshold)}`);
    if (values.length < dx * dy) {
      throw new Error(`contours.contour: expected ${dx * dy} values (=${dx}x${dy}), got ${values.length}`);
    }
    const polygons: ContourRing[][] = [];
    const holes: ContourRing[] = [];
    isorings(values, v, (ring) => {
      if (smooth) smoothLinear(ring, values, v);
      if (ringArea(ring) > 0) polygons.push([ring]);
      else holes.push(ring);
    });
    for (const hole of holes) {
      for (const polygon of polygons) {
        if (contains(polygon[0], hole) !== -1) {
          polygon.push(hole);
          break;
        }
      }
    }
    return { type: "MultiPolygon", value: v, coordinates: polygons };
  }

  // Marching squares emitting CLOSED rings: cell segments are stitched into
  // fragments keyed by their endpoints on a half-integer lattice; when a
  // fragment closes on itself it is a finished ring. The scan covers a
  // virtual border (y = -1 row, x = -1 column, etc.) where everything is
  // below threshold, so edge-touching regions still close.
  function isorings(values: ArrayLike<number>, value: number, callback: (ring: Pt[]) => void): void {
    const fragmentByStart = new Map<number, Fragment>();
    const fragmentByEnd = new Map<number, Fragment>();
    let x = -1;
    let y = -1;
    let t0: number, t1: number, t2: number, t3: number;

    const above = (i: number): number => {
      const val = values[i];
      return val != null && +val >= value ? 1 : 0;
    };

    // Unique index for a half-integer lattice point.
    const index = (p: Pt): number => p[0] * 2 + p[1] * (dx + 1) * 4;

    function stitch(line: Segment): void {
      const start: Pt = [line[0][0] + x, line[0][1] + y];
      const end: Pt = [line[1][0] + x, line[1][1] + y];
      const startIndex = index(start);
      const endIndex = index(end);
      let f = fragmentByEnd.get(startIndex);
      if (f) {
        const g = fragmentByStart.get(endIndex);
        if (g) {
          fragmentByEnd.delete(f.end);
          fragmentByStart.delete(g.start);
          if (f === g) {
            f.ring.push(end); // closes the ring: first point === last point
            callback(f.ring);
          } else {
            const merged: Fragment = { start: f.start, end: g.end, ring: f.ring.concat(g.ring) };
            fragmentByStart.set(f.start, merged);
            fragmentByEnd.set(g.end, merged);
          }
        } else {
          fragmentByEnd.delete(f.end);
          f.ring.push(end);
          f.end = endIndex;
          fragmentByEnd.set(endIndex, f);
        }
      } else if ((f = fragmentByStart.get(endIndex))) {
        // (The symmetric merge case is unreachable here: fragmentByEnd has
        // no entry at startIndex, or the branch above would have taken it.)
        fragmentByStart.delete(f.start);
        f.ring.unshift(start);
        f.start = startIndex;
        fragmentByStart.set(startIndex, f);
      } else {
        const frag: Fragment = { start: startIndex, end: endIndex, ring: [start, end] };
        fragmentByStart.set(startIndex, frag);
        fragmentByEnd.set(endIndex, frag);
      }
    }

    // Emit the segments for a cell case; saddles (5, 10) are disambiguated
    // by the cell-center average. Saddles only arise in interior cells, so
    // all four samples exist.
    function emit(caseIndex: number): void {
      let segs = CASES[caseIndex];
      if (caseIndex === 5 || caseIndex === 10) {
        const center =
          (valid(values[(y + 1) * dx + x]) +
            valid(values[(y + 1) * dx + x + 1]) +
            valid(values[y * dx + x + 1]) +
            valid(values[y * dx + x])) /
          4;
        if (center >= value) segs = caseIndex === 5 ? CASE5_CONNECTED : CASE10_CONNECTED;
      }
      for (const line of segs) stitch(line);
    }

    // First row (y = -1): the row above the grid is all below.
    x = y = -1;
    t1 = above(0);
    emit(t1 << 1);
    while (++x < dx - 1) {
      t0 = t1;
      t1 = above(x + 1);
      emit(t0 | (t1 << 1));
    }
    emit(t1 << 0);

    // Intermediate rows.
    while (++y < dy - 1) {
      x = -1;
      t1 = above(y * dx + dx);
      t2 = above(y * dx);
      emit((t1 << 1) | (t2 << 2));
      while (++x < dx - 1) {
        t0 = t1;
        t1 = above(y * dx + dx + x + 1);
        t3 = t2;
        t2 = above(y * dx + x + 1);
        emit(t0 | (t1 << 1) | (t2 << 2) | (t3 << 3));
      }
      emit(t1 | (t2 << 3));
    }

    // Last row (y = dy - 1): the row below the grid is all below.
    x = -1;
    t2 = above(y * dx);
    emit(t2 << 2);
    while (++x < dx - 1) {
      t3 = t2;
      t2 = above(y * dx + x + 1);
      emit((t2 << 2) | (t3 << 3));
    }
    emit(t2 << 3);
  }

  // Move each crossing point to the linearly-interpolated threshold position
  // between its two neighboring samples (d3's smoothLinear). Unsmoothed
  // crossings sit at integer coordinates (pixel boundaries); the smoothed
  // position lies within ±0.5 of that.
  function smoothLinear(ring: Pt[], values: ArrayLike<number>, value: number): void {
    for (const point of ring) {
      const px = point[0];
      const py = point[1];
      const xt = px | 0;
      const yt = py | 0;
      const v1 = valid(values[yt * dx + xt]);
      if (px > 0 && px < dx && xt === px) {
        point[0] = smooth1(px, valid(values[yt * dx + xt - 1]), v1, value);
      }
      if (py > 0 && py < dy && yt === py) {
        point[1] = smooth1(py, valid(values[(yt - 1) * dx + xt]), v1, value);
      }
    }
  }

  return { contour, size: [dx, dy], smooth };
}

function smooth1(coord: number, v0: number, v1: number, value: number): number {
  const a = value - v0;
  const b = v1 - v0;
  const d = isFinite(a) || isFinite(b) ? a / b : Math.sign(a) / Math.sign(b);
  return isNaN(d) ? coord : coord + d - 0.5;
}

/**
 * Threshold helper for `.contour()`: given a count, returns ~count nice tick
 * values over the finite extent of `values` (d3's `thresholds(count)`
 * behavior — the lowest tick may sit just below the minimum, forming the
 * base band; ticks at/above the maximum are dropped). Given an array, it
 * passes through as numbers.
 */
export function contourThresholds(
  values: ArrayLike<number>,
  count: number | ArrayLike<number>,
): number[] {
  if (typeof count !== "number") return Array.from(count, Number);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = +values[i];
    if (isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min > max) return []; // no finite values
  if (min === max) return [min];
  const [lo, hi] = niceExtent(min, max, count);
  const tz = ticks(lo, hi, count);
  while (tz.length && tz[tz.length - 1] >= max) tz.pop();
  while (tz.length > 1 && tz[1] < min) tz.shift();
  return tz;
}
