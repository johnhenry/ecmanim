// d3-array essentials (D3-parity campaign, cluster D1): the grouping /
// statistics helpers the gallery scenes lean on. Pure, isomorphic, no deps.
// Naming follows d3 so ports read 1:1; Map keys follow JS Map semantics
// (identity for objects — d3's InternMap string-interning divergence is
// documented in the campaign README).

export function ascending(a: any, b: any): number {
  return a == null || b == null ? NaN : a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN;
}

export function descending(a: any, b: any): number {
  return a == null || b == null ? NaN : b < a ? -1 : b > a ? 1 : b >= a ? 0 : NaN;
}

export function extent<T>(values: Iterable<T>, accessor?: (d: T, i: number) => number | null | undefined): [number, number] {
  let min = Infinity, max = -Infinity, i = 0;
  for (const d of values) {
    const v = accessor ? accessor(d, i++) : (d as unknown as number);
    if (v == null || Number.isNaN(+v)) continue;
    if (+v < min) min = +v;
    if (+v > max) max = +v;
  }
  return min <= max ? [min, max] : [NaN, NaN];
}

export function max<T>(values: Iterable<T>, accessor?: (d: T, i: number) => number | null | undefined): number {
  return extent(values, accessor)[1];
}

export function min<T>(values: Iterable<T>, accessor?: (d: T, i: number) => number | null | undefined): number {
  return extent(values, accessor)[0];
}

export function sum<T>(values: Iterable<T>, accessor?: (d: T, i: number) => number | null | undefined): number {
  let s = 0, i = 0;
  for (const d of values) {
    const v = accessor ? accessor(d, i++) : (d as unknown as number);
    if (v != null && !Number.isNaN(+v)) s += +v;
  }
  return s;
}

export function mean<T>(values: Iterable<T>, accessor?: (d: T, i: number) => number | null | undefined): number {
  let s = 0, n = 0, i = 0;
  for (const d of values) {
    const v = accessor ? accessor(d, i++) : (d as unknown as number);
    if (v != null && !Number.isNaN(+v)) { s += +v; n++; }
  }
  return n ? s / n : NaN;
}

/** d3.range: arithmetic progression [start, stop) by step. */
export function rangeOf(start: number, stop?: number, step = 1): number[] {
  if (stop === undefined) { stop = start; start = 0; }
  const n = Math.max(0, Math.ceil((stop - start) / step));
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = start + i * step;
  return out;
}

/** R-7 quantile on an UNSORTED copy (matches d3.quantile). */
export function quantile(values: Iterable<number>, p: number, accessor?: (d: any, i: number) => number): number {
  let arr: number[] = [];
  let i = 0;
  for (const d of values) {
    const v = accessor ? accessor(d, i++) : (d as unknown as number);
    if (v != null && !Number.isNaN(+v)) arr.push(+v);
  }
  arr.sort((a, b) => a - b);
  const n = arr.length;
  if (!n) return NaN;
  if (p <= 0 || n < 2) return arr[0];
  if (p >= 1) return arr[n - 1];
  const h = (n - 1) * p;
  const i0 = Math.floor(h);
  return arr[i0] + (arr[i0 + 1] - arr[i0]) * (h - i0);
}

export function group<T, K>(values: Iterable<T>, key: (d: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const d of values) {
    const k = key(d);
    const g = m.get(k);
    if (g) g.push(d); else m.set(k, [d]);
  }
  return m;
}

export function groups<T, K>(values: Iterable<T>, key: (d: T) => K): Array<[K, T[]]> {
  return [...group(values, key)];
}

export function rollup<T, K, V>(values: Iterable<T>, reduce: (group: T[]) => V, key: (d: T) => K): Map<K, V> {
  const m = new Map<K, V>();
  for (const [k, g] of group(values, key)) m.set(k, reduce(g));
  return m;
}

export function rollups<T, K, V>(values: Iterable<T>, reduce: (group: T[]) => V, key: (d: T) => K): Array<[K, V]> {
  return [...rollup(values, reduce, key)];
}

/** d3.groupSort: keys of group(values, key) sorted by comparing reduced groups. */
export function groupSort<T, K>(
  values: Iterable<T>,
  reduceOrCompare: ((group: T[]) => any) | ((a: T[], b: T[]) => number),
  key: (d: T) => K,
): K[] {
  const grouped = groups(values, key);
  // Heuristic matching d3: arity 1 = reducer (sort by reduced value),
  // arity 2 = comparator over the group arrays.
  if (reduceOrCompare.length === 1) {
    const reduce = reduceOrCompare as (group: T[]) => any;
    return grouped
      .map(([k, g]) => [k, reduce(g)] as [K, any])
      .sort((a, b) => ascending(a[1], b[1]))
      .map(([k]) => k);
  }
  const compare = reduceOrCompare as (a: T[], b: T[]) => number;
  return grouped.sort((a, b) => compare(a[1], b[1])).map(([k]) => k);
}

/** d3.pairs: consecutive pairs [[a,b],[b,c],...]. */
export function pairs<T, R = [T, T]>(values: Iterable<T>, reducer?: (a: T, b: T) => R): R[] {
  const out: R[] = [];
  let prev: T | undefined;
  let first = true;
  for (const d of values) {
    if (!first) out.push(reducer ? reducer(prev as T, d) : ([prev, d] as unknown as R));
    prev = d;
    first = false;
  }
  return out;
}

// --- d3's tick algorithm (powers of 10 x {1, 2, 5}) -------------------------

const E10 = Math.sqrt(50), E5 = Math.sqrt(10), E2 = Math.sqrt(2);

/** The step d3 would pick for ~count ticks across [start, stop].
 *  Negative return = inverse step (1/-step), exactly like d3.tickIncrement. */
export function tickIncrement(start: number, stop: number, count: number): number {
  const step = (stop - start) / Math.max(0, count);
  const power = Math.floor(Math.log(step) / Math.LN10);
  const error = step / Math.pow(10, power);
  return power >= 0
    ? (error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1) * Math.pow(10, power)
    : -Math.pow(10, -power) / (error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1);
}

export function tickStep(start: number, stop: number, count: number): number {
  const inc = tickIncrement(start, stop, count);
  return inc < 0 ? 1 / -inc : inc;
}

/** d3.ticks: nice round values covering [start, stop] with ~count entries. */
export function ticks(start: number, stop: number, count: number): number[] {
  if (!(count > 0)) return [];
  if (start === stop) return [start];
  const reverse = stop < start;
  if (reverse) [start, stop] = [stop, start];
  const inc = tickIncrement(start, stop, count);
  if (inc === 0 || !isFinite(inc)) return [];
  let out: number[];
  if (inc > 0) {
    const lo = Math.ceil(start / inc);
    const hi = Math.floor(stop / inc);
    out = rangeOf(lo, hi + 1).map((i) => i * inc);
  } else {
    const lo = Math.ceil(start * -inc);
    const hi = Math.floor(stop * -inc);
    out = rangeOf(lo, hi + 1).map((i) => i / -inc);
  }
  return reverse ? out.reverse() : out;
}

/** Expand [start, stop] outward to tick-aligned bounds (d3.nice). */
export function niceExtent(start: number, stop: number, count: number): [number, number] {
  let prestep: number | undefined;
  for (let iter = 0; iter < 10; iter++) {
    const step = tickIncrement(start, stop, count);
    if (step === prestep || step === 0 || !isFinite(step)) break;
    if (step > 0) {
      start = Math.floor(start / step) * step;
      stop = Math.ceil(stop / step) * step;
    } else {
      // Inverse (fractional) step: multiply by -step, expand OUTWARD
      // (floor the start, ceil the stop), divide back.
      start = Math.floor(start * -step) / -step;
      stop = Math.ceil(stop * -step) / -step;
    }
    prestep = step;
  }
  return [start, stop];
}
