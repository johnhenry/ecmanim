// Lottie loader — the PURE-MATH half of the Lottie player (campaign 5, L1).
// Everything in this module is a deterministic function of the animation JSON:
// parsing, keyframe evaluation (cubic-bezier easing, hold keyframes, spatial
// position beziers), 2D affine transform composition, shape→bezier-path
// generation (rect / ellipse / polystar), gradient stop parsing, and trim-path
// window math. No mobjects, no node: imports, no DOM — the caller hands in a
// parsed object or a JSON string.
//
// The mobject half (src/mobject/lottie_mobject.ts) turns these evaluations
// into VMobjects per frame.
//
// Supported / approximated / skipped (v1 scope; see also lottie_mobject.ts):
// - Keyframes: {t, s, e?, h?, i, o, ti?, to?} arrays with per-component
//   cubic-bezier easing (CSS timing-function algorithm: Newton + bisection
//   x-solve, then y-eval). Legacy quirks handled: final bare {t} keyframe
//   (value = previous e ?? s), missing `e` (= next keyframe's s), bare
//   number/array `k` regardless of the `a` flag, scalar values wrapped in
//   1-element arrays.
// - Spatial position interpolation: when a keyframe carries ti/to tangents the
//   value follows the cubic bezier s, s+to, e+ti, e with the EASED t.
// - Colors: normalized to [r,g,b,a] in 0..1 (legacy 0..255 arrays divided
//   through when any component exceeds 1 + the array looks 8-bit).
// - Gradients: stop arrays parsed ((offset,r,g,b)*p + optional (offset,a)*
//   alpha tail). Rendering fidelity lives in the mobject half (linear mapped
//   to ecmanim gradientColors; radial approximated as a flat mid-stop color).
// - Trim paths: s/e/o mapped to a [start,end] window in [0,1]. Windows that
//   WRAP across the seam (offset pushing start past 1) are clamped to
//   [start, 1] — a documented approximation (ecmanim strokeStart/End cannot
//   represent a wrapped window).
// - Skew (sk/sa) on transforms: implemented (rotate/shear/rotate).
// - NOT here (documented in the mobject half): expressions, effects, merge
//   paths, image assets, camera layers.

// ---------------------------------------------------------------------------
// Types (deliberately loose — real-world Lottie JSON is wildly inconsistent).
// ---------------------------------------------------------------------------

/** A parsed Lottie animation document (the raw JSON plus an asset index). */
export interface LottieAnimation {
  /** Raw animation JSON. */
  data: any;
  /** Frame rate. */
  fr: number;
  /** In / out point (frames). */
  ip: number;
  op: number;
  /** Composition size in Lottie pixels. */
  w: number;
  h: number;
  /** Precomp/image assets indexed by refId. */
  assets: Map<string, any>;
}

/** One bezier path in Lottie's shape encoding: v = vertices, i/o = RELATIVE
 *  in/out tangent handles, c = closed. */
export interface LottiePath {
  v: number[][];
  i: number[][];
  o: number[][];
  c: boolean;
}

/** One parsed gradient stop, channels in 0..1. */
export interface GradientStop {
  offset: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 2D affine matrix [a, b, c, d, tx, ty]:
 *  x' = a·x + c·y + tx ; y' = b·x + d·y + ty. */
export type Mat2D = [number, number, number, number, number, number];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Parse a Lottie document from an object or JSON string. Never reads files —
 *  the caller is responsible for I/O. */
export function parseLottie(input: string | object): LottieAnimation {
  const data: any = typeof input === "string" ? JSON.parse(input) : input;
  if (!data || typeof data !== "object" || !Array.isArray(data.layers)) {
    throw new Error("parseLottie: not a Lottie animation (missing layers array)");
  }
  const assets = new Map<string, any>();
  for (const a of data.assets ?? []) {
    if (a && a.id != null) assets.set(String(a.id), a);
  }
  return {
    data,
    fr: Number(data.fr) || 30,
    ip: Number(data.ip) || 0,
    op: Number(data.op) || 0,
    w: Number(data.w) || 0,
    h: Number(data.h) || 0,
    assets,
  };
}

// ---------------------------------------------------------------------------
// Cubic-bezier easing (the CSS timing-function algorithm)
// ---------------------------------------------------------------------------

const _easeCache = new Map<string, (u: number) => number>();

/**
 * Easing curve through (0,0), (x1,y1), (x2,y2), (1,1): solve the bezier's
 * x(t) = u (Newton with bisection fallback), then evaluate y(t). Results are
 * memoized per parameter tuple (keyframes reuse a handful of curves).
 */
export function cubicBezierEase(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (u: number) => number {
  // Clamp control x into [0,1] (required for x(t) to be monotone).
  x1 = Math.min(1, Math.max(0, x1));
  x2 = Math.min(1, Math.max(0, x2));
  const key = `${x1},${y1},${x2},${y2}`;
  const hit = _easeCache.get(key);
  if (hit) return hit;

  // Polynomial coefficients: B(t) = ((A t + B) t + C) t with P0=0, P3=1.
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solveT = (u: number): number => {
    // Newton–Raphson.
    let t = u;
    for (let i = 0; i < 8; i++) {
      const x = sampleX(t) - u;
      if (Math.abs(x) < 1e-7) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-7) break;
      t -= x / d;
    }
    // Bisection fallback.
    let lo = 0;
    let hi = 1;
    t = u;
    while (lo < hi) {
      const x = sampleX(t);
      if (Math.abs(x - u) < 1e-7) return t;
      if (u > x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
      if (hi - lo < 1e-7) break;
    }
    return t;
  };

  const fn = (u: number): number => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    return sampleY(solveT(u));
  };
  _easeCache.set(key, fn);
  return fn;
}

// ---------------------------------------------------------------------------
// Keyframe evaluation
// ---------------------------------------------------------------------------

const isKeyframeList = (k: any): boolean =>
  Array.isArray(k) && k.length > 0 && typeof k[0] === "object" &&
  k[0] !== null && !Array.isArray(k[0]) && k[0].t !== undefined;

const asArray = (v: any): number[] =>
  Array.isArray(v) ? v.map(Number) : [Number(v)];

/** Per-component easing parameter (i.x may be scalar, array, or missing). */
const easeParam = (v: any, idx: number, fallback: number): number => {
  if (v == null) return fallback;
  if (Array.isArray(v)) return Number(v[idx] ?? v[0] ?? fallback);
  return Number(v);
};

/** Start value of keyframe `kf`, falling back to the previous keyframe's end
 *  (legacy files omit `s` on the final bare {t} keyframe). */
function kfStart(kfs: any[], i: number): number[] | null {
  const kf = kfs[i];
  if (kf.s != null) return Array.isArray(kf.s) ? kf.s : [kf.s];
  for (let j = i - 1; j >= 0; j--) {
    if (kfs[j].e != null) return Array.isArray(kfs[j].e) ? kfs[j].e : [kfs[j].e];
    if (kfs[j].s != null) return Array.isArray(kfs[j].s) ? kfs[j].s : [kfs[j].s];
  }
  return null;
}

/** End value of keyframe `i`: its `e`, else the next keyframe's `s`. */
function kfEnd(kfs: any[], i: number): number[] | null {
  const kf = kfs[i];
  if (kf.e != null) return Array.isArray(kf.e) ? kf.e : [kf.e];
  if (i + 1 < kfs.length && kfs[i + 1].s != null) {
    const s = kfs[i + 1].s;
    return Array.isArray(s) ? s : [s];
  }
  return kfStart(kfs, i);
}

/**
 * Evaluate a Lottie animatable property at `frame`. Returns a scalar for
 * 1-component values, else a fresh number[]. Handles static {a:0,k:v},
 * animated keyframe lists, bare values regardless of the `a` flag, hold
 * keyframes (h:1), per-component bezier easing, and spatial ti/to beziers.
 */
export function evalProperty(prop: any, frame: number): number | number[] {
  const arr = evalVector(prop, frame);
  return arr.length === 1 ? arr[0] : arr;
}

/** evalProperty, always returning a scalar (component 0). */
export function evalScalar(prop: any, frame: number): number {
  return evalVector(prop, frame)[0] ?? 0;
}

/** evalProperty, always returning a fresh array. */
export function evalVector(prop: any, frame: number): number[] {
  if (prop == null) return [0];
  // Split position: {s:true, x:{...}, y:{...}}.
  if (prop.s === true || (prop.x != null && prop.y != null && prop.k === undefined)) {
    return [evalScalar(prop.x, frame), evalScalar(prop.y, frame)];
  }
  const k = prop.k !== undefined ? prop.k : prop;
  if (typeof k === "number") return [k];
  if (!Array.isArray(k)) return [0];
  if (!isKeyframeList(k)) return k.map(Number); // bare vector even with a:1

  const kfs = k;
  // Before the first keyframe.
  if (frame <= kfs[0].t) return (kfStart(kfs, 0) ?? [0]).map(Number);
  // Find the active segment.
  let idx = kfs.length - 1;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (frame < kfs[i + 1].t) { idx = i; break; }
  }
  if (idx >= kfs.length - 1) {
    // At/after the last keyframe.
    const last = kfs.length - 1;
    const v = kfStart(kfs, last) ?? kfEnd(kfs, last - 1) ?? [0];
    return v.map(Number);
  }
  const kf = kfs[idx];
  const next = kfs[idx + 1];
  const s = kfStart(kfs, idx) ?? [0];
  if (kf.h === 1) return s.map(Number);
  const e = kfEnd(kfs, idx) ?? s;
  const span = next.t - kf.t;
  const u = span > 0 ? (frame - kf.t) / span : 0;

  // Spatial bezier: position keyframes with ti/to tangents follow
  // s → s+to → e+ti → e with a single eased t (component-0 easing).
  const hasSpatial =
    (kf.to != null || kf.ti != null) && s.length >= 2 && e.length >= 2;
  if (hasSpatial) {
    const ease = cubicBezierEase(
      easeParam(kf.o?.x, 0, 0.167), easeParam(kf.o?.y, 0, 0.167),
      easeParam(kf.i?.x, 0, 0.833), easeParam(kf.i?.y, 0, 0.833),
    );
    const t = ease(u);
    const to = asArray(kf.to ?? [0, 0]);
    const ti = asArray(kf.ti ?? [0, 0]);
    const out: number[] = [];
    const n = Math.max(s.length, e.length);
    for (let c = 0; c < n; c++) {
      const p0 = Number(s[c] ?? 0);
      const p3 = Number(e[c] ?? 0);
      const p1 = p0 + Number(to[c] ?? 0);
      const p2 = p3 + Number(ti[c] ?? 0);
      const mt = 1 - t;
      out.push(
        mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3,
      );
    }
    return out;
  }

  // Component-wise eased lerp.
  const out: number[] = [];
  const n = Math.max(s.length, e.length);
  for (let c = 0; c < n; c++) {
    const ease = cubicBezierEase(
      easeParam(kf.o?.x, c, 0.167), easeParam(kf.o?.y, c, 0.167),
      easeParam(kf.i?.x, c, 0.833), easeParam(kf.i?.y, c, 0.833),
    );
    const t = ease(u);
    const a = Number(s[c] ?? 0);
    const b = Number(e[c] ?? 0);
    out.push(a + (b - a) * t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shape-path (v/i/o/c) property evaluation
// ---------------------------------------------------------------------------

const clonePath = (p: any): LottiePath => ({
  v: (p.v ?? []).map((q: number[]) => [Number(q[0]) || 0, Number(q[1]) || 0]),
  i: (p.i ?? []).map((q: number[]) => [Number(q[0]) || 0, Number(q[1]) || 0]),
  o: (p.o ?? []).map((q: number[]) => [Number(q[0]) || 0, Number(q[1]) || 0]),
  c: !!p.c,
});

const lerpPath = (a: any, b: any, t: number): LottiePath => {
  const n = Math.min(a.v?.length ?? 0, b.v?.length ?? 0);
  const mix = (p: number[][], q: number[][], k: number): number[] => [
    (Number(p[k]?.[0]) || 0) + ((Number(q[k]?.[0]) || 0) - (Number(p[k]?.[0]) || 0)) * t,
    (Number(p[k]?.[1]) || 0) + ((Number(q[k]?.[1]) || 0) - (Number(p[k]?.[1]) || 0)) * t,
  ];
  const out: LottiePath = { v: [], i: [], o: [], c: !!a.c };
  for (let k = 0; k < n; k++) {
    out.v.push(mix(a.v, b.v, k));
    out.i.push(mix(a.i, b.i, k));
    out.o.push(mix(a.o, b.o, k));
  }
  return out;
};

/** The value of a path keyframe entry (may be a bare object or a 1-element
 *  array). */
const pathValue = (v: any): any => (Array.isArray(v) ? v[0] : v);

/**
 * Evaluate an animatable SHAPE property (`ks` of a `sh` item, or a mask `pt`)
 * at `frame`. Path keyframes interpolate v/i/o arrays component-wise with the
 * keyframe's easing; mismatched vertex counts fall back to the start path.
 */
export function evalShapePath(prop: any, frame: number): LottiePath | null {
  if (prop == null) return null;
  const k = prop.k !== undefined ? prop.k : prop;
  if (k == null) return null;
  if (!Array.isArray(k)) {
    return k.v ? clonePath(k) : null; // static path object
  }
  if (!isKeyframeList(k)) return null;
  const kfs = k;
  const startOf = (i: number): any => {
    const kf = kfs[i];
    if (kf.s != null) return pathValue(kf.s);
    for (let j = i - 1; j >= 0; j--) {
      if (kfs[j].e != null) return pathValue(kfs[j].e);
      if (kfs[j].s != null) return pathValue(kfs[j].s);
    }
    return null;
  };
  const endOf = (i: number): any => {
    const kf = kfs[i];
    if (kf.e != null) return pathValue(kf.e);
    if (i + 1 < kfs.length && kfs[i + 1].s != null) return pathValue(kfs[i + 1].s);
    return startOf(i);
  };

  if (frame <= kfs[0].t) {
    const s = startOf(0);
    return s ? clonePath(s) : null;
  }
  let idx = kfs.length - 1;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (frame < kfs[i + 1].t) { idx = i; break; }
  }
  if (idx >= kfs.length - 1) {
    const s = startOf(kfs.length - 1);
    return s ? clonePath(s) : null;
  }
  const kf = kfs[idx];
  const next = kfs[idx + 1];
  const s = startOf(idx);
  if (!s) return null;
  if (kf.h === 1) return clonePath(s);
  const e = endOf(idx);
  if (!e || (e.v?.length ?? 0) !== (s.v?.length ?? 0)) return clonePath(s);
  const span = next.t - kf.t;
  const u = span > 0 ? (frame - kf.t) / span : 0;
  const ease = cubicBezierEase(
    easeParam(kf.o?.x, 0, 0.167), easeParam(kf.o?.y, 0, 0.167),
    easeParam(kf.i?.x, 0, 0.833), easeParam(kf.i?.y, 0, 0.833),
  );
  return lerpPath(s, e, ease(u));
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

/** Normalize a Lottie color array to [r,g,b,a] in 0..1. Legacy exporters emit
 *  0..255 channels — detected when any channel exceeds 1. */
export function normalizeColor(c: number[]): [number, number, number, number] {
  let [r, g, b, a] = [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 1];
  if (r > 1 || g > 1 || b > 1 || a > 1) {
    r /= 255; g /= 255; b /= 255;
    if (a > 1) a /= 255;
  }
  const cl = (x: number) => Math.min(1, Math.max(0, x));
  return [cl(r), cl(g), cl(b), cl(a)];
}

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

/**
 * Parse a gradient's `g` property at `frame` into sorted stops. The stop
 * array is (offset, r, g, b) × p, followed by an optional (offset, alpha) ×
 * m tail; alpha stops are resampled onto the color-stop offsets by linear
 * interpolation.
 */
export function parseGradientStops(g: any, frame: number): GradientStop[] {
  if (!g) return [];
  const count = Number(g.p) || 0;
  const raw = evalVector(g.k, frame);
  const n = count > 0 ? count : Math.floor(raw.length / 4);
  const stops: GradientStop[] = [];
  for (let i = 0; i < n; i++) {
    const off = raw[i * 4];
    if (off == null) break;
    stops.push({
      offset: Math.min(1, Math.max(0, Number(off) || 0)),
      r: Math.min(1, Math.max(0, Number(raw[i * 4 + 1]) || 0)),
      g: Math.min(1, Math.max(0, Number(raw[i * 4 + 2]) || 0)),
      b: Math.min(1, Math.max(0, Number(raw[i * 4 + 3]) || 0)),
      a: 1,
    });
  }
  // Alpha tail: pairs of (offset, alpha) after the color stops.
  const tail = raw.slice(n * 4);
  if (tail.length >= 2) {
    const alphas: Array<[number, number]> = [];
    for (let i = 0; i + 1 < tail.length; i += 2) {
      alphas.push([Number(tail[i]) || 0, Math.min(1, Math.max(0, Number(tail[i + 1]) || 0))]);
    }
    const alphaAt = (off: number): number => {
      if (!alphas.length) return 1;
      if (off <= alphas[0][0]) return alphas[0][1];
      for (let i = 0; i < alphas.length - 1; i++) {
        const [o0, a0] = alphas[i];
        const [o1, a1] = alphas[i + 1];
        if (off <= o1) {
          const t = o1 > o0 ? (off - o0) / (o1 - o0) : 0;
          return a0 + (a1 - a0) * t;
        }
      }
      return alphas[alphas.length - 1][1];
    };
    for (const s of stops) s.a = alphaAt(s.offset);
  }
  stops.sort((a, b) => a.offset - b.offset);
  return stops;
}

// ---------------------------------------------------------------------------
// 2D affine matrices
// ---------------------------------------------------------------------------

export const MAT_IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

/** Compose: result maps p ↦ A(B(p)) — B is applied first. */
export function matMul(A: Mat2D, B: Mat2D): Mat2D {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

export function matApply(m: Mat2D, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Isotropic scale factor: sqrt(|det|) — used to scale stroke widths. */
export function matScaleFactor(m: Mat2D): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

const matTranslate = (x: number, y: number): Mat2D => [1, 0, 0, 1, x, y];
const matScale = (sx: number, sy: number): Mat2D => [sx, 0, 0, sy, 0, 0];
const matRotate = (rad: number): Mat2D => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
};

/** Raw (pre-evaluated) transform values accepted by buildTransformMatrix. */
export interface TransformValues {
  anchor?: number[];   // a
  position?: number[]; // p
  scale?: number[];    // s, PERCENT (100 = identity)
  rotation?: number;   // r, degrees
  skew?: number;       // sk, degrees
  skewAxis?: number;   // sa, degrees
}

/**
 * Lottie/AE transform order: translate(p) · rotate(r) · skew(sk about sa) ·
 * scale(s/100) · translate(-a), all in y-down pixel space (positive degrees
 * = visually clockwise, which the standard y-down rotation matrix gives).
 */
export function buildTransformMatrix(tv: TransformValues): Mat2D {
  const a = tv.anchor ?? [0, 0];
  const p = tv.position ?? [0, 0];
  const s = tv.scale ?? [100, 100];
  const rad = ((tv.rotation ?? 0) * Math.PI) / 180;
  let m = matTranslate(-(a[0] ?? 0), -(a[1] ?? 0));
  m = matMul(matScale((s[0] ?? 100) / 100, (s[1] ?? s[0] ?? 100) / 100), m);
  if (tv.skew) {
    const sk = (-tv.skew * Math.PI) / 180;
    const sa = ((tv.skewAxis ?? 0) * Math.PI) / 180;
    m = matMul(matRotate(-sa), m);
    m = matMul([1, 0, Math.tan(sk), 1, 0, 0], m);
    m = matMul(matRotate(sa), m);
  }
  if (rad) m = matMul(matRotate(rad), m);
  m = matMul(matTranslate(p[0] ?? 0, p[1] ?? 0), m);
  return m;
}

/**
 * Evaluate a Lottie transform node (a layer `ks` or a shape-group `tr`) at
 * `frame` → matrix + opacity (0..1).
 */
export function evalTransform(
  tr: any,
  frame: number,
): { m: Mat2D; opacity: number } {
  if (!tr) return { m: MAT_IDENTITY, opacity: 1 };
  const o = tr.o != null ? evalScalar(tr.o, frame) / 100 : 1;
  const m = buildTransformMatrix({
    anchor: tr.a != null ? evalVector(tr.a, frame) : [0, 0],
    position: tr.p != null ? evalVector(tr.p, frame) : [0, 0],
    scale: tr.s != null ? evalVector(tr.s, frame) : [100, 100],
    rotation: tr.r != null ? evalScalar(tr.r, frame) : 0,
    skew: tr.sk != null ? evalScalar(tr.sk, frame) : 0,
    skewAxis: tr.sa != null ? evalScalar(tr.sa, frame) : 0,
  });
  return { m, opacity: Math.min(1, Math.max(0, o)) };
}

// ---------------------------------------------------------------------------
// Parametric shapes → LottiePath (all in local y-down pixel space)
// ---------------------------------------------------------------------------

/** Bezier circular-arc constant for quarter arcs. */
const ARC_K = 0.5519150244935105;

/** Ellipse (el): center p, size s (width, height) → 4-segment closed path. */
export function ellipsePath(p: number[], s: number[]): LottiePath {
  const cx = p[0] ?? 0;
  const cy = p[1] ?? 0;
  const rx = (s[0] ?? 0) / 2;
  const ry = (s[1] ?? 0) / 2;
  const kx = rx * ARC_K;
  const ky = ry * ARC_K;
  // Vertices: top, right, bottom, left (lottie-web order), y-down space.
  return {
    v: [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]],
    i: [[-kx, 0], [0, -ky], [kx, 0], [0, ky]],
    o: [[kx, 0], [0, ky], [-kx, 0], [0, -ky]],
    c: true,
  };
}

/** Rectangle (rc): center p, size s, corner radius r → closed path
 *  (clockwise in y-down space, starting at the top-right corner). */
export function rectPath(p: number[], s: number[], r = 0): LottiePath {
  const cx = p[0] ?? 0;
  const cy = p[1] ?? 0;
  const hw = (s[0] ?? 0) / 2;
  const hh = (s[1] ?? 0) / 2;
  const rr = Math.min(Math.abs(r), hw, hh);
  if (rr <= 1e-9) {
    return {
      v: [
        [cx + hw, cy - hh], [cx + hw, cy + hh],
        [cx - hw, cy + hh], [cx - hw, cy - hh],
      ],
      i: [[0, 0], [0, 0], [0, 0], [0, 0]],
      o: [[0, 0], [0, 0], [0, 0], [0, 0]],
      c: true,
    };
  }
  const k = rr * ARC_K;
  // 8 vertices: two per rounded corner, clockwise from top-right arc start.
  return {
    v: [
      [cx + hw - rr, cy - hh], [cx + hw, cy - hh + rr], // top-right corner
      [cx + hw, cy + hh - rr], [cx + hw - rr, cy + hh], // bottom-right
      [cx - hw + rr, cy + hh], [cx - hw, cy + hh - rr], // bottom-left
      [cx - hw, cy - hh + rr], [cx - hw + rr, cy - hh], // top-left
    ],
    i: [
      [-0, 0], [0, -k],
      [0, 0], [k, 0],
      [0, 0], [0, k],
      [0, 0], [-k, 0],
    ],
    o: [
      [k, 0], [0, 0],
      [0, k], [0, 0],
      [-k, 0], [0, 0],
      [0, -k], [0, 0],
    ],
    c: true,
  };
}

/** Polystar (sr) parameters, already evaluated at a frame. */
export interface PolystarValues {
  type: 1 | 2;          // 1 = star, 2 = polygon
  points: number;       // pt
  position: number[];   // p
  rotation?: number;    // r, degrees
  outerRadius: number;  // or
  innerRadius?: number; // ir (star only)
  outerRoundness?: number; // os, percent
  innerRoundness?: number; // is, percent
}

/** Polystar (sr) → closed path, following lottie-web's vertex/tangent
 *  construction (roundness = fraction of the circumscribed arc segment). */
export function polystarPath(v: PolystarValues): LottiePath {
  const star = v.type !== 2;
  const sides = Math.max(1, Math.floor(v.points));
  const numPts = star ? sides * 2 : sides;
  const angleStep = (2 * Math.PI) / numPts;
  const rotRad = (((v.rotation ?? 0) - 90) * Math.PI) / 180;
  const px = v.position[0] ?? 0;
  const py = v.position[1] ?? 0;
  const longRad = v.outerRadius;
  const shortRad = v.innerRadius ?? 0;
  const longRound = (v.outerRoundness ?? 0) / 100;
  const shortRound = (v.innerRoundness ?? 0) / 100;
  const longSeg = (2 * Math.PI * longRad) / (numPts * 2);
  const shortSeg = (2 * Math.PI * shortRad) / (numPts * 2);

  const path: LottiePath = { v: [], i: [], o: [], c: true };
  let ang = rotRad;
  let longFlag = true;
  for (let k = 0; k < numPts; k++) {
    const rad = star ? (longFlag ? longRad : shortRad) : longRad;
    const round = star ? (longFlag ? longRound : shortRound) : longRound;
    const seg = star ? (longFlag ? longSeg : shortSeg) : longSeg;
    const x = rad * Math.cos(ang);
    const y = rad * Math.sin(ang);
    const len = Math.hypot(x, y);
    // Unit tangent perpendicular to the radius (lottie-web's handle sense:
    // in-handle points backward along travel, out-handle forward).
    const tx = len < 1e-12 ? 0 : y / len;
    const ty = len < 1e-12 ? 0 : -x / len;
    path.v.push([px + x, py + y]);
    path.i.push([tx * seg * round, ty * seg * round]);
    path.o.push([-tx * seg * round, -ty * seg * round]);
    longFlag = !longFlag;
    ang += angleStep;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Trim paths
// ---------------------------------------------------------------------------

/**
 * Map trim-path s/e/o values (s,e in percent; o in degrees, 360 = one full
 * loop) to a [start, end] window in [0, 1]. The offset rotates the window;
 * a window that would WRAP across the path seam is clamped to end at 1
 * (documented approximation — a single strokeStart/strokeEnd pair cannot
 * represent a wrapped window).
 */
export function trimWindow(s: number, e: number, o: number): [number, number] {
  let a = s / 100;
  let b = e / 100;
  if (b < a) [a, b] = [b, a];
  const off = (o ?? 0) / 360;
  a += off;
  b += off;
  // Bring the window's start into [0, 1).
  const shift = Math.floor(a);
  a -= shift;
  b -= shift;
  if (b > 1) {
    // Wrapped window → clamp (keep the longer visible piece anchored at a).
    b = 1;
  }
  const cl = (x: number) => Math.min(1, Math.max(0, x));
  return [cl(a), cl(b)];
}
