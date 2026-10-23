// Diagram-as-code with animated board transitions. A tiny Mermaid/D2-ish DSL is
// parsed to a graph, laid out (a built-in deterministic layered layout; elkjs is
// an optional future backend), and built into a board (a VGroup of node + edge
// mobjects, each tagged with a stable `matchId`). Two boards then animate between
// each other via TransformMatchingAuto — nodes/edges are matched by id and the
// deltas are tweened. Isomorphic; labels use RasterText (no font needed).

import { VGroup } from "../mobject/VMobject.ts";
import { RoundedRectangle } from "../mobject/polygram.ts";
import { Arrow } from "../mobject/geometry.ts";
import { RasterText, estimateTextSize } from "../mobject/text/Text.ts";
import { Color } from "../core/color.ts";

export interface DiagramNode { id: string; label: string; }
export interface DiagramEdge { from: string; to: string; label?: string; }
export interface DiagramGraph { nodes: DiagramNode[]; edges: DiagramEdge[]; }

/**
 * Parse a small diagram DSL. Supported per line:
 *   A                      a bare node
 *   A[Label text]          a node with a label
 *   A --> B                an edge
 *   A -- label --> B       a labeled edge
 * Node ids are auto-created on first use. Blank lines / `//` comments ignored.
 */
export function parseDiagram(dsl: string): DiagramGraph {
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const ensure = (id: string) => {
    const key = id.trim();
    if (!nodes.has(key)) nodes.set(key, { id: key, label: key });
    return key;
  };
  const declare = (token: string): string => {
    // "A[Label]" or "A"
    const m = /^([^[\]]+?)(?:\[([^\]]*)\])?$/.exec(token.trim());
    if (!m) return ensure(token);
    const id = m[1].trim();
    ensure(id);
    if (m[2] != null) nodes.get(id)!.label = m[2];
    return id;
  };
  for (const raw of dsl.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;
    const edge = /^(.+?)\s*--(?:\s*(.+?)\s*--)?>\s*(.+)$/.exec(line);
    if (edge) {
      const from = declare(edge[1]);
      const to = declare(edge[3]);
      edges.push({ from, to, label: edge[2]?.trim() || undefined });
    } else {
      declare(line);
    }
  }
  return { nodes: Array.from(nodes.values()), edges };
}

/** Default node box size (world units); boxes never shrink below this. */
export const DIAGRAM_NODE_WIDTH = 1.8;
export const DIAGRAM_NODE_HEIGHT = 0.9;
/** Padding between a label and its box edge when the box grows to fit it. */
const FIT_PAD_X = 0.3;
const FIT_PAD_Y = 0.2;
/** Minimum clear space kept between neighbouring boxes (matches the default gaps). */
const CLEAR_X = 1.2;
const CLEAR_Y = 0.7;

/** Box size of a node: the default size, grown to fit its label plus padding. */
export interface DiagramNodeSize { width: number; height: number; }

/**
 * Size each node's box so its label fits. Uses `estimateTextSize` (character
 * count x fontSize x 0.55 per line), the same backend-independent estimate
 * RasterText uses for its own bounds, so Node, Canvas-2D and WebGL agree. A
 * label that already fits within the default 1.8 x 0.9 box (with padding)
 * leaves the box at exactly the default size.
 */
export function measureDiagramNodes(graph: DiagramGraph, fontSize = 0.32): Map<string, DiagramNodeSize> {
  const sizes = new Map<string, DiagramNodeSize>();
  for (const node of graph.nodes) {
    const t = estimateTextSize(node.label, fontSize);
    sizes.set(node.id, {
      width: Math.max(DIAGRAM_NODE_WIDTH, t.width + 2 * FIT_PAD_X),
      height: Math.max(DIAGRAM_NODE_HEIGHT, t.height + 2 * FIT_PAD_Y),
    });
  }
  return sizes;
}

export interface LayoutOptions {
  /** Horizontal spacing between layers (default 3). */
  layerGap?: number;
  /** Vertical spacing between nodes in a layer (default 1.6). */
  nodeGap?: number;
  /** "layered" (default, left→right by depth) or "circular". */
  algorithm?: "layered" | "circular";
  /**
   * Per-node box sizes (see `measureDiagramNodes`). When given, spacing grows
   * so wider/taller boxes don't collide; gaps that already suffice, and any
   * layout where every node is the default size, are left exactly as-is.
   * Omitted (default): sizes are ignored, i.e. the historical layout.
   */
  nodeSizes?: Map<string, DiagramNodeSize>;
}

/** Deterministic layout → node id → [x, y, 0]. */
export function layoutDiagram(graph: DiagramGraph, opts: LayoutOptions = {}): Map<string, number[]> {
  const layerGap = opts.layerGap ?? 3;
  const nodeGap = opts.nodeGap ?? 1.6;
  const pos = new Map<string, number[]>();

  if (opts.algorithm === "circular") {
    const n = graph.nodes.length || 1;
    let rad = Math.max(1.5, (n * nodeGap) / (2 * Math.PI));
    const sizes = opts.nodeSizes;
    if (sizes && n > 1 && graph.nodes.some((nd) => {
      const z = sizes.get(nd.id);
      return z && (z.width > DIAGRAM_NODE_WIDTH || z.height > DIAGRAM_NODE_HEIGHT);
    })) {
      // Grow the ring until neighbouring boxes clear each other.
      for (let i = 0; i < n; i++) {
        const a = sizes.get(graph.nodes[i].id), b = sizes.get(graph.nodes[(i + 1) % n].id);
        if (!a || !b) continue;
        const chord = (a.width + b.width) / 2 + 0.3;
        rad = Math.max(rad, chord / (2 * Math.sin(Math.PI / n)));
      }
    }
    graph.nodes.forEach((node, i) => {
      const a = (2 * Math.PI * i) / n;
      pos.set(node.id, [rad * Math.cos(a), rad * Math.sin(a), 0]);
    });
    return pos;
  }

  // Layered: BFS depth from roots (nodes with no incoming edge).
  const incoming = new Map<string, number>();
  for (const node of graph.nodes) incoming.set(node.id, 0);
  for (const e of graph.edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) { if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from)!.push(e.to); }

  const depth = new Map<string, number>();
  const queue: string[] = graph.nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);
  for (const id of queue) depth.set(id, 0);
  // Fallback: if there are no roots (a cycle), seed with the first node.
  if (!queue.length && graph.nodes.length) { queue.push(graph.nodes[0].id); depth.set(graph.nodes[0].id, 0); }
  while (queue.length) {
    const id = queue.shift()!;
    const d = depth.get(id) ?? 0;
    for (const next of adj.get(id) ?? []) {
      if (!depth.has(next) || (depth.get(next)! < d + 1)) {
        depth.set(next, d + 1);
        queue.push(next);
      }
    }
  }
  // Any node never reached (disconnected) → depth 0.
  for (const node of graph.nodes) if (!depth.has(node.id)) depth.set(node.id, 0);

  // Group by depth and spread vertically (centered).
  const byDepth = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const d = depth.get(node.id)!;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(node.id);
  }
  const maxDepth = Math.max(0, ...byDepth.keys());

  // Crossing reduction: barycenter sweeps. Order each layer by the mean index
  // of its neighbors in the adjacent layer (downward then upward), which
  // reduces — does not minimize — edge crossings. Deterministic: ties keep the
  // current (stable) order.
  const preds = new Map<string, string[]>();
  for (const e of graph.edges) { if (!preds.has(e.to)) preds.set(e.to, []); preds.get(e.to)!.push(e.from); }
  const orderLayer = (ids: string[], neighborOf: (id: string) => string[], indexIn: Map<string, number>) => {
    const bary = new Map<string, number>();
    ids.forEach((id, i) => {
      const ns = neighborOf(id).map((n) => indexIn.get(n)).filter((v): v is number => v != null);
      bary.set(id, ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : i);
    });
    ids.sort((a, b) => bary.get(a)! - bary.get(b)!);
  };
  const indexMap = (ids: string[]) => new Map(ids.map((id, i) => [id, i]));
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let d = 1; d <= maxDepth; d++) {       // downward: order by predecessors
      const prev = byDepth.get(d - 1), cur = byDepth.get(d);
      if (prev && cur) orderLayer(cur, (id) => preds.get(id) ?? [], indexMap(prev));
    }
    for (let d = maxDepth - 1; d >= 0; d--) {   // upward: order by successors
      const next = byDepth.get(d + 1), cur = byDepth.get(d);
      if (next && cur) orderLayer(cur, (id) => adj.get(id) ?? [], indexMap(next));
    }
  }
  const sizes = opts.nodeSizes;
  // Column centers. Historical formula unless a wider box needs more room.
  const layerWidth = (d: number) => Math.max(DIAGRAM_NODE_WIDTH, ...(byDepth.get(d) ?? []).map((id) => sizes?.get(id)?.width ?? DIAGRAM_NODE_WIDTH));
  const gaps: number[] = [];
  for (let d = 0; d < maxDepth; d++) gaps.push(sizes ? Math.max(layerGap, (layerWidth(d) + layerWidth(d + 1)) / 2 + CLEAR_X) : layerGap);
  const grown = gaps.some((g) => g !== layerGap);
  const colX: number[] = [];
  if (!grown) {
    for (let d = 0; d <= maxDepth; d++) colX.push((d - maxDepth / 2) * layerGap);
  } else {
    let x = 0;
    colX.push(0);
    for (const g of gaps) { x += g; colX.push(x); }
    const mid = x / 2;
    for (let d = 0; d <= maxDepth; d++) colX[d] -= mid;
  }
  for (const [d, ids] of byDepth) {
    const count = ids.length;
    // Row offsets. Historical formula unless taller boxes need more room.
    const rowGaps: number[] = [];
    for (let i = 0; i + 1 < count; i++) {
      const ha = sizes?.get(ids[i])?.height ?? DIAGRAM_NODE_HEIGHT, hb = sizes?.get(ids[i + 1])?.height ?? DIAGRAM_NODE_HEIGHT;
      rowGaps.push(sizes ? Math.max(nodeGap, (ha + hb) / 2 + CLEAR_Y) : nodeGap);
    }
    const rowsGrown = rowGaps.some((g) => g !== nodeGap);
    const ys: number[] = [];
    if (!rowsGrown) {
      for (let i = 0; i < count; i++) ys.push((i - (count - 1) / 2) * nodeGap);
    } else {
      let y = 0;
      ys.push(0);
      for (const g of rowGaps) { y += g; ys.push(y); }
      for (let i = 0; i < count; i++) ys[i] -= y / 2;
    }
    ids.forEach((id, i) => pos.set(id, [colX[d], ys[i], 0]));
  }
  return pos;
}

export interface BoardOptions extends LayoutOptions {
  nodeColor?: string;
  edgeColor?: string;
  textColor?: string;
  fontSize?: number;
}

/** Build a board: a VGroup of node + edge mobjects, each tagged with a `matchId`. */
export function buildBoard(graph: DiagramGraph, opts: BoardOptions = {}): VGroup {
  const fontSize = opts.fontSize ?? 0.32;
  const sizes = opts.nodeSizes ?? measureDiagramNodes(graph, fontSize);
  const pos = layoutDiagram(graph, { ...opts, nodeSizes: sizes });
  const board = new VGroup();
  const nodeColor = opts.nodeColor ?? "#58C4DD";
  const edgeColor = opts.edgeColor ?? "#B0B0B0";
  const textColor = opts.textColor ?? "#FFFFFF";

  const nodeMobs = new Map<string, any>();
  for (const node of graph.nodes) {
    const p = pos.get(node.id) ?? [0, 0, 0];
    const sz = sizes.get(node.id) ?? { width: DIAGRAM_NODE_WIDTH, height: DIAGRAM_NODE_HEIGHT };
    const box = new RoundedRectangle({ width: sz.width, height: sz.height, cornerRadius: 0.15, color: nodeColor });
    box.setStyle?.({ fillColor: Color.parse(nodeColor), fillOpacity: 0.18, strokeColor: Color.parse(nodeColor), strokeWidth: 3 });
    const label = new RasterText(node.label, { fontSize, color: textColor });
    const group = new VGroup();
    group.add(box);
    group.add(label);
    group.moveTo(p);
    (group as any).matchId = "node:" + node.id;
    board.add(group);
    nodeMobs.set(node.id, group);
  }
  for (const e of graph.edges) {
    let a = pos.get(e.from) ?? [0, 0, 0];
    let b = pos.get(e.to) ?? [0, 0, 0];
    // Trim endpoints to the node boxes' boundaries so arrowheads land on the
    // box edge instead of piercing to its center.
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const dir = [dx / len, dy / len, 0];
    const fromMob = nodeMobs.get(e.from), toMob = nodeMobs.get(e.to);
    try { if (fromMob) a = fromMob.getBoundaryPoint(dir); } catch { /* keep center */ }
    try { if (toMob) b = toMob.getBoundaryPoint([-dir[0], -dir[1], 0]); } catch { /* keep center */ }
    const arrow = new Arrow(a, b, { color: edgeColor });
    (arrow as any).matchId = `edge:${e.from}->${e.to}`;
    board.add(arrow);
  }
  return board;
}

/** Convenience: parse DSL and build a board in one call. */
export function diagram(dsl: string, opts: BoardOptions = {}): VGroup {
  return buildBoard(parseDiagram(dsl), opts);
}
