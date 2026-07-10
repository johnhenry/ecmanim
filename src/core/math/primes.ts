// Prime utilities (3b1b campaign, prime-spiral visual). Pure, isomorphic.

/** Sieve of Eratosthenes: Uint8Array of length n+1, 1 = prime. */
export function sieve(n: number): Uint8Array {
  const isP = new Uint8Array(n + 1).fill(1);
  isP[0] = 0;
  if (n >= 1) isP[1] = 0;
  for (let p = 2; p * p <= n; p++) {
    if (!isP[p]) continue;
    for (let m = p * p; m <= n; m += p) isP[m] = 0;
  }
  return isP;
}

/** All primes ≤ n, ascending. */
export function primesUpTo(n: number): number[] {
  const isP = sieve(n);
  const out: number[] = [];
  for (let i = 2; i <= n; i++) if (isP[i]) out.push(i);
  return out;
}

/** Trial-division primality (fine for one-off checks; use sieve for ranges). */
export function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

/**
 * Eigen-decomposition of a REAL 2x2 matrix [[a, b], [c, d]] (3b1b
 * eigenvector visual). Returns real eigenpairs only (empty array when the
 * eigenvalues are complex); each vector is unit length with a stable sign
 * convention (largest-magnitude component positive).
 */
export function eigen2x2(m: [[number, number], [number, number]]): Array<{ value: number; vector: [number, number] }> {
  const [[a, b], [c, d]] = m;
  const tr = a + d;
  const det = a * d - b * c;
  const disc = tr * tr / 4 - det;
  if (disc < 0) return [];
  const root = Math.sqrt(disc);
  const values = disc === 0 ? [tr / 2] : [tr / 2 + root, tr / 2 - root];
  return values.map((value) => {
    // (A - λI)v = 0: pick the more numerically stable row.
    let v: [number, number];
    if (Math.abs(b) > 1e-12) v = [b, value - a];
    else if (Math.abs(c) > 1e-12) v = [value - d, c];
    else v = Math.abs(a - value) < Math.abs(d - value) ? [1, 0] : [0, 1];
    const len = Math.hypot(v[0], v[1]) || 1;
    v = [v[0] / len, v[1] / len];
    if ((Math.abs(v[0]) >= Math.abs(v[1]) ? v[0] : v[1]) < 0) v = [-v[0], -v[1]];
    return { value, vector: v };
  });
}
