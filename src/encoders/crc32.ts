// CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320) as used by PNG
// (PNG spec, annex D) and ZIP (PKWARE APPNOTE 4.4.7). Table-driven, no deps.

const TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Running CRC: feed `crc32Update(prev, bytes)`; start from 0. */
export function crc32Update(prev: number, bytes: Uint8Array): number {
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** CRC-32 of `bytes` as an unsigned 32-bit integer. */
export function crc32(bytes: Uint8Array): number {
  return crc32Update(0, bytes);
}
