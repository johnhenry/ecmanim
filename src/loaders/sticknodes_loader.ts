// Stick Nodes `.nodes` (stickfigure) importer (epic #61, #73).
//
// ATTRIBUTION. The binary layout implemented here (header, per-version/build
// node fields, connector records, polyfill table, the "zlib-wrapped
// little-endian vs raw big-endian" file split) follows the MIT-licensed
// sticknodes-rs (https://github.com/vinceTheProgrammer/sticknodes-rs),
// Copyright (c) 2025 vinceTheProgrammer. Its MIT notice is reproduced in
// THIRD_PARTY_NOTICES.md. This is a TypeScript re-implementation written from
// that layout; no code is copied. Clean-room: StykAnimate source was not
// consulted.
//
// Two layers:
//  - `parseStickNodes(bytes)`: PURE, synchronous, no I/O, no mobjects, no node:
//    imports. `Uint8Array` in, plain data out (`StickNodesFigure`).
//  - `loadStickNodes(bytes, config)`: builds a `Skeleton`, a pose track, a
//    `PoseLibrary` and metadata from the parsed figure, following the
//    `loadLottie` pattern (sync, pure of I/O: read the file yourself).
//
// SCOPE. sticknodes-rs documents `.nodes` figures only (a single pose). The
// project (`.stknds`, zip-based) and movieclip (`.nodemc`) formats it lists as
// future work are NOT supported: a zip container is rejected with a clear
// message, so there are no multi-frame tracks yet (the track has one key).

import { Skeleton } from "../mobject/skeleton.ts";
import type { SkeletonConfig } from "../mobject/skeleton.ts";
import type { BoneSpec, Pose } from "../mobject/skeleton_model.ts";
import { PoseLibrary, poseTrack } from "../animation/pose.ts";
import type { KeyframeTrack } from "../animation/keyframe_track.ts";
import { Color } from "../core/color.ts";
import { inflateZlib } from "./inflate.ts";

// Newest layout sticknodes-rs reads (Stick Nodes 4.2.3 build 72).
const KNOWN_VERSION = 423;
const KNOWN_BUILD = 72;
const MAX_NODES = 10000;
const MAX_DEPTH = 2000;
// ecmanim stroke widths are "px at 1080p"; the default frame is 8 units tall.
const STROKE_PX_PER_WORLD_UNIT = 1080 / 8;

export class StickNodesParseError extends Error {
  constructor(message: string) { super(`Stick Nodes: ${message}`); this.name = "StickNodesParseError"; }
}

export interface StickNodesColor { r: number; g: number; b: number; a: number }
export type StickNodeType =
  | "root" | "roundedSegment" | "segment" | "circle" | "triangle"
  | "filledCircle" | "ellipse" | "trapezoid" | "polygon" | "unknown";

export interface StickNodeConnector {
  localX: number; localY: number; percent: number; percentDefault: number; value: number;
  method: "byPercent" | "byValue"; reversed: boolean; smartStretchAncestralValue: number;
  /** Draw index of the node this connector ends on (when the file links one). */
  endDrawIndex: number | null;
}

/** One node of the figure. Angles are DEGREES, lengths/thickness file pixels. */
export interface StickNode {
  drawIndex: number;
  /** Draw index of the parent node; null for the root. */
  parent: number | null;
  type: StickNodeType;
  isStatic: boolean; isStretchy: boolean; isFloaty: boolean; isSmartStretch: boolean;
  doNotApplySmartStretch: boolean; smartStretchResetImpulse: boolean;
  useSegmentColor: boolean; useCircleOutline: boolean; circleIsHollow: boolean;
  useGradient: boolean; reverseGradient: boolean; gradientMode: "sideways" | "normal";
  useSegmentScale: boolean;
  localX: number; localY: number; scale: number;
  defaultLength: number; length: number; defaultThickness: number; thickness: number;
  curveRadius: number; curveCirculization: boolean; curvePolyfillPrecision: number;
  halfArc: boolean; rightTriangleDirection: number; triangleUpsideDown: boolean;
  trapezoidThicknessStart: number; trapezoidThicknessEnd: number; trapezoidTopThicknessRatio: number;
  trapezoidRoundedStart: boolean; trapezoidRoundedEnd: boolean;
  polygonVertices: number;
  defaultLocalAngle: number; localAngle: number; defaultAngle: number;
  color: StickNodesColor; gradientColor: StickNodesColor; outlineColor: StickNodesColor;
  angleLock: "none" | "absolute" | "relative";
  dragLocked: boolean; dragLockAngle: number; smartStretchMultiplier: number;
  connector: StickNodeConnector | null;
}

export interface StickNodesPolyfill {
  anchorDrawIndex: number; color: StickNodesColor; usePolyfillColor: boolean; attachedDrawIndices: number[];
}

/** Plain-data result of `parseStickNodes`. `nodes` is in file (pre-)order; `nodes[0]` is the root. */
export interface StickNodesFigure {
  version: number;
  build: number;
  /** True when the file was a zlib-wrapped little-endian stream. */
  compressed: boolean;
  /** Figure-level scale from the header (informational; not applied). */
  scale: number;
  /** Figure colour (used by nodes without their own segment colour). */
  color: StickNodesColor;
  nodes: StickNode[];
  polyfills: StickNodesPolyfill[];
  warnings: string[];
}

const NODE_TYPES: Record<number, StickNodeType> = {
  [-1]: "root", 0: "roundedSegment", 1: "segment", 2: "circle", 3: "triangle",
  4: "filledCircle", 5: "ellipse", 6: "trapezoid", 7: "polygon",
};

class Reader {
  pos = 0;
  private dv: DataView;
  bytes: Uint8Array;
  le: boolean;
  constructor(bytes: Uint8Array, le: boolean) {
    this.bytes = bytes;
    this.le = le;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get remaining() { return this.bytes.length - this.pos; }
  private need(n: number) {
    if (this.pos + n > this.bytes.length) throw new StickNodesParseError(`truncated file (unexpected end of data at byte ${this.pos})`);
  }
  u8() { this.need(1); return this.dv.getUint8(this.pos++); }
  bool() { return this.u8() !== 0; }
  i8() { this.need(1); return this.dv.getInt8(this.pos++); }
  i16() { this.need(2); const v = this.dv.getInt16(this.pos, this.le); this.pos += 2; return v; }
  i32() { this.need(4); const v = this.dv.getInt32(this.pos, this.le); this.pos += 4; return v; }
  f32() {
    this.need(4); const v = this.dv.getFloat32(this.pos, this.le); this.pos += 4;
    if (!Number.isFinite(v)) throw new StickNodesParseError(`non-finite number at byte ${this.pos - 4}`);
    return v;
  }
  /** Colours are stored alpha, blue, green, red. */
  color(): StickNodesColor { const a = this.u8(), b = this.u8(), g = this.u8(), r = this.u8(); return { r, g, b, a }; }
}

const DEFAULT_COLOR: StickNodesColor = { r: 32, g: 32, b: 32, a: 255 };
const DEFAULT_GRADIENT: StickNodesColor = { r: 128, g: 128, b: 128, a: 255 };

function defaultNode(): StickNode {
  return {
    drawIndex: 0, parent: null, type: "roundedSegment",
    isStatic: false, isStretchy: false, isFloaty: false, isSmartStretch: false,
    doNotApplySmartStretch: false, smartStretchResetImpulse: false,
    useSegmentColor: false, useCircleOutline: false, circleIsHollow: false,
    useGradient: false, reverseGradient: false, gradientMode: "normal", useSegmentScale: false,
    localX: 0, localY: 0, scale: 1, defaultLength: 0, length: 0, defaultThickness: 32, thickness: 32,
    curveRadius: 0, curveCirculization: false, curvePolyfillPrecision: 1,
    halfArc: false, rightTriangleDirection: 0, triangleUpsideDown: false,
    trapezoidThicknessStart: 32, trapezoidThicknessEnd: 16, trapezoidTopThicknessRatio: -1,
    trapezoidRoundedStart: false, trapezoidRoundedEnd: false, polygonVertices: 5,
    defaultLocalAngle: 0, localAngle: 0, defaultAngle: 0,
    color: { ...DEFAULT_COLOR }, gradientColor: { ...DEFAULT_GRADIENT }, outlineColor: { ...DEFAULT_GRADIENT },
    angleLock: "none", dragLocked: false, dragLockAngle: 0, smartStretchMultiplier: 1, connector: null,
  };
}

interface Ctx { r: Reader; version: number; build: number; nodes: StickNode[]; seen: Set<number>; warnings: string[] }

function readNode(c: Ctx, isConnector: boolean): { node: StickNode; childCount: number; connectorFlags: boolean[] } {
  const { r, version, build } = c;
  const n = defaultNode();
  if (isConnector) {
    const localX = r.f32(), localY = r.f32(), percent = r.f32();
    const percentDefault = build >= 44 ? r.f32() : percent;
    const value = r.f32();
    const method = r.i32() === 1 ? "byValue" : "byPercent";
    const reversed = r.bool();
    const smartStretchAncestralValue = build >= 65 ? r.f32() : 1;
    n.connector = { localX, localY, percent, percentDefault, value, method, reversed, smartStretchAncestralValue, endDrawIndex: null };
  }
  const typeCode = r.i8();
  n.type = NODE_TYPES[typeCode] ?? "unknown";
  if (n.type === "unknown") c.warnings.push(`node type ${typeCode} is unknown (treated as a rounded segment)`);
  n.drawIndex = r.i32();
  n.isStatic = r.bool();
  n.isStretchy = r.bool();
  if (version >= 403 && build >= 48) n.isFloaty = r.bool();
  if (version >= 248) n.isSmartStretch = r.bool();
  if (version >= 252) n.doNotApplySmartStretch = r.bool();
  if (version >= 403 && build >= 50) n.smartStretchResetImpulse = r.bool();
  n.useSegmentColor = r.bool();
  if (version >= 256) n.useCircleOutline = r.bool();
  if (version >= 403 && build >= 21) n.circleIsHollow = r.bool();
  if (version >= 176) { n.useGradient = r.bool(); n.reverseGradient = r.bool(); }
  if (version >= 403 && build >= 20) n.gradientMode = r.i16() === 0 ? "sideways" : "normal";
  n.useSegmentScale = r.bool();
  n.localX = r.f32(); n.localY = r.f32(); n.scale = r.f32();
  n.defaultLength = r.f32(); n.length = r.f32();
  n.defaultThickness = r.i32(); n.thickness = r.i32();
  if (version >= 320) n.curveRadius = r.i32();
  if (version >= 403 && build >= 20) n.curveCirculization = r.bool();
  if (version >= 403 && build >= 21) n.curvePolyfillPrecision = r.i16();
  if (version >= 256) { n.halfArc = r.bool(); n.rightTriangleDirection = r.i16(); }
  if (version >= 300) n.triangleUpsideDown = r.bool();
  if (version >= 403 && build >= 36) {
    if (build < 64) { n.trapezoidThicknessStart = r.i32(); n.trapezoidThicknessEnd = r.i32(); }
    else { n.trapezoidThicknessStart = r.f32(); n.trapezoidThicknessEnd = r.f32(); }
  }
  if (version >= 403 && build === 36) { r.i32(); r.i32(); r.u8(); r.u8(); }
  if (version >= 256 && build !== 36) n.trapezoidTopThicknessRatio = r.f32();
  if (version >= 403 && build >= 36) { n.trapezoidRoundedStart = r.bool(); n.trapezoidRoundedEnd = r.bool(); }
  if (version >= 256) n.polygonVertices = r.i16();
  if (version >= 248) n.defaultLocalAngle = r.f32();
  n.localAngle = r.f32();
  if (version >= 248) n.defaultAngle = r.f32(); else n.defaultLocalAngle = n.localAngle;
  n.color = r.color();
  if (version >= 176) n.gradientColor = r.color();
  if (version >= 256) n.outlineColor = r.color();
  let locked = false, lockMain = false;
  if (version >= 403 && build >= 39) { locked = r.bool(); if (build <= 50) locked = false; }
  if (version >= 403 && build >= 39 && build <= 50) r.f32();
  if (version >= 403 && build >= 51) { lockMain = r.bool(); if (build < 56) lockMain = !lockMain; }
  if (version >= 403 && build >= 51 && build <= 56) { r.f32(); r.f32(); }
  if (version >= 403 && build >= 57) r.f32();
  if (version >= 403 && build >= 63) r.f32();
  if (version >= 403 && build >= 67) r.f32();
  if (version >= 403 && build >= 63) r.i8();
  if (version >= 403 && build >= 39) n.dragLocked = build <= 40 ? r.i16() !== 0 : r.bool();
  if (version >= 403 && build >= 41 && build <= 45) r.i16();
  if (version >= 403 && build >= 46) n.dragLockAngle = r.f32();
  if (version >= 403 && build >= 41) n.smartStretchMultiplier = r.f32();
  if (version >= 403 && build >= 41 && build <= 45) r.u8();
  n.angleLock = locked ? (lockMain ? "absolute" : "relative") : "none";
  const childCount = r.i32();
  if (childCount < 0 || childCount > Math.min(MAX_NODES, r.remaining)) {
    throw new StickNodesParseError(`invalid child count ${childCount} at byte ${r.pos}`);
  }
  const connectorFlags: boolean[] = [];
  if (version >= 403 && build > 38) for (let i = 0; i < childCount; i++) connectorFlags.push(r.i32() !== 0);
  return { node: n, childCount, connectorFlags };
}

function readChildren(c: Ctx, parent: number | null, count: number, flags: boolean[], depth: number) {
  if (depth > MAX_DEPTH) throw new StickNodesParseError("node tree is too deep");
  for (let i = 0; i < count; i++) {
    if (c.nodes.length >= MAX_NODES) throw new StickNodesParseError(`more than ${MAX_NODES} nodes`);
    const { node, childCount, connectorFlags } = readNode(c, !!flags[i]);
    if (c.seen.has(node.drawIndex)) throw new StickNodesParseError(`duplicate draw order index ${node.drawIndex}`);
    c.seen.add(node.drawIndex);
    node.parent = parent;
    c.nodes.push(node);
    readChildren(c, node.drawIndex, childCount, connectorFlags, depth + 1);
  }
}

function readHeader(r: Reader) {
  const version = r.i32();
  const build = version >= 403 ? r.i32() : KNOWN_BUILD;
  const scale = r.f32();
  const color = r.color();
  return { version, build, scale, color };
}

/**
 * Parse a Stick Nodes `.nodes` figure. Pure and synchronous: bytes in, plain
 * data out. Throws `StickNodesParseError` for malformed input. Files newer
 * than the layout this was written against, and trailing unread bytes, are
 * reported in `warnings` rather than rejected.
 */
export function parseStickNodes(bytes: Uint8Array): StickNodesFigure {
  if (!(bytes instanceof Uint8Array)) throw new StickNodesParseError("input must be a Uint8Array");
  if (bytes.length < 4) throw new StickNodesParseError("file too short to be a .nodes figure");
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5 || bytes[2] === 7)) {
    throw new StickNodesParseError("this looks like a zip container (.stknds project or archive); only .nodes figures are supported");
  }
  const warnings: string[] = [];
  let data = bytes;
  let compressed = false;
  // The first big-endian int is the version for raw files; anything outside the
  // known range means the whole file is a zlib stream holding a little-endian body.
  const be = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, false);
  if (be > KNOWN_VERSION || be < 160) {
    try { data = inflateZlib(bytes); } catch (e) {
      throw new StickNodesParseError(`not a valid .nodes file (${(e as Error).message})`);
    }
    compressed = true;
  }
  const r = new Reader(data, compressed);
  const h = readHeader(r);
  if (h.version > KNOWN_VERSION || (h.version === KNOWN_VERSION && h.build > KNOWN_BUILD)) {
    warnings.push(`file is from a newer Stick Nodes version/build (${h.version}/${h.build}) than the layout this importer targets (${KNOWN_VERSION}/${KNOWN_BUILD}); reading on a best-effort basis`);
  }
  const ctx: Ctx = { r, version: h.version, build: h.build, nodes: [], seen: new Set(), warnings };
  readChildren(ctx, null, 1, [false], 0);
  const polyfills: StickNodesPolyfill[] = [];
  if (!compressed) {
    if (h.version >= 230) {
      const count = r.i32();
      if (count < 0 || count > r.remaining) throw new StickNodesParseError(`invalid polyfill count ${count}`);
      for (let i = 0; i < count; i++) {
        const anchorDrawIndex = r.i32();
        const color = r.color();
        const usePolyfillColor = r.bool();
        const na = r.i32();
        if (na < 0 || na > r.remaining) throw new StickNodesParseError(`invalid polyfill node count ${na}`);
        const attachedDrawIndices: number[] = [];
        for (let k = 0; k < na; k++) attachedDrawIndices.push(r.i32());
        polyfills.push({ anchorDrawIndex, color, usePolyfillColor, attachedDrawIndices });
      }
    }
    if (h.version >= 403 && h.build >= 38) {
      const count = r.i32();
      if (count < 0 || count > r.remaining) throw new StickNodesParseError(`invalid connector count ${count}`);
      for (let i = 0; i < count; i++) {
        const mine = r.i32(), end = r.i32();
        const node = ctx.nodes.find((x) => x.drawIndex === mine);
        if (!node || !ctx.seen.has(end)) throw new StickNodesParseError(`connector link ${mine}->${end} references a missing node`);
        if (!node.connector) throw new StickNodesParseError(`connector link on node ${mine} which has no connector data`);
        node.connector.endDrawIndex = end;
      }
    }
  }
  if (r.remaining > 0) {
    warnings.push(`${r.remaining} trailing byte(s) after the node data were ignored` +
      (compressed ? " (the polyfill and connector tables of compressed files are not read)" : ""));
  }
  return { version: h.version, build: h.build, compressed, scale: h.scale, color: h.color, nodes: ctx.nodes, polyfills, warnings };
}

// ---------------------------------------------------------------------------
// Skeleton import
// ---------------------------------------------------------------------------

export interface StickNodesConfig {
  /** World units per file pixel. Default 0.01 (100 px = 1 unit). */
  unitsPerPixel?: number;
  /** Negate angles (mirror vertically). Stick Nodes' axis orientation is not
   *  specified by the format reference; the default imports angles as-is
   *  (counter-clockwise, y-up). Default false. */
  flipY?: boolean;
  /** Passed through to `Skeleton` (colour, joints, heads, ...). `color`
   *  overrides the figure colour. */
  skeleton?: Omit<SkeletonConfig, "root" | "rotation" | "scale">;
  /** Place the skeleton here (world units). Default [0, 0]. */
  root?: [number, number];
}

export interface StickNodesMeta {
  version: number;
  build: number;
  compressed: boolean;
  nodeCount: number;
  /** Bone id for each imported (non-root) node's draw index. */
  boneIdByDrawIndex: Record<number, string>;
  /** The parsed figure, for anything the Skeleton cannot carry. */
  figure: StickNodesFigure;
  /** Everything that was read but not represented (see docs/skeletal.md). */
  warnings: string[];
}

export interface StickNodesResult {
  skeleton: Skeleton;
  /** One-key `KeyframeTrack<Pose>` holding the file's pose at t = 0 (`.nodes` is a single pose). */
  track: KeyframeTrack<Pose>;
  /** `"pose"` (the saved pose) and `"default"` (the file's default angles/lengths). */
  poses: PoseLibrary;
  meta: StickNodesMeta;
}

const rad = (d: number) => (d * Math.PI) / 180;
const hex2 = (n: number) => n.toString(16).padStart(2, "0");
const toHex = (c: StickNodesColor) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;

/**
 * Import a `.nodes` figure (raw or zlib-wrapped) as a `Skeleton`. Pure of I/O:
 * read the file yourself and pass the bytes. Unrepresented features (smart
 * stretch, floaty, angle locks, connectors, polyfills, non-segment node
 * shapes, per-segment scale) are listed in `meta.warnings`, never dropped
 * silently.
 */
export function loadStickNodes(bytes: Uint8Array, config: StickNodesConfig = {}): StickNodesResult {
  const fig = parseStickNodes(bytes);
  const upp = config.unitsPerPixel ?? 0.01;
  if (!(upp > 0) || !Number.isFinite(upp)) throw new RangeError("loadStickNodes: unitsPerPixel must be a positive finite number");
  const sgn = config.flipY ? -1 : 1;
  const warnings = [...fig.warnings];
  const [rootNode, ...rest] = fig.nodes;
  const idOf = (d: number) => `n${d}`;
  const boneIdByDrawIndex: Record<number, string> = {};

  const bones: BoneSpec[] = rest.map((n) => {
    boneIdByDrawIndex[n.drawIndex] = idOf(n.drawIndex);
    return {
      id: idOf(n.drawIndex),
      parent: n.parent === rootNode.drawIndex || n.parent === null ? null : idOf(n.parent),
      length: n.length * upp,
      angle: sgn * rad(n.localAngle),
      width: Math.max(0, n.thickness * upp * STROKE_PX_PER_WORLD_UNIT),
      zIndex: n.drawIndex,
    };
  });

  const note = (what: string, list: StickNode[]) => {
    if (list.length) warnings.push(`${what} not simulated (draw index ${list.map((n) => n.drawIndex).join(", ")}); stored pose kept`);
  };
  const real = rest;
  note("floaty motion is", real.filter((n) => n.isFloaty));
  note("smart stretch is", real.filter((n) => n.isSmartStretch || n.smartStretchMultiplier !== 1));
  note("stretchy / static flags are", real.filter((n) => n.isStretchy || n.isStatic));
  note("angle locks are", real.filter((n) => n.angleLock !== "none"));
  note("drag locks are", real.filter((n) => n.dragLocked));
  note("connectors are", real.filter((n) => n.connector));
  note("per-segment scale is", real.filter((n) => n.useSegmentScale));
  const shaped = real.filter((n) => !["roundedSegment", "segment", "unknown"].includes(n.type));
  if (shaped.length) {
    warnings.push(`non-segment node shapes (${[...new Set(shaped.map((n) => n.type))].join(", ")}) are drawn as plain bones (draw index ${shaped.map((n) => n.drawIndex).join(", ")})`);
  }
  if (real.some((n) => n.useGradient)) warnings.push("gradients are not rendered; segments use a flat colour");
  if (real.some((n) => n.curveRadius !== 0)) warnings.push("segment curve radius is not rendered; bones are straight");
  if (fig.polyfills.length) warnings.push(`${fig.polyfills.length} polyfill(s) not rendered (their data is in meta.figure.polyfills)`);
  if (rootNode.type !== "root") warnings.push("the first node is not a root node; it is treated as the root anyway");

  const figColor = toHex(fig.color);
  const skeleton = new Skeleton(bones, {
    color: figColor,
    ...(config.skeleton ?? {}),
    root: config.root ?? [0, 0],
    rotation: sgn * rad(rootNode.localAngle),
  });
  const userColor = config.skeleton?.color;
  for (const n of rest) {
    const m = skeleton.getBoneMobject(idOf(n.drawIndex));
    const c = n.useSegmentColor ? n.color : fig.color;
    if (n.useSegmentColor && userColor === undefined) m.strokeColor = Color.parse(toHex(c));
    m.strokeOpacity = c.a / 255;
  }

  const poseOf = (angle: (n: StickNode) => number, length: (n: StickNode) => number, rootAngle: number): Pose => {
    const out: Pose = { root: config.root ? [...config.root] : [0, 0], rotation: sgn * rad(rootAngle), scale: 1, bones: {} };
    for (const n of rest) out.bones[idOf(n.drawIndex)] = { angle: sgn * rad(angle(n)), length: length(n) * upp, bend: 0 };
    return out;
  };
  const current = poseOf((n) => n.localAngle, (n) => n.length, rootNode.localAngle);
  const dflt = poseOf((n) => n.defaultLocalAngle, (n) => n.defaultLength, rootNode.defaultLocalAngle);
  const poses = new PoseLibrary({ pose: current, default: dflt });
  const track = poseTrack<Pose>([{ t: 0, value: current }]);

  return {
    skeleton, track, poses,
    meta: { version: fig.version, build: fig.build, compressed: fig.compressed, nodeCount: fig.nodes.length, boneIdByDrawIndex, figure: fig, warnings },
  };
}
