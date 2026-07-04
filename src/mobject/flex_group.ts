// Opt-in Flexbox layout via Yoga (Meta/React's portable WASM Flexbox engine,
// also what Vercel's Satori uses) -- a concretely low-risk way to get real
// flexbox semantics instead of building a layout engine from scratch.
//
// Fully additive: a Mobject outside a FlexGroup is completely unaffected; a
// child inside one can still opt out of stretch/grow by pinning its own
// dimensions (Yoga only overrides what it's told to control).
//
// ASYNC INIT is the one sharp edge here: layout() must load Yoga's WASM
// before it can compute anything, mirroring the lazy-loader pattern already
// used by src/wasm.ts. Nothing is computed until `await group.layout()`.

import { Group } from "./Mobject.ts";
import type { Mobject } from "./Mobject.ts";

export type FlexDirection = "row" | "column" | "row-reverse" | "column-reverse";
export type JustifyContent =
  | "flex-start" | "center" | "flex-end"
  | "space-between" | "space-around" | "space-evenly";
export type AlignItems = "flex-start" | "center" | "flex-end" | "stretch" | "baseline";

export interface FlexGroupConfig {
  direction?: FlexDirection;
  justifyContent?: JustifyContent;
  alignItems?: AlignItems;
  gap?: number;
  /** Container size. Defaults to the group's own current bounding box
   *  (its children's pre-layout extent) when omitted. */
  width?: number;
  height?: number;
}

export interface FlexChildConfig {
  flexGrow?: number;
  flexShrink?: number;
  /** Overrides the child's own current getWidth() as its flex-basis. */
  flexBasis?: number;
  margin?: number;
}

const DIRECTION_KEY: Record<FlexDirection, string> = {
  row: "FLEX_DIRECTION_ROW",
  "row-reverse": "FLEX_DIRECTION_ROW_REVERSE",
  column: "FLEX_DIRECTION_COLUMN",
  "column-reverse": "FLEX_DIRECTION_COLUMN_REVERSE",
};
const JUSTIFY_KEY: Record<JustifyContent, string> = {
  "flex-start": "JUSTIFY_FLEX_START",
  center: "JUSTIFY_CENTER",
  "flex-end": "JUSTIFY_FLEX_END",
  "space-between": "JUSTIFY_SPACE_BETWEEN",
  "space-around": "JUSTIFY_SPACE_AROUND",
  "space-evenly": "JUSTIFY_SPACE_EVENLY",
};
const ALIGN_KEY: Record<AlignItems, string> = {
  "flex-start": "ALIGN_FLEX_START",
  center: "ALIGN_CENTER",
  "flex-end": "ALIGN_FLEX_END",
  stretch: "ALIGN_STRETCH",
  baseline: "ALIGN_BASELINE",
};

let _yoga: any = null;

/** True once Yoga's WASM has been loaded (via a prior layout() call). */
export function isYogaLoaded(): boolean {
  return _yoga != null;
}

async function loadYogaOnce(): Promise<any> {
  if (_yoga) return _yoga;
  // yoga-layout resolves its own WASM at import time (top-level await inside
  // the package) -- an optionalDependency, mirroring @napi-rs/canvas/three's
  // graceful-degrade pattern elsewhere in this codebase.
  const mod = await import("yoga-layout");
  _yoga = mod.default;
  return _yoga;
}

export class FlexGroup extends Group {
  flexConfig: FlexGroupConfig;
  private _childConfig = new WeakMap<Mobject, FlexChildConfig>();

  constructor(config: FlexGroupConfig = {}) {
    super();
    this.flexConfig = config;
  }

  /** Per-child flex config (flexGrow/flexShrink/flexBasis/margin). A child
   *  with no config here just uses its own current size as a fixed basis. */
  setChildFlex(child: Mobject, config: FlexChildConfig): this {
    this._childConfig.set(child, config);
    return this;
  }

  /**
   * Compute the flex layout and reposition every direct child accordingly.
   * Necessarily async -- Yoga's WASM must be loaded first. Safe to call
   * repeatedly (e.g. after adding/removing children or resizing the
   * container); each call builds a fresh Yoga node tree.
   */
  async layout(): Promise<this> {
    const Yoga = await loadYogaOnce();
    const children = this.submobjects;

    const width = this.flexConfig.width ?? this.getWidth();
    const height = this.flexConfig.height ?? this.getHeight();
    // The group's own world-space top-left corner (world Y-up; Yoga's own
    // coordinate system is Y-down from a top-left origin), computed BEFORE
    // any repositioning below.
    const center = this.getCenter();
    const originX = center[0] - width / 2;
    const originY = center[1] + height / 2;

    const root = Yoga.Node.create();
    root.setWidth(width);
    root.setHeight(height);
    root.setFlexDirection(Yoga[DIRECTION_KEY[this.flexConfig.direction ?? "row"]]);
    if (this.flexConfig.justifyContent) root.setJustifyContent(Yoga[JUSTIFY_KEY[this.flexConfig.justifyContent]]);
    if (this.flexConfig.alignItems) root.setAlignItems(Yoga[ALIGN_KEY[this.flexConfig.alignItems]]);
    if (this.flexConfig.gap != null) root.setGap(Yoga.GUTTER_ALL, this.flexConfig.gap);

    const nodes = children.map((child) => {
      const node = Yoga.Node.create();
      const cfg = this._childConfig.get(child) ?? {};
      node.setWidth(cfg.flexBasis ?? child.getWidth());
      node.setHeight(child.getHeight());
      if (cfg.flexGrow != null) node.setFlexGrow(cfg.flexGrow);
      if (cfg.flexShrink != null) node.setFlexShrink(cfg.flexShrink);
      if (cfg.margin != null) node.setMargin(Yoga.EDGE_ALL, cfg.margin);
      return node;
    });
    nodes.forEach((node, i) => root.insertChild(node, i));

    root.calculateLayout(width, height, Yoga.DIRECTION_LTR);

    for (let i = 0; i < children.length; i++) {
      const node = nodes[i];
      const left = node.getComputedLeft();
      const top = node.getComputedTop();
      const w = node.getComputedWidth();
      const h = node.getComputedHeight();
      const child = children[i];
      const z = child.getCenter()[2];
      // Yoga's (left, top) is the child's top-left corner, Y-down from the
      // container's own top-left -- convert to a world-space (Y-up) center.
      const worldX = originX + left + w / 2;
      const worldY = originY - (top + h / 2);
      child.moveTo([worldX, worldY, z]);
    }

    root.freeRecursive();
    return this;
  }
}
