// Seeded, deterministic noise primitives: value noise, simplex noise, and
// fractal Brownian motion. Everything here is a pure function of (seed, input)
// — same seed + same coordinates → same value, in any sampling order — so it
// composes with scrubbing, alwaysRedraw, and the deterministic render cache.
//
// This module is the canonical home of the PRNG lattice that wiggle() has
// always used (src/animation/expressions.ts delegates here); latticeValue1D's
// formula is a compatibility contract — changing it would silently re-time
// every wiggle() animation ever rendered.

/** Standard mulberry32 seeded PRNG → a function returning numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic lattice value in [-1, 1] for integer index `i` under `seed`.
 * BIT-COMPATIBILITY CONTRACT: this exact mix is what wiggle() has always
 * sampled; regression vectors in test/noise.test.ts pin it down.
 */
export function latticeValue1D(seed: number, i: number): number {
  return mulberry32((seed * 0x9e3779b1) ^ (i * 0x85ebca77))() * 2 - 1;
}

// Ken Perlin's smootherstep (6t^5 - 15t^4 + 10t^3): C2-continuous fade, the
// standard for lattice noise. (Inlined rather than imported from
// animation/rate_functions to keep core/ below animation/ in the layering.)
function fade(t: number): number {
  return t * t * t * (t * (6 * t - 15) + 10);
}

/**
 * Smooth 1D value noise in [-1, 1]: lattice values at integers, smootherstep
 * blend between. Continuous in x; pure of sampling order (lattice cached).
 * Note: wiggle() uses the SAME lattice but a sigmoid blend — the two agree at
 * integer x and differ slightly between (wiggle's shape is frozen for compat).
 */
export function valueNoise1D(seed: number): (x: number) => number {
  const cache = new Map<number, number>();
  const lattice = (i: number): number => {
    let v = cache.get(i);
    if (v === undefined) {
      v = latticeValue1D(seed, i);
      cache.set(i, v);
    }
    return v;
  };
  return (x: number): number => {
    const i = Math.floor(x);
    const a = lattice(i);
    const b = lattice(i + 1);
    return a + (b - a) * fade(x - i);
  };
}

// ---------------------------------------------------------------------------
// Simplex noise (Gustavson's public-domain reference construction), with the
// permutation table shuffled per seed via mulberry32 Fisher-Yates.
// ---------------------------------------------------------------------------

const GRAD3: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

function buildPerm(seed: number): Uint8Array {
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  const rand = mulberry32(seed);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = base[i]; base[i] = base[j]; base[j] = tmp;
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

/** Seeded 2D simplex noise in roughly [-1, 1]. */
export function simplex2D(seed: number): (x: number, y: number) => number {
  const perm = buildPerm(seed);
  return (x: number, y: number): number => {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = GRAD3[perm[ii + perm[jj]] % 12];
      t0 *= t0;
      n += t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = GRAD3[perm[ii + i1 + perm[jj + j1]] % 12];
      t1 *= t1;
      n += t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = GRAD3[perm[ii + 1 + perm[jj + 1]] % 12];
      t2 *= t2;
      n += t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * n;
  };
}

/** Seeded 3D simplex noise in roughly [-1, 1]. */
export function simplex3D(seed: number): (x: number, y: number, z: number) => number {
  const perm = buildPerm(seed);
  return (x: number, y: number, z: number): number => {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);
    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0)      { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else               { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0)       { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0)  { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else               { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;
    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    let n = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      const g = GRAD3[perm[ii + perm[jj + perm[kk]]] % 12];
      t0 *= t0;
      n += t0 * t0 * (g[0] * x0 + g[1] * y0 + g[2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      const g = GRAD3[perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] % 12];
      t1 *= t1;
      n += t1 * t1 * (g[0] * x1 + g[1] * y1 + g[2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      const g = GRAD3[perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] % 12];
      t2 *= t2;
      n += t2 * t2 * (g[0] * x2 + g[1] * y2 + g[2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      const g = GRAD3[perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] % 12];
      t3 *= t3;
      n += t3 * t3 * (g[0] * x3 + g[1] * y3 + g[2] * z3);
    }
    return 32 * n;
  };
}

export interface FbmOptions {
  /** Number of noise layers summed (default 4). */
  octaves?: number;
  /** Frequency multiplier per octave (default 2). */
  lacunarity?: number;
  /** Amplitude multiplier per octave (default 0.5). */
  gain?: number;
}

/**
 * Fractal Brownian motion over a 2D noise field: octaves of the base noise at
 * increasing frequency and decreasing amplitude, normalized so the result
 * stays in roughly the base noise's range.
 */
export function fbm(
  noise: (x: number, y: number) => number,
  options: FbmOptions = {},
): (x: number, y: number) => number {
  const { octaves = 4, lacunarity = 2, gain = 0.5 } = options;
  return (x: number, y: number): number => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  };
}

/** 3D counterpart of {@link fbm}. */
export function fbm3(
  noise: (x: number, y: number, z: number) => number,
  options: FbmOptions = {},
): (x: number, y: number, z: number) => number {
  const { octaves = 4, lacunarity = 2, gain = 0.5 } = options;
  return (x: number, y: number, z: number): number => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  };
}
