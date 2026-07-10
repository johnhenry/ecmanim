// Staged reveals for mermaid diagrams (campaign 4, cluster M2). One entry
// point — revealDiagram(diagram) — with a per-diagramType ordering strategy:
//
//   flowchart/state/class/er/git   nodes appear BEFORE the edges that touch
//                                  them ("topological" walk of the friendly
//                                  edge ids; state's `edgeN` ids carry no
//                                  endpoints and fall back to spatial order)
//   sequence                       actors + lifelines first, then the message
//                                  geometry top-to-bottom by world y
//   gantt                          axis/scaffolding first, then task bars
//                                  growing left-to-right in id order
//   pie/quadrant/timeline/journey  staggered FadeIn/GrowFromCenter in spatial
//   /mindmap                       order (mindmap: radial from the center)
//   anything else                  LaggedStart FadeIn over the children
//
// The composition is a single flat LaggedStart: with a uniform per-part
// runTime and 0 <= lagRatio < 1 the children's start times are monotonically
// nondecreasing in list order, so "node before edge" is guaranteed simply by
// list position — and DiagramReveal.startOf(id) exposes the composed start
// times so the ordering property is testable without playing a frame.
//
// Scene cleanup follows matchTex's proven pattern (src/mobject/mathtex.ts):
// the child FadeIn/Create/Grow animations introduce loose wrapper VGroups
// while playing; at finish those wrappers all leave the scene and the
// DiagramMobject itself is introduced, so the scene ends holding exactly
// `diagram` — whether or not the caller added it beforehand.

import { FadeIn, Create, Animation } from "./Animation.ts";
import type { AnimationConfig } from "./Animation.ts";
import { LaggedStart } from "./composition.ts";
import { GrowFromCenter, GrowFromEdge } from "./extra.ts";
import { VGroup } from "../mobject/VMobject.ts";
import type { Mobject } from "../mobject/Mobject.ts";
import * as V from "../core/math/vector.ts";
import type { DiagramMobject } from "../loaders/mermaid_loader.ts";

/** How node ids are ordered by revealDiagram for graph-shaped diagrams. */
export type RevealOrder = "topological" | "source" | "spatial";

export interface DiagramRevealConfig extends AnimationConfig {
  /** Node ordering for flowchart/state/class/er/git. Default "topological". */
  order?: RevealOrder;
  /** Total run time of the composed reveal (children compress into it). */
  runTime?: number;
  /** Stagger between consecutive parts (AnimationGroup lagRatio). Default 0.3. */
  lagRatio?: number;
  /** Factory for node-part animations (default: FadeIn; gantt: GrowFromEdge
   *  LEFT; pie/mindmap: GrowFromCenter). */
  nodeAnimation?: (part: Mobject, id: string) => Animation;
  /** Factory for edge-part animations (default: Create — draws the connector). */
  edgeAnimation?: (part: Mobject, id: string) => Animation;
}

// ---------------------------------------------------------------------------
// Friendly-edge-id endpoint parsing.
// ---------------------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Parse the source/target node ids out of a friendly edge id, given the
 *  diagram's node ids. Handles flowchart `L_A_B_0`, class `id_Animal_Dog_1`,
 *  the bare `A_B` aliases, and er's raw `id_entity-USER-0_entity-ORDER-1_0`.
 *  Returns null when the id encodes no endpoints (state's `edgeN`). Ambiguity
 *  (node names containing underscores) resolves to the longest matching pair. */
export function parseEdgeEndpoints(
  edgeId: string,
  nodeIds: readonly string[],
): { source: string; target: string } | null {
  // er edges embed the raw entity ids: entity-<NAME>-<n>_entity-<NAME>-<n>.
  const er = /entity-(.+?)-\d+_entity-(.+?)-\d+/.exec(edgeId);
  if (er && nodeIds.includes(er[1]) && nodeIds.includes(er[2])) {
    return { source: er[1], target: er[2] };
  }
  let best: { source: string; target: string; len: number } | null = null;
  for (const a of nodeIds) {
    for (const b of nodeIds) {
      const re = new RegExp(`(?:^|_)${escapeRe(a)}_${escapeRe(b)}(?:_|$)`);
      if (!re.test(edgeId)) continue;
      const len = a.length + b.length;
      if (!best || len > best.len) best = { source: a, target: b, len };
    }
  }
  return best ? { source: best.source, target: best.target } : null;
}

// ---------------------------------------------------------------------------
// Ordering helpers.
// ---------------------------------------------------------------------------

const rr = (n: number) => Math.round(n * 100) / 100; // spatial tie tolerance

// Top-to-bottom (world y descending), then left-to-right.
function spatialCompare(a: Mobject, b: Mobject): number {
  const ca = a.getCenter(), cb = b.getCenter();
  const dy = rr(cb[1]) - rr(ca[1]);
  if (dy !== 0) return dy;
  return rr(ca[0]) - rr(cb[0]);
}

// Kahn's algorithm over parsed edges; ties (and cycles) break by source order.
function topologicalOrder(
  nodeIds: string[],
  edges: Array<{ source: string; target: string }>,
): string[] {
  const inDeg = new Map<string, number>(nodeIds.map((n) => [n, 0]));
  for (const { source, target } of edges) {
    if (source === target) continue; // self-loop adds no ordering constraint
    if (inDeg.has(target) && inDeg.has(source)) inDeg.set(target, (inDeg.get(target) ?? 0) + 1);
  }
  const order: string[] = [];
  const remaining = new Set(nodeIds);
  while (remaining.size) {
    // First remaining node (source order) with in-degree 0 — or, when the
    // graph is cyclic and none exists, the first remaining node outright.
    let pick: string | null = null;
    for (const n of nodeIds) {
      if (remaining.has(n) && (inDeg.get(n) ?? 0) === 0) { pick = n; break; }
    }
    if (pick == null) for (const n of nodeIds) { if (remaining.has(n)) { pick = n; break; } }
    order.push(pick!);
    remaining.delete(pick!);
    for (const { source, target } of edges) {
      if (source === pick && remaining.has(target)) {
        inDeg.set(target, Math.max(0, (inDeg.get(target) ?? 0) - 1));
      }
    }
  }
  return order;
}

// ---------------------------------------------------------------------------
// Part collection: friendly-id parts + the un-id'd remainder.
// ---------------------------------------------------------------------------

interface Part {
  id: string; // friendly id, or a synthetic "__rest__"/"msgN"/"partN" name
  group: Mobject; // VGroup wrapper (or bare leaf) — same instances as diagram's
}

// SVGMobject is FLAT: every drawable is a direct submobject of the diagram,
// and ids map to lists of those leaves. The remainder is whatever leaf no
// friendly node/edge id claims (backgrounds, grids, connector labels...).
function collectParts(diagram: DiagramMobject): {
  nodes: Part[];
  edges: Part[];
  restLeaves: Mobject[];
} {
  const covered = new Set<Mobject>();
  const wrap = (id: string): Part => {
    const group = diagram.byId(id);
    for (const leaf of group.submobjects) covered.add(leaf);
    return { id, group };
  };
  const nodes = diagram.nodeIds().map(wrap);
  const edges = diagram.edgeIds().map(wrap);
  const restLeaves = diagram.submobjects.filter((m) => !covered.has(m));
  return { nodes, edges, restLeaves };
}

// ---------------------------------------------------------------------------
// The composed animation.
// ---------------------------------------------------------------------------

/** A staged diagram reveal. A flat LaggedStart whose children are tagged with
 *  the part ids they animate; `startOf(id)` exposes each part's composed start
 *  time (seconds on the unscaled child timeline) for ordering assertions. */
export class DiagramReveal extends LaggedStart {
  /** The diagram this reveal introduces (Scene.play adds it at finish). */
  readonly introduced: DiagramMobject;
  /** Part ids in reveal (start-time) order. Synthetic ids name the un-id'd
   *  remainder: "__rest__" (scaffolding/leftovers), "msgN" (sequence
   *  messages), "partN" (fallback spatial units). */
  readonly revealOrder: string[];

  constructor(diagram: DiagramMobject, animations: Animation[], config: AnimationConfig = {}) {
    super(animations, { lagRatio: config.lagRatio ?? 0.3, ...config });
    this.introduced = diagram;
    this.revealOrder = this.animations.map((a: any) => String(a._partId ?? ""));
  }

  /** Composed start time (seconds, unscaled child timeline) of a part's
   *  animation. Comparable across parts: with a group runTime the whole
   *  timeline rescales uniformly, so ordering is preserved. */
  startOf(id: string): number {
    const t = this.timings.find(({ anim }) => (anim as any)._partId === id);
    if (!t) {
      throw new Error(`DiagramReveal.startOf: no part "${id}". Parts: ${this.revealOrder.join(", ")}`);
    }
    return t.start;
  }

  /** matchTex's cleanup contract: every loose wrapper the child animations
   *  introduced while playing leaves the scene at finish; the DiagramMobject
   *  itself (`this.introduced`) is added instead, so the scene ends holding
   *  exactly the diagram. */
  override getMobjectsToRemove(): Mobject[] {
    return [...this.getMobjectsToIntroduce(), ...super.getMobjectsToRemove()];
  }
}

function tag(anim: Animation, id: string): Animation {
  (anim as any)._partId = id;
  return anim;
}

/** Reveal a mermaid diagram with a per-diagram-type staging strategy. Play it
 *  through Scene.play; afterwards the scene contains `diagram` itself. */
export function revealDiagram(diagram: DiagramMobject, config: DiagramRevealConfig = {}): DiagramReveal {
  const { order = "topological", nodeAnimation, edgeAnimation, ...animConfig } = config;
  const { nodes, edges, restLeaves } = collectParts(diagram);

  const childConfig: AnimationConfig = {};
  const fadeIn = (m: Mobject, id: string) => tag(new FadeIn(m, childConfig), id);
  const nodeAnim = (part: Part) =>
    tag(nodeAnimation ? nodeAnimation(part.group, part.id) : defaultNodeAnim(diagram, part), part.id);
  const edgeAnim = (part: Part) =>
    tag(edgeAnimation ? edgeAnimation(part.group, part.id) : new Create(part.group, childConfig), part.id);

  function defaultNodeAnim(d: DiagramMobject, part: Part): Animation {
    switch (d.diagramType) {
      case "gantt":
        return new GrowFromEdge(part.group, V.LEFT, childConfig);
      case "pie":
      case "mindmap":
        return new GrowFromCenter(part.group, childConfig);
      default:
        return new FadeIn(part.group, childConfig);
    }
  }

  const anims: Animation[] = [];

  switch (diagram.diagramType) {
    case "flowchart":
    case "state":
    case "class":
    case "er":
    case "git": {
      if (nodes.length === 0 && edges.length === 0) {
        // git (and any render without per-element ids) has nothing addressable:
        // degrade to the spatial fallback (per-type default / user factory).
        anims.push(...fallbackAnims(diagram, restLeaves, nodeAnim));
        break;
      }
      const nodeIdList = nodes.map((n) => n.id);
      // Parse each edge's endpoints from its friendly id; state's `edgeN` ids
      // (and anything else unparseable) get spatial ordering after all nodes.
      const parsed = new Map<string, { source: string; target: string }>();
      const unparsed: Part[] = [];
      for (const e of edges) {
        const ends = parseEdgeEndpoints(e.id, nodeIdList);
        if (ends) parsed.set(e.id, ends);
        else unparsed.push(e);
      }
      let nodeOrder: string[];
      if (order === "source") nodeOrder = nodeIdList;
      else if (order === "spatial") {
        nodeOrder = [...nodes].sort((a, b) => spatialCompare(a.group, b.group)).map((n) => n.id);
      } else {
        nodeOrder = topologicalOrder(nodeIdList, [...parsed.values()]);
      }
      // Emit each node, then every not-yet-emitted edge whose endpoints are
      // BOTH revealed (cycles resolve because the walk covers all nodes).
      const partById = new Map(nodes.map((n) => [n.id, n] as const));
      const revealed = new Set<string>();
      const emitted = new Set<string>();
      for (const nid of nodeOrder) {
        revealed.add(nid);
        anims.push(nodeAnim(partById.get(nid)!));
        for (const e of edges) {
          if (emitted.has(e.id)) continue;
          const ends = parsed.get(e.id);
          if (ends && revealed.has(ends.source) && revealed.has(ends.target)) {
            emitted.add(e.id);
            anims.push(edgeAnim(e));
          }
        }
      }
      for (const e of [...unparsed].sort((a, b) => spatialCompare(a.group, b.group))) {
        anims.push(edgeAnim(e));
      }
      // Un-id'd remainder (edge labels, cluster boxes...) fades in last.
      if (restLeaves.length) anims.push(fadeIn(new VGroup(...restLeaves), "__rest__"));
      break;
    }

    case "sequence": {
      // Actors + lifelines first (a friendly actor id maps both the
      // participant group and its `actorN` lifeline), source order...
      for (const n of nodes) anims.push(nodeAnim(n));
      // ...then the message geometry — mermaid gives messages no ids, so the
      // remaining leaves play top-to-bottom (world y descending).
      const messages = [...restLeaves].sort(spatialCompare);
      messages.forEach((leaf, i) => anims.push(fadeIn(leaf, `msg${i}`)));
      break;
    }

    case "gantt": {
      // Axis/grid/section scaffolding first, then bars grow left-to-right in
      // id order (a1, task1, ...).
      if (restLeaves.length) anims.push(fadeIn(new VGroup(...restLeaves), "__rest__"));
      for (const n of nodes) anims.push(nodeAnim(n));
      break;
    }

    case "pie":
    case "quadrant":
    case "timeline":
    case "journey":
    case "mindmap": {
      // Stagger over the id'd parts (nodes then edges — mindmap has edge_I_J
      // connectors) plus the un-id'd remainder, in spatial order. Mindmap
      // orders radially from the diagram center instead. Synthetic (un-id'd)
      // parts get the SAME per-type default (pie/mindmap: GrowFromCenter) and
      // honor a user nodeAnimation factory — pie and quadrant emit no
      // per-element ids at all, so a hardwired FadeIn here used to make the
      // documented GrowFromCenter default unreachable.
      const units: Part[] = [...nodes, ...edges];
      restLeaves.forEach((leaf, i) => units.push({ id: `part${i}`, group: leaf }));
      if (diagram.diagramType === "mindmap") {
        const center = diagram.getCenter();
        units.sort((a, b) =>
          V.distance(a.group.getCenter(), center) - V.distance(b.group.getCenter(), center));
      } else {
        units.sort((a, b) => spatialCompare(a.group, b.group));
      }
      for (const u of units) anims.push(nodeAnim(u));
      break;
    }

    default:
      anims.push(...fallbackAnims(diagram, restLeaves, nodeAnim));
      break;
  }

  if (anims.length === 0) {
    // Nothing addressable at all: a bare FadeIn of the whole diagram.
    anims.push(fadeIn(new VGroup(...diagram.submobjects), "__rest__"));
  }

  return new DiagramReveal(diagram, anims, animConfig);
}

// Unknown/id-less diagrams: staggered reveal over the top-level children in
// spatial (top-to-bottom, left-to-right) order, using the per-type default
// node animation (or the user's nodeAnimation factory).
function fallbackAnims(
  diagram: DiagramMobject,
  restLeaves: Mobject[],
  nodeAnim: (part: { id: string; group: Mobject }) => Animation,
): Animation[] {
  const leaves = restLeaves.length ? restLeaves : diagram.submobjects;
  return [...leaves].sort(spatialCompare).map((leaf, i) => nodeAnim({ id: `part${i}`, group: leaf }));
}

export default revealDiagram;
