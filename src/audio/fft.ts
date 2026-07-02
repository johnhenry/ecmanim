// A compact, dependency-free radix-2 Cooley–Tukey FFT (in-place, iterative), used
// for per-frame audio spectra. Pure math — works headless in Node and the browser.

/** In-place radix-2 FFT. `re`/`im` length must be a power of two. */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error("fftInPlace: length must be a power of two");

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  // Danielson–Lanczos.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k], aIm = im[i + k];
        const bRe = re[i + k + len / 2], bIm = im[i + k + len / 2];
        const tRe = bRe * cr - bIm * ci;
        const tIm = bRe * ci + bIm * cr;
        re[i + k] = aRe + tRe; im[i + k] = aIm + tIm;
        re[i + k + len / 2] = aRe - tRe; im[i + k + len / 2] = aIm - tIm;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Round up to the next power of two. */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Magnitude spectrum of a real window (a Hann window is applied). Returns
 * `size/2` bins in [0, ∞); index 0 = DC/bass … up to Nyquist. `size` must be a
 * power of two; the window is zero-padded/truncated to `size`.
 */
export function magnitudeSpectrum(window: ArrayLike<number>, size: number): Float64Array {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const n = Math.min(window.length, size);
  for (let i = 0; i < n; i++) {
    // Hann window reduces spectral leakage.
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    re[i] = (window[i] as number) * w;
  }
  fftInPlace(re, im);
  const half = size >> 1;
  const out = new Float64Array(half);
  for (let i = 0; i < half; i++) out[i] = Math.hypot(re[i], im[i]) / half;
  return out;
}
