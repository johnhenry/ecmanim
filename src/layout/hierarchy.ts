/**
 * Hierarchy layouts — a faithful TypeScript port of d3-hierarchy.
 *
 * Pure math, isomorphic (no renderer/mobject imports, no `node:` imports).
 *
 * Provides:
 *   - hierarchy(data, children?)          — node model (sum/count/sort/traversal/links)
 *   - stratify({id, parentId} | {path})   — tabular input → node model
 *   - treemap()                            — squarify/binary/slice/dice/sliceDice tiling → {x0, y0, x1, y1}
 *   - partition()                          — icicle bands → {x0, y0, x1, y1} (map to polar for sunburst)
 *   - pack()                               — front-chain circle packing + Welzl enclose → {x, y, r}
 *   - tree()                               — Buchheim et al. linear-time tidy tree → {x, y}
 *   - cluster()                            — dendrogram, leaves at equal depth → {x, y}
 *
 * Coordinate conventions match d3 exactly so d3 ports translate 1:1:
 *   - treemap/partition: origin top-left of the [0,0,w,h] region; y grows down;
 *     partition assigns y bands by depth (root band at y0 = 0).
 *   - pack: root circle centered at (w/2, h/2).
 *   - tree/cluster with size([w,h]): x in [0,w] (breadth), y in [0,h] (depth;
 *     root at y = 0). With nodeSize([dx,dy]): root at (0,0), siblings dx apart.
 *   - pack() and pack/enclose randomization uses d3's own deterministic LCG,
 *     so results are reproducible and identical to d3's.
 *
 * Known (intentional) divergences from d3-hierarchy — noted inline too:
 *   - stratify(options?) accepts an options object ({id, parentId} or {path})
 *     in addition to d3's fluent .id()/.parentId()/.path() accessors (both work).
 *   - node.copy() is not provided (not needed by the campaign; everything else
 *     from the d3 node model is here, including node.path()).
 */

// ---------------------------------------------------------------------------
// Deterministic LCG (d3-hierarchy/src/lcg.js) — used by pack/enclose shuffles.
// ---------------------------------------------------------------------------

const lcgA = 1664525;
const lcgC = 1013904223;
const lcgM = 4294967296; // 2^32

function lcg(): () => number {
  let s = 1;
  return () => (s = (lcgA * s + lcgC) % lcgM) / lcgM;
}

function shuffle<U>(array: U[], random: () => number): U[] {
  let m = array.length;
  let t: U;
  let i: number;
  while (m) {
    i = (random() * m--) | 0;
    t = array[m];
    array[m] = array[i];
    array[i] = t;
  }
  return array;
}

// ---------------------------------------------------------------------------
// Node model
// ---------------------------------------------------------------------------

export interface HierarchyLink<T> {
  source: HierarchyNode<T>;
  target: HierarchyNode<T>;
}

/** Computes node.height = max distance to a leaf (d3 computeHeight). */
function computeHeight(node: HierarchyNode<unknown>): void {
  let height = 0;
  let n: HierarchyNode<unknown> | null = node;
  do {
    n.height = height;
  } while ((n = n.parent) !== null && n.height < ++height);
}

/** d3's count() reducer: leaves count 1; internal nodes sum children. */
function countNode(node: HierarchyNode<unknown>): void {
  let sum = 0;
  const children = node.children;
  let i = children ? children.length : 0;
  if (!i) sum = 1;
  else while (--i >= 0) sum += children![i].value!;
  node.value = sum;
}

export class HierarchyNode<T> {
  data: T;
  depth: number;
  height: number;
  parent: HierarchyNode<T> | null;
  children?: HierarchyNode<T>[];
  /** Set by sum()/count(). */
  value?: number;
  /** Set by stratify(). */
  id?: string;
  /** Set by treemap()/partition(). */
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
  /** Set by pack() (x, y, r) and tree()/cluster() (x, y). */
  x?: number;
  y?: number;
  r?: number;

  constructor(data: T) {
    this.data = data;
    this.depth = 0;
    this.height = 0;
    this.parent = null;
  }

  /**
   * Post-order aggregation. Matches d3 exactly: node.value = the node's OWN
   * value (+value(node.data) || 0, so NaN/negative-coercion follows d3) PLUS
   * the sum of its children's already-computed values.
   */
  sum(value: (d: T) => number): this {
    return this.eachAfter((node) => {
      let sum = +value(node.data) || 0;
      const children = node.children;
      let i = children ? children.length : 0;
      while (--i >= 0) sum += children![i].value!;
      node.value = sum;
    });
  }

  /** node.value = number of leaves under (and including) the node. */
  count(): this {
    return this.eachAfter(countNode);
  }

  /**
   * Breadth-first traversal (same order as the node iterator / descendants()).
   */
  each(
    callback: (node: HierarchyNode<T>, index: number, root: this) => void,
    that?: unknown,
  ): this {
    let index = -1;
    for (const node of this) {
      callback.call(that, node, ++index, this);
    }
    return this;
  }

  /** Post-order traversal (children before parents). */
  eachAfter(
    callback: (node: HierarchyNode<T>, index: number, root: this) => void,
    that?: unknown,
  ): this {
    const nodes: HierarchyNode<T>[] = [this];
    const next: HierarchyNode<T>[] = [];
    let node: HierarchyNode<T> | undefined;
    let index = -1;
    while ((node = nodes.pop()) !== undefined) {
      next.push(node);
      const children = node.children;
      if (children) for (let i = 0, n = children.length; i < n; ++i) nodes.push(children[i]);
    }
    while ((node = next.pop()) !== undefined) {
      callback.call(that, node, ++index, this);
    }
    return this;
  }

  /** Pre-order traversal (parents before children). */
  eachBefore(
    callback: (node: HierarchyNode<T>, index: number, root: this) => void,
    that?: unknown,
  ): this {
    const nodes: HierarchyNode<T>[] = [this];
    let node: HierarchyNode<T> | undefined;
    let index = -1;
    while ((node = nodes.pop()) !== undefined) {
      callback.call(that, node, ++index, this);
      const children = node.children;
      if (children) for (let i = children.length - 1; i >= 0; --i) nodes.push(children[i]);
    }
    return this;
  }

  /** First node (in breadth-first order) for which callback returns truthy. */
  find(
    callback: (node: HierarchyNode<T>, index: number, root: this) => unknown,
    that?: unknown,
  ): HierarchyNode<T> | undefined {
    let index = -1;
    for (const node of this) {
      if (callback.call(that, node, ++index, this)) return node;
    }
    return undefined;
  }

  /**
   * Sorts children of every node (pre-order, MUTATES children arrays in
   * place, like d3). Call after sum() and before a layout.
   */
  sort(compare: (a: HierarchyNode<T>, b: HierarchyNode<T>) => number): this {
    return this.eachBefore((node) => {
      if (node.children) node.children.sort(compare);
    });
  }

  /** Shortest path through the lowest common ancestor (d3 node.path). */
  path(end: HierarchyNode<T>): HierarchyNode<T>[] {
    let start: HierarchyNode<T> = this;
    const ancestor = leastCommonAncestor(start, end);
    const nodes: HierarchyNode<T>[] = [start];
    while (start !== ancestor) {
      start = start.parent!;
      nodes.push(start);
    }
    const k = nodes.length;
    let e: HierarchyNode<T> | null = end;
    while (e !== ancestor) {
      nodes.splice(k, 0, e!);
      e = e!.parent;
    }
    return nodes;
  }

  /** This node, then each parent up to the root. */
  ancestors(): HierarchyNode<T>[] {
    let node: HierarchyNode<T> | null = this;
    const nodes: HierarchyNode<T>[] = [node];
    while ((node = node.parent) !== null) nodes.push(node);
    return nodes;
  }

  /** All nodes in breadth-first order (self first). */
  descendants(): HierarchyNode<T>[] {
    return Array.from(this);
  }

  /** All leaf nodes in pre-order. */
  leaves(): HierarchyNode<T>[] {
    const leaves: HierarchyNode<T>[] = [];
    this.eachBefore((node) => {
      if (!node.children) leaves.push(node);
    });
    return leaves;
  }

  /** {source: parent, target: child} for every descendant edge. */
  links(): HierarchyLink<T>[] {
    const root = this;
    const links: HierarchyLink<T>[] = [];
    root.each((node) => {
      if (node !== root) links.push({ source: node.parent!, target: node });
    });
    return links;
  }

  /** Breadth-first iterator (d3 Node[Symbol.iterator]). */
  *[Symbol.iterator](): Generator<HierarchyNode<T>, void, undefined> {
    let node: HierarchyNode<T> | undefined = this;
    let current: HierarchyNode<T>[];
    let next: HierarchyNode<T>[] = [node];
    do {
      current = next.reverse();
      next = [];
      while ((node = current.pop()) !== undefined) {
        yield node;
        const children = node.children;
        if (children) for (let i = 0, n = children.length; i < n; ++i) next.push(children[i]);
      }
    } while (next.length);
  }
}

function leastCommonAncestor<T>(
  a: HierarchyNode<T> | null,
  b: HierarchyNode<T> | null,
): HierarchyNode<T> | null {
  if (a === b) return a;
  const aNodes = a!.ancestors();
  const bNodes = b!.ancestors();
  let c: HierarchyNode<T> | null = null;
  let ai = aNodes.length - 1;
  let bi = bNodes.length - 1;
  let an = aNodes[ai];
  let bn = bNodes[bi];
  while (an === bn) {
    c = an;
    an = aNodes[--ai];
    bn = bNodes[--bi];
  }
  return c;
}

function objectChildren(d: unknown): unknown {
  return (d as { children?: unknown }).children;
}

function mapChildren(d: unknown): unknown {
  return Array.isArray(d) ? d[1] : null;
}

/**
 * Constructs a root HierarchyNode from hierarchical data. `children` returns
 * an iterable of children (default: d.children). Maps are treated as
 * [key, value] entries like d3 (children of a Map node are its entries).
 */
export function hierarchy<T>(
  data: T,
  children?: (d: T) => Iterable<T> | null | undefined,
): HierarchyNode<T> {
  let accessor: (d: T) => Iterable<T> | null | undefined;
  let rootData: T = data;
  if (data instanceof Map) {
    // d3 wraps Map roots as a [key, value] entry; children default to entries.
    rootData = [undefined, data] as unknown as T;
    accessor =
      children ?? (mapChildren as (d: T) => Iterable<T> | null | undefined);
  } else {
    accessor = children ?? (objectChildren as (d: T) => Iterable<T> | null | undefined);
  }

  const root = new HierarchyNode<T>(rootData);
  const nodes: HierarchyNode<T>[] = [root];
  let node: HierarchyNode<T> | undefined;

  while ((node = nodes.pop()) !== undefined) {
    const childData = accessor(node.data);
    if (childData) {
      const childs = Array.from(childData);
      const n = childs.length;
      if (n) {
        const childNodes: HierarchyNode<T>[] = new Array(n);
        node.children = childNodes;
        for (let i = n - 1; i >= 0; --i) {
          const child = (childNodes[i] = new HierarchyNode(childs[i]));
          nodes.push(child);
          child.parent = node;
          child.depth = node.depth + 1;
        }
      }
    }
  }

  return root.eachBefore(computeHeight);
}

// ---------------------------------------------------------------------------
// stratify — tabular ({id, parentId}) or slash-path input → node model
// ---------------------------------------------------------------------------

export interface StratifyOptions<T> {
  id?: (d: T, i: number, data: T[]) => string | number | null | undefined;
  parentId?: (d: T, i: number, data: T[]) => string | number | null | undefined;
  path?: (d: T, i: number, data: T[]) => string;
}

export interface StratifyOperator<T> {
  /** Imputed path nodes (see path()) carry data === null. */
  (data: Iterable<T>): HierarchyNode<T>;
  id(): (d: T, i: number, data: T[]) => string | number | null | undefined;
  id(fn: (d: T, i: number, data: T[]) => string | number | null | undefined): StratifyOperator<T>;
  parentId(): (d: T, i: number, data: T[]) => string | number | null | undefined;
  parentId(
    fn: (d: T, i: number, data: T[]) => string | number | null | undefined,
  ): StratifyOperator<T>;
  path(): ((d: T, i: number, data: T[]) => string) | null;
  path(fn: ((d: T, i: number, data: T[]) => string) | null): StratifyOperator<T>;
}

function defaultId(d: unknown): unknown {
  return (d as { id?: unknown }).id;
}

function defaultParentId(d: unknown): unknown {
  return (d as { parentId?: unknown }).parentId;
}

// Path helpers (verbatim d3 semantics): slashes may be escaped with
// backslashes; trailing slash stripped; leading slash added.
function slash(path: string, i: number): boolean {
  if (path[i] === "/") {
    let k = 0;
    while (i > 0 && path[--i] === "\\") ++k;
    if ((k & 1) === 0) return true;
  }
  return false;
}

function normalizePath(path: unknown): string {
  let p = `${path}`;
  const i = p.length;
  if (slash(p, i - 1) && !slash(p, i - 2)) p = p.slice(0, -1);
  return p[0] === "/" ? p : `/${p}`;
}

// "/foo/bar" → "/foo", "/foo" → "/", "/" → "" (root id must be truthy).
function parentofPath(path: string): string {
  let i = path.length;
  if (i < 2) return "";
  while (--i > 1) if (slash(path, i)) break;
  return path.slice(0, i);
}

/**
 * Builds a hierarchy from tabular data.
 *
 * DIVERGENCE (additive): accepts an options object — stratify({id, parentId})
 * or stratify({path}) — in addition to d3's fluent accessors, which are also
 * provided (.id(), .parentId(), .path()).
 */
export function stratify<T>(options?: StratifyOptions<T>): StratifyOperator<T> {
  let id: (d: T, i: number, data: T[]) => unknown = defaultId as (
    d: T,
    i: number,
    data: T[],
  ) => unknown;
  let parentId: (d: T, i: number, data: T[]) => unknown = defaultParentId as (
    d: T,
    i: number,
    data: T[],
  ) => unknown;
  let path: ((d: T, i: number, data: T[]) => unknown) | null = null;

  if (options) {
    if (options.id) id = options.id;
    if (options.parentId) parentId = options.parentId;
    if (options.path) path = options.path;
  }

  // Sentinels (d3 uses object identity for both).
  const ambiguous = {};
  const imputed = {};

  function op(data: Iterable<T>): HierarchyNode<T> {
    const array: unknown[] = Array.from(data);
    let currentId = id as (d: unknown, i: number, data: unknown) => unknown;
    let currentParentId = parentId as (d: unknown, i: number, data: unknown) => unknown;
    const nodeByKey = new Map<string, HierarchyNode<T> | typeof ambiguous>();
    let root: HierarchyNode<T> | undefined;

    if (path != null) {
      const p = path as (d: unknown, i: number, data: unknown) => unknown;
      const I = array.map((d, i) => normalizePath(p(d, i, data)));
      const P = I.map(parentofPath);
      const S = new Set(I).add("");
      for (const pi of P) {
        if (!S.has(pi)) {
          S.add(pi);
          I.push(pi);
          P.push(parentofPath(pi));
          array.push(imputed);
        }
      }
      currentId = (_, i) => I[i];
      currentParentId = (_, i) => P[i];
    }

    let n = array.length;
    const nodes: HierarchyNode<T>[] = new Array(n);
    const parentIds: (string | undefined)[] = new Array(n);

    for (let i = 0; i < n; ++i) {
      const d = array[i];
      const node = (nodes[i] = new HierarchyNode<T>(d as T));
      let nodeId = currentId(d, i, data);
      if (nodeId != null && (nodeId = `${nodeId}`)) {
        const nodeKey = (node.id = nodeId as string);
        nodeByKey.set(nodeKey, nodeByKey.has(nodeKey) ? ambiguous : node);
      }
      let pid = currentParentId(d, i, data);
      if (pid != null && (pid = `${pid}`)) {
        parentIds[i] = pid as string;
      }
    }

    for (let i = 0; i < n; ++i) {
      const node = nodes[i];
      const nodeId = parentIds[i];
      if (nodeId) {
        const parent = nodeByKey.get(nodeId);
        if (!parent) throw new Error("missing: " + nodeId);
        if (parent === ambiguous) throw new Error("ambiguous: " + nodeId);
        const parentNode = parent as HierarchyNode<T>;
        if (parentNode.children) parentNode.children.push(node);
        else parentNode.children = [node];
        node.parent = parentNode;
      } else {
        if (root) throw new Error("multiple roots");
        root = node;
      }
    }

    if (!root) throw new Error("no root");

    // When imputing internal nodes, only introduce roots if needed.
    // Then replace the imputed marker data with null.
    if (path != null) {
      while ((root.data as unknown) === imputed && root.children!.length === 1) {
        root = root.children![0];
        --n;
      }
      for (let i = nodes.length - 1; i >= 0; --i) {
        const node = nodes[i];
        if ((node.data as unknown) !== imputed) break;
        node.data = null as unknown as T;
      }
    }

    const preroot = { depth: -1 } as unknown as HierarchyNode<T>;
    root.parent = preroot;
    root
      .eachBefore((node) => {
        node.depth = node.parent!.depth + 1;
        --n;
      })
      .eachBefore(computeHeight);
    root.parent = null;
    if (n > 0) throw new Error("cycle");

    return root;
  }

  const operator = op as StratifyOperator<T>;

  operator.id = function (x?: (d: T, i: number, data: T[]) => string | number | null | undefined) {
    if (x === undefined) return id as never;
    if (typeof x !== "function") throw new Error("id is not a function");
    id = x;
    return operator as never;
  } as StratifyOperator<T>["id"];

  operator.parentId = function (
    x?: (d: T, i: number, data: T[]) => string | number | null | undefined,
  ) {
    if (x === undefined) return parentId as never;
    if (typeof x !== "function") throw new Error("parentId is not a function");
    parentId = x;
    return operator as never;
  } as StratifyOperator<T>["parentId"];

  operator.path = function (x?: ((d: T, i: number, data: T[]) => string) | null) {
    if (x === undefined) return path as never;
    if (x !== null && typeof x !== "function") throw new Error("path is not a function");
    path = x;
    return operator as never;
  } as StratifyOperator<T>["path"];

  return operator;
}

// ---------------------------------------------------------------------------
// Treemap tiling methods
// ---------------------------------------------------------------------------

/** Structural node shape that tiles operate on (HierarchyNode satisfies it). */
export interface TileRect {
  value?: number;
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
}

export interface TileNode {
  value?: number;
  depth?: number;
  children?: TileRect[];
}

export type TileFunction = (
  parent: TileNode,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) => void;

export interface SquarifyTileFunction extends TileFunction {
  /** Returns a new squarify tile with the specified desired aspect ratio (>= 1). */
  ratio(ratio: number): SquarifyTileFunction;
}

/** Golden ratio — d3's default squarify target aspect ratio. */
export const phi = (1 + Math.sqrt(5)) / 2;

/** Horizontal subdivision: children side by side, x varies, full height. */
export const treemapDice: TileFunction = (parent, x0, y0, x1, y1) => {
  const nodes = parent.children!;
  const n = nodes.length;
  const k = parent.value! && (x1 - x0) / parent.value!;
  let x = x0;
  for (let i = 0; i < n; ++i) {
    const node = nodes[i];
    node.y0 = y0;
    node.y1 = y1;
    node.x0 = x;
    node.x1 = x += node.value! * k;
  }
};

/** Vertical subdivision: children stacked, y varies, full width. */
export const treemapSlice: TileFunction = (parent, x0, y0, x1, y1) => {
  const nodes = parent.children!;
  const n = nodes.length;
  const k = parent.value! && (y1 - y0) / parent.value!;
  let y = y0;
  for (let i = 0; i < n; ++i) {
    const node = nodes[i];
    node.x0 = x0;
    node.x1 = x1;
    node.y0 = y;
    node.y1 = y += node.value! * k;
  }
};

/** Alternates dice (even depth) and slice (odd depth), like d3. */
export const treemapSliceDice: TileFunction = (parent, x0, y0, x1, y1) => {
  ((parent.depth ?? 0) & 1 ? treemapSlice : treemapDice)(parent, x0, y0, x1, y1);
};

interface SquarifyRow {
  value: number;
  dice: boolean;
  children: TileRect[];
}

/**
 * d3's squarifyRatio: greedily fills rows along the shorter side, adding
 * nodes while the worst aspect ratio (relative to `ratio`) doesn't degrade.
 */
function squarifyRatio(
  ratio: number,
  parent: TileNode,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): SquarifyRow[] {
  const rows: SquarifyRow[] = [];
  const nodes = parent.children!;
  const n = nodes.length;
  let i0 = 0;
  let i1 = 0;
  let value = parent.value!;

  while (i0 < n) {
    const dx = x1 - x0;
    const dy = y1 - y0;

    // Find the next non-empty node.
    let sumValue: number;
    do sumValue = nodes[i1++].value!;
    while (!sumValue && i1 < n);
    let minValue = sumValue;
    let maxValue = sumValue;
    const alpha = Math.max(dy / dx, dx / dy) / (value * ratio);
    let beta = sumValue * sumValue * alpha;
    let minRatio = Math.max(maxValue / beta, beta / minValue);

    // Keep adding nodes while the aspect ratio maintains or improves.
    for (; i1 < n; ++i1) {
      const nodeValue = nodes[i1].value!;
      sumValue += nodeValue;
      if (nodeValue < minValue) minValue = nodeValue;
      if (nodeValue > maxValue) maxValue = nodeValue;
      beta = sumValue * sumValue * alpha;
      const newRatio = Math.max(maxValue / beta, beta / minValue);
      if (newRatio > minRatio) {
        sumValue -= nodeValue;
        break;
      }
      minRatio = newRatio;
    }

    // Position and record the row orientation.
    const row: SquarifyRow = { value: sumValue, dice: dx < dy, children: nodes.slice(i0, i1) };
    rows.push(row);
    if (row.dice) {
      treemapDice(row, x0, y0, x1, value ? (y0 += (dy * sumValue) / value) : y1);
    } else {
      treemapSlice(row, x0, y0, value ? (x0 += (dx * sumValue) / value) : x1, y1);
    }
    value -= sumValue;
    i0 = i1;
  }

  return rows;
}

function customSquarify(ratio: number): SquarifyTileFunction {
  const squarify = ((parent, x0, y0, x1, y1) => {
    squarifyRatio(ratio, parent, x0, y0, x1, y1);
  }) as SquarifyTileFunction;
  squarify.ratio = (x: number) => customSquarify((x = +x) > 1 ? x : 1);
  return squarify;
}

/**
 * Squarified treemap tiling (Bruls et al.) minimizing worst aspect ratio;
 * rows run along the shorter side. Default target ratio: golden ratio (phi).
 */
export const treemapSquarify: SquarifyTileFunction = customSquarify(phi);

/** Recursive binary partition balancing value halves. */
export const treemapBinary: TileFunction = (parent, x0, y0, x1, y1) => {
  const nodes = parent.children!;
  const n = nodes.length;
  const sums = new Array<number>(n + 1);
  let sum = (sums[0] = 0);
  for (let i = 0; i < n; ++i) {
    sums[i + 1] = sum += nodes[i].value!;
  }

  function partition(
    i: number,
    j: number,
    value: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void {
    if (i >= j - 1) {
      const node = nodes[i];
      node.x0 = x0;
      node.y0 = y0;
      node.x1 = x1;
      node.y1 = y1;
      return;
    }

    const valueOffset = sums[i];
    const valueTarget = value / 2 + valueOffset;
    let k = i + 1;
    let hi = j - 1;

    while (k < hi) {
      const mid = (k + hi) >>> 1;
      if (sums[mid] < valueTarget) k = mid + 1;
      else hi = mid;
    }

    if (valueTarget - sums[k - 1] < sums[k] - valueTarget && i + 1 < k) --k;

    const valueLeft = sums[k] - valueOffset;
    const valueRight = value - valueLeft;

    if (x1 - x0 > y1 - y0) {
      const xk = value ? (x0 * valueRight + x1 * valueLeft) / value : x1;
      partition(i, k, valueLeft, x0, y0, xk, y1);
      partition(k, j, valueRight, xk, y0, x1, y1);
    } else {
      const yk = value ? (y0 * valueRight + y1 * valueLeft) / value : y1;
      partition(i, k, valueLeft, x0, y0, x1, yk);
      partition(k, j, valueRight, x0, yk, x1, y1);
    }
  }

  partition(0, n, parent.value!, x0, y0, x1, y1);
};

// ---------------------------------------------------------------------------
// treemap() layout
// ---------------------------------------------------------------------------

function constantZero(): number {
  return 0;
}

function constant(x: number): () => number {
  return () => x;
}

function roundNode(node: HierarchyNode<unknown>): void {
  node.x0 = Math.round(node.x0!);
  node.y0 = Math.round(node.y0!);
  node.x1 = Math.round(node.x1!);
  node.y1 = Math.round(node.y1!);
}

export type NodeValueFunction<T> = (node: HierarchyNode<T>) => number;

export interface TreemapLayout<T> {
  /** Assigns x0/y0/x1/y1 on every node. Call sum() (and optionally sort()) first. */
  (root: HierarchyNode<T>): HierarchyNode<T>;
  tile(): TileFunction;
  tile(tile: TileFunction): TreemapLayout<T>;
  size(): [number, number];
  size(size: readonly [number, number]): TreemapLayout<T>;
  round(): boolean;
  round(round: boolean): TreemapLayout<T>;
  padding(): NodeValueFunction<T>;
  padding(padding: number | NodeValueFunction<T>): TreemapLayout<T>;
  paddingInner(): NodeValueFunction<T>;
  paddingInner(padding: number | NodeValueFunction<T>): TreemapLayout<T>;
  paddingOuter(): NodeValueFunction<T>;
  paddingOuter(padding: number | NodeValueFunction<T>): TreemapLayout<T>;
  paddingTop(): NodeValueFunction<T>;
  paddingTop(padding: number | NodeValueFunction<T>): TreemapLayout<T>;
  paddingRight(): NodeValueFunction<T>;
  paddingRight(padding: number | NodeValueFunction<T>): TreemapLayout<T>;
  paddingBottom(): NodeValueFunction<T>;
  paddingBottom(padding: number | NodeValueFunction<T>): TreemapLayout<T>;
  paddingLeft(): NodeValueFunction<T>;
  paddingLeft(padding: number | NodeValueFunction<T>): TreemapLayout<T>;
}

/**
 * Treemap layout. Defaults match d3: squarify tiling (golden ratio), size
 * [1, 1], zero padding, no rounding.
 */
export function treemap<T = unknown>(): TreemapLayout<T> {
  type Fn = (node: HierarchyNode<T>) => number;
  let tile: TileFunction = treemapSquarify;
  let round = false;
  let dx = 1;
  let dy = 1;
  let paddingStack: number[] = [0];
  let paddingInner: Fn = constantZero;
  let paddingTop: Fn = constantZero;
  let paddingRight: Fn = constantZero;
  let paddingBottom: Fn = constantZero;
  let paddingLeft: Fn = constantZero;

  function layout(root: HierarchyNode<T>): HierarchyNode<T> {
    root.x0 = root.y0 = 0;
    root.x1 = dx;
    root.y1 = dy;
    root.eachBefore(positionNode);
    paddingStack = [0];
    if (round) root.eachBefore(roundNode);
    return root;
  }

  function positionNode(node: HierarchyNode<T>): void {
    let p = paddingStack[node.depth];
    let x0 = node.x0! + p;
    let y0 = node.y0! + p;
    let x1 = node.x1! - p;
    let y1 = node.y1! - p;
    if (x1 < x0) x0 = x1 = (x0 + x1) / 2;
    if (y1 < y0) y0 = y1 = (y0 + y1) / 2;
    node.x0 = x0;
    node.y0 = y0;
    node.x1 = x1;
    node.y1 = y1;
    if (node.children) {
      p = paddingStack[node.depth + 1] = paddingInner(node) / 2;
      x0 += paddingLeft(node) - p;
      y0 += paddingTop(node) - p;
      x1 -= paddingRight(node) - p;
      y1 -= paddingBottom(node) - p;
      if (x1 < x0) x0 = x1 = (x0 + x1) / 2;
      if (y1 < y0) y0 = y1 = (y0 + y1) / 2;
      tile(node, x0, y0, x1, y1);
    }
  }

  const self = layout as TreemapLayout<T>;

  self.round = function (x?: boolean) {
    if (x === undefined) return round as never;
    round = !!x;
    return self as never;
  } as TreemapLayout<T>["round"];

  self.size = function (x?: readonly [number, number]) {
    if (x === undefined) return [dx, dy] as never;
    dx = +x[0];
    dy = +x[1];
    return self as never;
  } as TreemapLayout<T>["size"];

  self.tile = function (x?: TileFunction) {
    if (x === undefined) return tile as never;
    if (typeof x !== "function") throw new Error("tile is not a function");
    tile = x;
    return self as never;
  } as TreemapLayout<T>["tile"];

  self.padding = function (x?: number | Fn) {
    if (x === undefined) return self.paddingInner() as never;
    return self.paddingInner(x).paddingOuter(x) as never;
  } as TreemapLayout<T>["padding"];

  self.paddingInner = function (x?: number | Fn) {
    if (x === undefined) return paddingInner as never;
    paddingInner = typeof x === "function" ? x : constant(+x);
    return self as never;
  } as TreemapLayout<T>["paddingInner"];

  self.paddingOuter = function (x?: number | Fn) {
    if (x === undefined) return self.paddingTop() as never;
    return self.paddingTop(x).paddingRight(x).paddingBottom(x).paddingLeft(x) as never;
  } as TreemapLayout<T>["paddingOuter"];

  self.paddingTop = function (x?: number | Fn) {
    if (x === undefined) return paddingTop as never;
    paddingTop = typeof x === "function" ? x : constant(+x);
    return self as never;
  } as TreemapLayout<T>["paddingTop"];

  self.paddingRight = function (x?: number | Fn) {
    if (x === undefined) return paddingRight as never;
    paddingRight = typeof x === "function" ? x : constant(+x);
    return self as never;
  } as TreemapLayout<T>["paddingRight"];

  self.paddingBottom = function (x?: number | Fn) {
    if (x === undefined) return paddingBottom as never;
    paddingBottom = typeof x === "function" ? x : constant(+x);
    return self as never;
  } as TreemapLayout<T>["paddingBottom"];

  self.paddingLeft = function (x?: number | Fn) {
    if (x === undefined) return paddingLeft as never;
    paddingLeft = typeof x === "function" ? x : constant(+x);
    return self as never;
  } as TreemapLayout<T>["paddingLeft"];

  return self;
}

// ---------------------------------------------------------------------------
// partition() — adjacency diagram (icicle); map bands to polar for sunburst
// ---------------------------------------------------------------------------

export interface PartitionLayout<T> {
  /**
   * Assigns x0/y0/x1/y1; y bands correspond to depth (root band at the top,
   * y0 = padding, band height = h / (root.height + 1)). Call sum() first.
   */
  (root: HierarchyNode<T>): HierarchyNode<T>;
  size(): [number, number];
  size(size: readonly [number, number]): PartitionLayout<T>;
  round(): boolean;
  round(round: boolean): PartitionLayout<T>;
  padding(): number;
  padding(padding: number): PartitionLayout<T>;
}

/** Partition layout. Defaults match d3: size [1, 1], padding 0, round false. */
export function partition<T = unknown>(): PartitionLayout<T> {
  let dx = 1;
  let dy = 1;
  let padding = 0;
  let round = false;

  function layout(root: HierarchyNode<T>): HierarchyNode<T> {
    const n = root.height + 1;
    root.x0 = root.y0 = padding;
    root.x1 = dx;
    root.y1 = dy / n;
    root.eachBefore(positionNode(dy, n));
    if (round) root.eachBefore(roundNode);
    return root;
  }

  function positionNode(dy: number, n: number): (node: HierarchyNode<T>) => void {
    return (node) => {
      if (node.children) {
        treemapDice(
          node,
          node.x0!,
          (dy * (node.depth + 1)) / n,
          node.x1!,
          (dy * (node.depth + 2)) / n,
        );
      }
      let x0 = node.x0!;
      let y0 = node.y0!;
      let x1 = node.x1! - padding;
      let y1 = node.y1! - padding;
      if (x1 < x0) x0 = x1 = (x0 + x1) / 2;
      if (y1 < y0) y0 = y1 = (y0 + y1) / 2;
      node.x0 = x0;
      node.y0 = y0;
      node.x1 = x1;
      node.y1 = y1;
    };
  }

  const self = layout as PartitionLayout<T>;

  self.round = function (x?: boolean) {
    if (x === undefined) return round as never;
    round = !!x;
    return self as never;
  } as PartitionLayout<T>["round"];

  self.size = function (x?: readonly [number, number]) {
    if (x === undefined) return [dx, dy] as never;
    dx = +x[0];
    dy = +x[1];
    return self as never;
  } as PartitionLayout<T>["size"];

  self.padding = function (x?: number) {
    if (x === undefined) return padding as never;
    padding = +x;
    return self as never;
  } as PartitionLayout<T>["padding"];

  return self;
}

// ---------------------------------------------------------------------------
// enclose — smallest enclosing circle (Welzl, via d3's move-to-front basis)
// ---------------------------------------------------------------------------

export interface PackCircle {
  x: number;
  y: number;
  r: number;
}

/**
 * Smallest circle enclosing the given circles (d3 packEnclose; Welzl's
 * algorithm with a deterministic LCG shuffle, identical results to d3).
 */
export function packEnclose(circles: Iterable<PackCircle>): PackCircle | undefined {
  return packEncloseRandom(Array.from(circles), lcg());
}

function packEncloseRandom(circles: PackCircle[], random: () => number): PackCircle | undefined {
  let i = 0;
  const shuffled = shuffle(Array.from(circles), random);
  const n = shuffled.length;
  let B: PackCircle[] = [];
  let e: PackCircle | undefined;

  while (i < n) {
    const p = shuffled[i];
    if (e && enclosesWeak(e, p)) ++i;
    else {
      e = encloseBasis((B = extendBasis(B, p)));
      i = 0;
    }
  }

  return e;
}

function extendBasis(B: PackCircle[], p: PackCircle): PackCircle[] {
  if (enclosesWeakAll(p, B)) return [p];

  // If we get here then B must have at least one element.
  for (let i = 0; i < B.length; ++i) {
    if (enclosesNot(p, B[i]) && enclosesWeakAll(encloseBasis2(B[i], p), B)) {
      return [B[i], p];
    }
  }

  // If we get here then B must have at least two elements.
  for (let i = 0; i < B.length - 1; ++i) {
    for (let j = i + 1; j < B.length; ++j) {
      if (
        enclosesNot(encloseBasis2(B[i], B[j]), p) &&
        enclosesNot(encloseBasis2(B[i], p), B[j]) &&
        enclosesNot(encloseBasis2(B[j], p), B[i]) &&
        enclosesWeakAll(encloseBasis3(B[i], B[j], p), B)
      ) {
        return [B[i], B[j], p];
      }
    }
  }

  // If we get here then something is very wrong.
  throw new Error("unexpected enclose basis state");
}

function enclosesNot(a: PackCircle, b: PackCircle): boolean {
  const dr = a.r - b.r;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dr < 0 || dr * dr < dx * dx + dy * dy;
}

function enclosesWeak(a: PackCircle, b: PackCircle): boolean {
  const dr = a.r - b.r + Math.max(a.r, b.r, 1) * 1e-9;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dr > 0 && dr * dr > dx * dx + dy * dy;
}

function enclosesWeakAll(a: PackCircle, B: PackCircle[]): boolean {
  for (let i = 0; i < B.length; ++i) {
    if (!enclosesWeak(a, B[i])) return false;
  }
  return true;
}

function encloseBasis(B: PackCircle[]): PackCircle {
  switch (B.length) {
    case 1:
      return encloseBasis1(B[0]);
    case 2:
      return encloseBasis2(B[0], B[1]);
    default:
      return encloseBasis3(B[0], B[1], B[2]);
  }
}

function encloseBasis1(a: PackCircle): PackCircle {
  return { x: a.x, y: a.y, r: a.r };
}

function encloseBasis2(a: PackCircle, b: PackCircle): PackCircle {
  const x1 = a.x,
    y1 = a.y,
    r1 = a.r;
  const x2 = b.x,
    y2 = b.y,
    r2 = b.r;
  const x21 = x2 - x1,
    y21 = y2 - y1,
    r21 = r2 - r1;
  const l = Math.sqrt(x21 * x21 + y21 * y21);
  return {
    x: (x1 + x2 + (x21 / l) * r21) / 2,
    y: (y1 + y2 + (y21 / l) * r21) / 2,
    r: (l + r1 + r2) / 2,
  };
}

function encloseBasis3(a: PackCircle, b: PackCircle, c: PackCircle): PackCircle {
  const x1 = a.x,
    y1 = a.y,
    r1 = a.r;
  const x2 = b.x,
    y2 = b.y,
    r2 = b.r;
  const x3 = c.x,
    y3 = c.y,
    r3 = c.r;
  const a2 = x1 - x2,
    a3 = x1 - x3,
    b2 = y1 - y2,
    b3 = y1 - y3,
    c2 = r2 - r1,
    c3 = r3 - r1;
  const d1 = x1 * x1 + y1 * y1 - r1 * r1;
  const d2 = d1 - x2 * x2 - y2 * y2 + r2 * r2;
  const d3 = d1 - x3 * x3 - y3 * y3 + r3 * r3;
  const ab = a3 * b2 - a2 * b3;
  const xa = (b2 * d3 - b3 * d2) / (ab * 2) - x1;
  const xb = (b3 * c2 - b2 * c3) / ab;
  const ya = (a3 * d2 - a2 * d3) / (ab * 2) - y1;
  const yb = (a2 * c3 - a3 * c2) / ab;
  const A = xb * xb + yb * yb - 1;
  const B = 2 * (r1 + xa * xb + ya * yb);
  const C = xa * xa + ya * ya - r1 * r1;
  const r = -(Math.abs(A) > 1e-6 ? (B + Math.sqrt(B * B - 4 * A * C)) / (2 * A) : C / B);
  return {
    x: x1 + xa + xb * r,
    y: y1 + ya + yb * r,
    r,
  };
}

// ---------------------------------------------------------------------------
// packSiblings — front-chain circle packing (Wang et al.)
// ---------------------------------------------------------------------------

/** Positions circle c tangent to a and b (d3 place()). */
function place(b: PackCircle, a: PackCircle, c: PackCircle): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2) {
    let a2 = a.r + c.r;
    a2 *= a2;
    let b2 = b.r + c.r;
    b2 *= b2;
    if (a2 > b2) {
      const x = (d2 + b2 - a2) / (2 * d2);
      const y = Math.sqrt(Math.max(0, b2 / d2 - x * x));
      c.x = b.x - x * dx - y * dy;
      c.y = b.y - x * dy + y * dx;
    } else {
      const x = (d2 + a2 - b2) / (2 * d2);
      const y = Math.sqrt(Math.max(0, a2 / d2 - x * x));
      c.x = a.x + x * dx - y * dy;
      c.y = a.y + x * dy + y * dx;
    }
  } else {
    c.x = a.x + c.r;
    c.y = a.y;
  }
}

function intersects(a: PackCircle, b: PackCircle): boolean {
  const dr = a.r + b.r - 1e-6;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dr > 0 && dr * dr > dx * dx + dy * dy;
}

/** Doubly-linked front-chain node (renamed from d3's internal `Node`). */
class ChainLink {
  _: PackCircle;
  next: ChainLink | null = null;
  previous: ChainLink | null = null;
  constructor(circle: PackCircle) {
    this._ = circle;
  }
}

function score(node: ChainLink): number {
  const a = node._;
  const b = node.next!._;
  const ab = a.r + b.r;
  const dx = (a.x * b.r + b.x * a.r) / ab;
  const dy = (a.y * b.r + b.y * a.r) / ab;
  return dx * dx + dy * dy;
}

function packSiblingsRandom(circles: PackCircle[], random: () => number): number {
  const n = circles.length;
  if (!n) return 0;

  let a: PackCircle, b: PackCircle, c: PackCircle;

  // Place the first circle.
  a = circles[0];
  a.x = 0;
  a.y = 0;
  if (!(n > 1)) return a.r;

  // Place the second circle.
  b = circles[1];
  a.x = -b.r;
  b.x = a.r;
  b.y = 0;
  if (!(n > 2)) return a.r + b.r;

  // Place the third circle.
  place(b, a, (c = circles[2]));

  // Initialize the front-chain using the first three circles a, b and c.
  let na = new ChainLink(a);
  let nb = new ChainLink(b);
  let nc = new ChainLink(c);
  na.next = nc.previous = nb;
  nb.next = na.previous = nc;
  nc.next = nb.previous = na;

  // Attempt to place each remaining circle…
  pack: for (let i = 3; i < n; ++i) {
    place(na._, nb._, (c = circles[i]));
    nc = new ChainLink(c);

    // Find the closest intersecting circle on the front-chain, if any.
    // "Closeness" is determined by linear distance along the front-chain.
    // "Ahead" or "behind" is likewise determined by linear distance.
    let j = nb.next!;
    let k = na.previous!;
    let sj = nb._.r;
    let sk = na._.r;
    do {
      if (sj <= sk) {
        if (intersects(j._, nc._)) {
          nb = j;
          na.next = nb;
          nb.previous = na;
          --i;
          continue pack;
        }
        sj += j._.r;
        j = j.next!;
      } else {
        if (intersects(k._, nc._)) {
          na = k;
          na.next = nb;
          nb.previous = na;
          --i;
          continue pack;
        }
        sk += k._.r;
        k = k.previous!;
      }
    } while (j !== k.next);

    // Success! Insert the new circle c between a and b.
    nc.previous = na;
    nc.next = nb;
    na.next = nb.previous = nc;

    // Compute the new closest circle pair to the centroid.
    nb = nc;
    let aa = score(na);
    let cursor = nc;
    while ((cursor = cursor.next!) !== nb) {
      const ca = score(cursor);
      if (ca < aa) {
        na = cursor;
        aa = ca;
      }
    }
    nb = na.next!;
  }

  // Compute the enclosing circle of the front chain.
  const chain: PackCircle[] = [nb._];
  let cursor: ChainLink = nb;
  while ((cursor = cursor.next!) !== nb) chain.push(cursor._);
  const e = packEncloseRandom(chain, random)!;

  // Translate the circles to put the enclosing circle around the origin.
  for (let i = 0; i < n; ++i) {
    const circle = circles[i];
    circle.x -= e.x;
    circle.y -= e.y;
  }

  return e.r;
}

/**
 * Packs the given circles (each with a radius r) tightly, assigning x and y;
 * the enclosing circle is centered near the origin. Mutates and returns the
 * input array. Deterministic (d3's LCG), identical output to d3.
 */
export function packSiblings<C extends { r: number; x?: number; y?: number }>(circles: C[]): C[] {
  packSiblingsRandom(circles as unknown as PackCircle[], lcg());
  return circles;
}

// ---------------------------------------------------------------------------
// pack() layout
// ---------------------------------------------------------------------------

export interface PackLayout<T> {
  /** Assigns x, y, r on every node. Call sum() (and optionally sort()) first. */
  (root: HierarchyNode<T>): HierarchyNode<T>;
  radius(): NodeValueFunction<T> | null;
  radius(radius: NodeValueFunction<T> | null): PackLayout<T>;
  size(): [number, number];
  size(size: readonly [number, number]): PackLayout<T>;
  padding(): NodeValueFunction<T>;
  padding(padding: number | NodeValueFunction<T>): PackLayout<T>;
}

function defaultPackRadius(d: HierarchyNode<unknown>): number {
  return Math.sqrt(d.value!);
}

/**
 * Circle-packing layout. Defaults match d3: radius null (sqrt of value,
 * rescaled to fit), size [1, 1], padding 0. Root circle is centered at
 * (w/2, h/2).
 */
export function pack<T = unknown>(): PackLayout<T> {
  type Fn = (node: HierarchyNode<T>) => number;
  let radius: Fn | null = null;
  let dx = 1;
  let dy = 1;
  let padding: Fn = constantZero;

  function layout(root: HierarchyNode<T>): HierarchyNode<T> {
    const random = lcg();
    root.x = dx / 2;
    root.y = dy / 2;
    if (radius) {
      root
        .eachBefore(radiusLeaf(radius))
        .eachAfter(packChildrenRandom(padding, 0.5, random))
        .eachBefore(translateChild(1));
    } else {
      root
        .eachBefore(radiusLeaf(defaultPackRadius as Fn))
        .eachAfter(packChildrenRandom(constantZero, 1, random))
        .eachAfter(packChildrenRandom(padding, root.r! / Math.min(dx, dy), random))
        .eachBefore(translateChild(Math.min(dx, dy) / (2 * root.r!)));
    }
    return root;
  }

  function radiusLeaf(radius: Fn): (node: HierarchyNode<T>) => void {
    return (node) => {
      if (!node.children) {
        node.r = Math.max(0, +radius(node) || 0);
      }
    };
  }

  function packChildrenRandom(
    padding: Fn,
    k: number,
    random: () => number,
  ): (node: HierarchyNode<T>) => void {
    return (node) => {
      const children = node.children;
      if (children) {
        const n = children.length;
        const r = padding(node) * k || 0;
        if (r) for (let i = 0; i < n; ++i) children[i].r! += r;
        const e = packSiblingsRandom(children as unknown as PackCircle[], random);
        if (r) for (let i = 0; i < n; ++i) children[i].r! -= r;
        node.r = e + r;
      }
    };
  }

  function translateChild(k: number): (node: HierarchyNode<T>) => void {
    return (node) => {
      const parent = node.parent;
      node.r! *= k;
      if (parent) {
        node.x = parent.x! + k * node.x!;
        node.y = parent.y! + k * node.y!;
      }
    };
  }

  const self = layout as PackLayout<T>;

  self.radius = function (x?: Fn | null) {
    if (x === undefined) return radius as never;
    if (x !== null && typeof x !== "function") throw new Error("radius is not a function");
    radius = x;
    return self as never;
  } as PackLayout<T>["radius"];

  self.size = function (x?: readonly [number, number]) {
    if (x === undefined) return [dx, dy] as never;
    dx = +x[0];
    dy = +x[1];
    return self as never;
  } as PackLayout<T>["size"];

  self.padding = function (x?: number | Fn) {
    if (x === undefined) return padding as never;
    padding = typeof x === "function" ? x : constant(+x);
    return self as never;
  } as PackLayout<T>["padding"];

  return self;
}

// ---------------------------------------------------------------------------
// tree() — Buchheim et al. linear-time variant of Reingold–Tilford tidy tree
// ---------------------------------------------------------------------------

export type SeparationFunction<T> = (a: HierarchyNode<T>, b: HierarchyNode<T>) => number;

function defaultSeparation<T>(a: HierarchyNode<T>, b: HierarchyNode<T>): number {
  return a.parent === b.parent ? 1 : 2;
}

/** Working wrapper node for the Buchheim walks (d3 TreeNode). */
class TreeWrap {
  _: HierarchyNode<unknown>;
  parent: TreeWrap | null = null;
  children: TreeWrap[] | null = null;
  A: TreeWrap | null = null; // default ancestor
  a: TreeWrap; // ancestor
  z = 0; // prelim
  m = 0; // mod
  c = 0; // change
  s = 0; // shift
  t: TreeWrap | null = null; // thread
  i: number; // sibling index

  constructor(node: HierarchyNode<unknown>, i: number) {
    this._ = node;
    this.a = this;
    this.i = i;
  }
}

function treeWrapEachBefore(root: TreeWrap, callback: (v: TreeWrap) => void): void {
  const nodes: TreeWrap[] = [root];
  let node: TreeWrap | undefined;
  while ((node = nodes.pop()) !== undefined) {
    callback(node);
    const children = node.children;
    if (children) for (let i = children.length - 1; i >= 0; --i) nodes.push(children[i]);
  }
}

function treeWrapEachAfter(root: TreeWrap, callback: (v: TreeWrap) => void): void {
  const nodes: TreeWrap[] = [root];
  const next: TreeWrap[] = [];
  let node: TreeWrap | undefined;
  while ((node = nodes.pop()) !== undefined) {
    next.push(node);
    const children = node.children;
    if (children) for (let i = 0, n = children.length; i < n; ++i) nodes.push(children[i]);
  }
  while ((node = next.pop()) !== undefined) callback(node);
}

function treeRoot(root: HierarchyNode<unknown>): TreeWrap {
  const tree = new TreeWrap(root, 0);
  const nodes: TreeWrap[] = [tree];
  let node: TreeWrap | undefined;

  while ((node = nodes.pop()) !== undefined) {
    const children = node._.children;
    if (children) {
      const n = children.length;
      node.children = new Array(n);
      for (let i = n - 1; i >= 0; --i) {
        const child = (node.children[i] = new TreeWrap(children[i], i));
        nodes.push(child);
        child.parent = node;
      }
    }
  }

  (tree.parent = new TreeWrap(null as unknown as HierarchyNode<unknown>, 0)).children = [tree];
  return tree;
}

// Left/right contour successors (child or thread).
function nextLeft(v: TreeWrap): TreeWrap | null {
  const children = v.children;
  return children ? children[0] : v.t;
}

function nextRight(v: TreeWrap): TreeWrap | null {
  const children = v.children;
  return children ? children[children.length - 1] : v.t;
}

// Shifts the current subtree rooted at w+ (see Buchheim et al.).
function moveSubtree(wm: TreeWrap, wp: TreeWrap, shift: number): void {
  const change = shift / (wp.i - wm.i);
  wp.c -= change;
  wp.s += shift;
  wm.c += change;
  wp.z += shift;
  wp.m += shift;
}

// Applies aggregated shifts to the smaller subtrees between w- and w+.
function executeShifts(v: TreeWrap): void {
  let shift = 0;
  let change = 0;
  const children = v.children!;
  let i = children.length;
  while (--i >= 0) {
    const w = children[i];
    w.z += shift;
    w.m += shift;
    shift += w.s + (change += w.c);
  }
}

// If vi-'s ancestor is a sibling of v, returns vi-'s ancestor; otherwise the
// specified default ancestor.
function nextAncestor(vim: TreeWrap, v: TreeWrap, ancestor: TreeWrap): TreeWrap {
  return vim.a.parent === v.parent ? vim.a : ancestor;
}

export interface TreeLayout<T> {
  /** Assigns x, y on every node. Does not require sum(). */
  (root: HierarchyNode<T>): HierarchyNode<T>;
  separation(): SeparationFunction<T>;
  separation(separation: SeparationFunction<T>): TreeLayout<T>;
  /** Returns the size if sized, or null if nodeSize is in effect (d3 semantics). */
  size(): [number, number] | null;
  size(size: readonly [number, number]): TreeLayout<T>;
  /** Returns the node size if set, or null if size is in effect (d3 semantics). */
  nodeSize(): [number, number] | null;
  nodeSize(size: readonly [number, number]): TreeLayout<T>;
}

/**
 * Tidy tree layout (Buchheim/Reingold–Tilford). Defaults match d3: size
 * [1, 1], separation (a, b) => a.parent === b.parent ? 1 : 2.
 *
 * With size([w, h]): x spans [0, w] (breadth), y = depth mapped to [0, h].
 * With nodeSize([dx, dy]): root at (0, 0), y = depth * dy.
 * For radial trees use size([2 * Math.PI, radius]) and map (x, y) to polar.
 */
export function tree<T = unknown>(): TreeLayout<T> {
  let separation: SeparationFunction<T> = defaultSeparation;
  let dx = 1;
  let dy = 1;
  let nodeSize = false;

  function layout(root: HierarchyNode<T>): HierarchyNode<T> {
    const t = treeRoot(root as HierarchyNode<unknown>);

    // Compute the layout using Buchheim et al.'s algorithm.
    treeWrapEachAfter(t, firstWalk);
    t.parent!.m = -t.z;
    treeWrapEachBefore(t, secondWalk);

    // If a fixed node size is specified, scale x and y.
    if (nodeSize) {
      root.eachBefore(sizeNode);
    } else {
      // If a fixed tree size is specified, scale x and y based on the extent.
      // Compute the left-most, right-most, and depth-most nodes for extents.
      let left = root;
      let right = root;
      let bottom = root;
      root.eachBefore((node) => {
        if (node.x! < left.x!) left = node;
        if (node.x! > right.x!) right = node;
        if (node.depth > bottom.depth) bottom = node;
      });
      const s = left === right ? 1 : separation(left, right) / 2;
      const tx = s - left.x!;
      const kx = dx / (right.x! + s + tx);
      const ky = dy / (bottom.depth || 1);
      root.eachBefore((node) => {
        node.x = (node.x! + tx) * kx;
        node.y = node.depth * ky;
      });
    }

    return root;
  }

  // Computes a preliminary x-coordinate for v (first walk of Buchheim et al.).
  function firstWalk(v: TreeWrap): void {
    const children = v.children;
    const siblings = v.parent!.children!;
    const w = v.i ? siblings[v.i - 1] : null;
    if (children) {
      executeShifts(v);
      const midpoint = (children[0].z + children[children.length - 1].z) / 2;
      if (w) {
        v.z = w.z + separation(v._ as HierarchyNode<T>, w._ as HierarchyNode<T>);
        v.m = v.z - midpoint;
      } else {
        v.z = midpoint;
      }
    } else if (w) {
      v.z = w.z + separation(v._ as HierarchyNode<T>, w._ as HierarchyNode<T>);
    }
    v.parent!.A = apportion(v, w, v.parent!.A || siblings[0]);
  }

  // Computes all real x-coordinates by summing up the modifiers recursively.
  function secondWalk(v: TreeWrap): void {
    v._.x = v.z + v.parent!.m;
    v.m += v.parent!.m;
  }

  // The core of the algorithm: combines a new subtree with the previous
  // subtrees, using threads to traverse the inside/outside contours up to
  // the highest common level.
  function apportion(v: TreeWrap, w: TreeWrap | null, ancestor: TreeWrap): TreeWrap {
    if (w) {
      let vip: TreeWrap | null = v;
      let vop: TreeWrap = v;
      let vim: TreeWrap | null = w;
      let vom: TreeWrap = vip.parent!.children![0];
      let sip = vip.m;
      let sop = vop.m;
      let sim = vim.m;
      let som = vom.m;
      for (;;) {
        vim = nextRight(vim!);
        vip = nextLeft(vip!);
        if (!(vim && vip)) break;
        vom = nextLeft(vom)!;
        vop = nextRight(vop)!;
        vop.a = v;
        const shift =
          vim.z + sim - vip.z - sip + separation(vim._ as HierarchyNode<T>, vip._ as HierarchyNode<T>);
        if (shift > 0) {
          moveSubtree(nextAncestor(vim, v, ancestor), v, shift);
          sip += shift;
          sop += shift;
        }
        sim += vim.m;
        sip += vip.m;
        som += vom.m;
        sop += vop.m;
      }
      if (vim && !nextRight(vop)) {
        vop.t = vim;
        vop.m += sim - sop;
      }
      if (vip && !nextLeft(vom)) {
        vom.t = vip;
        vom.m += sip - som;
        ancestor = v;
      }
    }
    return ancestor;
  }

  function sizeNode(node: HierarchyNode<T>): void {
    node.x! *= dx;
    node.y = node.depth * dy;
  }

  const self = layout as TreeLayout<T>;

  self.separation = function (x?: SeparationFunction<T>) {
    if (x === undefined) return separation as never;
    separation = x;
    return self as never;
  } as TreeLayout<T>["separation"];

  self.size = function (x?: readonly [number, number]) {
    if (x === undefined) return (nodeSize ? null : [dx, dy]) as never;
    nodeSize = false;
    dx = +x[0];
    dy = +x[1];
    return self as never;
  } as TreeLayout<T>["size"];

  self.nodeSize = function (x?: readonly [number, number]) {
    if (x === undefined) return (nodeSize ? [dx, dy] : null) as never;
    nodeSize = true;
    dx = +x[0];
    dy = +x[1];
    return self as never;
  } as TreeLayout<T>["nodeSize"];

  return self;
}

// ---------------------------------------------------------------------------
// cluster() — dendrogram (leaves at equal depth)
// ---------------------------------------------------------------------------

export interface ClusterLayout<T> {
  /** Assigns x, y on every node; all leaves end up at y = h (or depth 0 row under nodeSize). */
  (root: HierarchyNode<T>): HierarchyNode<T>;
  separation(): SeparationFunction<T>;
  separation(separation: SeparationFunction<T>): ClusterLayout<T>;
  size(): [number, number] | null;
  size(size: readonly [number, number]): ClusterLayout<T>;
  nodeSize(): [number, number] | null;
  nodeSize(size: readonly [number, number]): ClusterLayout<T>;
}

function meanX(children: HierarchyNode<unknown>[]): number {
  let x = 0;
  for (const c of children) x += c.x!;
  return x / children.length;
}

function maxY(children: HierarchyNode<unknown>[]): number {
  let y = 0;
  for (const c of children) y = Math.max(y, c.y!);
  return 1 + y;
}

function leafLeft(node: HierarchyNode<unknown>): HierarchyNode<unknown> {
  let children: HierarchyNode<unknown>[] | undefined;
  while ((children = node.children)) node = children[0];
  return node;
}

function leafRight(node: HierarchyNode<unknown>): HierarchyNode<unknown> {
  let children: HierarchyNode<unknown>[] | undefined;
  while ((children = node.children)) node = children[children.length - 1];
  return node;
}

/**
 * Dendrogram layout: like tree(), but all leaves are placed at the same
 * depth (y = h with size([w, h]); root at y = 0). Defaults match d3.
 */
export function cluster<T = unknown>(): ClusterLayout<T> {
  let separation: SeparationFunction<T> = defaultSeparation;
  let dx = 1;
  let dy = 1;
  let nodeSize = false;

  function layout(root: HierarchyNode<T>): HierarchyNode<T> {
    let previousNode: HierarchyNode<T> | undefined;
    let x = 0;

    // First walk, computing the initial x & y values.
    root.eachAfter((node) => {
      const children = node.children;
      if (children) {
        node.x = meanX(children);
        node.y = maxY(children);
      } else {
        node.x = previousNode ? (x += separation(node, previousNode)) : 0;
        node.y = 0;
        previousNode = node;
      }
    });

    const left = leafLeft(root) as HierarchyNode<T>;
    const right = leafRight(root) as HierarchyNode<T>;
    const x0 = left.x! - separation(left, right) / 2;
    const x1 = right.x! + separation(right, left) / 2;

    // Second walk, normalizing x & y to the desired size.
    return root.eachAfter(
      nodeSize
        ? (node) => {
            node.x = (node.x! - root.x!) * dx;
            node.y = (root.y! - node.y!) * dy;
          }
        : (node) => {
            node.x = ((node.x! - x0) / (x1 - x0)) * dx;
            node.y = (1 - (root.y! ? node.y! / root.y! : 1)) * dy;
          },
    );
  }

  const self = layout as ClusterLayout<T>;

  self.separation = function (x?: SeparationFunction<T>) {
    if (x === undefined) return separation as never;
    separation = x;
    return self as never;
  } as ClusterLayout<T>["separation"];

  self.size = function (x?: readonly [number, number]) {
    if (x === undefined) return (nodeSize ? null : [dx, dy]) as never;
    nodeSize = false;
    dx = +x[0];
    dy = +x[1];
    return self as never;
  } as ClusterLayout<T>["size"];

  self.nodeSize = function (x?: readonly [number, number]) {
    if (x === undefined) return (nodeSize ? [dx, dy] : null) as never;
    nodeSize = true;
    dx = +x[0];
    dy = +x[1];
    return self as never;
  } as ClusterLayout<T>["nodeSize"];

  return self;
}
