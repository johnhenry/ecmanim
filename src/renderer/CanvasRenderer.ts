// Renders a scene's mobjects onto a Canvas-2D context. This module is
// isomorphic: the same code drives a browser <canvas> and a Node
// @napi-rs/canvas surface. It knows nothing about video or the DOM.

import { partialBezier, bezier } from "../core/math/bezier.ts";
import { ZBuffer } from "./zbuffer.ts";
import { Color } from "../core/color.ts";
import { splitEffects, effectsToCanvasFilter, effectPad, makeNoiseBytes } from "../core/effects.ts";
import type { FrameEffect } from "../core/effects.ts";
import type { Vec3, Ctx2D, ColorLike } from "../core/types.ts";
import type { Mobject } from "../mobject/Mobject.ts";

const to255 = (c: { r: number; g: number; b: number }): [number, number, number] => [
  Math.round(Math.max(0, Math.min(1, c.r)) * 255),
  Math.round(Math.max(0, Math.min(1, c.g)) * 255),
  Math.round(Math.max(0, Math.min(1, c.b)) * 255),
];

const parseHexColor = (str: ColorLike): [number, number, number] => to255(Color.parse(str));

// Average of a point list — a cheap face/mobject center for depth sorting.
function centroid(points: number[][]): Vec3 {
  let x = 0, y = 0, z = 0;
  for (const p of points) { x += p[0]; y += p[1]; z += p[2]; }
  const n = points.length || 1;
  return [x / n, y / n, z / n];
}

// A small SYNCHRONOUS offscreen-canvas factory for the static-subtree render
// cache below (the per-frame draw path can't await an async canvas backend
// mid-render). Works in the browser (OffscreenCanvas or a detached <canvas>
// element); returns null under Node with no browser globals, since
// @napi-rs/canvas can only be reached via an async import() -- caching
// gracefully no-ops there (drawVMobject() runs directly, same as always).
function makeSyncOffscreenCanvas(w: number, h: number): any {
  const G: any = globalThis as any;
  if (typeof G.OffscreenCanvas === "function") return new G.OffscreenCanvas(w, h);
  if (typeof G.document !== "undefined") {
    const c = G.document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

interface StaticCacheEntry {
  canvas: any;
  ctx: any;
  fingerprint: string;
  cameraFingerprint: string;
  w: number;
  h: number;
}

export interface CameraConfig {
  pixelWidth?: number;
  pixelHeight?: number;
  frameHeight?: number;
  frameWidth?: number;
  frameCenter?: number[];
  background?: ColorLike;
  zoom?: number;
  [key: string]: any;
}

export class Camera {
  pixelWidth: number;
  pixelHeight: number;
  frameHeight: number;
  frameWidth: number;
  frameCenter: number[];
  background: ColorLike;
  // Members provided by 3D camera subclasses. `declare` so no field initializer
  // is emitted — otherwise (ES2022 class fields) this would shadow the
  // subclass's prototype method with `undefined`.
  // projectionDepth is provided by 3D camera subclasses as a prototype method.
  // It is declared via interface-merging below (as a method signature) rather
  // than a class property, so subclasses can override it with a method without a
  // member-kind mismatch (TS2425), and nothing is emitted to shadow it under
  // Node type-stripping.
  declare disableZBuffer?: boolean;
  declare flatShading?: boolean;
  declare focalDistance?: number;
  // Opt-in anti-aliasing for the 3D z-buffer rasterizer (default 1 = off,
  // byte-identical to pre-existing behavior). Renders the 3D pass internally
  // at `superSample`x linear resolution and box-filters down -- see
  // src/renderer/zbuffer.ts for why this rasterizer needs it (hard,
  // unaliased per-pixel edge tests) and why it's opt-in (O(n^2) more pixel
  // work, not free on a CPU rasterizer). No effect on the 2D vector-fill
  // path, which is already anti-aliased by the underlying canvas backend.
  declare superSample?: number;
  // An optional animatable "camera frame" mobject (a Rectangle). When set, its
  // size/center drive the viewport via preRender() — this is how
  // MovingCameraScene / ZoomedScene pan and zoom by animating a mobject.
  declare frame?: any;
  // Optional uniform zoom factor (default 1 via `?? 1`, so unset is a no-op).
  // Mirrors ThreeDCamera.zoom (src/scene/three_d.ts), giving both renderer
  // paths one shared zoom mechanism for pointer-driven camera control.
  declare zoom?: number;
  // Optional camera roll in radians (Motion Canvas `camera.rotation`):
  // rotates the view about frameCenter. Unset/0 keeps toPixel on the exact
  // pre-existing axis-aligned arithmetic. Synced from a rotated frame
  // mobject in preRender() when one is set (rotate the frame, roll the
  // camera), or set directly.
  declare rotation?: number;
  // Camera-level full-frame grading (src/core/effects.ts FrameEffect):
  // blur/colorAdjust/glow/shadow applied to the whole composed frame, plus
  // vignette and grain (noise). Applied by CanvasRenderer at the end of both
  // the 2D and 3D paths -- one grade per frame, far cheaper than per-mobject
  // effects for scene-wide looks. The Camera is the seam because it's the
  // one object already threaded through every backend (node, browser,
  // player, studio) without touching Scene.
  declare frameEffects?: FrameEffect[];

  constructor(config: CameraConfig = {}) {
    this.pixelWidth = config.pixelWidth ?? 1920;
    this.pixelHeight = config.pixelHeight ?? 1080;
    this.frameHeight = config.frameHeight ?? 8;
    this.frameWidth = config.frameWidth ?? (this.frameHeight * this.pixelWidth) / this.pixelHeight;
    this.frameCenter = config.frameCenter ?? [0, 0, 0];
    this.background = config.background ?? "#000000";
    if (config.zoom != null) this.zoom = config.zoom;
    if (config.rotation != null) this.rotation = config.rotation;
    if (config.superSample != null) this.superSample = config.superSample;
    if (config.frameEffects != null) this.frameEffects = config.frameEffects;
  }

  // World coordinates -> pixel coordinates (y is flipped: world y-up).
  toPixel(p: number[]): [number, number] {
    const z = this.zoom ?? 1;
    let cx = p[0] - this.frameCenter[0];
    let cy = p[1] - this.frameCenter[1];
    const rot = this.rotation ?? 0;
    if (rot !== 0) {
      // A camera rolled by +rot shows the world rotated by -rot.
      const c = Math.cos(-rot), s = Math.sin(-rot);
      const rx = cx * c - cy * s;
      cy = cx * s + cy * c;
      cx = rx;
    }
    return [
      (cx / this.frameWidth / z + 0.5) * this.pixelWidth,
      (0.5 - cy / this.frameHeight / z) * this.pixelHeight,
    ];
  }

  // Convert a manim stroke width (roughly px at 1080p) to this resolution.
  strokeScale(): number {
    return this.pixelHeight / 1080;
  }

  // Sync the viewport (frameCenter/width/height) to the frame mobject, if one is
  // set. A no-op when `this.frame` is unset, so behavior is unchanged for the
  // common case. Called at the top of the renderer's renderScene/renderScene3D.
  preRender(): void {
    const f = this.frame;
    if (!f) return;
    if (typeof f.getCenter === "function") this.frameCenter = f.getCenter();
    // A camera-frame Rectangle (marked by MovingCameraScene.setupFrame) may
    // be ROTATED; its axis-aligned getWidth/getHeight would then report the
    // inflated bounding box. Derive the true edge lengths and the roll angle
    // from its corner anchors instead. ecmanim's Rectangle anchors run
    // UR -> UL -> DL -> DR, so at rest the first edge points along -x.
    if (f.__isCameraFrameRect && typeof f.getSubpaths === "function") {
      const sp = f.getSubpaths()[0];
      if (sp && sp.length >= 13) {
        const c0 = sp[0], c1 = sp[3], c2 = sp[6];
        this.frameWidth = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
        this.frameHeight = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
        // Normalize to (-pi, pi] so a wrapped atan2 doesn't report 2pi-off.
        let roll = Math.atan2(c1[1] - c0[1], c1[0] - c0[0]) - Math.PI;
        roll = ((roll % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (roll > Math.PI) roll -= 2 * Math.PI;
        this.rotation = roll;
        return;
      }
    }
    if (typeof f.getHeight === "function") this.frameHeight = f.getHeight();
    if (typeof f.getWidth === "function") this.frameWidth = f.getWidth();
  }
}

// Declaration-merge an optional projectionDepth *method* onto Camera. Declaring
// it as a method (rather than a class property) lets 3D subclasses override it
// with a prototype method without a member-kind mismatch (TS2425).
export interface Camera {
  projectionDepth?(p: number[]): number;
}

export interface CanvasRendererOptions {
  /** Synchronous offscreen-canvas factory. Browsers don't need this
   *  (OffscreenCanvas / a detached <canvas> is used automatically); Node
   *  callers pass @napi-rs/canvas's createCanvas here -- it can only be
   *  reached via an async import, so the renderer can't fetch it itself.
   *  Enables the effects pipeline's offscreen compositing and makes
   *  cacheStatic() work under Node. */
  createCanvas?: (w: number, h: number) => any;
}

export class CanvasRenderer {
  ctx: Ctx2D;
  camera: Camera;
  _zb?: ZBuffer;
  private _staticCache = new WeakMap<any, StaticCacheEntry>();
  private _createCanvas?: (w: number, h: number) => any;
  // Top-level mobjects of the current renderScene call (zoomed-display source).
  private _sceneMobjects?: any[];
  // Deterministic noise-effect tile canvases, keyed by `${seed}|${mono}`.
  private _noiseTiles = new Map<string, any>();

  constructor(ctx: Ctx2D, camera: Camera, opts: CanvasRendererOptions = {}) {
    this.ctx = ctx;
    this.camera = camera;
    this._createCanvas = opts.createCanvas;
  }

  private _makeOffscreen(w: number, h: number): any {
    return this._createCanvas?.(w, h) ?? makeSyncOffscreenCanvas(w, h);
  }

  clear(): void {
    const { ctx, camera } = this;
    ctx.save();
    ctx.fillStyle = camera.background as string;
    ctx.fillRect(0, 0, camera.pixelWidth, camera.pixelHeight);
    ctx.restore();
  }

  renderScene(mobjects: any[]): void {
    // Sync the viewport to an animatable camera frame (no-op when unset).
    this.camera.preRender?.();
    // Remember the frame's full top-level list so a zoomed display can
    // re-render the scene through its own derived camera (drawZoomedDisplay).
    this._sceneMobjects = mobjects;
    // With a 3D camera, use the depth-buffered rasterizer so interpenetrating
    // surfaces resolve per pixel (painter sorting can't). 2D uses vector fills.
    if (typeof this.camera.projectionDepth === "function" && !this.camera.disableZBuffer) {
      this.renderScene3D(mobjects);
      return;
    }
    const frameFx = this.camera.frameEffects;
    if (frameFx?.length) {
      // Full-frame grading: compose the whole 2D scene into an offscreen,
      // then one filtered drawImage + vignette/grain to the main ctx.
      const off = this._makeOffscreen(this.camera.pixelWidth, this.camera.pixelHeight);
      if (off) {
        const savedCtx = this.ctx;
        this.ctx = off.getContext("2d");
        try {
          this.clear();
          this.renderMobjects(mobjects);
        } finally {
          this.ctx = savedCtx;
        }
        this._compositeFrame(off, frameFx);
        return;
      }
      // No offscreen backend: draw direct; only the overlay-style frame
      // effects (vignette/grain) still apply, filter grading is skipped.
      this.clear();
      this.renderMobjects(mobjects);
      this._drawFrameOverlays(frameFx);
      return;
    }
    this.clear();
    this.renderMobjects(mobjects);
  }

  // Composite a fully-drawn frame back to the main ctx with the camera's
  // frame effects: one filtered drawImage (blur/colorAdjust/glow/shadow),
  // then vignette and grain drawn on top.
  private _compositeFrame(sourceCanvas: any, frameFx: any[]): void {
    const { ctx } = this;
    const effects = frameFx.filter((e) => e.type !== "vignette");
    const plan = splitEffects(effects);
    // Frame-level noise is handled as an overlay (the frame is opaque --
    // no alpha clipping needed), not via the per-mobject noise pass.
    const filterStr = this._buildEffectFilter({}, { ...plan, noise: undefined }, this.camera.strokeScale());
    ctx.save();
    if (filterStr) (ctx as any).filter = filterStr;
    ctx.drawImage(sourceCanvas, 0, 0);
    ctx.restore();
    this._drawFrameOverlays(frameFx);
  }

  // Vignette + grain: direct draws over the composed frame -- these need no
  // offscreen, so they also work on the degraded no-backend path.
  private _drawFrameOverlays(frameFx: any[]): void {
    const { ctx, camera } = this;
    const w = camera.pixelWidth, h = camera.pixelHeight;
    for (const e of frameFx) {
      if (e.type === "vignette" && e.strength > 0) {
        const color = Color.parse(e.color ?? "#000000");
        const grad = ctx.createRadialGradient(
          w / 2, h / 2, Math.min(w, h) * 0.35,
          w / 2, h / 2, Math.hypot(w, h) / 2,
        );
        grad.addColorStop(0, color.toRGBAString(0));
        grad.addColorStop(1, color.toRGBAString(Math.max(0, Math.min(1, e.strength))));
        ctx.save();
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      } else if (e.type === "noise" && e.amount > 0) {
        const tile = this._noiseTile(e.seed ?? 0, e.monochrome ?? true);
        if (!tile) continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, e.amount));
        for (let ty = 0; ty < h; ty += tile.height) {
          for (let tx = 0; tx < w; tx += tile.width) ctx.drawImage(tile, tx, ty);
        }
        ctx.restore();
      }
    }
  }

  /** SceneRenderer-shaped alias for renderScene(), satisfying the shared
   *  interface in scene_renderer.ts. Purely delegating -- renderScene()
   *  remains the primary, unchanged public method. */
  renderFrame(mobjects: Mobject[]): void {
    this.renderScene(mobjects);
  }

  // --- 3D depth-buffered path --------------------------------------------
  renderScene3D(mobjects: any[]): void {
    // Sync the viewport to an animatable camera frame (no-op when unset).
    this.camera.preRender?.();
    const { ctx, camera } = this;
    const superSample = camera.superSample ?? 1;
    if (!this._zb) this._zb = new ZBuffer(camera.pixelWidth, camera.pixelHeight, superSample);
    this._zb.resize(camera.pixelWidth, camera.pixelHeight, superSample);
    const bg = parseHexColor(camera.background);
    this._zb.clear(bg[0], bg[1], bg[2]);

    // Collect the drawable family; text and images are deferred to an overlay.
    // Fixed-in-frame / fixed-orientation mobjects are drawn last, in screen
    // space, so HUD/titles stay put while the camera orbits.
    const overlay: any[] = [];
    const fixed: any[] = [];
    const draw = (m: any, fixedInFrame: boolean, fixedOrient: boolean) => {
      const fif = fixedInFrame || !!m._fixedInFrame;
      const fo = fixedOrient || !!m._fixedOrientation;
      // Mesh3D (src/mobject/mesh3d.ts) is the GPU-only tier -- its own
      // `points` is just a cheap bounding-box proxy, not real face geometry,
      // so rasterizing it here would draw a wrong box shape. There is
      // deliberately no CPU fallback for this tier (see the mesh-import
      // plan's Phase 2 perf gate) -- render via ThreeRenderer instead.
      if (m._isMesh3D) {
        // skip
      } else if (m.points && m.points.length) {
        if (fif || fo) fixed.push({ mob: m, fixedInFrame: fif, fixedOrient: fo });
        else if (m._isText || m._isImage || m._isParticles) overlay.push(m);
        else this._rasterMobject(m);
      }
      for (const s of m.submobjects) draw(s, fif, fo);
    };
    for (const m of mobjects) draw(m, false, false);

    // Per-mobject effects apply only to the 2D-composited layers here
    // (overlay text/images, fixed-in-frame draws) -- the z-buffered solid
    // geometry writes raw RGBA with no per-mobject compositing surface, so
    // effects on those mobjects are silently skipped (documented; same
    // silent-skip convention as Mesh3D above).
    const drawOverlays = () => {
      for (const m of overlay) {
        if (m.effects?.length) this._drawWithEffects(m);
        else if (m._isImage) this.drawImage(m);
        else if (m._isParticles) this.drawParticles(m);
        else this.drawText(m);
      }
      for (const { mob, fixedInFrame } of fixed) this._drawFixed(mob, fixedInFrame);
    };

    const frameFx = camera.frameEffects;
    if (frameFx?.length) {
      // Full-frame grading: blit the z-buffer into an offscreen, draw the
      // overlays INTO it (so grading covers them too), then one filtered
      // composite. This also sidesteps the spec quirk that putImageData
      // ignores ctx.filter -- the filter rides the final drawImage instead.
      const off = this._makeOffscreen(camera.pixelWidth, camera.pixelHeight);
      if (off) {
        const offCtx = off.getContext("2d");
        this._zb.blitTo(offCtx);
        const savedCtx = this.ctx;
        this.ctx = offCtx;
        try {
          drawOverlays();
        } finally {
          this.ctx = savedCtx;
        }
        this._compositeFrame(off, frameFx);
        return;
      }
      this._zb.blitTo(ctx);
      drawOverlays();
      this._drawFrameOverlays(frameFx);
      return;
    }

    this._zb.blitTo(ctx);
    drawOverlays();
  }

  // Draw a mobject that ignores (fixed-in-frame) or partially ignores
  // (fixed-orientation / billboard) the 3D camera projection. Fixed-in-frame:
  // interpret coords in frame space via the base 2D Camera mapping. Fixed-
  // orientation: project the CENTER through the 3D camera, then draw the mobject
  // un-rotated around that screen anchor.
  _drawFixed(mob: any, fixedInFrame: boolean): void {
    const { ctx, camera } = this;
    // Base 2D frame->pixel mapping (no 3D rotation / perspective).
    const flat = (p: number[]): [number, number] => {
      const cx = p[0] - camera.frameCenter[0];
      const cy = p[1] - camera.frameCenter[1];
      return [
        (cx / camera.frameWidth + 0.5) * camera.pixelWidth,
        (0.5 - cy / camera.frameHeight) * camera.pixelHeight,
      ];
    };

    // Compute the screen anchor + a translation offset so a temporary override
    // of camera.toPixel draws the mobject in the right place.
    let offX = 0, offY = 0;
    if (!fixedInFrame) {
      // Fixed-orientation: anchor at the 3D-projected center, but draw the shape
      // flat (un-rotated) around it.
      const center = mob.getCenter ? mob.getCenter() : [0, 0, 0];
      const [sx, sy] = camera.toPixel(center);
      const [fx, fy] = flat(center);
      offX = sx - fx;
      offY = sy - fy;
    }

    const savedToPixel = camera.toPixel;
    (camera as any).toPixel = (p: number[]): [number, number] => {
      const [x, y] = flat(p);
      return [x + offX, y + offY];
    };
    try {
      if (mob._isText) this.drawText(mob);
      else if (mob._isImage) this.drawImage(mob);
      else if (mob._isParticles) this.drawParticles(mob);
      else this.drawVMobject(mob);
    } finally {
      (camera as any).toPixel = savedToPixel;
    }
  }

  _projectVertex(p: number[]): { x: number; y: number; z: number; r?: number; g?: number; b?: number } {
    const [x, y] = this.camera.toPixel(p);
    return { x, y, z: this.camera.projectionDepth!(p) };
  }

  // Flatten a VMobject's subpaths into world-space polygon loops.
  _flatten(mob: any): number[][][] {
    const seg = mob._straightPath ? 1 : 6;
    const loops: number[][][] = [];
    for (const sp of mob.getSubpaths()) {
      const nc = Math.floor((sp.length - 1) / 3);
      if (nc < 1) continue;
      const loop = [sp[0]];
      for (let i = 0; i < nc; i++) {
        const a = sp[3 * i], c1 = sp[3 * i + 1], c2 = sp[3 * i + 2], b = sp[3 * i + 3];
        for (let k = 1; k <= seg; k++) loop.push(seg === 1 ? b : bezier(a, c1, c2, b, k / seg));
      }
      loops.push(loop);
    }
    return loops;
  }

  _rasterMobject(mob: any): void {
    const zb = this._zb!;
    const opacity = mob.opacity ?? 1;
    const loops = this._flatten(mob);

    const fillAlpha = (mob.fillOpacity ?? 0) * opacity;
    if (fillAlpha > 0 && mob.fillColor) {
      // Gouraud (smooth) fill when the face carries per-vertex colors.
      const vc = mob._vertexColors;
      const smooth = vc && !this.camera.flatShading && loops.length === 1 && loops[0].length === vc.length;
      if (smooth) {
        const loop = loops[0];
        const n = loop.length;
        const proj = loop.map((p, i) => {
          const v = this._projectVertex(p);
          v.r = vc[i][0]; v.g = vc[i][1]; v.b = vc[i][2];
          return v;
        });
        const c = this._projectVertex(centroid(loop));
        c.r = c.g = c.b = 0;
        for (let i = 0; i < n; i++) { c.r += vc[i][0] / n; c.g += vc[i][1] / n; c.b += vc[i][2] / n; }
        for (let i = 0; i < n - 1; i++) zb.triangleGouraud(c, proj[i], proj[i + 1], fillAlpha);
      } else {
        const rgb = to255(mob.fillColor);
        for (const loop of loops) {
          const n = loop.length;
          if (n < 3) continue;
          const c = this._projectVertex(centroid(loop));
          const proj = loop.map((p) => this._projectVertex(p));
          for (let i = 0; i < n; i++) zb.triangle(c, proj[i], proj[(i + 1) % n], rgb, fillAlpha);
        }
      }
    }

    const strokeAlpha = (mob.strokeOpacity ?? 1) * opacity;
    const strokeWidth = mob.strokeWidth ?? 0;
    if (strokeWidth > 0 && strokeAlpha > 0 && mob.strokeColor) {
      const rgb = to255(mob.strokeColor);
      const halfWidth = (strokeWidth * this.camera.strokeScale()) / 2;
      // Bias edges toward the viewer so grid lines sit atop coplanar faces.
      const bias = 0.02 * (this.camera.focalDistance ?? 20) / 20 + 0.01;
      for (const loop of loops) {
        const proj = loop.map((p) => this._projectVertex(p));
        for (let i = 0; i < proj.length - 1; i++) {
          zb.line(proj[i], proj[i + 1], halfWidth, rgb, strokeAlpha, bias);
        }
      }
    }
  }

  renderMobjects(mobjects: any[]): void {
    // Draw in z-index order, stable for equal z. With a 3D camera, break ties by
    // painter's depth (far faces first) so surfaces self-occlude correctly.
    const camera3d = typeof this.camera.projectionDepth === "function" ? this.camera : null;
    const flat: Array<{ mob: any; z: number; depth: number; seq: number; effects?: any[] }> = [];
    let seq = 0;
    const collect = (m: any, inheritedZ: number, inheritedEffects?: any[]) => {
      const z = m.zIndex ?? inheritedZ;
      // A container's own effects propagate to its leaves (like zIndex) --
      // effects are applied PER LEAF, one offscreen composite each; subtree-
      // level compositing (blur the whole group as one image) is future work.
      const effects = m.effects?.length ? m.effects : inheritedEffects;
      // A composite group is dispatched as ONE unit (its children render
      // into a scoped offscreen layer) -- don't walk them into the flat list.
      if (m._isCompositeGroup) {
        if (m.submobjects.length) flat.push({ mob: m, z, depth: 0, seq: seq++, effects });
        return;
      }
      // Mesh3D is GPU-only (see renderScene3D()'s equivalent skip above) --
      // its `points` is just a bounding-box proxy, not real geometry.
      if (!m._isMesh3D && m.points && m.points.length) {
        const depth = camera3d ? camera3d.projectionDepth!(centroid(m.points)) : 0;
        flat.push({ mob: m, z, depth, seq: seq++, effects });
      }
      // A zoomed display renders itself (blit + border) -- don't ALSO walk
      // its children through the normal dispatch.
      if (m._isZoomedDisplay) return;
      for (const s of m.submobjects) collect(s, z, effects);
    };
    for (const m of mobjects) collect(m, 0, undefined);
    // Ascending depth = far -> near (nearer draws last, on top).
    flat.sort((a, b) => (a.z - b.z) || (a.depth - b.depth) || (a.seq - b.seq));
    for (const { mob, effects } of flat) {
      const op = mob.compositeOperation;
      const savedOp = op ? this.ctx.globalCompositeOperation : undefined;
      if (op) this.ctx.globalCompositeOperation = op;
      try {
        if (mob._isCompositeGroup) this.drawCompositeGroup(mob);
        else if (effects?.length) this._drawWithEffects(mob, effects);
        else if (mob._isZoomedDisplay) this.drawZoomedDisplay(mob);
        else if (mob._isText) this.drawText(mob);
        else if (mob._isImage) this.drawImage(mob);
        else if (mob._isParticles) this.drawParticles(mob);
        else if (mob._cacheStatic) this._drawCachedVMobject(mob);
        else this.drawVMobject(mob);
      } finally {
        if (op) this.ctx.globalCompositeOperation = savedOp!;
      }
    }
  }

  // Render a CompositeGroup's children into a full-frame offscreen layer
  // (children's compositeOperations blend against siblings only), then draw
  // the finished layer with the group's opacity. The group's OWN
  // compositeOperation is applied by the dispatch loop above, so the layer
  // itself blends into the scene like any single mobject would. Degrades to
  // unscoped child rendering when no offscreen backend exists.
  drawCompositeGroup(group: any): void {
    const { camera } = this;
    const off = this._makeOffscreen(camera.pixelWidth, camera.pixelHeight);
    if (!off) {
      this.renderMobjects(group.submobjects);
      return;
    }
    const offCtx = off.getContext("2d");
    const savedCtx = this.ctx;
    this.ctx = offCtx;
    try {
      this.renderMobjects(group.submobjects);
    } finally {
      this.ctx = savedCtx;
    }
    const alpha = group.opacity ?? 1;
    if (alpha >= 1) {
      this.ctx.drawImage(off, 0, 0);
    } else {
      const savedAlpha = this.ctx.globalAlpha;
      this.ctx.globalAlpha = savedAlpha * alpha;
      this.ctx.drawImage(off, 0, 0);
      this.ctx.globalAlpha = savedAlpha;
    }
  }

  // Render the scene AGAIN through a derived camera focused on the zoomed
  // frame's region, into the display's screen rectangle (ZoomedScene's
  // render-to-region compositing -- manim's MultiCamera equivalent). Uses the
  // same offscreen machinery as the effects pipeline; on backends with no
  // offscreen support the display draws only its border (documented
  // degradation, same convention as effects).
  drawZoomedDisplay(mob: any): void {
    const { ctx, camera } = this;
    const frame = mob._sourceFrame;
    if (!frame) return;
    // Display rect in pixels (from the display's own 4-corner box).
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of mob.points) {
      const [x, y] = camera.toPixel(p);
      minx = Math.min(minx, x); miny = Math.min(miny, y);
      maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
    }
    const wpx = Math.max(2, Math.round(maxx - minx));
    const hpx = Math.max(2, Math.round(maxy - miny));

    const off = this._makeOffscreen(wpx, hpx);
    if (off) {
      const offCtx = off.getContext("2d");
      const derived = new Camera({
        pixelWidth: wpx,
        pixelHeight: hpx,
        frameWidth: frame.getWidth(),
        frameHeight: frame.getHeight(),
        frameCenter: frame.getCenter(),
        background: camera.background,
      });
      const sub = new CanvasRenderer(offCtx, derived, { createCanvas: this._createCanvas as any });
      // Everything the main render call saw, minus zoom displays (recursion)
      // and the source-frame border itself (manim doesn't show the frame
      // inside its own zoom).
      const sceneMobs = (this._sceneMobjects ?? []).filter(
        (m: any) => !m._isZoomedDisplay && m !== frame,
      );
      sub.clear();
      sub.renderMobjects(sceneMobs);
      ctx.save();
      ctx.drawImage(off, minx, miny, wpx, hpx);
      ctx.restore();
    }
    // Border + any other display chrome draw on top of the blit.
    for (const child of mob.submobjects ?? []) {
      if (child.points?.length) this.drawVMobject(child);
    }
  }

  // --- static-subtree render cache (Mobject.cacheStatic()) -------------------
  // Screen-space cache, MVP-scoped: invalidated on ANY camera-state change
  // (frameCenter/frameWidth/frameHeight/zoom), so it mainly helps static-
  // camera scenes with many unchanging elements, not continuous camera
  // motion. World-space caching with a transform-only blit is a valid future
  // refinement, out of scope here.

  // Content-based fingerprint (NOT reference equality): Mobject.interpolate()
  // mutates `points` element-by-element in place while keeping the same
  // outer array reference, so `mob.points === cached.points` would be an
  // incorrect/unsafe dirty-check -- it would stay true across an animation
  // that IS visibly changing the shape.
  private _fingerprintMobject(mob: any): string {
    const pts: number[][] = mob.points ?? [];
    const n = pts.length;
    const sampleAt = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1];
    let s = String(n);
    for (const i of sampleAt) {
      if (i < 0 || i >= n) continue;
      const p = pts[i];
      s += `|${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
    }
    // Color is a plain object with no toString() override, so template-
    // string coercion would collapse every color to "[object Object]" --
    // use its own toRGBAString()/toHex() explicitly.
    const fill = mob.fillColor?.toRGBAString?.() ?? String(mob.fillColor);
    const stroke = mob.strokeColor?.toRGBAString?.() ?? String(mob.strokeColor);
    s += `|${fill}|${stroke}|${mob.strokeWidth}|${mob.fillOpacity}|${mob.strokeOpacity}|${mob.strokeEnd ?? 1}|${mob.strokeStart ?? 0}`;
    return s;
  }

  private _cameraFingerprint(): string {
    const c = this.camera;
    return `${c.frameCenter.join(",")}|${c.frameWidth}|${c.frameHeight}|${c.zoom ?? 1}|${c.rotation ?? 0}`;
  }

  private _pixelBBox(mob: any): { minX: number; minY: number; maxX: number; maxY: number } {
    const { camera } = this;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of mob.points ?? []) {
      const [x, y] = camera.toPixel(p);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }

  // Render a single mobject into a freshly-made offscreen canvas sized to its
  // padded pixel bounding box, translating the camera so the mobject lands at
  // the offscreen's origin. Returns null when the bbox is degenerate or no
  // offscreen backend exists. Shared by the static-subtree cache and the
  // effects compositor -- the ctx-swap + toPixel-override discipline lives in
  // exactly one place.
  private _renderToOffscreen(mob: any, pad: number): { canvas: any; minX: number; minY: number } | null {
    const bbox = this._pixelBBox(mob);
    if (!isFinite(bbox.minX)) return null;
    const minX = Math.floor(bbox.minX) - pad;
    const minY = Math.floor(bbox.minY) - pad;
    const w = Math.max(1, Math.ceil(bbox.maxX - bbox.minX) + pad * 2);
    const h = Math.max(1, Math.ceil(bbox.maxY - bbox.minY) + pad * 2);

    const canvas = this._makeOffscreen(w, h);
    if (!canvas) return null;
    const offCtx = canvas.getContext("2d");

    const savedCtx = this.ctx;
    const savedToPixel = this.camera.toPixel;
    (this.camera as any).toPixel = (p: number[]): [number, number] => {
      const [x, y] = savedToPixel.call(this.camera, p);
      return [x - minX, y - minY];
    };
    this.ctx = offCtx;
    try {
      if (mob._isText) this.drawText(mob);
      else if (mob._isImage) this.drawImage(mob);
      else if (mob._isParticles) this.drawParticles(mob);
      else this.drawVMobject(mob);
    } finally {
      this.ctx = savedCtx;
      (this.camera as any).toPixel = savedToPixel;
    }
    return { canvas, minX, minY };
  }

  private _drawCachedVMobject(mob: any): void {
    // Pad by the stroke width so a wide stroke isn't clipped at the shape's
    // raw point bounding box.
    const pad = Math.ceil(((mob.strokeWidth ?? 0) + (mob.backgroundStrokeWidth ?? 0)) * this.camera.strokeScale()) + 2;
    const bbox = this._pixelBBox(mob);
    if (!isFinite(bbox.minX)) return;
    const minX = Math.floor(bbox.minX) - pad;
    const minY = Math.floor(bbox.minY) - pad;
    const w = Math.max(1, Math.ceil(bbox.maxX - bbox.minX) + pad * 2);
    const h = Math.max(1, Math.ceil(bbox.maxY - bbox.minY) + pad * 2);

    const fingerprint = this._fingerprintMobject(mob);
    const cameraFingerprint = this._cameraFingerprint();
    const cached = this._staticCache.get(mob);
    if (cached && cached.fingerprint === fingerprint && cached.cameraFingerprint === cameraFingerprint && cached.w === w && cached.h === h) {
      this.ctx.drawImage(cached.canvas, minX, minY);
      return;
    }

    const off = this._renderToOffscreen(mob, pad);
    if (!off) {
      // No synchronous offscreen-canvas backend available -- fall back to
      // drawing directly; caching is a no-op here.
      this.drawVMobject(mob);
      return;
    }

    this._staticCache.set(mob, {
      canvas: off.canvas, ctx: off.canvas.getContext("2d"),
      fingerprint, cameraFingerprint, w, h,
    });
    this.ctx.drawImage(off.canvas, off.minX, off.minY);
  }

  // --- effects compositor (src/core/effects.ts) -----------------------------
  // Renders the mobject to a padded offscreen, then composites back with ONE
  // filtered drawImage: blur/colorAdjust as their CSS filter functions, glow
  // as N chained drop-shadow(0 0 r color) entries (the standard CSS glow
  // technique), drop shadow as a final drop-shadow(). Everything rides
  // ctx.filter rather than the shadow* context properties DELIBERATELY:
  // @napi-rs/canvas (Skia) ignores shadow* on drawImage entirely (verified
  // empirically), while filter drop-shadow() applies to drawImage in both
  // Skia and browsers -- filter is the only mechanism that behaves
  // identically across backends. Noise is a separate alpha-clipped pass.
  private _buildEffectFilter(mob: any, plan: ReturnType<typeof splitEffects>, scale: number): string {
    let filter = effectsToCanvasFilter(plan.filter, scale);
    if (plan.glow) {
      const strength = Math.max(1, Math.min(4, Math.round(plan.glow.strength ?? 2)));
      const glowColor = Color.parse(
        plan.glow.color ?? mob.strokeColor ?? mob.fillColor ?? "#ffffff",
      ).toRGBAString(1);
      const r = plan.glow.radius * scale;
      for (let i = 0; i < strength; i++) filter += ` drop-shadow(0px 0px ${r}px ${glowColor})`;
    }
    if (plan.shadow) {
      const shadowColor = Color.parse(plan.shadow.color ?? "#000000").toRGBAString(1);
      const ox = (plan.shadow.offsetX ?? 0) * scale;
      const oy = (plan.shadow.offsetY ?? 0) * scale;
      filter += ` drop-shadow(${ox}px ${oy}px ${plan.shadow.blur * scale}px ${shadowColor})`;
    }
    return filter.trim();
  }

  private _drawWithEffects(mob: any, effects: any[] = mob.effects): void {
    const scale = this.camera.strokeScale();
    const plan = splitEffects(effects);
    const filterStr = this._buildEffectFilter(mob, plan, scale);
    const strokePad = Math.ceil(((mob.strokeWidth ?? 0) + (mob.backgroundStrokeWidth ?? 0)) * scale) + 2;
    const pad = effectPad(effects, scale) + strokePad;

    const off = this._renderToOffscreen(mob, pad);
    const { ctx } = this;

    if (!off) {
      // Degraded direct-ctx path (no offscreen backend): the same filter
      // string applies per fill/stroke op rather than to the composed
      // result; noise is skipped.
      ctx.save();
      try {
        if (filterStr) (ctx as any).filter = filterStr;
        if (mob._isText) this.drawText(mob);
        else if (mob._isImage) this.drawImage(mob);
        else if (mob._isParticles) this.drawParticles(mob);
        else this.drawVMobject(mob);
      } finally {
        ctx.restore();
      }
      return;
    }

    const { canvas, minX, minY } = off;
    const w = canvas.width, h = canvas.height;

    // Single composite: filter carries blur/colorAdjust/glow/shadow at once.
    ctx.save();
    if (filterStr) (ctx as any).filter = filterStr;
    ctx.drawImage(canvas, minX, minY);
    ctx.restore();

    // Noise: seeded tile clipped to the source's alpha (source-in on a
    // scratch canvas), composited over the main draw at `amount` opacity --
    // opacity-preserving grain, deterministic per seed.
    if (plan.noise && plan.noise.amount > 0) {
      const scratch = this._makeOffscreen(w, h);
      const tile = this._noiseTile(plan.noise.seed ?? 0, plan.noise.monochrome ?? true);
      if (scratch && tile) {
        const sctx = scratch.getContext("2d");
        sctx.drawImage(canvas, 0, 0);
        sctx.globalCompositeOperation = "source-in";
        for (let ty = 0; ty < h; ty += tile.height) {
          for (let tx = 0; tx < w; tx += tile.width) {
            sctx.drawImage(tile, tx, ty);
          }
        }
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, plan.noise.amount));
        ctx.drawImage(scratch, minX, minY);
        ctx.restore();
      }
    }
  }

  // Deterministic noise tile canvas (128px), cached per (seed, mono).
  private _noiseTile(seed: number, mono: boolean): any {
    const key = `${seed}|${mono}`;
    let tile = this._noiseTiles.get(key);
    if (tile) return tile;
    const SIZE = 128;
    tile = this._makeOffscreen(SIZE, SIZE);
    if (!tile) return null;
    const tctx = tile.getContext("2d");
    const img = tctx.createImageData(SIZE, SIZE);
    img.data.set(makeNoiseBytes(SIZE, seed, mono));
    tctx.putImageData(img, 0, 0);
    this._noiseTiles.set(key, tile);
    return tile;
  }

  // Draw a raster ImageMobject into the pixel bounding box of its projected
  // corners (axis-aligned; the common 2D case is exact, 3D is an approximation).
  drawImage(mob: any): void {
    if (!mob.image) return;
    const { ctx, camera } = this;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of mob.points) {
      const [x, y] = camera.toPixel(p);
      minx = Math.min(minx, x); miny = Math.min(miny, y);
      maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
    }
    ctx.save();
    ctx.globalAlpha = mob.opacity ?? 1;
    // manim renders tiny pixel-array images as crisp blocks; honor an
    // explicit `pixelated` flag (set by ImageMobject for small bitmaps).
    if (mob.pixelated && "imageSmoothingEnabled" in ctx) ctx.imageSmoothingEnabled = false;
    try {
      ctx.drawImage(mob.image, minx, miny, maxx - minx, maxy - miny);
    } catch { /* unsupported drawable */ }
    ctx.restore();
  }

  // Draw a ParticleSystem (src/mobject/particles.ts): each live particle is
  // computed closed-form for the system's clock and rasterized directly --
  // thousands of fills, not thousands of mobjects.
  drawParticles(mob: any): void {
    const { ctx, camera } = this;
    const mobOpacity = mob.opacity ?? 1;
    if (mobOpacity <= 0) return;
    const particles = mob.sampleParticles();
    if (!particles.length) return;
    // World-units -> pixels scale from the live projection (honors zoom).
    const [x0] = camera.toPixel([0, 0, 0]);
    const [x1] = camera.toPixel([1, 0, 0]);
    const pxPerUnit = Math.abs(x1 - x0) || 1;
    const square = mob.shape === "square";
    ctx.save();
    for (const p of particles) {
      const alpha = p.opacity * mobOpacity;
      if (alpha <= 0) continue;
      const [px, py] = camera.toPixel([p.x, p.y, 0]);
      const d = Math.max(0.5, p.size * pxPerUnit);
      ctx.fillStyle = p.color.toRGBAString(alpha);
      if (square) {
        ctx.fillRect(px - d / 2, py - d / 2, d, d);
      } else {
        ctx.beginPath();
        ctx.arc(px, py, d / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawText(mob: any): void {
    const { ctx, camera } = this;
    const alpha = (mob.fillOpacity ?? 1) * (mob.opacity ?? 1);
    if (alpha <= 0) return;
    const box = mob.getBoundingBox();
    const center = mob.getCenter();
    const fontHeightWorld = mob.currentFontHeight();
    const fontPx = fontHeightWorld / camera.frameHeight * camera.pixelHeight;
    const lines = mob.text.split("\n");
    const lineStepPx = fontPx * 1.2;

    ctx.save();
    ctx.font = `${mob.slant === "italic" ? "italic " : ""}${mob.weight} ${fontPx}px ${mob.font}`;
    ctx.fillStyle = mob.fillColor.toRGBAString(alpha);
    ctx.textAlign = mob.align === "left" ? "left" : mob.align === "right" ? "right" : "center";
    ctx.textBaseline = "middle";

    // Typewriter reveal: clip to a fraction of the box width.
    const reveal = mob.revealFraction ?? 1;
    const [px0] = camera.toPixel([box.min[0], 0, 0]);
    const [px1] = camera.toPixel([box.max[0], 0, 0]);
    const [, pyTop] = camera.toPixel([0, box.max[1], 0]);
    const [, pyBot] = camera.toPixel([0, box.min[1], 0]);
    if (reveal < 1) {
      ctx.beginPath();
      ctx.rect(px0, pyTop - 4, (px1 - px0) * reveal, (pyBot - pyTop) + 8);
      ctx.clip();
    }

    const anchorX = mob.align === "left" ? box.min[0] : mob.align === "right" ? box.max[0] : center[0];
    const [cx] = camera.toPixel([anchorX, 0, 0]);
    const [, cyTop] = camera.toPixel([0, box.max[1], 0]);
    lines.forEach((line: string, i: number) => {
      const y = cyTop + lineStepPx * (i + 0.5);
      ctx.fillText(line, cx, y);
    });
    ctx.restore();
  }

  // Trace a VMobject's subpaths into the current path, honoring strokeEnd
  // (and optionally strokeStart) for progressive drawing (Create/Write and
  // Motion Canvas's start-side partial draw). Curves in [startProportion,
  // proportion] of the total outline are emitted; entry/exit curves are
  // clipped exactly via partialBezier.
  tracePath(mob: any, proportion = 1, startProportion = 0): void {
    const { ctx, camera } = this;
    const subpaths = mob.getSubpaths();
    const totalCurves = subpaths.reduce((n: number, sp: number[][]) => n + Math.max(0, Math.floor((sp.length - 1) / 3)), 0);
    const drawCurves = totalCurves * Math.max(0, Math.min(1, proportion));
    const skipCurves = totalCurves * Math.max(0, Math.min(1, startProportion));
    let drawn = 0;
    let penDown = false;

    for (const sp of subpaths) {
      const nc = Math.floor((sp.length - 1) / 3);
      if (nc < 1) continue;
      if (drawn >= drawCurves) break;
      penDown = false;
      for (let i = 0; i < nc; i++) {
        if (drawn >= drawCurves) break;
        // Fully before the start window: skip without drawing.
        if (drawn + 1 <= skipCurves) {
          drawn += 1;
          continue;
        }
        let a = sp[3 * i], c1 = sp[3 * i + 1], c2 = sp[3 * i + 2], b = sp[3 * i + 3];
        const t0 = Math.max(0, skipCurves - drawn);
        const t1 = Math.min(1, drawCurves - drawn);
        if (t0 > 0 || t1 < 1) {
          [a, c1, c2, b] = partialBezier(a, c1, c2, b, t0, t1);
        }
        if (!penDown || t0 > 0) {
          const [sx, sy] = camera.toPixel(a);
          ctx.moveTo(sx, sy);
          penDown = true;
        }
        const p1 = camera.toPixel(c1);
        const p2 = camera.toPixel(c2);
        const p3 = camera.toPixel(b);
        ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
        drawn += 1;
      }
    }
  }

  // Build a linear gradient across the mobject's projected bounding box in the
  // sheen direction, from its gradientColors. Returns null if unavailable.
  _buildGradient(mob: any, alpha: number): CanvasGradient | null {
    const colors: any[] = mob.gradientColors;
    if (!colors || colors.length === 0) return null;
    const { ctx, camera } = this;
    // Pixel-space bounding box of the projected points.
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of mob.points) {
      const [x, y] = camera.toPixel(p);
      minx = Math.min(minx, x); miny = Math.min(miny, y);
      maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
    }
    if (!isFinite(minx)) return null;
    // Sheen direction in world space -> pixel space (y flips).
    const dir = mob.sheenDirection ?? [-1, 1, 0];
    const dx = dir[0];
    const dy = -(dir[1] ?? 0); // world y-up -> pixel y-down
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    const hw = (maxx - minx) / 2 || 1, hh = (maxy - miny) / 2 || 1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const grad = ctx.createLinearGradient(
      cx - ux * hw, cy - uy * hh,
      cx + ux * hw, cy + uy * hh,
    );
    const n = colors.length;
    for (let i = 0; i < n; i++) {
      const stop = n === 1 ? 0 : i / (n - 1);
      grad.addColorStop(stop, colors[i].toRGBAString(alpha));
    }
    return grad;
  }

  drawVMobject(mob: any): void {
    const { ctx, camera } = this;
    if (mob.points.length === 0) return;

    const proportion = mob.strokeEnd ?? 1;
    const startProportion = mob.strokeStart ?? 0;
    const opacity = mob.opacity ?? 1;
    const lineJoin: CanvasLineJoin = mob.lineJoin ?? "round";
    const lineCap: CanvasLineCap = mob.lineCap ?? "round";

    // Fill (only meaningful when the whole path is present).
    const fillOpacity = mob.fillOpacity ?? 0;
    if (fillOpacity > 0 && proportion >= 1) {
      ctx.beginPath();
      this.tracePath(mob, 1);
      ctx.closePath();
      const alpha = fillOpacity * opacity;
      const grad = this._buildGradient(mob, alpha);
      ctx.fillStyle = grad ?? mob.fillColor.toRGBAString(alpha);
      ctx.fill("evenodd");
    }

    // Background stroke: a wider stroke drawn under the main stroke.
    const bgWidth = mob.backgroundStrokeWidth ?? 0;
    const bgOpacity = mob.backgroundStrokeOpacity ?? 1;
    if (bgWidth > 0 && bgOpacity > 0 && mob.backgroundStrokeColor) {
      ctx.beginPath();
      this.tracePath(mob, proportion, startProportion);
      ctx.strokeStyle = mob.backgroundStrokeColor.toRGBAString(bgOpacity * opacity);
      ctx.lineWidth = bgWidth * camera.strokeScale();
      ctx.lineJoin = lineJoin;
      ctx.lineCap = lineCap;
      ctx.stroke();
    }

    // Main stroke.
    const strokeOpacity = mob.strokeOpacity ?? 1;
    const strokeWidth = mob.strokeWidth ?? 0;
    if (strokeWidth > 0 && strokeOpacity > 0) {
      ctx.beginPath();
      this.tracePath(mob, proportion, startProportion);
      ctx.strokeStyle = mob.strokeColor.toRGBAString(strokeOpacity * opacity);
      ctx.lineWidth = strokeWidth * camera.strokeScale();
      ctx.lineJoin = lineJoin;
      ctx.lineCap = lineCap;
      ctx.stroke();
    }
  }
}
