// Diagram diff (campaign 4, cluster M3 — "your diagram, evolving"): morph one
// rendered mermaid diagram into another. Elements are matched by FRIENDLY id
// (the stable cross-render key — the raw SVG ids carry per-render `mmdN`
// prefixes, so they never match between two loadMermaid calls):
//
//   shared friendly id in both     Transform old part -> new part (in place)
//   only in the old diagram        FadeOut
//   only in the new diagram        FadeIn
//   un-id'd remainder (grids,      crossfade (simultaneous FadeOut old rest /
//   backgrounds, loose labels)     FadeIn new rest)
//
// MATCHING APPROACH — buildMatchingFromKeyed (transform_matching.ts) fed
// friendly-id-keyed part VGroups directly, NOT TransformMatchingAuto with
// seeded matchIds. Rationale: SVGMobject (hence DiagramMobject) is FLAT — its
// submobjects are the individual drawable leaves, so piecesOf(diagram) yields
// hundreds of anonymous VMobjects, and TransformMatchingAuto's autoKey
// (matchId -> text -> shape signature) would compare leaf-by-leaf with no way
// to see the friendly-id grouping (seeding matchId on byId(...) wrapper
// VGroups doesn't help: those wrappers aren't in the diagram's tree, so
// piecesOf never visits them). Keying byId() wrappers through
// buildMatchingFromKeyed gives exactly the same Transform/FadeOut/FadeIn
// composition TransformMatchingAuto would build, minus the key-derivation
// layer we'd be fighting.
//
// Scene cleanup follows matchTex's proven introduced/getMobjectsToRemove
// override (src/mobject/mathtex.ts): at finish, the old diagram AND every
// loose wrapper the child animations introduced leave the scene, and
// `newDiagram` itself is added — its matched parts coincide with the
// transformed old geometry at alpha 1, so the swap is invisible and the scene
// ends holding exactly `newDiagram`.

import type { AnimationConfig } from "./Animation.ts";
import { FadeIn, FadeOut, Animation } from "./Animation.ts";
import { AnimationGroup } from "./composition.ts";
import { buildMatchingFromKeyed } from "./transform_matching.ts";
import type { Mobject } from "../mobject/Mobject.ts";
import { VGroup } from "../mobject/VMobject.ts";
import type { DiagramMobject } from "../loaders/mermaid_loader.ts";

export interface DiagramDiffConfig extends AnimationConfig {
  /** Total run time (children run simultaneously within it). */
  runTime?: number;
  /** Force-match a source friendly id to a differently-named target id
   *  (e.g. a renamed node: { OldName: "NewName" }). */
  keyMap?: Record<string, string>;
}

// The canonical friendly ids of a diagram (nodeIds + edgeIds — NOT every
// alias in friendlyIds, which would pair the same geometry twice via e.g.
// both "L_A_B_0" and its "A_B" alias), each with its part VGroup and the
// leaves that part claims.
function keyedParts(diagram: DiagramMobject): {
  keyed: Array<[string, VGroup]>;
  restLeaves: Mobject[];
} {
  const keyed: Array<[string, VGroup]> = [];
  const covered = new Set<Mobject>();
  for (const id of [...diagram.nodeIds(), ...diagram.edgeIds()]) {
    const group = diagram.byId(id);
    for (const leaf of group.submobjects) covered.add(leaf);
    keyed.push([id, group]);
  }
  // SVGMobject is flat: submobjects are the drawable leaves themselves.
  const restLeaves = diagram.submobjects.filter((m) => !covered.has(m));
  return { keyed, restLeaves };
}

/** The composed diff animation, with the id partition exposed for
 *  introspection/tests. */
export class DiagramDiff extends AnimationGroup {
  /** newDiagram — Scene.play adds it to the scene at finish. */
  readonly introduced: DiagramMobject;
  /** Friendly ids present in both diagrams (Transform-morphed in place). */
  readonly matchedIds: string[];
  /** Friendly ids only in newDiagram (FadeIn). */
  readonly addedIds: string[];
  /** Friendly ids only in oldDiagram (FadeOut). */
  readonly removedIds: string[];
  private readonly _oldDiagram: DiagramMobject;

  constructor(
    oldDiagram: DiagramMobject,
    newDiagram: DiagramMobject,
    animations: Animation[],
    partition: { matched: string[]; added: string[]; removed: string[] },
    config: AnimationConfig = {},
  ) {
    super(animations, config);
    this.introduced = newDiagram;
    this._oldDiagram = oldDiagram;
    this.matchedIds = partition.matched;
    this.addedIds = partition.added;
    this.removedIds = partition.removed;
  }

  /** matchTex's cleanup contract: the old diagram, the loose FadeIn wrappers
   *  introduced during the play, and everything the children flagged for
   *  removal all leave the scene at finish; `this.introduced` (newDiagram)
   *  replaces them. */
  override getMobjectsToRemove(): Mobject[] {
    return [...this.getMobjectsToIntroduce(), ...super.getMobjectsToRemove(), this._oldDiagram];
  }
}

/** Morph `oldDiagram` into `newDiagram`, matching parts by friendly id.
 *  Typical use: `scene.add(oldDiagram); await scene.play(diffDiagrams(
 *  oldDiagram, newDiagram));` — afterwards the scene shows newDiagram. */
export function diffDiagrams(
  oldDiagram: DiagramMobject,
  newDiagram: DiagramMobject,
  config: DiagramDiffConfig = {},
): DiagramDiff {
  const old = keyedParts(oldDiagram);
  const next = keyedParts(newDiagram);

  // The Transform / FadeOut / FadeIn core, exactly as TransformMatchingTex
  // builds it — but keyed on friendly ids instead of tex strings.
  const anims: Animation[] = buildMatchingFromKeyed(old.keyed, next.keyed, config);

  // Un-id'd remainder: geometry bound to nothing addressable. Crossfade.
  if (old.restLeaves.length) anims.push(new FadeOut(new VGroup(...old.restLeaves), config));
  if (next.restLeaves.length) anims.push(new FadeIn(new VGroup(...next.restLeaves), config));

  // Partition bookkeeping (mirrors buildMatchingFromKeyed's pairing rule:
  // FIFO buckets per key, keyMap applied to source keys).
  const keyMap = config.keyMap ?? {};
  const targetCounts = new Map<string, number>();
  for (const [k] of next.keyed) targetCounts.set(k, (targetCounts.get(k) ?? 0) + 1);
  const matched: string[] = [];
  const removed: string[] = [];
  for (const [rawKey] of old.keyed) {
    const key = keyMap[rawKey] ?? rawKey;
    const n = targetCounts.get(key) ?? 0;
    if (n > 0) {
      targetCounts.set(key, n - 1);
      matched.push(rawKey);
    } else {
      removed.push(rawKey);
    }
  }
  const added = [...targetCounts.entries()].filter(([, n]) => n > 0).map(([k]) => k);

  return new DiagramDiff(oldDiagram, newDiagram, anims, { matched, added, removed }, config);
}

export default diffDiagrams;
