// Sankey diagram layout: a pure-math port of d3-sankey.
//
// Isomorphic (no renderer, mobject, or node:* imports) and deterministic:
// there is no randomness anywhere; all sorts are stable (JS Array#sort is
// stable) with explicit index tie-breaks, so the same input always produces
// the same layout.
//
// Algorithm (matching d3-sankey):
//   1. computeNodeLinks   -- resolve link endpoints, build per-node link lists
//   2. computeNodeValues  -- node.value = max(sum in, sum out) (or fixedValue)
//   3. computeNodeDepths  -- breadth-first layering left-to-right (node.depth)
//   4. computeNodeHeights -- breadth-first layering right-to-left (node.height)
//   5. computeNodeBreadths-- assign columns per the align strategy, then run
//      `iterations` rounds of relaxation, alternating right-to-left and
//      left-to-right weighted-median passes with collision resolution
//      (nodePadding) after each pass
//   6. computeLinkBreadths-- stack link offsets (link.y0 / y1 / width)
//
// Nodes and links are mutated in place (like d3-sankey) and the same graph
// object is returned.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SankeyNode {
  index?: number;
  /** Optional override for the computed node value. */
  fixedValue?: number;
  // Computed:
  sourceLinks?: SankeyLink[];
  targetLinks?: SankeyLink[];
  value?: number;
  /** Shortest path length from a source (left BFS layer). */
  depth?: number;
  /** Shortest path length to a sink (right BFS layer). */
  height?: number;
  /** Final column index after applying the align strategy. */
  layer?: number;
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  [key: string]: unknown;
}

export interface SankeyLink {
  /** Node id (resolved via nodeId) or node object. */
  source: unknown;
  target: unknown;
  value: number;
  index?: number;
  // Computed:
  y0?: number;
  y1?: number;
  width?: number;
  [key: string]: unknown;
}

export interface SankeyGraph {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export type SankeyAlign = "justify" | "left" | "right" | "center";

export interface SankeyOptions {
  /** Node id accessor for resolving link endpoints. Default: d => d.index. */
  nodeId?: (node: SankeyNode, i: number, nodes: SankeyNode[]) => unknown;
  /** Horizontal alignment strategy. Default "justify". */
  nodeAlign?: SankeyAlign | ((node: SankeyNode, n: number) => number);
  /** Node rectangle width (x1 - x0). Default 24. */
  nodeWidth?: number;
  /** Minimum vertical gap between nodes in a column. Default 8. */
  nodePadding?: number;
  /** Layout extent [[x0, y0], [x1, y1]]. Default [[0, 0], [1, 1]]. */
  extent?: [[number, number], [number, number]];
  /** Optional comparator for nodes within a column (disables breadth sort). */
  nodeSort?: (a: SankeyNode, b: SankeyNode) => number;
  /** Optional comparator for links (disables breadth link reordering). */
  linkSort?: (a: SankeyLink, b: SankeyLink) => number;
  /** Relaxation iterations. Default 6. */
  iterations?: number;
}

// ---------------------------------------------------------------------------
// Align strategies (d3-sankey's sankeyJustify / Left / Right / Center)
// ---------------------------------------------------------------------------

function alignJustify(node: SankeyNode, n: number): number {
  return node.sourceLinks!.length ? node.depth! : n - 1;
}

function alignLeft(node: SankeyNode): number {
  return node.depth!;
}

function alignRight(node: SankeyNode, n: number): number {
  return n - 1 - node.height!;
}

function alignCenter(node: SankeyNode): number {
  return node.targetLinks!.length
    ? node.depth!
    : node.sourceLinks!.length
      ? Math.min(...node.sourceLinks!.map((l) => (l.target as SankeyNode).depth!)) - 1
      : 0;
}

const ALIGNS: Record<SankeyAlign, (node: SankeyNode, n: number) => number> = {
  justify: alignJustify,
  left: alignLeft,
  right: alignRight,
  center: alignCenter,
};

// ---------------------------------------------------------------------------
// Comparators (stable, with index tie-breaks)
// ---------------------------------------------------------------------------

function ascendingBreadth(a: SankeyNode, b: SankeyNode): number {
  return a.y0! - b.y0! || a.index! - b.index!;
}

function ascendingSourceBreadth(a: SankeyLink, b: SankeyLink): number {
  return (
    (a.source as SankeyNode).y0! - (b.source as SankeyNode).y0! ||
    a.index! - b.index!
  );
}

function ascendingTargetBreadth(a: SankeyLink, b: SankeyLink): number {
  return (
    (a.target as SankeyNode).y0! - (b.target as SankeyNode).y0! ||
    a.index! - b.index!
  );
}

// ---------------------------------------------------------------------------
// sankey
// ---------------------------------------------------------------------------

/**
 * Create a sankey layout function. Call the returned function with
 * `{nodes, links}`; it assigns node {x0, x1, y0, y1, value, depth, height,
 * layer} and link {y0, y1, width} in place and returns the graph.
 */
export function sankey(options: SankeyOptions = {}): (graph: SankeyGraph) => SankeyGraph {
  const {
    nodeId = (d: SankeyNode) => d.index,
    nodeAlign = "justify",
    nodeWidth = 24,
    nodePadding = 8,
    extent = [[0, 0], [1, 1]],
    nodeSort,
    linkSort,
    iterations = 6,
  } = options;

  const align = typeof nodeAlign === "function" ? nodeAlign : ALIGNS[nodeAlign];
  if (!align) throw new Error(`unknown nodeAlign: ${String(nodeAlign)}`);

  const [[x0, y0], [x1, y1]] = extent;
  const dx = nodeWidth;
  // Effective vertical padding: shrunk if a column has too many nodes to fit.
  let py = nodePadding;

  function layout(graph: SankeyGraph): SankeyGraph {
    computeNodeLinks(graph);
    computeNodeValues(graph);
    computeNodeDepths(graph);
    computeNodeHeights(graph);
    computeNodeBreadths(graph);
    computeLinkBreadths(graph);
    return graph;
  }

  function computeNodeLinks({ nodes, links }: SankeyGraph): void {
    for (let i = 0; i < nodes.length; ++i) {
      const node = nodes[i];
      node.index = i;
      node.sourceLinks = [];
      node.targetLinks = [];
    }
    const nodeById = new Map<unknown, SankeyNode>(
      nodes.map((d, i) => [nodeId(d, i, nodes), d]),
    );
    for (let i = 0; i < links.length; ++i) {
      const link = links[i];
      link.index = i;
      let { source, target } = link;
      if (typeof source !== "object" || source === null) {
        const found = nodeById.get(source);
        if (!found) throw new Error(`missing node: ${String(source)}`);
        source = link.source = found;
      }
      if (typeof target !== "object" || target === null) {
        const found = nodeById.get(target);
        if (!found) throw new Error(`missing node: ${String(target)}`);
        target = link.target = found;
      }
      (source as SankeyNode).sourceLinks!.push(link);
      (target as SankeyNode).targetLinks!.push(link);
    }
    if (linkSort) {
      for (const { sourceLinks, targetLinks } of nodes) {
        sourceLinks!.sort(linkSort);
        targetLinks!.sort(linkSort);
      }
    }
  }

  function computeNodeValues({ nodes }: SankeyGraph): void {
    for (const node of nodes) {
      node.value =
        node.fixedValue !== undefined
          ? node.fixedValue
          : Math.max(
              node.sourceLinks!.reduce((s, l) => s + l.value, 0),
              node.targetLinks!.reduce((s, l) => s + l.value, 0),
            );
    }
  }

  function computeNodeDepths({ nodes }: SankeyGraph): void {
    const n = nodes.length;
    let current = new Set<SankeyNode>(nodes);
    let next = new Set<SankeyNode>();
    let x = 0;
    while (current.size) {
      for (const node of current) {
        node.depth = x;
        for (const { target } of node.sourceLinks!) next.add(target as SankeyNode);
      }
      if (++x > n) throw new Error("circular link");
      current = next;
      next = new Set();
    }
  }

  function computeNodeHeights({ nodes }: SankeyGraph): void {
    const n = nodes.length;
    let current = new Set<SankeyNode>(nodes);
    let next = new Set<SankeyNode>();
    let x = 0;
    while (current.size) {
      for (const node of current) {
        node.height = x;
        for (const { source } of node.targetLinks!) next.add(source as SankeyNode);
      }
      if (++x > n) throw new Error("circular link");
      current = next;
      next = new Set();
    }
  }

  function computeNodeLayers({ nodes }: SankeyGraph): SankeyNode[][] {
    const x = Math.max(...nodes.map((d) => d.depth!)) + 1;
    const kx = (x1 - x0 - dx) / (x - 1);
    const columns: SankeyNode[][] = new Array(x);
    for (const node of nodes) {
      const i = Math.max(0, Math.min(x - 1, Math.floor(align(node, x))));
      node.layer = i;
      node.x0 = x0 + i * kx;
      node.x1 = node.x0 + dx;
      if (columns[i]) columns[i].push(node);
      else columns[i] = [node];
    }
    if (nodeSort) {
      for (const column of columns) {
        column.sort((a, b) => nodeSort(a, b) || a.index! - b.index!);
      }
    }
    return columns;
  }

  function initializeNodeBreadths(columns: SankeyNode[][]): void {
    const ky = Math.min(
      ...columns.map(
        (c) =>
          (y1 - y0 - (c.length - 1) * py) /
          c.reduce((s, d) => s + d.value!, 0),
      ),
    );
    for (const nodes of columns) {
      let y = y0;
      for (const node of nodes) {
        node.y0 = y;
        node.y1 = y + node.value! * ky;
        y = node.y1 + py;
        for (const link of node.sourceLinks!) link.width = link.value * ky;
      }
      y = (y1 - y + py) / (nodes.length + 1);
      for (let i = 0; i < nodes.length; ++i) {
        const node = nodes[i];
        node.y0! += y * (i + 1);
        node.y1! += y * (i + 1);
      }
      reorderLinks(nodes);
    }
  }

  function computeNodeBreadths(graph: SankeyGraph): void {
    const columns = computeNodeLayers(graph);
    const maxColumn = Math.max(...columns.map((c) => c.length));
    py = Math.min(nodePadding, (y1 - y0) / (maxColumn - 1));
    initializeNodeBreadths(columns);
    for (let i = 0; i < iterations; ++i) {
      const alpha = Math.pow(0.99, i);
      const beta = Math.max(1 - alpha, (i + 1) / iterations);
      relaxRightToLeft(columns, alpha, beta);
      relaxLeftToRight(columns, alpha, beta);
    }
  }

  /** Reposition each node downstream per its incoming links' positions. */
  function relaxLeftToRight(columns: SankeyNode[][], alpha: number, beta: number): void {
    for (let i = 1, n = columns.length; i < n; ++i) {
      const column = columns[i];
      for (const target of column) {
        let y = 0;
        let w = 0;
        for (const link of target.targetLinks!) {
          const source = link.source as SankeyNode;
          const v = link.value * (target.layer! - source.layer!);
          y += targetTop(source, target) * v;
          w += v;
        }
        if (!(w > 0)) continue;
        const dy = (y / w - target.y0!) * alpha;
        target.y0! += dy;
        target.y1! += dy;
        reorderNodeLinks(target);
      }
      if (nodeSort === undefined) column.sort(ascendingBreadth);
      resolveCollisions(column, beta);
    }
  }

  /** Reposition each node upstream per its outgoing links' positions. */
  function relaxRightToLeft(columns: SankeyNode[][], alpha: number, beta: number): void {
    for (let n = columns.length, i = n - 2; i >= 0; --i) {
      const column = columns[i];
      for (const source of column) {
        let y = 0;
        let w = 0;
        for (const link of source.sourceLinks!) {
          const target = link.target as SankeyNode;
          const v = link.value * (target.layer! - source.layer!);
          y += sourceTop(source, target) * v;
          w += v;
        }
        if (!(w > 0)) continue;
        const dy = (y / w - source.y0!) * alpha;
        source.y0! += dy;
        source.y1! += dy;
        reorderNodeLinks(source);
      }
      if (nodeSort === undefined) column.sort(ascendingBreadth);
      resolveCollisions(column, beta);
    }
  }

  function resolveCollisions(nodes: SankeyNode[], alpha: number): void {
    const i = nodes.length >> 1;
    const subject = nodes[i];
    resolveCollisionsBottomToTop(nodes, subject.y0! - py, i - 1, alpha);
    resolveCollisionsTopToBottom(nodes, subject.y1! + py, i + 1, alpha);
    resolveCollisionsBottomToTop(nodes, y1, nodes.length - 1, alpha);
    resolveCollisionsTopToBottom(nodes, y0, 0, alpha);
  }

  /** Push any overlapping nodes down. */
  function resolveCollisionsTopToBottom(
    nodes: SankeyNode[],
    y: number,
    i: number,
    alpha: number,
  ): void {
    for (; i < nodes.length; ++i) {
      const node = nodes[i];
      const dy = (y - node.y0!) * alpha;
      if (dy > 1e-6) {
        node.y0! += dy;
        node.y1! += dy;
      }
      y = node.y1! + py;
    }
  }

  /** Push any overlapping nodes up. */
  function resolveCollisionsBottomToTop(
    nodes: SankeyNode[],
    y: number,
    i: number,
    alpha: number,
  ): void {
    for (; i >= 0; --i) {
      const node = nodes[i];
      const dy = (node.y1! - y) * alpha;
      if (dy > 1e-6) {
        node.y0! -= dy;
        node.y1! -= dy;
      }
      y = node.y0! - py;
    }
  }

  function reorderNodeLinks(node: SankeyNode): void {
    if (linkSort !== undefined) return;
    for (const link of node.targetLinks!) {
      (link.source as SankeyNode).sourceLinks!.sort(ascendingTargetBreadth);
    }
    for (const link of node.sourceLinks!) {
      (link.target as SankeyNode).targetLinks!.sort(ascendingSourceBreadth);
    }
  }

  function reorderLinks(nodes: SankeyNode[]): void {
    if (linkSort !== undefined) return;
    for (const { sourceLinks, targetLinks } of nodes) {
      sourceLinks!.sort(ascendingTargetBreadth);
      targetLinks!.sort(ascendingSourceBreadth);
    }
  }

  /**
   * Y position that link (source -> target) would have if links were sorted
   * by target breadth, used to compute the weighted median in relaxation.
   */
  function targetTop(source: SankeyNode, target: SankeyNode): number {
    let y = source.y0! - ((source.sourceLinks!.length - 1) * py) / 2;
    for (const { target: node, width } of source.sourceLinks!) {
      if (node === target) break;
      y += width! + py;
    }
    for (const { source: node, width } of target.targetLinks!) {
      if (node === source) break;
      y += width!;
    }
    return y;
  }

  function sourceTop(source: SankeyNode, target: SankeyNode): number {
    let y = target.y0! - ((target.targetLinks!.length - 1) * py) / 2;
    for (const { source: node, width } of target.targetLinks!) {
      if (node === source) break;
      y += width! + py;
    }
    for (const { target: node, width } of source.sourceLinks!) {
      if (node === target) break;
      y += width!;
    }
    return y;
  }

  function computeLinkBreadths({ nodes }: SankeyGraph): void {
    for (const node of nodes) {
      let ly0 = node.y0!;
      let ly1 = ly0;
      for (const link of node.sourceLinks!) {
        link.y0 = ly0 + link.width! / 2;
        ly0 += link.width!;
      }
      for (const link of node.targetLinks!) {
        link.y1 = ly1 + link.width! / 2;
        ly1 += link.width!;
      }
    }
  }

  return layout;
}

// ---------------------------------------------------------------------------
// sankeyLinkHorizontalPoints
// ---------------------------------------------------------------------------

export type Point2 = [number, number];

/**
 * The cubic bezier of d3's sankeyLinkHorizontal for a laid-out link:
 * starts at [source.x1, link.y0], ends at [target.x0, link.y1], with
 * horizontal tangents -- both control points sit at the horizontal midpoint
 * (curveBumpX): c1 = [mx, y0], c2 = [mx, y1].
 *
 * With no `samples`, returns the 4 control points
 * [[x0, y0], [c1x, c1y], [c2x, c2y], [x1, y1]] ready for
 * VMobject.addCubicBezier. With `samples` (>= 2), returns that many points
 * evaluated along the cubic instead (a polyline approximation).
 *
 * Note: the returned centerline should be stroked with width `link.width`
 * to render the ribbon, exactly like d3's stroked-path convention.
 */
export function sankeyLinkHorizontalPoints(link: SankeyLink, samples?: number): Point2[] {
  const source = link.source as SankeyNode;
  const target = link.target as SankeyNode;
  const px0 = source.x1!;
  const py0 = link.y0!;
  const px1 = target.x0!;
  const py1 = link.y1!;
  const mx = (px0 + px1) / 2;

  const controls: Point2[] = [
    [px0, py0],
    [mx, py0],
    [mx, py1],
    [px1, py1],
  ];
  if (samples === undefined) return controls;
  if (!(samples >= 2)) throw new Error("samples must be >= 2");

  const out: Point2[] = [];
  for (let i = 0; i < samples; ++i) {
    const t = i / (samples - 1);
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push([
      a * controls[0][0] + b * controls[1][0] + c * controls[2][0] + d * controls[3][0],
      a * controls[0][1] + b * controls[1][1] + c * controls[2][1] + d * controls[3][1],
    ]);
  }
  return out;
}
