// d3-scale equivalents (D3-parity campaign, cluster D1). Pure, isomorphic.
//
// API STYLE: chainable getter/setter (`scaleLinear().domain([0,1]).range(
// [0,720])`), deliberately breaking ecmanim's config-object convention —
// these exist so D3 gallery ports read line-for-line, and D3 code is
// wall-to-wall chained scale calls. Every scale is also just a callable
// function, like d3's.

import { ticks, tickIncrement, niceExtent, tickStep } from "./array_utils.ts";
import { formatSpecifierAuto, format } from "./format.ts";

type Numeric = number | Date | { valueOf(): number };

const num = (v: Numeric): number => +v;

// --- continuous base ---------------------------------------------------------

export interface ScaleLinear {
  (value: Numeric): number;
  invert(pixel: number): number;
  domain(): number[];
  domain(d: Numeric[]): ScaleLinear;
  range(): number[];
  range(r: number[]): ScaleLinear;
  clamp(): boolean;
  clamp(c: boolean): ScaleLinear;
  ticks(count?: number): number[];
  tickFormat(count?: number, specifier?: string): (v: number) => string;
  nice(count?: number): ScaleLinear;
  copy(): ScaleLinear;
}

function makeContinuous(
  transform: (v: number) => number,
  untransform: (v: number) => number,
): ScaleLinear {
  let domain: number[] = [0, 1];
  let range: number[] = [0, 1];
  let clamped = false;

  // Piecewise linear over transformed domain (supports polylinear like d3).
  const scale = ((value: Numeric): number => {
    let v = transform(num(value));
    const n = Math.min(domain.length, range.length) - 1;
    const td = domain.map(transform);
    if (clamped) {
      const lo = Math.min(td[0], td[n]), hi = Math.max(td[0], td[n]);
      v = Math.max(lo, Math.min(hi, v));
    }
    // Find segment.
    let i = 0;
    const asc = td[n] >= td[0];
    while (i < n - 1 && (asc ? v > td[i + 1] : v < td[i + 1])) i++;
    const t0 = td[i], t1 = td[i + 1];
    const r0 = range[i], r1 = range[i + 1];
    const t = t1 === t0 ? 0.5 : (v - t0) / (t1 - t0);
    return r0 + (r1 - r0) * t;
  }) as ScaleLinear;

  scale.invert = (pixel: number): number => {
    const n = Math.min(domain.length, range.length) - 1;
    const td = domain.map(transform);
    let i = 0;
    const asc = range[n] >= range[0];
    while (i < n - 1 && (asc ? pixel > range[i + 1] : pixel < range[i + 1])) i++;
    const r0 = range[i], r1 = range[i + 1];
    const t = r1 === r0 ? 0.5 : (pixel - r0) / (r1 - r0);
    return untransform(td[i] + (td[i + 1] - td[i]) * t);
  };

  scale.domain = ((d?: Numeric[]) => {
    if (d === undefined) return [...domain];
    domain = d.map(num);
    return scale;
  }) as ScaleLinear["domain"];

  scale.range = ((r?: number[]) => {
    if (r === undefined) return [...range];
    range = [...r];
    return scale;
  }) as ScaleLinear["range"];

  scale.clamp = ((c?: boolean) => {
    if (c === undefined) return clamped;
    clamped = c;
    return scale;
  }) as ScaleLinear["clamp"];

  scale.ticks = (count = 10): number[] => {
    // Log scales get their own ticks override; the base is linear-space.
    return ticks(domain[0], domain[domain.length - 1], count);
  };

  scale.tickFormat = (count = 10, specifier?: string): ((v: number) => string) => {
    const [a, b] = [domain[0], domain[domain.length - 1]];
    return format(specifier ?? formatSpecifierAuto(a, b, count));
  };

  scale.nice = (count = 10): ScaleLinear => {
    const n = domain.length - 1;
    const [lo, hi] = niceExtent(domain[0], domain[n], count);
    domain[0] = lo;
    domain[n] = hi;
    return scale;
  };

  scale.copy = (): ScaleLinear =>
    makeContinuous(transform, untransform).domain(domain).range(range).clamp(clamped);

  return scale;
}

export function scaleLinear(domain?: Numeric[], range?: number[]): ScaleLinear {
  const s = makeContinuous((v) => v, (v) => v);
  if (domain) s.domain(domain);
  if (range) s.range(range);
  return s;
}

export function scaleLog(domain?: Numeric[], range?: number[]): ScaleLinear {
  const s = makeContinuous(Math.log, Math.exp);
  if (domain) s.domain(domain); else s.domain([1, 10]);
  if (range) s.range(range);
  // Log ticks: powers of the (assumed 10) base with 1..9 mantissas like d3.
  s.ticks = (count = 10): number[] => {
    const d = s.domain();
    let lo = d[0], hi = d[d.length - 1];
    const reverse = hi < lo;
    if (reverse) [lo, hi] = [hi, lo];
    let i = Math.floor(Math.log10(lo));
    const j = Math.ceil(Math.log10(hi));
    const out: number[] = [];
    if (j - i < count) {
      for (; i <= j; i++) {
        for (let k = 1; k < 10; k++) {
          const t = k * Math.pow(10, i);
          if (t >= lo && t <= hi) out.push(t);
        }
      }
      if (out.length * 2 < count) return ticks(lo, hi, count);
    } else {
      const step = Math.ceil((j - i) / Math.max(1, count));
      for (; i <= j; i += step) {
        const t = Math.pow(10, i);
        if (t >= lo && t <= hi) out.push(t);
      }
    }
    return reverse ? out.reverse() : out;
  };
  return s;
}

export function scalePow(exponent = 1, domain?: Numeric[], range?: number[]): ScaleLinear {
  const t = (v: number) => (v < 0 ? -Math.pow(-v, exponent) : Math.pow(v, exponent));
  const u = (v: number) => (v < 0 ? -Math.pow(-v, 1 / exponent) : Math.pow(v, 1 / exponent));
  const s = makeContinuous(t, u);
  if (domain) s.domain(domain);
  if (range) s.range(range);
  return s;
}

export function scaleSqrt(domain?: Numeric[], range?: number[]): ScaleLinear {
  return scalePow(0.5, domain, range);
}

/** d3.scaleRadial: linear in AREA (radius ∝ sqrt) — bar length on a radial
 *  chart reads truthfully. */
export function scaleRadial(domain?: Numeric[], range?: number[]): ScaleLinear {
  const square = (v: number) => Math.sign(v) * v * v;
  const unsquare = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
  let inner = makeContinuous((v) => v, (v) => v);
  const s = ((value: Numeric): number =>
    unsquare(inner(num(value)))) as ScaleLinear;
  s.invert = (pixel: number) => inner.invert(square(pixel));
  s.domain = ((d?: Numeric[]) => (d === undefined ? inner.domain() : (inner.domain(d), s))) as ScaleLinear["domain"];
  s.range = ((r?: number[]) => (r === undefined ? inner.range().map(unsquare) : (inner.range(r.map(square)), s))) as ScaleLinear["range"];
  s.clamp = ((c?: boolean) => (c === undefined ? inner.clamp() : (inner.clamp(c), s))) as ScaleLinear["clamp"];
  s.ticks = (count = 10) => inner.ticks(count);
  s.tickFormat = (count = 10, spec?: string) => inner.tickFormat(count, spec);
  s.nice = (count = 10) => (inner.nice(count), s);
  s.copy = () => {
    const c = scaleRadial(inner.domain(), inner.range().map(unsquare));
    return c;
  };
  if (domain) s.domain(domain);
  if (range) s.range(range);
  return s;
}

// --- time --------------------------------------------------------------------

/** scaleUtc/scaleTime: linear over epoch ms; ticks snap to natural time
 *  boundaries (s/min/h/day/week/month/year) like d3's tickInterval table. */
export interface ScaleTime extends Omit<ScaleLinear, "ticks" | "invert" | "domain" | "copy"> {
  (value: Date | number): number;
  invert(pixel: number): Date;
  domain(): Date[];
  domain(d: Array<Date | number>): ScaleTime;
  ticks(count?: number): Date[];
  copy(): ScaleTime;
}

const durationSecond = 1000, durationMinute = 60_000, durationHour = 3_600_000,
  durationDay = 86_400_000, durationWeek = 604_800_000,
  durationMonth = 2_592_000_000, durationYear = 31_536_000_000;

// [duration-per-step, floor fn, step count] ladder (UTC).
const TIME_INTERVALS: Array<[number, (d: Date) => Date, (d: Date, n: number) => void]> = [
  [durationSecond, (d) => new Date(Math.floor(+d / 1000) * 1000), (d, n) => d.setTime(+d + n * 1000)],
  [durationMinute, (d) => new Date(Math.floor(+d / 60000) * 60000), (d, n) => d.setTime(+d + n * 60000)],
  [durationHour, (d) => new Date(Math.floor(+d / 3600000) * 3600000), (d, n) => d.setTime(+d + n * 3600000)],
  [durationDay, (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), (d, n) => d.setUTCDate(d.getUTCDate() + n)],
  [durationWeek, (d) => { const f = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); f.setUTCDate(f.getUTCDate() - f.getUTCDay()); return f; }, (d, n) => d.setUTCDate(d.getUTCDate() + 7 * n)],
  [durationMonth, (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), (d, n) => d.setUTCMonth(d.getUTCMonth() + n)],
  [durationYear, (d) => new Date(Date.UTC(d.getUTCFullYear(), 0, 1)), (d, n) => d.setUTCFullYear(d.getUTCFullYear() + n)],
];
const TIME_STEPS: Array<[number, number]> = [
  // [interval index, multiple]
  [0, 1], [0, 5], [0, 15], [0, 30],
  [1, 1], [1, 5], [1, 15], [1, 30],
  [2, 1], [2, 3], [2, 6], [2, 12],
  [3, 1], [3, 2],
  [4, 1],
  [5, 1], [5, 3],
  [6, 1],
];

export function scaleUtc(domain?: Array<Date | number>, range?: number[]): ScaleTime {
  const inner = scaleLinear();
  const s = ((value: Date | number): number => inner(+value)) as ScaleTime;
  s.invert = (pixel: number) => new Date(inner.invert(pixel));
  s.domain = ((d?: Array<Date | number>) => {
    if (d === undefined) return inner.domain().map((v) => new Date(v));
    inner.domain(d.map((v) => +v));
    return s;
  }) as ScaleTime["domain"];
  s.range = ((r?: number[]) => (r === undefined ? inner.range() : (inner.range(r), s))) as ScaleTime["range"];
  s.clamp = ((c?: boolean) => (c === undefined ? inner.clamp() : (inner.clamp(c), s))) as ScaleTime["clamp"];
  s.ticks = (count = 10): Date[] => {
    const d = inner.domain();
    const lo = d[0], hi = d[d.length - 1];
    const span = Math.abs(hi - lo);
    const target = span / count;
    // Pick the smallest step whose duration >= target.
    let pick: [number, number] | null = null;
    for (const [idx, mult] of TIME_STEPS) {
      if (TIME_INTERVALS[idx][0] * mult >= target) { pick = [idx, mult]; break; }
    }
    if (!pick) {
      // Years, multi-step nice.
      const yearStep = Math.max(1, Math.round(tickStep(lo / durationYear, hi / durationYear, count)));
      const out: Date[] = [];
      const first = new Date(Date.UTC(new Date(lo).getUTCFullYear(), 0, 1));
      for (const t = first; +t <= hi; t.setUTCFullYear(t.getUTCFullYear() + yearStep)) {
        if (+t >= lo) out.push(new Date(+t));
      }
      return out;
    }
    const [idx, mult] = pick;
    const [, floor, offset] = TIME_INTERVALS[idx];
    const out: Date[] = [];
    const t = floor(new Date(lo));
    while (+t < lo) offset(t, mult);
    while (+t <= hi) { out.push(new Date(+t)); offset(t, mult); }
    return out;
  };
  s.tickFormat = () => {
    // Multi-scale label like d3: pick by boundary significance.
    return ((v: any) => {
      const d = v instanceof Date ? v : new Date(v);
      if (d.getUTCMonth() === 0 && d.getUTCDate() === 1 && d.getUTCHours() === 0) return String(d.getUTCFullYear());
      if (d.getUTCDate() === 1 && d.getUTCHours() === 0) return MONTHS_ABBR[d.getUTCMonth()];
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return `${MONTHS_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}`;
      return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    }) as (v: number) => string;
  };
  s.nice = (count = 10) => {
    const t = s.ticks(count);
    if (t.length > 1) {
      const d = inner.domain();
      const span = +t[1] - +t[0];
      inner.domain([Math.floor(d[0] / span) * span, Math.ceil(d[d.length - 1] / span) * span]);
    }
    return s as unknown as ScaleLinear;
  };
  s.copy = () => scaleUtc(s.domain(), inner.range());
  if (domain) s.domain(domain);
  if (range) s.range(range);
  return s;
}

export const scaleTime = scaleUtc; // UTC semantics for deterministic renders.

const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// --- ordinal family -----------------------------------------------------------

export interface ScaleBand {
  (value: any): number;
  domain(): any[];
  domain(d: Iterable<any>): ScaleBand;
  range(): [number, number];
  range(r: [number, number]): ScaleBand;
  bandwidth(): number;
  step(): number;
  padding(p: number): ScaleBand;
  paddingInner(p: number): ScaleBand;
  paddingOuter(p: number): ScaleBand;
  align(a: number): ScaleBand;
  round(r: boolean): ScaleBand;
  copy(): ScaleBand;
}

export function scaleBand(domain?: Iterable<any>, range?: [number, number]): ScaleBand {
  let dom: any[] = [];
  let r0 = 0, r1 = 1;
  let padInner = 0, padOuter = 0, align = 0.5, round = false;
  const index = new Map<any, number>();

  let bandwidth = 0, step = 0, start = 0;
  const rescale = () => {
    const n = dom.length;
    const reverse = r1 < r0;
    let lo = reverse ? r1 : r0;
    const hi = reverse ? r0 : r1;
    step = (hi - lo) / Math.max(1, n - padInner + padOuter * 2);
    if (round) step = Math.floor(step);
    lo += (hi - lo - step * (n - padInner)) * align;
    bandwidth = step * (1 - padInner);
    if (round) { lo = Math.round(lo); bandwidth = Math.round(bandwidth); }
    start = reverse ? lo + step * (n - 1) : lo;
    if (reverse) step = -step;
  };

  const scale = ((value: any): number => {
    const i = index.get(value);
    return i === undefined ? NaN : start + step * i;
  }) as ScaleBand;

  scale.domain = ((d?: Iterable<any>) => {
    if (d === undefined) return [...dom];
    dom = [];
    index.clear();
    for (const v of d) {
      if (!index.has(v)) { index.set(v, dom.length); dom.push(v); }
    }
    rescale();
    return scale;
  }) as ScaleBand["domain"];
  scale.range = ((r?: [number, number]) => {
    if (r === undefined) return [r0, r1] as [number, number];
    [r0, r1] = r;
    rescale();
    return scale;
  }) as ScaleBand["range"];
  scale.bandwidth = () => Math.abs(bandwidth);
  scale.step = () => Math.abs(step);
  scale.padding = (p: number) => { padInner = Math.min(1, p); padOuter = p; rescale(); return scale; };
  scale.paddingInner = (p: number) => { padInner = Math.min(1, p); rescale(); return scale; };
  scale.paddingOuter = (p: number) => { padOuter = p; rescale(); return scale; };
  scale.align = (a: number) => { align = Math.max(0, Math.min(1, a)); rescale(); return scale; };
  scale.round = (r: boolean) => { round = r; rescale(); return scale; };
  scale.copy = () => {
    const c = scaleBand(dom, [r0, r1]).paddingInner(padInner).paddingOuter(padOuter).align(align).round(round);
    return c;
  };
  if (domain) scale.domain(domain);
  if (range) scale.range(range);
  rescale();
  return scale;
}

/** scalePoint = scaleBand with zero bandwidth (points at band centers). */
export function scalePoint(domain?: Iterable<any>, range?: [number, number]): ScaleBand {
  const s = scaleBand(domain, range);
  s.paddingInner(1);
  const origPadding = s.padding;
  s.padding = (p: number) => { s.paddingOuter(p); return s; };
  void origPadding;
  return s;
}

export interface ScaleOrdinal<R = any> {
  (value: any): R;
  domain(): any[];
  domain(d: Iterable<any>): ScaleOrdinal<R>;
  range(): R[];
  range(r: Iterable<R>): ScaleOrdinal<R>;
}

export function scaleOrdinal<R = any>(domain?: Iterable<any>, range?: Iterable<R>): ScaleOrdinal<R> {
  let dom: any[] = [];
  let rng: R[] = [];
  const index = new Map<any, number>();
  const scale = ((value: any): R => {
    let i = index.get(value);
    if (i === undefined) {
      // Implicit domain growth, like d3.
      i = dom.length;
      index.set(value, i);
      dom.push(value);
    }
    return rng[i % rng.length];
  }) as ScaleOrdinal<R>;
  scale.domain = ((d?: Iterable<any>) => {
    if (d === undefined) return [...dom];
    dom = []; index.clear();
    for (const v of d) if (!index.has(v)) { index.set(v, dom.length); dom.push(v); }
    return scale;
  }) as ScaleOrdinal<R>["domain"];
  scale.range = ((r?: Iterable<R>) => {
    if (r === undefined) return [...rng];
    rng = [...r];
    return scale;
  }) as ScaleOrdinal<R>["range"];
  if (domain) scale.domain(domain);
  if (range) scale.range(range);
  return scale;
}

// --- sequential / quantize / diverging ----------------------------------------

export interface ScaleSequential<R = any> {
  (value: number): R;
  domain(): [number, number];
  domain(d: [number, number]): ScaleSequential<R>;
  interpolator(): (t: number) => R;
  interpolator(fn: (t: number) => R): ScaleSequential<R>;
  ticks(count?: number): number[];
}

export function scaleSequential<R = any>(
  domainOrInterp?: [number, number] | ((t: number) => R),
  maybeInterp?: (t: number) => R,
): ScaleSequential<R> {
  let dom: [number, number] = [0, 1];
  let interp: (t: number) => R = ((t: number) => t) as any;
  if (typeof domainOrInterp === "function") interp = domainOrInterp;
  else if (domainOrInterp) { dom = domainOrInterp; if (maybeInterp) interp = maybeInterp; }
  const scale = ((value: number): R => {
    const t = dom[1] === dom[0] ? 0.5 : (value - dom[0]) / (dom[1] - dom[0]);
    return interp(Math.max(0, Math.min(1, t)));
  }) as ScaleSequential<R>;
  scale.domain = ((d?: [number, number]) => (d === undefined ? [...dom] as [number, number] : ((dom = d), scale))) as ScaleSequential<R>["domain"];
  scale.interpolator = ((fn?: (t: number) => R) => (fn === undefined ? interp : ((interp = fn), scale))) as ScaleSequential<R>["interpolator"];
  scale.ticks = (count = 10) => ticks(dom[0], dom[1], count);
  return scale;
}

/** scaleDiverging: piecewise around a center pivot. */
export function scaleDiverging<R = any>(
  domain: [number, number, number],
  interpolator: (t: number) => R,
): ScaleSequential<R> {
  const [a, b, c] = domain;
  const s = scaleSequential<R>([0, 1] as [number, number], interpolator);
  const scale = ((value: number): R => {
    const t = value < b
      ? 0.5 * (b === a ? 0 : (value - a) / (b - a))
      : 0.5 + 0.5 * (c === b ? 1 : (value - b) / (c - b));
    return interpolator(Math.max(0, Math.min(1, t)));
  }) as ScaleSequential<R>;
  scale.domain = s.domain;
  scale.interpolator = s.interpolator;
  scale.ticks = (count = 10) => ticks(a, c, count);
  return scale;
}

export interface ScaleQuantize<R = any> {
  (value: number): R;
  domain(): [number, number];
  domain(d: [number, number]): ScaleQuantize<R>;
  range(): R[];
  range(r: Iterable<R>): ScaleQuantize<R>;
  invertExtent(v: R): [number, number];
  ticks(count?: number): number[];
}

export function scaleQuantize<R = any>(domain?: [number, number], range?: Iterable<R>): ScaleQuantize<R> {
  let dom: [number, number] = [0, 1];
  let rng: R[] = [0, 1] as any;
  const scale = ((value: number): R => {
    if (value == null || Number.isNaN(+value)) return undefined as any;
    const n = rng.length;
    const t = (value - dom[0]) / (dom[1] - dom[0]);
    const i = Math.max(0, Math.min(n - 1, Math.floor(t * n)));
    return rng[i];
  }) as ScaleQuantize<R>;
  scale.domain = ((d?: [number, number]) => (d === undefined ? [...dom] as [number, number] : ((dom = d), scale))) as ScaleQuantize<R>["domain"];
  scale.range = ((r?: Iterable<R>) => (r === undefined ? [...rng] : ((rng = [...r]), scale))) as ScaleQuantize<R>["range"];
  scale.invertExtent = (v: R): [number, number] => {
    const i = rng.indexOf(v);
    const n = rng.length;
    return i < 0
      ? [NaN, NaN]
      : [dom[0] + (i / n) * (dom[1] - dom[0]), dom[0] + ((i + 1) / n) * (dom[1] - dom[0])];
  };
  scale.ticks = (count = 10) => ticks(dom[0], dom[1], count);
  if (domain) scale.domain(domain);
  if (range) scale.range(range);
  return scale;
}

export { ticks, tickStep, tickIncrement, niceExtent };
