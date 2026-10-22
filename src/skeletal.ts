// `@johnhenry/ecmanim/skeletal`: skeletal animation (epic #61). Kept out of the
// root barrel so the root export surface / bundle stays stable; it can be
// re-exported from "." later without a break.

export { SkeletonModel, ROOT_JOINT, lerpPose, wrapAngle } from "./mobject/skeleton_model.ts";
export type { BoneSpec, BonePose, Pose, PartialPose, Placement } from "./mobject/skeleton_model.ts";
export { Skeleton } from "./mobject/skeleton.ts";
export type { SkeletonConfig, HeadSpec, FillSpec } from "./mobject/skeleton.ts";
export { PoseTween, PoseLibrary, poseTrack } from "./animation/pose.ts";
export type { PoseTarget, PoseTweenConfig, PoseTweenIK } from "./animation/pose.ts";
export { solveTwoBone, solveFABRIK, IKChain, ikTarget, ikTargetXY } from "./mobject/ik.ts";
export type {
  Vec2 as IKVec2, BendSide, TwoBoneResult, TwoBoneOptions, FabrikOptions, FabrikResult,
  IKTargetSource, IKTargetFn, IKChainConfig, IKSolveResult, IKSolver,
} from "./mobject/ik.ts";
export { breakdown, blendToNeighbor, relax, push, applyPoseOp, insertBreakdown } from "./animation/pose_ops.ts";
export type { PoseOpSpec } from "./animation/pose_ops.ts";
export { Clip } from "./mobject/clip.ts";
export type { ClipConfig, ClipMode, ClipContent, ClipBuilder } from "./mobject/clip.ts";
export { loadStickNodes, parseStickNodes, StickNodesParseError } from "./loaders/sticknodes_loader.ts";
export type {
  StickNodesConfig, StickNodesResult, StickNodesMeta, StickNodesFigure, StickNode, StickNodeType,
  StickNodeConnector, StickNodesPolyfill, StickNodesColor,
} from "./loaders/sticknodes_loader.ts";
