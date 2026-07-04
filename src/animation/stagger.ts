// Composable stagger value-transform helpers, usable inline with
// LaggedStartMap's (m, index, total) factory signature or the `.animate`
// builder. Deliberately NOT a generic property-string DSL (mobject.set(name,
// value)) -- no such dispatcher exists on Mobject to build on top of.

/** Index-safe (negative-safe modulo) cycling through a fixed list of values,
 *  mo.js's property-map ergonomic: `cycle(["red", "blue", "green"])`. */
export function cycle<T>(values: readonly T[]): (m: any, index: number, total: number) => T {
  if (values.length === 0) throw new RangeError("cycle() requires at least one value");
  return (_m: any, index: number) => {
    const i = ((index % values.length) + values.length) % values.length;
    return values[i];
  };
}

/** Linear distribution by index across `[from, to]`, anime.js's `modifier`
 *  ergonomic: `staggerRange(0, 1)` gives each of `total` items an even step. */
export function staggerRange(from: number, to: number): (m: any, index: number, total: number) => number {
  return (_m: any, index: number, total: number) => {
    if (total <= 1) return from;
    const t = index / (total - 1);
    return from + (to - from) * t;
  };
}
