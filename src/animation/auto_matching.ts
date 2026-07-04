// Automatic shared-element matching (auto-Transform), à la Reveal.js Auto-Animate
// / Motion `layoutId`: author two independent states, and the engine pairs their
// pieces by IDENTITY (a user `matchId` → text → shape), Transforms each matched
// pair (tweening the position/size/color delta), and fades the unmatched. Unlike
// TransformMatchingShapes it keys on identity, NOT position — so an element that
// MOVED between states still matches and animates to its new place.
//
//   circle.matchId = "hero"; square.matchId = "hero";
//   await scene.play(new TransformMatchingAuto(stateA, stateB));

import { AnimationGroup } from "./composition.ts";
import { buildMatchingFromKeyed, piecesOf } from "./transform_matching.ts";
import type { AnimationConfig } from "./Animation.ts";

const r = (n: number) => Math.round(n * 1000) / 1000;

// Identity key (position-independent): explicit matchId, else text, else a shape
// signature (type + point-count + rounded size). Two pieces with the same key are
// "the same element" and get Transform-paired.
function autoKey(piece: any): string {
  const id = piece?.matchId ?? piece?.autoId;
  if (id != null) return "id:" + String(id);
  if (typeof piece?.text === "string" && piece.text.length) return "text:" + piece.text;
  const type = piece?.constructor?.name ?? "Mobject";
  const fam = piece?.getFamily ? piece.getFamily() : [piece];
  let n = 0;
  for (const m of fam) n += m?.points?.length ?? 0;
  let w = 0, h = 0;
  try { w = r(piece.getWidth()); h = r(piece.getHeight()); } catch { /* empty */ }
  return `shape:${type}:${n}:${w}:${h}`;
}

export interface AutoMatchingConfig extends AnimationConfig {
  transformMismatches?: boolean;
  fadeTransformMismatches?: boolean;
  keyMap?: Record<string, string>;
}

export class TransformMatchingAuto extends AnimationGroup {
  constructor(mobject: any, target: any, config: AutoMatchingConfig = {}) {
    const src = piecesOf(mobject).map((p) => [autoKey(p), p] as [string, any]);
    const tgt = piecesOf(target).map((p) => [autoKey(p), p] as [string, any]);
    super(buildMatchingFromKeyed(src, tgt, config), config);
    // NOTE: setting `this.introducer`/`this.remover` here would be dead code --
    // AnimationGroup.getMobjectsToIntroduce()/getMobjectsToRemove() are
    // overridden to flatMap each child's own introduce/remove list and never
    // consult the group's own flags. The individual matched/unmatched child
    // animations (Transform/FadeIn/FadeOut) already carry the correct
    // introducer/remover flags themselves.
  }
}

/** The pairing an auto-match would produce (source key → matched? ), for tests/introspection. */
export function autoMatchKeys(mobject: any): string[] {
  return piecesOf(mobject).map(autoKey);
}
