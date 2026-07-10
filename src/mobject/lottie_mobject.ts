// LottieMobject — the deterministic Lottie player (campaign 5, cluster L1).
// `loadLottie(jsonOrObject)` builds a Group whose `setFrame(f)` / `setTime(t)`
// are PURE functions of the animation JSON: the same frame always produces
// the same world geometry, in any call order (scrub-safe, render-cache-safe).
// `attachTo(scene)` adds a dt-driven clock updater (FourierPath's pattern).
//
// Feature support (v1 — sized to the committed corpus census; every
// approximation is listed here):
// - Layer types: shape (ty 4) FULL; solid (1) FULL (colored rect sw×sh);
//   null (3) FULL (transform-only); precomp (0) with nested comps, layer
//   ip/op gating, st startTime, sr stretch and BASIC time remap `tm`
//   (remap curve → inner frame; expressions ignored); text (5) BEST-EFFORT
//   (t.d.k[0].s fields used: `t` string, `s` font size, `fc` fill color,
//   `j` justification — rendered via the Text mobject, so glyph metrics
//   differ from AE); image (2) SKIPPED with a warning (assets are external).
// - Shape items: group (gr) with transform (tr) composed down; path (sh);
//   rect (rc, rounded); ellipse (el); polystar (sr, star + polygon; the
//   roundness handles follow lottie-web's construction); fill (fl); stroke
//   (st) with width/cap/join; gradient fill (gf) — LINEAR maps to ecmanim's
//   gradientColors + sheenDirection (a linear gradient over the bbox along
//   the s→e direction; stop OFFSETS are approximated as evenly spaced by the
//   renderer), RADIAL is approximated as a flat mid-stop fill; gradient
//   stroke (gs) approximated as a solid mid-stop stroke; trim paths (tm)
//   mapped to strokeStart/strokeEnd (STROKE ONLY — fills of trimmed paths
//   stay whole; wrapped windows clamp at the seam; m:1 "simultaneously"
//   applies the window per shape, m:2 "individually" distributes it across
//   the concatenated arc length); repeater (rp) with per-copy accumulated
//   transform and start/end opacity; merge paths (mm) and rounded corners
//   (rd) SKIPPED with warnings. Fill rule r:1 (nonzero) renders as evenodd
//   (the canvas backend's fixed fill rule) — a documented divergence.
// - Style scoping: fills/strokes apply to the raw paths of their OWN group
//   (first style of each kind wins per path); modifiers (tm/rp) apply to all
//   leaves built before them in the group, including nested-group leaves.
//   This matches After Effects exporter output (paths first, then styles,
//   then modifiers, then tr).
// - Transforms: anchor/position (incl. split x/y)/scale/rotation/skew/
//   opacity, all animatable; layer `parent` chains composed per frame
//   (world-space model — matrices are baked into the points every frame).
//   Layer + group opacity multiply down into leaf fill/stroke opacities.
// - Masks (masksProperties): additive ('a') masks are UNIONED as subpaths of
//   one destination-in shape inside a CompositeGroup; subtract ('s') becomes
//   destination-out; intersect ('i') gets its own destination-in pass (exact);
//   inverted additive masks approximate as destination-out (warned); other
//   modes fall back to additive with a warning. Mask expansion (x) ignored.
// - Track mattes (tt): 1 (alpha) → the matte layer (the one above, td:1)
//   wrapped as a destination-in sibling in a CompositeGroup; 2 (inverted) →
//   destination-out; luma 3/4 treated as alpha (warned approximation).
// - Coordinates: Lottie pixel space (y-down, origin top-left) → world units
//   (y-up, centered), fit to ~10 world units wide by default (config width/
//   height override). Stroke widths convert via the same scale (ecmanim
//   stroke units ≈ px at 1080p with the default 8-unit-tall frame).
// - OUT (documented): expressions, effects, camera/audio layers, image
//   assets, merge paths, luma-exact mattes, precomp edge clipping, per-
//   character text animators.
//
// Unsupported features never throw: they are skipped and recorded on
// `warnings: string[]` (deduplicated).

import { Group, CompositeGroup } from "./Mobject.ts";
import type { Mobject } from "./Mobject.ts";
import { VMobject } from "./VMobject.ts";
import { Text } from "./text/Text.ts";
import { Color } from "../core/color.ts";
import {
  parseLottie,
  evalScalar,
  evalVector,
  evalTransform,
  evalShapePath,
  normalizeColor,
  parseGradientStops,
  rectPath,
  ellipsePath,
  polystarPath,
  trimWindow,
  matMul,
  matApply,
  matScaleFactor,
  buildTransformMatrix,
} from "../loaders/lottie_loader.ts";
import type {
  LottieAnimation,
  LottiePath,
  Mat2D,
} from "../loaders/lottie_loader.ts";

// ecmanim stroke widths are "px at 1080p"; the default frame is 8 world units
// tall → 135 px per world unit.
const STROKE_PX_PER_WORLD_UNIT = 1080 / 8;

export interface LottieConfig {
  /** Target world width for the composition (default: fit 10 units wide). */
  width?: number;
  /** Target world height (with `width`, the tighter fit wins). */
  height?: number;
  /** Playback speed multiplier for attachTo (default 1). */
  speed?: number;
  /** Loop playback in attachTo (default true). */
  loop?: boolean;
}

/** Load a Lottie animation (object or JSON string) into a LottieMobject.
 *  Pure of I/O — read the file yourself and pass the contents. */
export function loadLottie(
  json: string | object,
  config: LottieConfig = {},
): LottieMobject {
  return new LottieMobject(parseLottie(json), config);
}

// ---------------------------------------------------------------------------
// Internal structures
// ---------------------------------------------------------------------------

interface MaskSlot {
  /** Stable VMobject carrying the mask geometry (rebuilt per frame). */
  mob: VMobject;
  /** The masksProperties entries unioned into this slot. */
  defs: any[];
}

interface LayerInst {
  def: any;
  /** Stable group whose children are rebuilt every frame (for precomps it
   *  instead permanently holds the child comp's containers). */
  content: Group;
  /** The outermost stable mobject mounted in the comp container (content,
   *  or CompositeGroup wrappers for masks/mattes). */
  outer: Mobject;
  maskSlots?: MaskSlot[];
  child?: CompInst;
  /** Consumed as a track matte by the layer below (not mounted standalone). */
  isMatteSource?: boolean;
}

interface CompInst {
  insts: LayerInst[]; // JSON order (index 0 = topmost)
  byInd: Map<number, LayerInst>;
  container: Group;
}

/** A shape leaf mid-assembly, in the LOCAL space of its group. */
interface ShapeLeaf {
  mob: VMobject;
  /** Raw path awaiting styles (vs. an already-styled nested-group leaf). */
  raw: boolean;
  hasFill: boolean;
  hasStroke: boolean;
  /** Linear-gradient endpoints, transformed alongside the points. */
  gradPts?: [number[], number[]];
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Append a LottiePath as one cubic-bezier subpath (i/o are RELATIVE
 *  tangents: handles are v[k]+o[k] → v[k+1]+i[k+1]). Optional matrix. */
function appendLottiePath(mob: VMobject, p: LottiePath, m?: Mat2D): void {
  const n = p.v.length;
  if (n === 0) return;
  const P = (x: number, y: number): number[] => {
    if (!m) return [x, y, 0];
    const [wx, wy] = matApply(m, x, y);
    return [wx, wy, 0];
  };
  mob.subpathStarts.push(mob.points.length);
  mob.points.push(P(p.v[0][0], p.v[0][1]));
  for (let k = 1; k < n; k++) {
    const a = p.v[k - 1];
    const b = p.v[k];
    const oa = p.o[k - 1] ?? [0, 0];
    const ib = p.i[k] ?? [0, 0];
    mob.points.push(
      P(a[0] + oa[0], a[1] + oa[1]),
      P(b[0] + ib[0], b[1] + ib[1]),
      P(b[0], b[1]),
    );
  }
  if (p.c && n > 1) {
    const a = p.v[n - 1];
    const b = p.v[0];
    const oa = p.o[n - 1] ?? [0, 0];
    const ib = p.i[0] ?? [0, 0];
    mob.points.push(
      P(a[0] + oa[0], a[1] + oa[1]),
      P(b[0] + ib[0], b[1] + ib[1]),
      P(b[0], b[1]),
    );
  }
}

/** Transform a leaf in place: points, gradient endpoints, stroke width. */
function applyMatrixToLeaf(leaf: ShapeLeaf, m: Mat2D): void {
  for (const p of leaf.mob.points) {
    const [x, y] = matApply(m, p[0], p[1]);
    p[0] = x;
    p[1] = y;
  }
  if (leaf.gradPts) {
    for (const g of leaf.gradPts) {
      const [x, y] = matApply(m, g[0], g[1]);
      g[0] = x;
      g[1] = y;
    }
  }
  leaf.mob.strokeWidth *= matScaleFactor(m);
}

const colorOf = (c: [number, number, number, number]): Color =>
  new Color(c[0], c[1], c[2], 1);

const midStop = (stops: Array<{ r: number; g: number; b: number; a: number }>) =>
  stops.length ? stops[Math.floor((stops.length - 1) / 2)] : { r: 1, g: 1, b: 1, a: 1 };

// ---------------------------------------------------------------------------
// LottieMobject
// ---------------------------------------------------------------------------

export class LottieMobject extends Group {
  /** Composition frame rate. */
  readonly fps: number;
  /** Composition in/out points (frames). */
  readonly inPoint: number;
  readonly outPoint: number;
  /** Frames between in and out point. */
  readonly totalFrames: number;
  /** Duration in seconds. */
  readonly duration: number;
  /** Composition size in Lottie pixels. */
  readonly compWidth: number;
  readonly compHeight: number;
  /** Deduplicated unsupported-feature warnings collected while building
   *  and playing. Never throws for unknown layer/shape types. */
  readonly warnings: string[] = [];
  /** attachTo playback speed multiplier. */
  speed: number;
  /** attachTo looping. */
  loop: boolean;

  private _anim: LottieAnimation;
  private _root: CompInst;
  /** Pixel→world map (scale + y-flip + centering), fixed at construction. */
  private _worldMat: Mat2D;
  private _clock = 0;
  private _currentFrame: number;

  constructor(anim: LottieAnimation, config: LottieConfig = {}) {
    super();
    this.name = anim.data.nm || "Lottie";
    this._anim = anim;
    this.fps = anim.fr;
    this.inPoint = anim.ip;
    this.outPoint = anim.op;
    this.totalFrames = anim.op - anim.ip;
    this.duration = this.totalFrames / (this.fps || 30);
    this.compWidth = anim.w;
    this.compHeight = anim.h;
    this.speed = config.speed ?? 1;
    this.loop = config.loop ?? true;

    // World fit: ~10 units wide by default; explicit width/height override
    // (when both are given, the tighter fit wins, preserving aspect).
    const w = anim.w || 1;
    const h = anim.h || 1;
    let k: number;
    if (config.width != null && config.height != null) {
      k = Math.min(config.width / w, config.height / h);
    } else if (config.width != null) {
      k = config.width / w;
    } else if (config.height != null) {
      k = config.height / h;
    } else {
      k = 10 / w;
    }
    // x' = k(x - w/2); y' = -k(y - h/2)  (y-down pixels → y-up world).
    this._worldMat = [k, 0, 0, -k, (-w / 2) * k, (h / 2) * k];

    this._root = this._buildComp(anim.data.layers ?? [], 0);
    this.add(this._root.container);
    this._currentFrame = NaN;
    this.setFrame(anim.ip);
  }

  // --- public API ----------------------------------------------------------

  /** Pose the whole animation at frame `f` — a pure function of the JSON.
   *  Same frame in, same world geometry out, in any call order. */
  setFrame(f: number): this {
    this._currentFrame = f;
    this._updateComp(this._root, f, this._worldMat, 1);
    return this;
  }

  /** Pose at `t` seconds from the in point (setFrame(ip + t·fps)). */
  setTime(t: number): this {
    return this.setFrame(this.inPoint + t * this.fps);
  }

  /** The frame most recently posed via setFrame/setTime. */
  get currentFrame(): number {
    return this._currentFrame;
  }

  /** Names of the root composition's layers (from `nm`, JSON order). */
  layers(): string[] {
    return this._root.insts.map((i) => String(i.def.nm ?? ""));
  }

  /** The stable container mobject for the first root layer named `name`
   *  (persists across setFrame calls; its CONTENT is rebuilt per frame). */
  layer(name: string): Mobject | undefined {
    const inst = this._root.insts.find((i) => i.def.nm === name);
    return inst?.outer;
  }

  /**
   * Add to `scene` with a clock updater: the internal clock advances by
   * dt·speed and the animation re-poses via setTime (looping over the
   * duration by default). Scrubbing manually still works — the clock only
   * moves inside the updater.
   */
  attachTo(scene: { add(...mobs: Mobject[]): unknown }): this {
    this.addUpdater((_m: Mobject, dt: number) => {
      this._clock += dt * this.speed;
      const d = this.duration;
      let t = this._clock;
      if (d > 0) {
        if (this.loop) t = ((t % d) + d) % d;
        else t = Math.min(t, d);
      }
      this.setTime(t);
    });
    scene.add(this);
    return this;
  }

  // --- warnings --------------------------------------------------------------

  private _warn(msg: string): void {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }

  // --- static structure ------------------------------------------------------

  private _buildComp(layers: any[], depth: number): CompInst {
    const container = new Group();
    const insts: LayerInst[] = [];
    const byInd = new Map<number, LayerInst>();

    if (depth > 16) {
      this._warn("precomp nesting deeper than 16 levels truncated");
      return { insts, byInd, container };
    }

    for (const def of layers) {
      const content = new Group();
      content.name = String(def?.nm ?? "layer");
      const inst: LayerInst = { def, content, outer: content };

      // Precomp: instantiate the referenced comp's layers ONCE (stable
      // containers; geometry rebuilt per frame).
      if (def.ty === 0) {
        const asset = this._anim.assets.get(String(def.refId));
        if (asset?.layers) {
          inst.child = this._buildComp(asset.layers, depth + 1);
          content.add(inst.child.container);
        } else {
          this._warn(`precomp asset "${def.refId}" not found — layer skipped`);
        }
      } else if (def.ty === 2) {
        this._warn(`image layer "${def.nm ?? "?"}" skipped (image assets unsupported)`);
      } else if (![0, 1, 3, 4, 5].includes(def.ty)) {
        this._warn(`unsupported layer type ${def.ty} ("${def.nm ?? "?"}") skipped`);
      }

      // Masks: union additive masks into one destination-in shape; subtract
      // masks cut with destination-out; intersect masks each get their own
      // destination-in pass (sequential destination-in = intersection).
      const maskDefs = (def.masksProperties ?? []).filter(
        (m: any) => m && m.mode !== "n",
      );
      if (maskDefs.length) {
        const slots: MaskSlot[] = [];
        const additive: any[] = [];
        const rest: Array<{ def: any; op: GlobalCompositeOperation }> = [];
        for (const md of maskDefs) {
          const mode = md.mode ?? "a";
          if (mode === "s") {
            rest.push({ def: md, op: md.inv ? "destination-in" : "destination-out" });
          } else if (mode === "i") {
            rest.push({ def: md, op: "destination-in" });
          } else {
            if (mode !== "a") {
              this._warn(`mask mode "${mode}" approximated as additive`);
            }
            if (md.inv) {
              this._warn("inverted additive mask approximated as destination-out");
              rest.push({ def: md, op: "destination-out" });
            } else {
              additive.push(md);
            }
          }
        }
        const makeMaskMob = (op: GlobalCompositeOperation): VMobject => {
          const mob = new VMobject({
            fillColor: "#FFFFFF",
            fillOpacity: 1,
            strokeWidth: 0,
            strokeOpacity: 0,
          });
          mob.compositeOperation = op;
          return mob;
        };
        const wrap = new CompositeGroup(inst.outer);
        if (additive.length) {
          const mob = makeMaskMob("destination-in");
          slots.push({ mob, defs: additive });
          wrap.add(mob);
        }
        for (const r of rest) {
          const mob = makeMaskMob(r.op);
          slots.push({ mob, defs: [r.def] });
          wrap.add(mob);
        }
        inst.maskSlots = slots;
        inst.outer = wrap;
      }

      inst.outer.name = content.name;
      insts.push(inst);
      if (def.ind != null) byInd.set(def.ind, inst);
    }

    // Track mattes: a layer with `tt` uses the layer ABOVE it (previous in
    // the array, usually flagged td:1) as its matte.
    for (let i = 0; i < insts.length; i++) {
      const def = insts[i].def;
      const tt = def.tt;
      if (!tt) continue;
      if (i === 0) {
        this._warn(`track matte on topmost layer "${def.nm ?? "?"}" has no matte source`);
        continue;
      }
      const src = insts[i - 1];
      src.isMatteSource = true;
      if (tt === 3 || tt === 4) {
        this._warn("luma track matte approximated as alpha matte");
      }
      const matteCG = new CompositeGroup(src.outer);
      matteCG.compositeOperation =
        tt === 2 || tt === 4 ? "destination-out" : "destination-in";
      insts[i].outer = new CompositeGroup(insts[i].outer, matteCG);
      insts[i].outer.name = insts[i].content.name;
    }

    // Mount bottom-first: the LAST layer in the JSON draws at the bottom.
    for (let i = insts.length - 1; i >= 0; i--) {
      if (!insts[i].isMatteSource) container.add(insts[i].outer);
    }
    return { insts, byInd, container };
  }

  // --- per-frame evaluation ---------------------------------------------------

  private _updateComp(
    comp: CompInst,
    frame: number,
    ambient: Mat2D,
    ambientOpacity: number,
  ): void {
    // Comp-space matrices including parent chains, memoized per call.
    const matCache = new Map<LayerInst, Mat2D>();
    const seen = new Set<LayerInst>();
    const localMat = (inst: LayerInst): Mat2D => {
      const hit = matCache.get(inst);
      if (hit) return hit;
      let m = evalTransform(inst.def.ks, frame).m;
      if (inst.def.parent != null && !seen.has(inst)) {
        seen.add(inst);
        const parent = comp.byInd.get(inst.def.parent);
        if (parent) m = matMul(localMat(parent), m);
        seen.delete(inst);
      }
      matCache.set(inst, m);
      return m;
    };

    for (const inst of comp.insts) {
      const def = inst.def;
      const ip = def.ip ?? -Infinity;
      const op = def.op ?? Infinity;
      const visible = !def.hd && frame >= ip && frame < op;
      if (!visible) {
        this._clearInst(inst);
        continue;
      }
      const M = matMul(ambient, localMat(inst));
      const opacity =
        ambientOpacity *
        Math.min(1, Math.max(0, def.ks?.o != null ? evalScalar(def.ks.o, frame) / 100 : 1));

      // Masks (mask paths live in LAYER space → through the full matrix).
      if (inst.maskSlots) {
        for (const slot of inst.maskSlots) {
          slot.mob.points = [];
          slot.mob.subpathStarts = [];
          let o = 1;
          for (const md of slot.defs) {
            const path = evalShapePath(md.pt, frame);
            if (path) appendLottiePath(slot.mob, path, M);
            if (md.o != null) o = Math.min(o, evalScalar(md.o, frame) / 100);
          }
          slot.mob.fillOpacity = Math.min(1, Math.max(0, o));
        }
      }

      switch (def.ty) {
        case 4: { // shape layer
          const leaves = this._buildShapeItems(def.shapes ?? [], frame);
          const children: Mobject[] = [];
          for (const leaf of leaves) {
            applyMatrixToLeaf(leaf, M);
            leaf.mob.strokeWidth *= STROKE_PX_PER_WORLD_UNIT;
            leaf.mob.fillOpacity *= opacity;
            leaf.mob.strokeOpacity *= opacity;
            if (leaf.gradPts) {
              const [s, e] = leaf.gradPts;
              const dx = e[0] - s[0];
              const dy = e[1] - s[1];
              if (Math.hypot(dx, dy) > 1e-12) leaf.mob.sheenDirection = [dx, dy, 0];
            }
            children.push(leaf.mob);
          }
          inst.content.submobjects = children;
          break;
        }
        case 1: { // solid: colored rect sw×sh anchored at the layer origin
          const mob = new VMobject({
            fillColor: def.sc ?? "#000000",
            fillOpacity: opacity,
            strokeWidth: 0,
            strokeOpacity: 0,
          });
          const sw = Number(def.sw) || 0;
          const sh = Number(def.sh) || 0;
          appendLottiePath(mob, rectPath([sw / 2, sh / 2], [sw, sh], 0), M);
          inst.content.submobjects = [mob];
          break;
        }
        case 3: // null: transform only
          inst.content.submobjects = [];
          break;
        case 0: { // precomp
          if (!inst.child) break;
          let childFrame: number;
          if (def.tm != null) {
            // Time remap: seconds → child frames.
            childFrame = evalScalar(def.tm, frame) * this.fps;
          } else {
            childFrame = (frame - (def.st ?? 0)) / (def.sr ?? 1);
          }
          this._updateComp(inst.child, childFrame, M, opacity);
          break;
        }
        case 5: { // text (best-effort)
          const mob = this._buildText(def, frame, M, opacity);
          inst.content.submobjects = mob ? [mob] : [];
          break;
        }
        default:
          inst.content.submobjects = [];
          break;
      }
    }
  }

  private _clearInst(inst: LayerInst): void {
    if (inst.maskSlots) {
      for (const slot of inst.maskSlots) {
        slot.mob.points = [];
        slot.mob.subpathStarts = [];
      }
    }
    if (inst.child) {
      for (const ci of inst.child.insts) this._clearInst(ci);
    } else {
      inst.content.submobjects = [];
    }
  }

  // --- shape tree --------------------------------------------------------------

  /** Build one items list (a layer's `shapes` or a group's `it`) at `frame`.
   *  Returned leaves are in the LOCAL space of this list (the group's own
   *  `tr` is already applied). */
  private _buildShapeItems(items: any[], frame: number): ShapeLeaf[] {
    const leaves: ShapeLeaf[] = [];
    const raws: ShapeLeaf[] = [];
    const styles: any[] = [];
    const modifiers: Array<{ item: any; scopeEnd: number }> = [];
    let trItem: any = null;

    const addRaw = (path: LottiePath | null): void => {
      if (!path || path.v.length === 0) return;
      const mob = new VMobject({
        strokeWidth: 0,
        strokeOpacity: 0,
        fillOpacity: 0,
        lineCap: "butt",
        lineJoin: "miter",
      });
      mob.points = [];
      mob.subpathStarts = [];
      appendLottiePath(mob, path);
      const leaf: ShapeLeaf = { mob, raw: true, hasFill: false, hasStroke: false };
      raws.push(leaf);
      leaves.push(leaf);
    };

    for (const item of items ?? []) {
      if (!item || item.hd) continue;
      switch (item.ty) {
        case "gr":
          leaves.push(...this._buildShapeItems(item.it ?? [], frame));
          break;
        case "sh":
          addRaw(evalShapePath(item.ks, frame));
          break;
        case "rc":
          addRaw(rectPath(
            evalVector(item.p, frame),
            evalVector(item.s, frame),
            item.r != null ? evalScalar(item.r, frame) : 0,
          ));
          break;
        case "el":
          addRaw(ellipsePath(evalVector(item.p, frame), evalVector(item.s, frame)));
          break;
        case "sr":
          addRaw(polystarPath({
            type: item.sy === 2 ? 2 : 1,
            points: evalScalar(item.pt, frame),
            position: evalVector(item.p, frame),
            rotation: item.r != null ? evalScalar(item.r, frame) : 0,
            outerRadius: item.or != null ? evalScalar(item.or, frame) : 0,
            innerRadius: item.ir != null ? evalScalar(item.ir, frame) : 0,
            outerRoundness: item.os != null ? evalScalar(item.os, frame) : 0,
            innerRoundness: item.is != null ? evalScalar(item.is, frame) : 0,
          }));
          break;
        case "fl":
        case "st":
        case "gf":
        case "gs":
          styles.push(item);
          break;
        case "tm":
        case "rp":
          modifiers.push({ item, scopeEnd: leaves.length });
          break;
        case "tr":
          trItem = item;
          break;
        case "mm":
          this._warn("merge paths (mm) unsupported — paths render unmerged");
          break;
        case "rd":
          this._warn("rounded corners (rd) unsupported — corners stay sharp");
          break;
        default:
          this._warn(`unsupported shape item type "${item.ty}" skipped`);
          break;
      }
    }

    // Styles: apply to this group's raw paths (first fill / first stroke of
    // the group win per path — AE exports one of each per group).
    for (const st of styles) this._applyStyle(st, raws, frame);

    // Modifiers, in item order, over the leaves that preceded them.
    for (const { item, scopeEnd } of modifiers) {
      const scope = leaves.slice(0, Math.min(scopeEnd, leaves.length));
      if (item.ty === "tm") this._applyTrim(item, scope, frame);
      else this._applyRepeater(item, scope, leaves, frame);
    }

    // The group's own transform maps everything into the parent's space.
    if (trItem) {
      const { m, opacity } = evalTransform(trItem, frame);
      for (const leaf of leaves) {
        applyMatrixToLeaf(leaf, m);
        leaf.mob.fillOpacity *= opacity;
        leaf.mob.strokeOpacity *= opacity;
      }
    }
    return leaves;
  }

  private _applyStyle(item: any, raws: ShapeLeaf[], frame: number): void {
    switch (item.ty) {
      case "fl": {
        if (item.fillEnabled === false) return;
        const c = normalizeColor(evalVector(item.c, frame));
        const o = (item.o != null ? evalScalar(item.o, frame) / 100 : 1) * c[3];
        for (const leaf of raws) {
          if (leaf.hasFill) continue;
          leaf.hasFill = true;
          leaf.mob.fillColor = colorOf(c);
          leaf.mob.fillOpacity = Math.min(1, Math.max(0, o));
        }
        break;
      }
      case "st": {
        const c = normalizeColor(evalVector(item.c, frame));
        const o = (item.o != null ? evalScalar(item.o, frame) / 100 : 1) * c[3];
        const w = item.w != null ? evalScalar(item.w, frame) : 1;
        const lineCap: CanvasLineCap =
          item.lc === 2 ? "round" : item.lc === 3 ? "square" : "butt";
        const lineJoin: CanvasLineJoin =
          item.lj === 2 ? "round" : item.lj === 3 ? "bevel" : "miter";
        for (const leaf of raws) {
          if (leaf.hasStroke) continue;
          leaf.hasStroke = true;
          leaf.mob.strokeColor = colorOf(c);
          leaf.mob.strokeOpacity = Math.min(1, Math.max(0, o));
          leaf.mob.strokeWidth = w;
          leaf.mob.lineCap = lineCap;
          leaf.mob.lineJoin = lineJoin;
        }
        break;
      }
      case "gf": {
        const stops = parseGradientStops(item.g, frame);
        const o = item.o != null ? evalScalar(item.o, frame) / 100 : 1;
        const linear = item.t !== 2;
        if (!linear) {
          this._warn("radial gradient fill approximated as flat mid-stop fill");
        }
        for (const leaf of raws) {
          if (leaf.hasFill) continue;
          leaf.hasFill = true;
          leaf.mob.fillOpacity = Math.min(1, Math.max(0, o));
          if (linear && stops.length > 1) {
            leaf.mob.fillColor = new Color(stops[0].r, stops[0].g, stops[0].b, 1);
            leaf.mob.gradientColors = stops.map(
              (s) => new Color(s.r, s.g, s.b, 1),
            );
            leaf.gradPts = [
              [...evalVector(item.s, frame)],
              [...evalVector(item.e, frame)],
            ];
          } else {
            const m = midStop(stops);
            leaf.mob.fillColor = new Color(m.r, m.g, m.b, 1);
          }
        }
        break;
      }
      case "gs": {
        this._warn("gradient stroke approximated as solid mid-stop stroke");
        const stops = parseGradientStops(item.g, frame);
        const m = midStop(stops);
        const o = item.o != null ? evalScalar(item.o, frame) / 100 : 1;
        const w = item.w != null ? evalScalar(item.w, frame) : 1;
        for (const leaf of raws) {
          if (leaf.hasStroke) continue;
          leaf.hasStroke = true;
          leaf.mob.strokeColor = new Color(m.r, m.g, m.b, 1);
          leaf.mob.strokeOpacity = Math.min(1, Math.max(0, o * m.a));
          leaf.mob.strokeWidth = w;
        }
        break;
      }
    }
  }

  private _applyTrim(item: any, scope: ShapeLeaf[], frame: number): void {
    if (!scope.length) return;
    const s = item.s != null ? evalScalar(item.s, frame) : 0;
    const e = item.e != null ? evalScalar(item.e, frame) : 100;
    const o = item.o != null ? evalScalar(item.o, frame) : 0;
    const [a, b] = trimWindow(s, e, o);
    if (item.m === 2 && scope.length > 1) {
      // "Individually": the window spans the CONCATENATION of the shapes,
      // distributed by arc length.
      const lengths = scope.map((l) => Math.max(1e-9, l.mob.getArcLength(8)));
      const total = lengths.reduce((x, y) => x + y, 0);
      let acc = 0;
      for (let i = 0; i < scope.length; i++) {
        const c0 = acc / total;
        acc += lengths[i];
        const c1 = acc / total;
        const lo = Math.max(a, c0);
        const hi = Math.min(b, c1);
        if (hi <= lo) {
          scope[i].mob.strokeStart = 0;
          scope[i].mob.strokeEnd = 0;
        } else {
          scope[i].mob.strokeStart = (lo - c0) / (c1 - c0);
          scope[i].mob.strokeEnd = (hi - c0) / (c1 - c0);
        }
      }
    } else {
      // "Simultaneously" (default): every shape gets the same window.
      for (const leaf of scope) {
        leaf.mob.strokeStart = a;
        leaf.mob.strokeEnd = b;
      }
    }
  }

  private _applyRepeater(
    item: any,
    scope: ShapeLeaf[],
    leaves: ShapeLeaf[],
    frame: number,
  ): void {
    if (!scope.length) return;
    const copies = Math.max(0, Math.round(evalScalar(item.c, frame)));
    const offset = item.o != null ? evalScalar(item.o, frame) : 0;
    const tr = item.tr ?? {};
    const anchor = tr.a != null ? evalVector(tr.a, frame) : [0, 0];
    const position = tr.p != null ? evalVector(tr.p, frame) : [0, 0];
    const scale = tr.s != null ? evalVector(tr.s, frame) : [100, 100];
    const rotation = tr.r != null ? evalScalar(tr.r, frame) : 0;
    const so = tr.so != null ? evalScalar(tr.so, frame) / 100 : 1;
    const eo = tr.eo != null ? evalScalar(tr.eo, frame) / 100 : 1;

    const scopeSet = new Set(scope);
    const kept = leaves.filter((l) => !scopeSet.has(l));
    const out: ShapeLeaf[] = [];
    for (let i = 0; i < copies; i++) {
      const mult = i + offset;
      const m = buildTransformMatrix({
        anchor,
        position: [position[0] * mult, (position[1] ?? 0) * mult],
        rotation: rotation * mult,
        scale: [
          100 * Math.pow((scale[0] ?? 100) / 100, mult),
          100 * Math.pow((scale[1] ?? scale[0] ?? 100) / 100, mult),
        ],
      });
      const alpha = copies > 1 ? so + (eo - so) * (i / (copies - 1)) : so;
      for (const src of scope) {
        const mob = src.mob.copy();
        const leaf: ShapeLeaf = {
          mob,
          raw: src.raw,
          hasFill: src.hasFill,
          hasStroke: src.hasStroke,
          gradPts: src.gradPts
            ? [[...src.gradPts[0]], [...src.gradPts[1]]]
            : undefined,
        };
        applyMatrixToLeaf(leaf, m);
        leaf.mob.fillOpacity *= alpha;
        leaf.mob.strokeOpacity *= alpha;
        out.push(leaf);
      }
    }
    leaves.length = 0;
    leaves.push(...kept, ...out);
  }

  // --- text ---------------------------------------------------------------------

  /** Best-effort text: uses t.d.k[0].s → { t: string, s: font size (px),
   *  fc: fill color, j: justification (0 L / 1 R / 2 C) }. Metrics differ
   *  from After Effects; per-character animators are ignored. */
  private _buildText(
    def: any,
    frame: number,
    M: Mat2D,
    opacity: number,
  ): Mobject | null {
    const docKfs = def.t?.d?.k;
    if (!Array.isArray(docKfs) || docKfs.length === 0) return null;
    this._warn("text layers are best-effort (glyph metrics differ from AE)");
    // Pick the last document keyframe at or before `frame`.
    let doc = docKfs[0].s;
    for (const kf of docKfs) {
      if (kf.t != null && kf.t <= frame && kf.s) doc = kf.s;
    }
    if (!doc || !doc.t) return null;
    if (docKfs.length > 1) {
      this._warn("animated text documents use stepped (hold) switching");
    }
    const scale = matScaleFactor(M);
    const fontSize = (Number(doc.s) || 24) * scale;
    const fc = Array.isArray(doc.fc) ? normalizeColor(doc.fc) : [1, 1, 1, 1];
    const text = String(doc.t).replace(/\r/g, "\n");
    const mob = new Text(text, {
      fontSize,
      color: new Color(fc[0], fc[1], fc[2], 1),
      fillOpacity: opacity,
    });
    // The layer origin is the text BASELINE anchor; Text centers on moveTo.
    const [ox, oy] = matApply(M, 0, 0);
    const w = mob.getWidth();
    const h = mob.getHeight();
    const j = Number(doc.j) || 0;
    const dx = j === 1 ? -w / 2 : j === 2 ? 0 : w / 2;
    mob.moveTo([ox + dx, oy + h * 0.35, 0]);
    return mob;
  }
}
