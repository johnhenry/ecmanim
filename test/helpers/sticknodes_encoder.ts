// TEST-ONLY encoder for the Stick Nodes `.nodes` figure layout, written from
// the field order documented in MIT sticknodes-rs (see
// src/loaders/sticknodes_loader.ts). Produces bytes we construct ourselves so
// no third-party sample files are committed. Mirrors the reader's version/build
// conditions.

export interface EncNode {
  type?: number;
  draw: number;
  isStatic?: boolean; isStretchy?: boolean; isFloaty?: boolean; isSmartStretch?: boolean;
  doNotApplySmartStretch?: boolean; smartStretchResetImpulse?: boolean;
  useSegmentColor?: boolean; useCircleOutline?: boolean; circleIsHollow?: boolean;
  useGradient?: boolean; reverseGradient?: boolean; gradientMode?: number; useSegmentScale?: boolean;
  localX?: number; localY?: number; scale?: number;
  defaultLength?: number; length?: number; defaultThickness?: number; thickness?: number;
  curveRadius?: number; curveCirculization?: boolean; polyfillPrecision?: number;
  halfArc?: boolean; rightTriangleDirection?: number; triangleUpsideDown?: boolean;
  trapStart?: number; trapEnd?: number; trapRatio?: number; trapRoundStart?: boolean; trapRoundEnd?: boolean;
  polygonVertices?: number;
  defaultLocalAngle?: number; localAngle?: number; defaultAngle?: number;
  color?: [number, number, number, number]; // r,g,b,a
  gradientColor?: [number, number, number, number];
  outlineColor?: [number, number, number, number];
  angleLocked?: boolean; angleLockMain?: boolean;
  connector?: { localX: number; localY: number; percent: number; percentDefault: number; value: number; method: number; reversed: boolean; ancestral: number };
  children?: EncNode[];
}

export interface EncFigure {
  version: number; build?: number; scale?: number; color?: [number, number, number, number];
  root: EncNode;
  polyfills?: { anchor: number; color: [number, number, number, number]; use: boolean; attached: number[] }[];
  connectors?: [number, number][];
  compress?: boolean; // zlib-wrap + little endian
  trailing?: number[];
}

class W {
  bytes: number[] = [];
  le: boolean;
  constructor(le: boolean) { this.le = le; }
  private put(n: number, f: (dv: DataView) => void) { const b = new DataView(new ArrayBuffer(n)); f(b); for (let i = 0; i < n; i++) this.bytes.push(b.getUint8(i)); }
  u8(v: number | boolean) { this.bytes.push((typeof v === "boolean" ? (v ? 1 : 0) : v) & 255); }
  i8(v: number) { this.u8(v & 255); }
  i16(v: number) { this.put(2, (d) => d.setInt16(0, v, this.le)); }
  i32(v: number) { this.put(4, (d) => d.setInt32(0, v, this.le)); }
  f32(v: number) { this.put(4, (d) => d.setFloat32(0, v, this.le)); }
  rgba(c: [number, number, number, number]) { this.u8(c[3]); this.u8(c[2]); this.u8(c[1]); this.u8(c[0]); }
}

function writeNode(w: W, n: EncNode, version: number, build: number, isConnector: boolean) {
  if (isConnector) {
    const c = n.connector!;
    w.f32(c.localX); w.f32(c.localY); w.f32(c.percent);
    if (build >= 44) w.f32(c.percentDefault);
    w.f32(c.value); w.i32(c.method); w.u8(c.reversed);
    if (build >= 65) w.f32(c.ancestral);
  }
  w.i8(n.type ?? 0); w.i32(n.draw);
  w.u8(!!n.isStatic); w.u8(!!n.isStretchy);
  if (version >= 403 && build >= 48) w.u8(!!n.isFloaty);
  if (version >= 248) w.u8(!!n.isSmartStretch);
  if (version >= 252) w.u8(!!n.doNotApplySmartStretch);
  if (version >= 403 && build >= 50) w.u8(!!n.smartStretchResetImpulse);
  w.u8(!!n.useSegmentColor);
  if (version >= 256) w.u8(!!n.useCircleOutline);
  if (version >= 403 && build >= 21) w.u8(!!n.circleIsHollow);
  if (version >= 176) { w.u8(!!n.useGradient); w.u8(!!n.reverseGradient); }
  if (version >= 403 && build >= 20) w.i16(n.gradientMode ?? 1);
  w.u8(!!n.useSegmentScale);
  w.f32(n.localX ?? 0); w.f32(n.localY ?? 0); w.f32(n.scale ?? 1);
  w.f32(n.defaultLength ?? n.length ?? 0); w.f32(n.length ?? 0);
  w.i32(n.defaultThickness ?? n.thickness ?? 32); w.i32(n.thickness ?? 32);
  if (version >= 320) w.i32(n.curveRadius ?? 0);
  if (version >= 403 && build >= 20) w.u8(!!n.curveCirculization);
  if (version >= 403 && build >= 21) w.i16(n.polyfillPrecision ?? 1);
  if (version >= 256) { w.u8(!!n.halfArc); w.i16(n.rightTriangleDirection ?? 0); }
  if (version >= 300) w.u8(!!n.triangleUpsideDown);
  if (version >= 403 && build >= 36) {
    if (build < 64) { w.i32(n.trapStart ?? 32); w.i32(n.trapEnd ?? 16); } else { w.f32(n.trapStart ?? 32); w.f32(n.trapEnd ?? 16); }
  }
  if (version >= 403 && build === 36) { w.i32(0); w.i32(0); w.u8(true); w.u8(true); }
  if (version >= 256 && build !== 36) w.f32(n.trapRatio ?? -1);
  if (version >= 403 && build >= 36) { w.u8(!!n.trapRoundStart); w.u8(!!n.trapRoundEnd); }
  if (version >= 256) w.i16(n.polygonVertices ?? 5);
  if (version >= 248) w.f32(n.defaultLocalAngle ?? n.localAngle ?? 0);
  w.f32(n.localAngle ?? 0);
  if (version >= 248) w.f32(n.defaultAngle ?? 0);
  w.rgba(n.color ?? [32, 32, 32, 255]);
  if (version >= 176) w.rgba(n.gradientColor ?? [128, 128, 128, 255]);
  if (version >= 256) w.rgba(n.outlineColor ?? [128, 128, 128, 255]);
  if (version >= 403 && build >= 39) w.u8(!!n.angleLocked);
  if (version >= 403 && build >= 39 && build <= 50) w.f32(0);
  if (version >= 403 && build >= 51) w.u8(!!n.angleLockMain);
  if (version >= 403 && build >= 51 && build <= 56) { w.f32(0); w.f32(0); }
  if (version >= 403 && build >= 57) w.f32(0);
  if (version >= 403 && build >= 63) w.f32(0);
  if (version >= 403 && build >= 67) w.f32(0);
  if (version >= 403 && build >= 63) w.i8(1);
  if (version >= 403 && build >= 39) { if (build <= 40) w.i16(0); else w.u8(false); }
  if (version >= 403 && build >= 41 && build <= 45) w.i16(0);
  if (version >= 403 && build >= 46) w.f32(0);
  if (version >= 403 && build >= 41) w.f32(1);
  if (version >= 403 && build >= 41 && build <= 45) w.u8(0);
  const kids = n.children ?? [];
  w.i32(kids.length);
  if (version >= 403 && build > 38) for (const k of kids) w.i32(k.connector ? 1 : 0);
  for (const k of kids) writeNode(w, k, version, build, !!k.connector && version >= 403 && build > 38);
}

function adler32(d: Uint8Array): number {
  let a = 1, b = 0;
  for (const x of d) { a = (a + x) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

/** zlib container using STORED deflate blocks (no compression needed for tests). */
export function zlibStored(data: Uint8Array): Uint8Array {
  const out: number[] = [0x78, 0x01];
  for (let off = 0; off < data.length || off === 0; off += 65535) {
    const chunk = data.subarray(off, Math.min(off + 65535, data.length));
    const last = off + 65535 >= data.length;
    out.push(last ? 1 : 0, chunk.length & 255, chunk.length >> 8, ~chunk.length & 255, (~chunk.length >> 8) & 255);
    for (const x of chunk) out.push(x);
    if (last) break;
  }
  const ad = adler32(data);
  out.push(ad >>> 24, (ad >>> 16) & 255, (ad >>> 8) & 255, ad & 255);
  return Uint8Array.from(out);
}

export function encodeNodes(fig: EncFigure): Uint8Array {
  const build = fig.build ?? 72;
  const w = new W(!!fig.compress);
  w.i32(fig.version);
  if (fig.version >= 403) w.i32(build);
  w.f32(fig.scale ?? 1);
  w.rgba(fig.color ?? [32, 32, 32, 255]);
  writeNode(w, fig.root, fig.version, build, false);
  if (!fig.compress) {
    if (fig.version >= 230) {
      const ps = fig.polyfills ?? [];
      w.i32(ps.length);
      for (const p of ps) { w.i32(p.anchor); w.rgba(p.color); w.u8(p.use); w.i32(p.attached.length); p.attached.forEach((a) => w.i32(a)); }
    }
    if (fig.version >= 403 && build >= 38) {
      const cs = fig.connectors ?? [];
      w.i32(cs.length);
      for (const [a, b] of cs) { w.i32(a); w.i32(b); }
    }
  }
  for (const t of fig.trailing ?? []) w.u8(t);
  const raw = Uint8Array.from(w.bytes);
  return fig.compress ? zlibStored(raw) : raw;
}
