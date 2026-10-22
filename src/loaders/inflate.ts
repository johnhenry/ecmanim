// Minimal synchronous zlib/DEFLATE decoder (RFC 1950/1951), pure JS, no
// dependencies, no node: imports. Exists so `loadStickNodes()` can read
// zlib-wrapped `.nodes` files synchronously in Node and the browser
// (`DecompressionStream` is async). Written from the RFCs; decode only.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Huff { counts: Uint16Array; symbols: Uint16Array }

function build(lengths: ArrayLike<number>, n: number): Huff {
  const counts = new Uint16Array(16);
  for (let i = 0; i < n; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
  const symbols = new Uint16Array(n);
  for (let i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
  return { counts, symbols };
}

let FIXED: { lit: Huff; dist: Huff } | null = null;
function fixed() {
  if (FIXED) return FIXED;
  const l = new Uint8Array(288);
  l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
  return (FIXED = { lit: build(l, 288), dist: build(new Uint8Array(30).fill(5), 30) });
}

/** Raw DEFLATE stream -> bytes. `maxOutput` guards against decompression bombs. */
export function inflateRaw(src: Uint8Array, start = 0, maxOutput = 256 * 1024 * 1024): { out: Uint8Array; end: number } {
  let pos = start, bitBuf = 0, bitCnt = 0;
  let out = new Uint8Array(Math.max(1024, Math.min(src.length * 4, maxOutput)));
  let o = 0;
  const fail = (m: string): never => { throw new Error(`inflate: ${m}`); };
  const bits = (n: number): number => {
    while (bitCnt < n) {
      if (pos >= src.length) fail("truncated input");
      bitBuf |= src[pos++] << bitCnt; bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n; bitCnt -= n;
    return v;
  };
  const decode = (h: Huff): number => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.counts[len];
      if (code - count < first) return h.symbols[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    return fail("invalid huffman code");
  };
  const ensure = (extra: number) => {
    if (o + extra <= out.length) return;
    if (o + extra > maxOutput) fail("output exceeds limit");
    let n = out.length * 2;
    while (n < o + extra) n *= 2;
    const b = new Uint8Array(Math.min(n, maxOutput)); b.set(out.subarray(0, o)); out = b;
  };
  let last = 0;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      if (pos + 4 > src.length) fail("truncated input");
      const len = src[pos] | (src[pos + 1] << 8);
      if ((len ^ 0xffff) !== (src[pos + 2] | (src[pos + 3] << 8))) fail("invalid stored block length");
      pos += 4;
      if (pos + len > src.length) fail("truncated input");
      ensure(len); out.set(src.subarray(pos, pos + len), o); o += len; pos += len;
    } else if (type === 1 || type === 2) {
      let lit: Huff, dist: Huff;
      if (type === 1) ({ lit, dist } = fixed());
      else {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        if (nlen > 286 || ndist > 30) fail("invalid dynamic block header");
        const cl = new Uint8Array(19);
        for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]] = bits(3);
        const clh = build(cl, 19);
        const ls = new Uint8Array(nlen + ndist);
        for (let i = 0; i < nlen + ndist;) {
          const sym = decode(clh);
          if (sym < 16) ls[i++] = sym;
          else {
            let prev = 0, rep: number;
            if (sym === 16) { if (i === 0) fail("invalid code lengths"); prev = ls[i - 1]; rep = 3 + bits(2); }
            else if (sym === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            if (i + rep > nlen + ndist) fail("invalid code lengths");
            while (rep--) ls[i++] = prev;
          }
        }
        lit = build(ls.subarray(0, nlen), nlen);
        dist = build(ls.subarray(nlen), ndist);
      }
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) { ensure(1); out[o++] = sym; }
        else if (sym === 256) break;
        else {
          const li = sym - 257;
          if (li >= 29) fail("invalid length symbol");
          const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
          const di = decode(dist);
          if (di >= 30) fail("invalid distance symbol");
          const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
          if (d > o) fail("distance too far back");
          ensure(len);
          for (let k = 0; k < len; k++, o++) out[o] = out[o - d];
        }
      }
    } else fail("invalid block type");
  } while (!last);
  return { out: out.slice(0, o), end: pos };
}

function adler32(d: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < d.length; i++) { a = (a + d[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

/** zlib (RFC 1950) stream -> bytes, verifying header and Adler-32 checksum. */
export function inflateZlib(src: Uint8Array, maxOutput?: number): Uint8Array {
  if (src.length < 6) throw new Error("inflate: truncated input");
  const cmf = src[0], flg = src[1];
  if ((cmf & 15) !== 8 || ((cmf << 8) | flg) % 31 !== 0 || (flg & 32)) throw new Error("inflate: invalid zlib header");
  const { out, end } = inflateRaw(src, 2, maxOutput);
  if (end + 4 > src.length) throw new Error("inflate: truncated input (missing checksum)");
  const want = ((src[end] << 24) | (src[end + 1] << 16) | (src[end + 2] << 8) | src[end + 3]) >>> 0;
  if (adler32(out) !== want) throw new Error("inflate: adler32 checksum mismatch");
  return out;
}
